import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
// Use WHATWG URL API
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '../dist');

// Configuration
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8443;
const RELAY_TOKEN = (process.env.RELAY_TOKEN || 'saeindia_sec_99348a7b1c0e').trim();

// Allowed Origins for CORS and WebSocket
const ALLOWED_ORIGINS = new Set([
  'https://saeindiasphn.netlify.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8443',
  'http://localhost:8080',
  'capacitor://localhost',
  'http://localhost'
]);

function isOriginAllowed(origin) {
  if (!origin) return true; // Non-browser clients (ESP32, curl, local scripts) have no origin
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+--saeindiasphn\.netlify\.app$/.test(origin)) return true; // Netlify preview deploys
  if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin)) return true;
  return false;
}

// Global Client Tracking
const frontendSockets = new Set();
const esp32Sockets = new Set();
let clientCounter = 0;

// Telemetry & Diagnostic Metrics
let rxBytesTotal = 0;
let txBytesTotal = 0;
let packetsForwarded = 0;
let esp32LastSeen = 0;
let lastHeartbeatTime = Date.now();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
};

// Broadcast relay state to all connected frontends
function broadcastRelayStatus() {
  const esp32Connected = esp32Sockets.size > 0;
  const statusMsg = JSON.stringify({
    type: 'RELAY_STATUS',
    relayOnline: true,
    server: 'sae-india-drone-relay',
    esp32Online: esp32Connected,
    connectorOnline: esp32Connected,
    esp32ClientsCount: esp32Sockets.size,
    frontendClientsCount: frontendSockets.size,
    esp32LastSeen,
    rxBytesTotal,
    txBytesTotal,
    packetsForwarded,
    timestamp: Date.now()
  });

  for (const client of frontendSockets) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(statusMsg);
      } catch (err) {
        // Socket send error handled in error listener
      }
    }
  }
}

// HTTP Server: Handles /health, CORS preflights, static assets & WebSocket upgrade handshakes
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, 'http://localhost');
  const pathname = parsedUrl.pathname || '/';
  const origin = req.headers.origin;

  // Handle CORS headers
  const allowOrigin = isOriginAllowed(origin) ? (origin || '*') : 'https://saeindiasphn.netlify.app';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Relay-Token, X-Client-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Health Status Endpoints (/health, /api/health)
  if (pathname === '/health' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'sae-india-drone-relay',
      websocket: true,
      endpoint: '/ws',
      uptime: Math.floor(process.uptime()),
      esp32Connected: esp32Sockets.size > 0,
      esp32Online: esp32Sockets.size > 0,
      frontendClientsCount: frontendSockets.size,
      esp32ClientsCount: esp32Sockets.size,
      totalClientsCount: frontendSockets.size + esp32Sockets.size,
      rxBytesTotal,
      txBytesTotal,
      packetsForwarded,
      timestamp: Date.now()
    }, null, 2));
    return;
  }

  // 2. Static Asset Serving from dist/ (if built)
  if (fs.existsSync(DIST_DIR)) {
    let filePath = path.join(DIST_DIR, pathname);
    
    // Safety check against path traversal
    if (!filePath.startsWith(DIST_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const isImmutableAsset = pathname.startsWith('/assets/');

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': isImmutableAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // SPA Fallback: Any path without an extension falls back to index.html
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }
  }

  // 3. Root Fallback Info
  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: 'sae-india-drone-relay',
      status: 'ok',
      message: 'SAE INDIA Drone Ground Station WSS Relay is online.',
      endpoints: {
        health: '/health',
        websocket: '/ws',
        connector: '/connector'
      },
      uptime: Math.floor(process.uptime()),
      connectedFrontends: frontendSockets.size,
      connectedEsp32: esp32Sockets.size
    }, null, 2));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
});

// WebSocket Server attached to HTTP Server
const wss = new WebSocketServer({ noServer: true });

// Upgrade Handler
server.on('upgrade', (request, socket, head) => {
  const parsedUrl = new URL(request.url, 'http://localhost');
  const pathname = parsedUrl.pathname || '/';
  const origin = request.headers.origin;
  const remoteAddr = request.socket.remoteAddress || 'unknown';

  console.log(`[WS] Upgrade request from ${remoteAddr} for path '${pathname}' (Origin: ${origin || 'none'})`);

  // Origin check for browser clients
  if (origin && !isOriginAllowed(origin)) {
    console.warn(`[WS] Connection rejected: Origin not allowed '${origin}'`);
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  // Valid routes: /ws, /connector, or root /
  if (pathname === '/ws' || pathname === '/connector' || pathname === '/') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      const queryObj = Object.fromEntries(parsedUrl.searchParams.entries());
      handleClientConnection(ws, request, pathname, queryObj);
    });
    return;
  }

  console.warn(`[WS] Unknown WebSocket path requested: ${pathname}`);
  socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
  socket.destroy();
});

