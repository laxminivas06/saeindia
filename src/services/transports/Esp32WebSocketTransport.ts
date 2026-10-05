import { MavlinkTransport, TransportStateEvent, TransportType } from '../../types/transport';
import { RELAY_CONFIG, WS_URL, HEALTH_URL } from '../../config/relayConfig';

export type WebSocketConnectionMode = 'LOCAL' | 'SECURE';
export type WebSocketProtocolMode = 'AUTO' | 'WS' | 'WSS';
export type Esp32LinkState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';
export type Esp32ErrorCategory =
  | 'NONE'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_TIMEOUT'
  | 'HANDSHAKE_FAILURE'
  | 'WSS_TLS_FAILURE'
  | 'MIXED_CONTENT_BLOCK'
  | 'INVALID_ENDPOINT'
  | 'ESP32_UNAVAILABLE'
  | 'RELAY_UNAVAILABLE'
  | 'CONNECTOR_OFFLINE'
  | 'HEARTBEAT_TIMEOUT'
  | 'SERVER_UNAVAILABLE';

export interface Esp32WebSocketOptions {
  protocolMode?: WebSocketProtocolMode;
  mode?: WebSocketConnectionMode;
  host?: string;
  port?: number;
  path?: string;
  secureEndpoint?: string;
  relayToken?: string;
  protocol?: 'ws' | 'wss';
  baudRate?: number;
  wifiSsid?: string;
}

export interface CloudHealthResult {
  reachable: boolean;
  status?: string;
  service?: string;
  websocket?: boolean;
  esp32Online?: boolean;
  frontendClientsCount?: number;
  latencyMs?: number;
  message?: string;
}

export class Esp32WebSocketTransport implements MavlinkTransport {
  public readonly id = 'esp32_websocket';
  public readonly name = 'ESP32-S3 Wireless MAVLink Bridge';
  public readonly type: TransportType = 'ESP32_WEBSOCKET';

  private dataListeners: Set<(chunk: Uint8Array) => void> = new Set();
  private stateListeners: Set<(event: TransportStateEvent) => void> = new Set();

  private socket: WebSocket | null = null;

  // Protocol configuration: 'AUTO' | 'WS' | 'WSS'
  private protocolMode: WebSocketProtocolMode = 'WSS';
  // Connection Mode: 'LOCAL' (ws://) vs 'SECURE' (wss://)
  private connectionMode: WebSocketConnectionMode = 'SECURE';

  private localHost: string = RELAY_CONFIG.DEFAULT_LOCAL_HOST;
  private localPort: number = RELAY_CONFIG.DEFAULT_LOCAL_PORT;
  private path: string = RELAY_CONFIG.WS_PATH;
  private secureEndpoint: string = RELAY_CONFIG.WS_URL;
  private relayToken: string = RELAY_CONFIG.RELAY_TOKEN;
  private currentProtocol: 'ws' | 'wss' = 'wss';
  private currentBaudRate: number = RELAY_CONFIG.DEFAULT_BAUD;

  // Relay Multi-Hop Status (from Cloud Relay server)
  private relayOnline: boolean = false;
  private connectorOnline: boolean = false;
  private esp32Online: boolean = false;
  private ackReceived: boolean = false;

  // Link State
  private linkState: Esp32LinkState = 'DISCONNECTED';
  private errorCategory: Esp32ErrorCategory = 'NONE';
  private lastErrorMessage: string = '';
  private latencyMs: number = 0;
  private connectStartTime: number = 0;
  private connectedTimestamp: number = 0;
  private lastPingSentTime: number = 0;

  // Live ESP32 Hardware Diagnostics (from ESP32_DIAGNOSTICS message)
  private esp32WifiConnected: boolean = false;
  private esp32WifiRssi: number = 0;
  private esp32WifiIp: string = '';
  private esp32WssConnected: boolean = false;
  private esp32UartRxBytes: number = 0;
  private esp32UartTxBytes: number = 0;
  private esp32WsTxBytes: number = 0;
  private esp32WsRxBytes: number = 0;
  private esp32MavlinkRxPackets: number = 0;
  private esp32MavlinkHeartbeats: number = 0;
  private esp32MavlinkHeartbeatDetected: boolean = false;
  private esp32DiagnosticCase: string = 'CHECKING';
  private lastEsp32DiagTimestamp: number = 0;

  // Cloud Health Cache
  private lastCloudHealth: CloudHealthResult = { reachable: false, message: 'Not checked yet' };

  // Wi-Fi State Persistence
  private wifiSsid: string = 'drone123';
  private wifiConnected: boolean = true;

  private isConnecting: boolean = false;
  private manualDisconnect: boolean = false;

  // Reconnect management: Single timer guaranteed, exponential backoff
  private reconnectAttempts: number = 0;
  private reconnectTimer: any = null;
  private connectTimeoutTimer: any = null;
  private pingIntervalTimer: any = null;

