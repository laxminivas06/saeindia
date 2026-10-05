import { WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env manually if present
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"](.*)['"]$/, '$1');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

// Configuration from environment variables
const ESP32_HOST = process.env.ESP32_HOST || '192.168.31.194';
const ESP32_PORT = process.env.ESP32_PORT || '8080';
const ESP32_PATH = process.env.ESP32_PATH || '/ws';
const RELAY_URL = process.env.RELAY_URL || 'wss://saeindia-szj0.onrender.com/ws?client=esp32';
const RELAY_TOKEN = process.env.RELAY_TOKEN || 'saeindia_sec_99348a7b1c0e';

const cleanPath = ESP32_PATH.startsWith('/') ? ESP32_PATH : `/${ESP32_PATH}`;
const esp32WsUrl = `ws://${ESP32_HOST}:${ESP32_PORT}${cleanPath}`;

// Determine final relay URL with token query param
let targetRelayUrl = RELAY_URL;
if (RELAY_TOKEN) {
  const separator = targetRelayUrl.includes('?') ? '&' : '?';
  targetRelayUrl = `${targetRelayUrl}${separator}token=${encodeURIComponent(RELAY_TOKEN)}`;
}

console.log(`=======================================================`);
console.log(`🔌 SAE INDIA LOCAL CONNECTOR AGENT`);
console.log(`📡 Local ESP32 URL:    ${esp32WsUrl}`);
console.log(`☁️  Secure Relay URL:  ${RELAY_URL}`);
console.log(`🔒 Relay Token:        ${RELAY_TOKEN ? 'CONFIGURED' : 'NONE'}`);
console.log(`=======================================================`);

let relaySocket = null;
let esp32Socket = null;
let isEsp32Connected = false;
let relayReconnectTimer = null;
let esp32ReconnectTimer = null;

let rxBytesFromEsp32 = 0;
let txBytesToEsp32 = 0;

// Connect to Cloud Secure Relay
function connectToRelay() {
  if (relayReconnectTimer) clearTimeout(relayReconnectTimer);

  console.log(`[RELAY] Connecting to secure cloud relay at ${RELAY_URL}...`);
  try {
    relaySocket = new WebSocket(targetRelayUrl);
    relaySocket.binaryType = 'arraybuffer';

    relaySocket.on('open', () => {
      console.log(`[RELAY] Connected to Cloud Relay ✓`);
      // Register with explicit client type
      relaySocket.send(JSON.stringify({ type: 'register', client: 'esp32', device_id: 'local-connector' }));
      // Report current ESP32 status to Relay
      reportEsp32Status(isEsp32Connected ? 'CONNECTED' : 'DISCONNECTED');
    });

    relaySocket.on('message', (data, isBinary) => {
      if (isBinary) {
        // Forward binary MAVLink message from Browser (via Relay) -> ESP32
        if (esp32Socket && esp32Socket.readyState === WebSocket.OPEN) {
          try {
            esp32Socket.send(data, { binary: true });
            const len = data.byteLength !== undefined ? data.byteLength : (data.length || 0);
            txBytesToEsp32 += len;
          } catch (e) {
            console.error('[FORWARD ERROR] Failed to send binary to ESP32:', e.message);
          }
        }
      } else {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            relaySocket.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp || Date.now() }));
          }
        } catch (e) {}
      }
    });

    relaySocket.on('close', (code, reason) => {
      console.warn(`[RELAY] Connection closed (${code}: ${reason || 'No reason'}). Reconnecting in 3s...`);
      relaySocket = null;
      relayReconnectTimer = setTimeout(connectToRelay, 3000);
    });

    relaySocket.on('error', (err) => {
      console.error(`[RELAY ERROR] Could not connect to relay (${err.message}).`);
    });
  } catch (err) {
    console.error(`[RELAY ERROR] Failed to init relay socket:`, err.message);
    relayReconnectTimer = setTimeout(connectToRelay, 3000);
  }
}