// Unified Connection Handler
function handleClientConnection(ws, request, pathname, query) {
  const clientId = ++clientCounter;
  const remoteAddr = request.socket.remoteAddress || 'unknown';

  ws.isAlive = true;
  ws.clientId = clientId;

  // Determine initial client role
  // 1. Explicit query param (?client=esp32 or ?client=frontend)
  // 2. Path: /connector defaults to esp32
  // 3. Header: x-client-type
  // 4. Default: frontend
  let clientType = 'frontend';
  if (query.client === 'esp32' || pathname === '/connector' || request.headers['x-client-type'] === 'esp32') {
    clientType = 'esp32';
  } else if (query.client === 'frontend' || request.headers['x-client-type'] === 'frontend') {
    clientType = 'frontend';
  }

  ws.clientType = clientType;

  console.log(`[WS] Client connected (ID: ${clientId}, Remote: ${remoteAddr}, Type: ${clientType}, Path: ${pathname})`);

  // Register into appropriate set
  if (clientType === 'esp32') {
    esp32Sockets.add(ws);
    esp32LastSeen = Date.now();
    console.log(`[WS] ESP32 connected (Total ESP32: ${esp32Sockets.size})`);
    broadcastRelayStatus();
  } else {
    frontendSockets.add(ws);
    console.log(`[WS] Frontend connected (Total Frontends: ${frontendSockets.size})`);
  }

  // Mandatory Connection Acknowledgement
  const ackMessage = JSON.stringify({
    type: 'connection_ack',
    status: 'connected',
    server: 'sae-india-drone-relay',
    client: clientType,
    clientId,
    endpoint: pathname,
    esp32Online: esp32Sockets.size > 0,
    timestamp: Date.now()
  });

  try {
    ws.send(ackMessage);
  } catch (err) {
    console.error(`[WS] Connection error sending ack to client ${clientId}:`, err.message);
  }

  // Also send current relay status to newly connected frontends
  if (clientType === 'frontend') {
    try {
      ws.send(JSON.stringify({
        type: 'RELAY_STATUS',
        relayOnline: true,
        server: 'sae-india-drone-relay',
        esp32Online: esp32Sockets.size > 0,
        connectorOnline: esp32Sockets.size > 0,
        esp32ClientsCount: esp32Sockets.size,
        frontendClientsCount: frontendSockets.size,
        esp32LastSeen,
        timestamp: Date.now()
      }));
    } catch (e) {}
  }

  // Pong handler for keepalive tracking
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Message Handler
  ws.on('message', (data, isBinary) => {
    ws.isAlive = true;

    // --- CASE A: Binary Frame (Raw MAVLink Telemetry or Command) ---
    if (isBinary) {
      const length = data.length || (data.byteLength !== undefined ? data.byteLength : 0);
      
      if (ws.clientType === 'esp32') {
        // ESP32 -> Render -> All Frontends
        rxBytesTotal += length;
        packetsForwarded++;
        esp32LastSeen = Date.now();

        if (frontendSockets.size > 0) {
          for (const client of frontendSockets) {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(data, { binary: true });
              } catch (e) {
                console.error(`[WS] Connection error forwarding binary to frontend ${client.clientId}:`, e.message);
              }
            }
          }
          console.log(`[WS] Message forwarded: ESP32 -> ${frontendSockets.size} Frontend(s) (${length} bytes)`);
        }
      } else {
        // Frontend -> Render -> All ESP32 Devices
        txBytesTotal += length;

        if (esp32Sockets.size > 0) {
          for (const esp of esp32Sockets) {
            if (esp.readyState === WebSocket.OPEN) {
              try {
                esp.send(data, { binary: true });
              } catch (e) {
                console.error(`[WS] Connection error forwarding binary to ESP32 ${esp.clientId}:`, e.message);
              }
            }
          }
          console.log(`[WS] Message forwarded: Frontend -> ESP32 (${length} bytes)`);
        } else {
          console.warn(`[WS] Command dropped: Frontend sent ${length} bytes but no ESP32 is currently connected to relay.`);
        }
      }
      return;
    }

    // --- CASE B: Text / JSON Message ---
    try {
      const text = data.toString();
      const msg = JSON.parse(text);
      console.log(`[WS] Message received from ${ws.clientType} (${ws.clientId}): ${msg.type || 'text'}`);

      // 1. Explicit Client Registration Handshake
      if (msg.type === 'register') {
        const targetType = (msg.client || '').toLowerCase();
        if (targetType === 'esp32' && ws.clientType !== 'esp32') {
          frontendSockets.delete(ws);
          esp32Sockets.add(ws);
          ws.clientType = 'esp32';
          ws.deviceId = msg.device_id || 'esp32-drone';
          esp32LastSeen = Date.now();
          console.log(`[WS] ESP32 connected (Client registered: ${ws.deviceId})`);
          broadcastRelayStatus();
        } else if (targetType === 'frontend' && ws.clientType !== 'frontend') {
          esp32Sockets.delete(ws);
          frontendSockets.add(ws);
          ws.clientType = 'frontend';
          console.log(`[WS] Frontend connected (Client registered)`);
          broadcastRelayStatus();
        }

        // Acknowledge registration
        ws.send(JSON.stringify({
          type: 'register_ack',
          status: 'ok',
          client: ws.clientType,
          deviceId: ws.deviceId || null,
          timestamp: Date.now()
        }));
        return;
      }

      // 2. Legacy ESP32 Status Message
      if (msg.type === 'ESP32_STATUS') {
        if (ws.clientType !== 'esp32') {
          frontendSockets.delete(ws);
          esp32Sockets.add(ws);
          ws.clientType = 'esp32';
          console.log(`[WS] ESP32 connected via ESP32_STATUS handshake.`);
        }
        esp32LastSeen = Date.now();
        broadcastRelayStatus();
        return;
      }

      // 3. Heartbeat Ping / Pong
      if (msg.type === 'ping') {
        console.log(`[WS] Heartbeat ping from ${ws.clientType} (${ws.clientId})`);
        try {
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: msg.timestamp || Date.now(),
            serverTimestamp: Date.now()
          }));
        } catch (e) {}
        return;
      }

      if (msg.type === 'pong') {
        ws.isAlive = true;
        return;
      }

      // 4. Test Relay Message
      if (msg.type === 'test') {
        console.log(`[WS] Test message received from ${ws.clientType}: "${msg.message}"`);
        // Echo back to sender
        ws.send(JSON.stringify({
          type: 'test_ack',
          status: 'ok',
          received: msg.message,
          relayedTo: ws.clientType === 'frontend' ? `esp32 (${esp32Sockets.size})` : `frontends (${frontendSockets.size})`,
          timestamp: Date.now()
        }));

        // Forward to the opposite party
        const forwardTarget = ws.clientType === 'frontend' ? esp32Sockets : frontendSockets;
        const relayPayload = JSON.stringify({
          type: 'test_relay',
          from: ws.clientType,
          message: msg.message,
          timestamp: Date.now()
        });

        for (const target of forwardTarget) {
          if (target.readyState === WebSocket.OPEN) {
            try {
              target.send(relayPayload);
            } catch (e) {}
          }
        }
        console.log(`[WS] Message forwarded test message to ${forwardTarget.size} recipient(s)`);
        return;
      }

      // 5. Default: Relay any arbitrary JSON message between ESP32 and Frontend
      if (ws.clientType === 'esp32') {
        for (const client of frontendSockets) {
          if (client.readyState === WebSocket.OPEN) {
            try { client.send(text); } catch (e) {}
          }
        }
      } else {
        for (const esp of esp32Sockets) {
          if (esp.readyState === WebSocket.OPEN) {
            try { esp.send(text); } catch (e) {}
          }
        }
      }

    } catch (err) {
      console.warn(`[WS] Non-JSON text received from ${ws.clientType} (${ws.clientId}):`, data.toString().slice(0, 100));
    }
  });

  // Close Handler
  ws.on('close', (code, reason) => {
    const reasonStr = reason ? reason.toString() : 'None';
    console.log(`[WS] Client disconnected (ID: ${clientId}, Type: ${ws.clientType}, Code: ${code}, Reason: ${reasonStr})`);

    if (ws.clientType === 'esp32') {
      esp32Sockets.delete(ws);
      console.log(`[WS] ESP32 disconnected (Remaining ESP32: ${esp32Sockets.size})`);
      broadcastRelayStatus();
    } else {
      frontendSockets.delete(ws);
      console.log(`[WS] Frontend disconnected (Remaining Frontends: ${frontendSockets.size})`);
    }
  });

  // Error Handler
  ws.on('error', (err) => {
    console.error(`[WS] Connection error (ID: ${clientId}, Type: ${ws.clientType}):`, err.message);
  });
}

