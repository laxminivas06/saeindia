import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse } from 'url';

const PORT = process.env.PORT || 8443;
const RELAY_TOKEN = process.env.RELAY_TOKEN || 'saeindia_secret_token_2026';

// Global relay state
let connectorSocket = null;
let esp32Online = false;
let esp32LastError = '';
const browserSockets = new Set();

let rxBytesTotal = 0;
let txBytesTotal = 0;
let packetsForwarded = 0;

// Create HTTP server for health checks & WebSocket upgrades
const server = http.createServer((req, res) => {
  const parsedUrl = parse(req.url, true);
  
  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      service: 'SAE INDIA MAVLink Secure WSS Relay',
      status: 'ok',
      uptime: process.uptime(),
      connectorOnline: connectorSocket !== null && connectorSocket.readyState === WebSocket.OPEN,
      esp32Online,
      esp32LastError,
      browserClientsCount: browserSockets.size,
      rxBytesTotal,
      txBytesTotal,
      packetsForwarded
    }, null, 2));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocketServer({ noServer: true });

function broadcastStatusToBrowsers() {
  const statusMsg = JSON.stringify({
    type: 'RELAY_STATUS',
    connectorOnline: connectorSocket !== null && connectorSocket.readyState === WebSocket.OPEN,
    esp32Online: connectorSocket !== null && connectorSocket.readyState === WebSocket.OPEN && esp32Online,
    error: connectorSocket === null 
      ? 'ESP32 connector offline' 
      : (!esp32Online ? (esp32LastError || 'ESP32 unavailable') : null)
  });

  for (const client of browserSockets) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(statusMsg);
      } catch (err) {
        // ignore send error
      }
    }
  }
}

// Upgrade handler with token authentication and routing
server.on('upgrade', (request, socket, head) => {
  const parsedUrl = parse(request.url, true);
  const pathname = parsedUrl.pathname;
  const token = parsedUrl.query.token || request.headers['x-relay-token'];

  // Validate authentication token if configured
  if (RELAY_TOKEN && RELAY_TOKEN.trim().length > 0) {
    if (token !== RELAY_TOKEN) {
      console.warn(`[AUTH FAILED] Unauthorized connection attempt to ${pathname} from ${request.socket.remoteAddress}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  // Route: /connector (for local connector agent)
  if (pathname === '/connector') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleConnectorConnection(ws);
    });
    return;
  }

  // Route: /ws or / (for frontend browser client)
  if (pathname === '/ws' || pathname === '/') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleBrowserConnection(ws);
    });
    return;
  }

  socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
  socket.destroy();
});

// Handle Local Connector Agent connection
function handleConnectorConnection(ws) {
  console.log('[CONNECTOR] Local connector connected successfully.');
  
  if (connectorSocket && connectorSocket !== ws) {
    console.warn('[CONNECTOR] Replacing existing connector instance.');
    try {
      connectorSocket.close(1000, 'Superseded by new connector');
    } catch (e) {}
  }

  connectorSocket = ws;
  esp32Online = false;
  esp32LastError = '';

  // Notify all browsers that connector is now online
  broadcastStatusToBrowsers();

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // Binary frame from ESP32 -> Forward to all connected browsers
      rxBytesTotal += data.length;
      packetsForwarded++;
      for (const browser of browserSockets) {
        if (browser.readyState === WebSocket.OPEN) {
          try {
            browser.send(data, { binary: true });
          } catch (e) {
            console.error('[FORWARD ERROR] Failed to send to browser:', e);
          }
        }
      }
    } else {
      // JSON control message from local connector
      try {
        const text = data.toString();
        const msg = JSON.parse(text);
        if (msg.type === 'ESP32_STATUS') {
          esp32Online = msg.status === 'CONNECTED';
          esp32LastError = msg.error || '';
          console.log(`[CONNECTOR REPORT] ESP32 status changed to: ${msg.status} ${esp32LastError ? `(${esp32LastError})` : ''}`);
          broadcastStatusToBrowsers();
        }
      } catch (err) {
        console.warn('[CONNECTOR] Non-JSON text message received:', data.toString());
      }
    }
  });

  ws.on('close', (code, reason) => {
    console.warn(`[CONNECTOR] Local connector disconnected (${code}: ${reason || 'No reason'}).`);
    if (connectorSocket === ws) {
      connectorSocket = null;
      esp32Online = false;
      esp32LastError = 'ESP32 connector offline';
      broadcastStatusToBrowsers();
    }
  });

  ws.on('error', (err) => {
    console.error('[CONNECTOR ERROR]', err.message);
  });
}

// Handle Browser Frontend connection
function handleBrowserConnection(ws) {
  console.log(`[BROWSER] Frontend client connected (Total: ${browserSockets.size + 1})`);
  browserSockets.add(ws);

  // Immediately send initial status to the browser
  const initialStatus = JSON.stringify({
    type: 'RELAY_STATUS',
    connectorOnline: connectorSocket !== null && connectorSocket.readyState === WebSocket.OPEN,
    esp32Online: connectorSocket !== null && connectorSocket.readyState === WebSocket.OPEN && esp32Online,
    error: connectorSocket === null 
      ? 'ESP32 connector offline' 
      : (!esp32Online ? (esp32LastError || 'ESP32 unavailable') : null)
  });
  ws.send(initialStatus);

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // Binary MAVLink frame from Browser -> Forward to local connector -> ESP32
      txBytesTotal += data.length;
      if (connectorSocket && connectorSocket.readyState === WebSocket.OPEN) {
        try {
          connectorSocket.send(data, { binary: true });
        } catch (err) {
          console.error('[FORWARD ERROR] Failed to send to connector:', err);
        }
      }
    }
  });

  ws.on('close', () => {
    browserSockets.delete(ws);
    console.log(`[BROWSER] Frontend client disconnected (Remaining: ${browserSockets.size})`);
  });

  ws.on('error', (err) => {
    console.warn('[BROWSER ERROR]', err.message);
    browserSockets.delete(ws);
  });
}

// Keepalive heartbeat to prevent idle connection termination
setInterval(() => {
  if (connectorSocket && connectorSocket.readyState === WebSocket.OPEN) {
    try {
      connectorSocket.ping();
    } catch (e) {}
  }
  for (const client of browserSockets) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.ping();
      } catch (e) {}
    }
  }
}, 25000);

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 SAE INDIA SECURE WEBSOCKET RELAY RUNNING`);
  console.log(`📡 Port:               ${PORT}`);
  console.log(`🔒 Token Auth:         ${RELAY_TOKEN ? 'ENABLED' : 'DISABLED'}`);
  console.log(`🌐 Browser Endpoint:   /ws (e.g. wss://YOUR-DOMAIN/ws?token=...)`);
  console.log(`🔌 Connector Endpoint: /connector`);
  console.log(`❤️  Health Check:       http://localhost:${PORT}/health`);
  console.log(`=======================================================`);
});