  // Cumulative Metrics
  private cumulativeRxBytes: number = 0;
  private cumulativeTxBytes: number = 0;
  private lastPacketTimestamp: number = 0;

  constructor() {
    const isHttpsOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';

    if (isHttpsOrigin) {
      this.protocolMode = 'WSS';
      this.connectionMode = 'SECURE';
      this.currentProtocol = 'wss';
      this.secureEndpoint = RELAY_CONFIG.WS_URL;
    } else {
      this.protocolMode = 'AUTO';
      this.connectionMode = 'SECURE';
      this.currentProtocol = 'wss';
      this.secureEndpoint = RELAY_CONFIG.WS_URL;
    }

    if (typeof window !== 'undefined') {
      try {
        const savedProtoMode = localStorage.getItem('esp32_proto_mode') as WebSocketProtocolMode;
        const savedMode = localStorage.getItem('esp32_conn_mode');
        const savedHost = localStorage.getItem('esp32_host');
        const savedPort = localStorage.getItem('esp32_port');
        const savedPath = localStorage.getItem('esp32_path');
        const savedSecureEndpoint = localStorage.getItem('esp32_secure_endpoint');
        const savedToken = localStorage.getItem('esp32_relay_token');
        const savedBaud = localStorage.getItem('esp32_baud');
        const savedSsid = localStorage.getItem('esp32_wifi_ssid');

        if (!isHttpsOrigin && (savedProtoMode === 'AUTO' || savedProtoMode === 'WS' || savedProtoMode === 'WSS')) {
          this.protocolMode = savedProtoMode;
        }

        if (savedHost && savedHost.trim().length > 0) this.localHost = savedHost.trim();
        if (savedPort) this.localPort = parseInt(savedPort, 10) || 8080;
        if (savedPath) this.path = savedPath.trim();
        
        // Clean up legacy URLs
        if (savedSecureEndpoint && savedSecureEndpoint.trim().length > 0) {
          if (savedSecureEndpoint.includes('saeindia-relay.onrender.com') || savedSecureEndpoint.includes('/connector')) {
            this.secureEndpoint = RELAY_CONFIG.WS_URL;
            localStorage.setItem('esp32_secure_endpoint', RELAY_CONFIG.WS_URL);
          } else {
            this.secureEndpoint = savedSecureEndpoint.trim();
          }
        } else {
          this.secureEndpoint = RELAY_CONFIG.WS_URL;
        }

        if (savedToken && savedToken.trim().length > 0) this.relayToken = savedToken.trim();
        if (savedBaud) this.currentBaudRate = parseInt(savedBaud, 10) || 57600;
        if (savedSsid) this.wifiSsid = savedSsid;

        // Auto-reconnect after browser reload if previously connected
        const autoConnect = localStorage.getItem('esp32_autoconnect');
        if (autoConnect === 'true') {
          setTimeout(() => {
            if (!this.manualDisconnect && !this.socket) {
              console.log('[WSS] Auto-reconnecting to production relay from localStorage…');
              this.connect();
            }
          }, 500);
        }
      } catch (e) {
        // ignore localStorage errors
      }
    }
  }

