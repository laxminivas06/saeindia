/**
 * Central Production Relay & WSS Configuration
 * SAE India Autonomous Drone Rescue Ground Station
 * 
 * Production Topology:
 * - Frontend: Netlify (https://saeindiasphn.netlify.app/)
 * - Backend / WSS Relay: Render (https://saeindia-szj0.onrender.com/)
 * - WSS Relay Endpoint: wss://saeindia-szj0.onrender.com/ws
 * - Hardware: ESP32-S3 Direct WSS / MAVLink Bridge <-> Pixhawk Flight Controller
 */

export const RELAY_CONFIG = {
  // Production Render Cloud Server
  API_BASE_URL: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || 'https://saeindia-szj0.onrender.com',
  WS_BASE_URL: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_BASE_URL) || 'wss://saeindia-szj0.onrender.com',
  
  // Standard WebSocket Endpoint Path
  WS_PATH: '/ws',
  HEALTH_PATH: '/health',
  
  // Computed Endpoints
  get WS_URL(): string {
    const base = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_BASE_URL) || this.WS_BASE_URL;
    return `${base.replace(/\/+$/, '')}${this.WS_PATH}`;
  },
  
  get HEALTH_URL(): string {
    const base = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || this.API_BASE_URL;
    return `${base.replace(/\/+$/, '')}${this.HEALTH_PATH}`;
  },

  // Token (accepted if configured on backend)
  RELAY_TOKEN: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_RELAY_TOKEN) || 'saeindia_sec_99348a7b1c0e',

  // Local development / offline fallbacks
  DEFAULT_LOCAL_HOST: '192.168.31.194',
  DEFAULT_LOCAL_PORT: 8080,
  DEFAULT_LOCAL_PATH: '/ws',
  DEFAULT_BAUD: 57600,
  
  // Reconnect intervals in milliseconds
  RECONNECT_BACKOFF: [1000, 2000, 4000, 8000, 16000, 30000, 60000],
  
  // Application heartbeat interval
  HEARTBEAT_INTERVAL_MS: 25000,

  // Connection timeout before aborting handshake attempt
  CONNECTION_TIMEOUT_MS: 10000
};

export const API_BASE_URL = RELAY_CONFIG.API_BASE_URL;
export const WS_BASE_URL = RELAY_CONFIG.WS_BASE_URL;
export const WS_URL = RELAY_CONFIG.WS_URL;
export const HEALTH_URL = RELAY_CONFIG.HEALTH_URL;