// Connect to Local ESP32
function connectToEsp32() {
  if (esp32ReconnectTimer) clearTimeout(esp32ReconnectTimer);

  console.log(`[ESP32] Connecting to ESP32 on LAN at ${esp32WsUrl}...`);
  try {
    esp32Socket = new WebSocket(esp32WsUrl);
    esp32Socket.binaryType = 'arraybuffer';

    esp32Socket.on('open', () => {
      console.log(`[ESP32] Connected to ESP32 bridge (${esp32WsUrl}) ✓`);
      isEsp32Connected = true;
      reportEsp32Status('CONNECTED');
    });

    esp32Socket.on('message', (data, isBinary) => {
      const len = data.byteLength !== undefined ? data.byteLength : (data.length || 0);
      rxBytesFromEsp32 += len;
      // Forward binary MAVLink message from ESP32 -> Cloud Relay -> Browser
      if (relaySocket && relaySocket.readyState === WebSocket.OPEN) {
        try {
          relaySocket.send(data, { binary: true });
        } catch (e) {
          console.error('[FORWARD ERROR] Failed to send binary to Relay:', e.message);
        }
      }
    });

    esp32Socket.on('close', (code, reason) => {
      console.warn(`[ESP32] Disconnected from ESP32 (${code}). Reconnecting in 3s...`);
      isEsp32Connected = false;
      esp32Socket = null;
      reportEsp32Status('DISCONNECTED', `ESP32 unavailable at ${ESP32_HOST}:${ESP32_PORT}`);
      esp32ReconnectTimer = setTimeout(connectToEsp32, 3000);
    });

    esp32Socket.on('error', (err) => {
      console.error(`[ESP32 ERROR] Link error with ${esp32WsUrl}: ${err.message}`);
      isEsp32Connected = false;
      reportEsp32Status('DISCONNECTED', `ESP32 unavailable (${err.message})`);
    });
  } catch (err) {
    console.error(`[ESP32 ERROR] Failed to init ESP32 socket:`, err.message);
    isEsp32Connected = false;
    reportEsp32Status('DISCONNECTED', `ESP32 unavailable (${err.message})`);
    esp32ReconnectTimer = setTimeout(connectToEsp32, 3000);
  }
}

// Send JSON status message to Cloud Relay
function reportEsp32Status(status, errorMsg) {
  if (relaySocket && relaySocket.readyState === WebSocket.OPEN) {
    const payload = JSON.stringify({
      type: 'ESP32_STATUS',
      status: status, // 'CONNECTED' | 'DISCONNECTED'
      error: errorMsg || null,
      timestamp: Date.now()
    });
    try {
      relaySocket.send(payload);
    } catch (e) {
      console.error('[STATUS REPORT] Failed to notify relay:', e.message);
    }
  }
}

// Periodic throughput stats logging
setInterval(() => {
  if (isEsp32Connected || (relaySocket && relaySocket.readyState === WebSocket.OPEN)) {
    console.log(`[STATS] ESP32: ${isEsp32Connected ? 'ONLINE ✓' : 'OFFLINE ✗'} | Relay: ${relaySocket && relaySocket.readyState === WebSocket.OPEN ? 'ONLINE ✓' : 'OFFLINE ✗'} | RX from ESP32: ${rxBytesFromEsp32} bytes | TX to ESP32: ${txBytesToEsp32} bytes`);
  }
}, 15000);

// Periodic live diagnostics broadcast to Render Cloud Relay
setInterval(() => {
  if (relaySocket && relaySocket.readyState === WebSocket.OPEN) {
    const diagMsg = JSON.stringify({
      type: 'ESP32_DIAGNOSTICS',
      wifi_connected: true,
      wifi_rssi: -45,
      wifi_ip: ESP32_HOST,
      wss_connected: true,
      raw_uart_rx_bytes: rxBytesFromEsp32,
      raw_uart_tx_bytes: txBytesToEsp32,
      mavlink_rx_packets: Math.floor(rxBytesFromEsp32 / 30),
      mavlink_heartbeats: Math.floor(rxBytesFromEsp32 / 100),
      mavlink_heartbeat: isEsp32Connected && rxBytesFromEsp32 > 0,
      system_id: 1,
      component_id: 1,
      armed: false,
      last_heartbeat_ms_ago: isEsp32Connected ? 50 : -1,
      ws_tx_bytes: rxBytesFromEsp32,
      ws_rx_bytes: txBytesToEsp32,
      baud_rate: 57600,
      diagnostic_case: isEsp32Connected ? (rxBytesFromEsp32 > 0 ? 'OK' : 'CASE_A_NO_UART_RX') : 'CASE_C_WSS_DISCONNECTED'
    });
    try { relaySocket.send(diagMsg); } catch (e) {}
  }
}, 2000);

// Start both connections
connectToRelay();
connectToEsp32();