  public isAvailable(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  public isRelayOnline(): boolean {
    return this.relayOnline;
  }

  public isConnectorOnline(): boolean {
    return this.connectorOnline;
  }

  public isEsp32Online(): boolean {
    return this.esp32Online;
  }

  public isAckReceived(): boolean {
    return this.ackReceived;
  }

  public getRelayToken(): string {
    return this.relayToken;
  }

  public getProtocolMode(): WebSocketProtocolMode {
    return this.protocolMode;
  }

  public getConnectionMode(): WebSocketConnectionMode {
    return this.connectionMode;
  }

  public getLinkState(): Esp32LinkState {
    return this.linkState;
  }

  public getErrorCategory(): Esp32ErrorCategory {
    return this.errorCategory;
  }

  public getLastErrorMessage(): string {
    return this.lastErrorMessage;
  }

  public getLatencyMs(): number {
    return this.latencyMs;
  }

  public getHost(): string {
    return this.localHost;
  }

  public getPort(): number {
    return this.localPort;
  }

  public getPath(): string {
    return this.path;
  }

  public getSecureEndpoint(): string {
    return this.secureEndpoint || RELAY_CONFIG.WS_URL;
  }

  public getProtocol(): 'ws' | 'wss' {
    return this.currentProtocol;
  }

  public getBaudRate(): number {
    return this.currentBaudRate;
  }

  public getWifiSsid(): string {
    return this.wifiSsid;
  }

  public isWifiConnected(): boolean {
    return this.wifiConnected;
  }

  public getLastCloudHealth(): CloudHealthResult {
    return this.lastCloudHealth;
  }

  public setWifiSsid(ssid: string) {
    this.wifiSsid = ssid.trim();
    this.wifiConnected = true;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('esp32_wifi_ssid', this.wifiSsid);
      } catch (e) {}
    }
  }

  public resetWifi() {
    this.wifiSsid = '';
    this.wifiConnected = false;
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('esp32_wifi_ssid');
        localStorage.setItem('esp32_autoconnect', 'false');
      } catch (e) {}
    }
    this.disconnect();
  }

  private formatPath(p: string): string {
    const trimmed = (p || '').trim();
    if (!trimmed) return '/ws';
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }

  public isPrivateIp(hostOrUrl: string): boolean {
    const cleanHost = hostOrUrl
      .replace(/^wss?:\/\//i, '')
      .replace(/^https?:\/\//i, '')
      .split(':')[0]
      .split('/')[0]
      .trim();
    if (cleanHost === 'localhost' || cleanHost === '127.0.0.1') return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(cleanHost)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanHost)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(cleanHost)) return true;
    return false;
  }

  public determineProtocol(forcedProto?: 'ws' | 'wss'): 'ws' | 'wss' {
    const isHttpsOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';
    if (isHttpsOrigin) {
      return 'wss';
    }
    if (forcedProto) return forcedProto;
    if (this.protocolMode === 'WS') return 'ws';
    if (this.protocolMode === 'WSS') return 'wss';
    return 'wss';
  }

  public getResolvedUrl(overrideProto?: 'ws' | 'wss'): string {
    const proto = this.determineProtocol(overrideProto);
    const formattedPath = this.formatPath(this.path);

    if (proto === 'wss') {
      let ep = (this.secureEndpoint || RELAY_CONFIG.WS_URL).trim();
      let url = ep.replace(/^ws:\/\//i, 'wss://');
      if (!url.startsWith('wss://')) {
        url = `wss://${url}`;
      }

      // Ensure appropriate path is present
      try {
        const u = new URL(url.replace('wss://', 'https://'));
        if (!u.pathname || u.pathname === '/') {
          url = `${url.replace(/\/$/, '')}${formattedPath}`;
        }
      } catch (e) {
        if (!url.includes('/')) {
          url = `${url}${formattedPath}`;
        }
      }

      // Client identification query parameter
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}client=frontend`;

      return url;
    } else {
      return `ws://${this.localHost}:${this.localPort}${formattedPath}?client=frontend`;
    }
  }

  public setConfig(options: Esp32WebSocketOptions) {
    const isHttpsOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';

    if (isHttpsOrigin) {
      this.protocolMode = 'WSS';
      this.connectionMode = 'SECURE';
    } else if (options.protocolMode) {
      this.protocolMode = options.protocolMode;
      this.connectionMode = options.protocolMode === 'WSS' ? 'SECURE' : 'LOCAL';
    } else if (options.mode) {
      this.connectionMode = options.mode;
      this.protocolMode = options.mode === 'SECURE' ? 'WSS' : 'AUTO';
    }

    if (options.host !== undefined && options.host.trim().length > 0) {
      this.localHost = options.host.trim();
    }
    if (options.port !== undefined && options.port > 0) {
      this.localPort = options.port;
    }
    if (options.path !== undefined) {
      this.path = options.path.trim();
    }
    if (options.secureEndpoint !== undefined && options.secureEndpoint.trim().length > 0) {
      this.secureEndpoint = options.secureEndpoint.trim();
    }
    if (options.relayToken !== undefined) {
      this.relayToken = options.relayToken.trim();
    }
    if (options.baudRate !== undefined && options.baudRate > 0) {
      this.currentBaudRate = options.baudRate;
    }
    if (options.wifiSsid) {
      this.wifiSsid = options.wifiSsid.trim();
      this.wifiConnected = true;
    }

    this.currentProtocol = this.determineProtocol(options.protocol);

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('esp32_proto_mode', this.protocolMode);
        localStorage.setItem('esp32_conn_mode', this.connectionMode);
        localStorage.setItem('esp32_host', this.localHost);
        localStorage.setItem('esp32_port', this.localPort.toString());
        localStorage.setItem('esp32_path', this.path);
        localStorage.setItem('esp32_secure_endpoint', this.secureEndpoint);
        localStorage.setItem('esp32_relay_token', this.relayToken);
        localStorage.setItem('esp32_proto', this.currentProtocol);
        localStorage.setItem('esp32_baud', this.currentBaudRate.toString());
        if (this.wifiSsid) localStorage.setItem('esp32_wifi_ssid', this.wifiSsid);
      } catch (e) {}
    }
  }

  /**
   * Health Check against Cloud Server (HTTPS GET /health)
   */
  public async checkCloudServerHealth(): Promise<CloudHealthResult> {
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(HEALTH_URL, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;
      if (res.ok) {
        const data = await res.json();
        const result: CloudHealthResult = {
          reachable: true,
          status: data.status || 'ok',
          service: data.service || 'sae-india-drone-relay',
          websocket: data.websocket === true,
          esp32Online: Boolean(data.esp32Online || data.esp32Connected),
          frontendClientsCount: data.frontendClientsCount || 0,
          latencyMs,
          message: `Render Cloud Relay reachable (${latencyMs}ms)`
        };
        this.lastCloudHealth = result;
        return result;
      } else {
        const result: CloudHealthResult = {
          reachable: false,
          latencyMs,
          message: `Cloud server returned HTTP ${res.status} ${res.statusText}`
        };
        this.lastCloudHealth = result;
        return result;
      }
    } catch (err: any) {
      const result: CloudHealthResult = {
        reachable: false,
        message: err.name === 'AbortError' ? 'Cloud health check timed out (6s)' : (err.message || 'Cannot reach Render cloud server')
      };
      this.lastCloudHealth = result;
      return result;
    }
  }

  /**
   * Direct ESP32 LAN ping check
   */
  public async checkEsp32Http(host?: string, port?: number): Promise<{ reachable: boolean; latencyMs?: number; message?: string }> {
    const targetHost = host ? host.trim() : this.localHost;
    const targetPort = port || this.localPort;
    const portPart = targetPort === 80 ? '' : `:${targetPort}`;
    const testUrl = `http://${targetHost}${portPart}/`;
    const startTime = Date.now();

    const isHttpsOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';
    if (isHttpsOrigin) {
      return {
        reachable: false,
        message: `HTTP ping to http://${targetHost}${portPart}/ is blocked by the browser on HTTPS (Mixed Content restriction). Use Cloud Relay WSS mode.`
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      await fetch(testUrl, {
        method: 'GET',
        mode: 'no-cors',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const latency = Date.now() - startTime;
      return {
        reachable: true,
        latencyMs: latency,
        message: `ESP32 reachable at ${targetHost}${portPart} (${latency}ms)`
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { reachable: false, message: `ESP32 at ${targetHost}${portPart} timed out (2.5s). Ensure device is on the same local Wi-Fi.` };
      }
      return { reachable: false, message: `Could not reach http://${targetHost}${portPart}/: ${err.message || 'Host unreachable'}` };
    }
  }

  public async connect(options?: Esp32WebSocketOptions): Promise<boolean> {
    if (!this.isAvailable()) {
      this.linkState = 'ERROR';
      this.errorCategory = 'INVALID_ENDPOINT';
      this.lastErrorMessage = 'WebSocket is not supported in this browser environment.';
      this.notifyState({
        phase: 'USB_NOT_DETECTED',
        message: this.lastErrorMessage,
        error: this.lastErrorMessage
      });
      return false;
    }

    if (options) {
      this.setConfig(options);
    }

    // Reset flags & clear existing timers
    this.manualDisconnect = false;
    this.reconnectAttempts = 0;
    this.clearAllTimers();
    this.cleanupSocket(false);

    // Initial state transition
    this.linkState = 'CONNECTING';
    this.errorCategory = 'NONE';
    this.lastErrorMessage = '';
    this.ackReceived = false;

    const initialProto = this.determineProtocol();
    return this.attemptConnection(initialProto);
  }

  private async attemptConnection(protocolToTry: 'ws' | 'wss'): Promise<boolean> {
    // Prevent duplicate connections if socket is already open or connecting
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      console.warn('[WSS] Socket already active. Cleaning up before new connection attempt.');
      this.cleanupSocket(false);
    }

    const wsUrl = this.getResolvedUrl(protocolToTry);
    const isHttpsOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';

    console.log('[WSS] Connecting...');
    console.log('[WSS] URL:', wsUrl);

    if (isHttpsOrigin && wsUrl.startsWith('ws://')) {
      const mixedMsg = `Browser blocks plain ws:// connections from HTTPS (${window.location.origin}). Using WSS relay.`;
      console.warn(mixedMsg);
      this.linkState = 'ERROR';
      this.errorCategory = 'MIXED_CONTENT_BLOCK';
      this.lastErrorMessage = mixedMsg;
      this.notifyState({
        phase: 'SERIAL_OPEN_FAILED',
        message: mixedMsg,
        error: 'Mixed-content browser blocking'
      });
      return false;
    }

    return new Promise<boolean>((resolve) => {
      this.isConnecting = true;
      this.linkState = 'CONNECTING';
      this.connectStartTime = Date.now();
      this.ackReceived = false;

      this.notifyState({
        phase: 'SERIAL_OPENING',
        message: `WSS CONNECTING: Opening connection to ${wsUrl}…`
      });

      // 10-second connection timeout watchdog
      this.connectTimeoutTimer = setTimeout(() => {
        if (this.isConnecting && (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.ackReceived)) {
          this.isConnecting = false;
          this.cleanupSocket(false);

          this.linkState = 'ERROR';
          this.errorCategory = 'RELAY_UNAVAILABLE';
          this.lastErrorMessage = `WSS connection to ${wsUrl} timed out after 10s.`;
          console.error(`[WSS ERROR] ${this.lastErrorMessage}`);

          this.notifyState({
            phase: 'SERIAL_OPEN_FAILED',
            message: this.lastErrorMessage,
            error: 'RELAY_UNAVAILABLE'
          });

          this.scheduleReconnect(protocolToTry);
          resolve(false);
        }
      }, RELAY_CONFIG.CONNECTION_TIMEOUT_MS);

      try {
        const socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';
        this.socket = socket;

        socket.onopen = () => {
          console.log('[WSS] Open');
          this.currentProtocol = protocolToTry;

          // Explicit Registration Handshake
          try {
            socket.send(JSON.stringify({
              type: 'register',
              client: 'frontend',
              timestamp: Date.now()
            }));
          } catch (e) {
            console.error('[WSS] Failed to send registration handshake:', e);
          }

          // Await connection_ack from server before declaring fully connected
          console.log('[WSS] Awaiting connection_ack from Render relay…');
          this.notifyState({
            phase: 'SERIAL_OPENING',
            message: 'WSS CONNECTING: Handshake sent, awaiting server acknowledgement…'
          });
        };

        socket.onmessage = (event: MessageEvent) => {
          this.lastPacketTimestamp = Date.now();

          // --- Binary MAVLink frame from Drone/ESP32 via Relay ---
          if (event.data instanceof ArrayBuffer) {
            const chunk = new Uint8Array(event.data);
            this.cumulativeRxBytes += chunk.length;
            console.log(`[WSS] Received telemetry (${chunk.length} bytes)`);
            this.dataListeners.forEach((fn) => fn(chunk));
            return;
          } else if (event.data instanceof Blob) {
            const reader = new FileReader();
            reader.onload = () => {
              if (reader.result instanceof ArrayBuffer) {
                const chunk = new Uint8Array(reader.result);
                this.cumulativeRxBytes += chunk.length;
                console.log(`[WSS] Received telemetry (${chunk.length} bytes)`);
                this.dataListeners.forEach((fn) => fn(chunk));
              }
            };
            reader.readAsArrayBuffer(event.data);
            return;
          }

          // --- JSON Control / Heartbeat Frames ---
          if (typeof event.data === 'string') {
            try {
              const msg = JSON.parse(event.data);

              // 1. Mandatory Connection Acknowledgement from Relay
              if (msg.type === 'connection_ack') {
                console.log('[WSS] Received: connection_ack', msg);
                this.clearAllTimers();
                this.isConnecting = false;
                this.ackReceived = true;
                this.connectedTimestamp = Date.now();
                this.reconnectAttempts = 0; // Reset counter on successful connection
                this.linkState = 'CONNECTED';
                this.relayOnline = true;
                this.errorCategory = 'NONE';
                this.lastErrorMessage = '';
                this.latencyMs = Math.max(1, Date.now() - this.connectStartTime);

                if (typeof window !== 'undefined') {
                  try { localStorage.setItem('esp32_autoconnect', 'true'); } catch (e) {}
                }

                // Start periodic application-level ping keepalive
                this.startPingInterval();

                const successMsg = `WSS CONNECTED to Render Cloud Relay (${wsUrl}) ✓ Latency: ${this.latencyMs}ms. Waiting for Pixhawk MAVLink Heartbeat…`;
                console.log(`[WSS] ${successMsg}`);

                this.notifyState({
                  phase: 'SERIAL_OPEN',
                  message: successMsg,
                  device: {
                    deviceName: `Render Cloud Relay (${RELAY_CONFIG.WS_BASE_URL})`,
                    productName: `Render WSS Relay [${protocolToTry.toUpperCase()}]`,
                    manufacturerName: 'SAE India Drone System',
                    driverType: 'ESP32_WEBSOCKET',
                    hasPermission: true,
                    baudRate: this.currentBaudRate
                  }
                });
                resolve(true);
                return;
              }

              // 2. ESP32 Live Hardware Diagnostics
              if (msg.type === 'ESP32_DIAGNOSTICS') {
                this.esp32Online = true;
                this.esp32WifiConnected = Boolean(msg.wifi_connected);
                this.esp32WifiRssi = Number(msg.wifi_rssi) || 0;
                this.esp32WifiIp = String(msg.wifi_ip || '');
                if (msg.wifi_ssid) this.wifiSsid = String(msg.wifi_ssid);
                this.esp32WssConnected = Boolean(msg.wss_connected);
                this.esp32UartRxBytes = Number(msg.raw_uart_rx_bytes) || 0;
                this.esp32UartTxBytes = Number(msg.raw_uart_tx_bytes) || 0;
                this.esp32WsTxBytes = Number(msg.ws_tx_bytes) || 0;
                this.esp32WsRxBytes = Number(msg.ws_rx_bytes) || 0;
                this.esp32MavlinkRxPackets = Number(msg.mavlink_rx_packets) || 0;
                this.esp32MavlinkHeartbeats = Number(msg.mavlink_heartbeats) || 0;
                this.esp32MavlinkHeartbeatDetected = Boolean(msg.mavlink_heartbeat);
                this.esp32DiagnosticCase = String(msg.diagnostic_case || 'OK');
                this.lastEsp32DiagTimestamp = Date.now();

                this.notifyState({
                  phase: this.linkState === 'CONNECTED' ? 'SERIAL_OPEN' : 'SERIAL_OPENING',
                  message: `ESP32 Diag: UART RX ${this.esp32UartRxBytes} B, MAVLink ${this.esp32MavlinkRxPackets} pkts (${this.esp32DiagnosticCase})`
                });
                return;
              }

              // 3. Relay Status Broadcast
              if (msg.type === 'RELAY_STATUS') {
                this.relayOnline = true;
                this.connectorOnline = Boolean(msg.connectorOnline);
                this.esp32Online = Boolean(msg.esp32Online);

                if (msg.esp32Diagnostics) {
                  const d = msg.esp32Diagnostics;
                  this.esp32WifiConnected = Boolean(d.wifi_connected);
                  this.esp32WifiRssi = Number(d.wifi_rssi) || 0;
                  this.esp32WifiIp = String(d.wifi_ip || '');
                  if (d.wifi_ssid) this.wifiSsid = String(d.wifi_ssid);
                  this.esp32WssConnected = Boolean(d.wss_connected);
                  this.esp32UartRxBytes = Number(d.raw_uart_rx_bytes) || 0;
                  this.esp32UartTxBytes = Number(d.raw_uart_tx_bytes) || 0;
                  this.esp32WsTxBytes = Number(d.ws_tx_bytes) || 0;
                  this.esp32WsRxBytes = Number(d.ws_rx_bytes) || 0;
                  this.esp32MavlinkRxPackets = Number(d.mavlink_rx_packets) || 0;
                  this.esp32MavlinkHeartbeats = Number(d.mavlink_heartbeats) || 0;
                  this.esp32MavlinkHeartbeatDetected = Boolean(d.mavlink_heartbeat);
                  this.esp32DiagnosticCase = String(d.diagnostic_case || 'OK');
                  this.lastEsp32DiagTimestamp = Date.now();
                }

                this.notifyState({
                  phase: this.linkState === 'CONNECTED' ? 'SERIAL_OPEN' : 'SERIAL_OPENING',
                  message: this.esp32Online
                    ? 'WSS Relay active: ESP32 Drone is ONLINE ✓'
                    : 'WSS Relay active: Waiting for ESP32 Drone to connect…'
                });
                return;
              }

              // 4. Heartbeat Pong Response
              if (msg.type === 'pong') {
                const roundTrip = Date.now() - (msg.timestamp || this.lastPingSentTime || Date.now());
                this.latencyMs = Math.max(1, roundTrip);
                console.log(`[WSS] Pong received. Latency: ${this.latencyMs}ms`);
                return;
              }

              // 5. Test Message Acknowledgement
              if (msg.type === 'test_ack' || msg.type === 'test_relay') {
                console.log('[WSS] Test message event:', msg);
                return;
              }

            } catch (err) {
              // Non-JSON string message -> treat as binary MAVLink bytes
              const encoder = new TextEncoder();
              const chunk = encoder.encode(event.data);
              this.cumulativeRxBytes += chunk.length;
              this.dataListeners.forEach((fn) => fn(chunk));
            }
          }
        };

        socket.onerror = (err: Event) => {
          console.error('[WSS] Connection error:', err);
          this.clearAllTimers();
          this.isConnecting = false;

          const diagCategory: Esp32ErrorCategory = 'RELAY_UNAVAILABLE';
          const diagMsg = `WSS connection error with ${wsUrl}. Verify Render service is active.`;

          this.linkState = 'ERROR';
          this.errorCategory = diagCategory;
          this.lastErrorMessage = diagMsg;

          this.notifyState({
            phase: 'SERIAL_OPEN_FAILED',
            message: diagMsg,
            error: diagCategory
          });
          resolve(false);
        };

        socket.onclose = (event: CloseEvent) => {
          console.log('[WSS] Closing');
          console.log(`[WSS] Closed (Code: ${event.code}, Clean: ${event.wasClean}, Reason: ${event.reason || 'None'})`);

          this.clearAllTimers();
          this.stopPingInterval();
          this.isConnecting = false;
          this.socket = null;
          this.ackReceived = false;

          // Manual disconnect: do not reconnect
          if (this.manualDisconnect) {
            this.linkState = 'DISCONNECTED';
            this.errorCategory = 'NONE';
            this.lastErrorMessage = 'WSS DISCONNECTED: Disconnected by user';
            this.notifyState({
              phase: 'DISCONNECTED',
              message: 'WSS DISCONNECTED by user.'
            });
            return;
          }

          // Initial connection failure handled by onerror / timeout
          if (this.linkState === 'CONNECTING') {
            return;
          }

          // Automatic Reconnect Sequence
          this.linkState = 'RECONNECTING';
          this.scheduleReconnect(protocolToTry);
        };

      } catch (err: any) {
        this.clearAllTimers();
        this.isConnecting = false;
        console.error('[WSS] Exception during WebSocket creation:', err);

        this.linkState = 'ERROR';
        this.errorCategory = 'INVALID_ENDPOINT';
        this.lastErrorMessage = `Failed to initialize WSS: ${err.message || err}`;

        this.notifyState({
          phase: 'SERIAL_OPEN_FAILED',
          message: this.lastErrorMessage,
          error: 'INVALID_ENDPOINT'
        });
        resolve(false);
      }
    });
  }

  /**
   * Exponential backoff reconnect:
   * 1s -> 2s -> 4s -> 8s -> 16s -> 30s -> 60s max
   * Guaranteed single timer. Retries indefinitely until connected or manual disconnect.
   */
  private scheduleReconnect(protocolToTry: 'ws' | 'wss') {
    if (this.manualDisconnect) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectAttempts++;
    const backoffDelays = RELAY_CONFIG.RECONNECT_BACKOFF;
    const delay = backoffDelays[Math.min(this.reconnectAttempts - 1, backoffDelays.length - 1)] || 60000;

    const reconMsg = `WSS RECONNECTING in ${delay / 1000}s (Attempt ${this.reconnectAttempts})…`;
    console.log(`[WSS] Reconnecting... (${reconMsg})`);

    this.notifyState({
      phase: 'WAITING_FOR_MAVLINK',
      message: reconMsg
    });

    this.reconnectTimer = setTimeout(() => {
      if (!this.manualDisconnect) {
        this.attemptConnection(protocolToTry);
      }
    }, delay);
  }

  /**
   * Start keepalive application-level ping (every 25 seconds)
   */
  private startPingInterval() {
    this.stopPingInterval();
    this.pingIntervalTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.lastPingSentTime = Date.now();
          this.socket.send(JSON.stringify({
            type: 'ping',
            timestamp: this.lastPingSentTime
          }));
        } catch (e) {
          console.warn('[WSS] Failed to send keepalive ping:', e);
        }
      }
    }, RELAY_CONFIG.HEARTBEAT_INTERVAL_MS);
  }

  private stopPingInterval() {
    if (this.pingIntervalTimer) {
      clearInterval(this.pingIntervalTimer);
      this.pingIntervalTimer = null;
    }
  }

  /**
   * Send test message across the relay (Requirement 20 / Test 7)
   */
  public sendTestMessage(message: string = 'WSS relay test'): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('[WSS] Cannot send test message: Socket is not open.');
      return false;
    }
    try {
      this.socket.send(JSON.stringify({
        type: 'test',
        message,
        timestamp: Date.now()
      }));
      console.log(`[WSS] Test message sent: "${message}"`);
      return true;
    } catch (e) {
      console.error('[WSS] Failed to send test message:', e);
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    this.reconnectAttempts = 0;
    this.isConnecting = false;
    this.ackReceived = false;
    this.clearAllTimers();
    this.stopPingInterval();

    this.linkState = 'DISCONNECTED';
    this.errorCategory = 'NONE';
    this.lastErrorMessage = '';

    if (typeof window !== 'undefined') {
      try { localStorage.setItem('esp32_autoconnect', 'false'); } catch (e) {}
    }

    this.cleanupSocket(true);

    this.notifyState({
      phase: 'DISCONNECTED',
      message: 'WSS DISCONNECTED by user.'
    });
  }

  private cleanupSocket(isManual: boolean) {
    if (this.socket) {
      try {
        this.socket.onopen = null;
        this.socket.onmessage = null;
        this.socket.onerror = null;
        this.socket.onclose = null;

        if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
          this.socket.close(1000, isManual ? 'User requested disconnect' : 'Cleaning up socket');
        }
      } catch (e) {}
      this.socket = null;
    }
  }

  private clearAllTimers() {
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public async send(data: Uint8Array): Promise<boolean> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const payload = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      this.socket.send(payload);
      this.cumulativeTxBytes += data.length;
      return true;
    } catch (e) {
      console.error('[WSS TX] Failed to send MAVLink bytes:', e);
      return false;
    }
  }

  public subscribeData(listener: (chunk: Uint8Array) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  public subscribeState(listener: (event: TransportStateEvent) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private notifyState(event: TransportStateEvent) {
    this.stateListeners.forEach((fn) => fn(event));
  }

  public async getDiagnostics(): Promise<Record<string, any>> {
    const pageProtocol = typeof window !== 'undefined' ? window.location.protocol.replace(':', '').toUpperCase() : 'HTTP';
    return {
      protocolMode: this.protocolMode,
      connectionMode: this.connectionMode,
      linkState: this.linkState,
      errorCategory: this.errorCategory,
      lastErrorMessage: this.lastErrorMessage,
      latencyMs: this.latencyMs,
      pageProtocol,
      host: this.localHost,
      port: this.localPort,
      path: this.path,
      secureEndpoint: this.secureEndpoint,
      relayOnline: this.relayOnline,
      connectorOnline: this.connectorOnline,
      esp32Online: this.esp32Online,
      ackReceived: this.ackReceived,
      relayTokenConfigured: Boolean(this.relayToken),
      protocol: this.currentProtocol,
      baudRate: this.currentBaudRate,
      url: this.getResolvedUrl(),
      wifiSsid: this.wifiSsid,
      wifiConnected: this.wifiConnected,
      isHttpsOrigin: typeof window !== 'undefined' && window.location.protocol === 'https:',
      readyState: this.socket ? this.socket.readyState : WebSocket.CLOSED,
      isConnecting: this.isConnecting,
      manualDisconnect: this.manualDisconnect,
      reconnectAttempts: this.reconnectAttempts,
      bytesReceived: this.cumulativeRxBytes,
      bytesSent: this.cumulativeTxBytes,
      lastPacketTimestamp: this.lastPacketTimestamp,
      lastPacketAgeMs: this.lastPacketTimestamp > 0 ? Date.now() - this.lastPacketTimestamp : null,
      cloudHealth: this.lastCloudHealth,
      // Live ESP32 Hardware Diagnostics
      esp32WifiConnected: this.esp32WifiConnected,
      esp32WifiRssi: this.esp32WifiRssi,
      esp32WifiIp: this.esp32WifiIp,
      esp32WssConnected: this.esp32WssConnected,
      esp32UartRxBytes: this.esp32UartRxBytes,
      esp32UartTxBytes: this.esp32UartTxBytes,
      esp32WsTxBytes: this.esp32WsTxBytes,
      esp32WsRxBytes: this.esp32WsRxBytes,
      esp32MavlinkRxPackets: this.esp32MavlinkRxPackets,
      esp32MavlinkHeartbeats: this.esp32MavlinkHeartbeats,
      esp32MavlinkHeartbeatDetected: this.esp32MavlinkHeartbeatDetected,
      esp32DiagnosticCase: this.esp32DiagnosticCase,
      renderHttpOnline: this.lastCloudHealth.reachable,
      connectionSummaryState: this.getConnectionSummaryState()
    };
  }

  public getConnectionSummaryState(): 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED_NO_TELEMETRY' | 'ACTIVE_STREAMING' {
    if (this.linkState === 'DISCONNECTED') return 'DISCONNECTED';
    if (this.linkState === 'CONNECTING' || this.isConnecting) return 'CONNECTING';
    if (this.linkState === 'CONNECTED') {
      if (this.cumulativeRxBytes > 0) return 'ACTIVE_STREAMING';
      const connectedDuration = this.connectedTimestamp > 0 ? (Date.now() - this.connectedTimestamp) : 0;
      if (connectedDuration > 5000) {
        return 'CONNECTED_NO_TELEMETRY';
      }
      return 'CONNECTING';
    }
    return 'DISCONNECTED';
  }

  public getRxBytes(): number { return this.cumulativeRxBytes; }
  public getTxBytes(): number { return this.cumulativeTxBytes; }
  public getEsp32WifiConnected(): boolean { return this.esp32WifiConnected; }
  public getEsp32WifiRssi(): number { return this.esp32WifiRssi; }
  public getEsp32WifiIp(): string { return this.esp32WifiIp; }
  public getEsp32WssConnected(): boolean { return this.esp32WssConnected; }
  public getEsp32UartRxBytes(): number { return this.esp32UartRxBytes; }
  public getEsp32UartTxBytes(): number { return this.esp32UartTxBytes; }
  public getEsp32WsTxBytes(): number { return this.esp32WsTxBytes; }
  public getEsp32WsRxBytes(): number { return this.esp32WsRxBytes; }
  public getEsp32MavlinkRxPackets(): number { return this.esp32MavlinkRxPackets; }
  public getEsp32MavlinkHeartbeats(): number { return this.esp32MavlinkHeartbeats; }
  public getEsp32MavlinkHeartbeatDetected(): boolean { return this.esp32MavlinkHeartbeatDetected; }
  public getEsp32DiagnosticCase(): string { return this.esp32DiagnosticCase; }
  public getEsp32WifiSsid(): string { return this.wifiSsid; }
}