// Keepalive Ping Timer: 25 Seconds
// Detects and terminates stale connections, logs heartbeat status
setInterval(() => {
  lastHeartbeatTime = Date.now();
  console.log(`[WS] Heartbeat check (Frontends: ${frontendSockets.size}, ESP32: ${esp32Sockets.size})`);

  const allClients = [...frontendSockets, ...esp32Sockets];
  for (const ws of allClients) {
    if (ws.isAlive === false) {
      console.warn(`[WS] Terminating unresponsive/stale connection (ID: ${ws.clientId}, Type: ${ws.clientType})`);
      try { ws.terminate(); } catch (e) {}
      frontendSockets.delete(ws);
      esp32Sockets.delete(ws);
      continue;
    }

    ws.isAlive = false;
    try {
      ws.ping();
    } catch (e) {
      console.error(`[WS] Failed to send ping to ${ws.clientId}:`, e.message);
    }
  }
}, 25000);

// Start Server on PORT
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 SAE INDIA SECURE WEBSOCKET CLOUD RELAY STARTED`);
  console.log(`📡 Listening on:       0.0.0.0:${PORT}`);
  console.log(`🌐 Primary WSS Route:  wss://saeindia-szj0.onrender.com/ws`);
  console.log(`🔌 Legacy WSS Route:   wss://saeindia-szj0.onrender.com/connector`);
  console.log(`❤️  Health Endpoint:   http://0.0.0.0:${PORT}/health`);
  console.log(`🎯 Frontend Origin:    https://saeindiasphn.netlify.app`);
  console.log(`=======================================================`);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('[WS] SIGTERM received. Shutting down WebSocket relay gracefully...');
  server.close(() => {
    process.exit(0);
  });
});
