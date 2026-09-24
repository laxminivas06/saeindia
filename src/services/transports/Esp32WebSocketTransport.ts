import { MavlinkTransport, TransportStateEvent, TransportType } from '../../types/transport';

export type WebSocketConnectionMode = 'LOCAL' | 'SECURE';

export interface Esp32WebSocketOptions {
  mode?: WebSocketConnectionMode;
  host?: string;
  port?: number;
  secureEndpoint?: string;
  protocol?: 'ws' | 'wss';
  baudRate?: number;
  wifiSsid?: string;
}

export class Esp32WebSocketTransport implements MavlinkTransport {
  public readonly id = 'esp32_websocket';
  public readonly name = 'ESP32-S3 Wireless MAVLink Bridge';
  public readonly type: TransportType = 'ESP32_WEBSOCKET';

  private dataListeners: Set<(chunk: Uint8Array) => void> = new Set();
  private stateListeners: Set<(event: TransportStateEvent) => void> = new Set();

  private socket: WebSocket | null = null;
  
  // Connection Mode: 'LOCAL' (ws://) vs 'SECURE' (wss://)
  private connectionMode: WebSocketConnectionMode = 'LOCAL';
  private localHost: string = '192.168.31.194';
  private localPort: number = 8080;
  private secureEndpoint: string = 'relay.example.com:8443';
  private currentProtocol: 'ws' | 'wss' = 'ws';
  private currentBaudRate: number = 57600;

  // Wi-Fi State Persistence (Independent of WebSocket & Page Reload)
  private wifiSsid: string = 'DRONE_WIFI_2.4G';
  private wifiConnected: boolean = true;
  
  private isConnecting: boolean = false;
  private manualDisconnect: boolean = false;
  
  // Reconnect management
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 5;
  private reconnectTimer: any = null;
  private connectTimeoutTimer: any = null;

  // Cumulative Metrics
  private cumulativeRxBytes: number = 0;
  private cumulativeTxBytes: number = 0;
  private lastPacketTimestamp: number = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const savedMode = localStorage.getItem('esp32_conn_mode');
        const savedHost = localStorage.getItem('esp32_host');
        const savedPort = localStorage.getItem('esp32_port');
        const savedSecureEndpoint = localStorage.getItem('esp32_secure_endpoint');
        const savedProto = localStorage.getItem('esp32_proto');
        const savedBaud = localStorage.getItem('esp32_baud');
        const savedSsid = localStorage.getItem('esp32_wifi_ssid');

        if (savedMode === 'LOCAL' || savedMode === 'SECURE') {
          this.connectionMode = savedMode;
        }

        if (savedHost && savedHost === '192.168.31.194') {
          this.localHost = savedHost;
        } else {
          this.localHost = '192.168.31.194';
          try {
            localStorage.setItem('esp32_host', '192.168.31.194');
          } catch (e) {
            // ignore
          }
        }
        if (savedPort) this.localPort = parseInt(savedPort, 10) || 8080;
        if (savedSecureEndpoint) this.secureEndpoint = savedSecureEndpoint;
        if (savedProto === 'ws' || savedProto === 'wss') this.currentProtocol = savedProto;
        if (savedBaud) this.currentBaudRate = parseInt(savedBaud, 10) || 57600;
        if (savedSsid) this.wifiSsid = savedSsid;

        // Check if user was connected previously before page refresh
        const autoConnect = localStorage.getItem('esp32_autoconnect');
        if (autoConnect === 'true') {
          // Automatic seamless reconnection after browser reload
          setTimeout(() => {
            if (!this.manualDisconnect && !this.socket) {
              console.log('[WS] Page reloaded: Auto-reconnecting to ESP32 WebSocket (Wi-Fi preserved)...');
              this.connect();
            }
          }, 400);
        }
      } catch (e) {
        // ignore
      }
    }
  }

  public isAvailable(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  public getConnectionMode(): WebSocketConnectionMode {
    return this.connectionMode;
  }

  public getHost(): string {
    return this.localHost;
  }

  public getPort(): number {
    return this.localPort;
  }

  public getSecureEndpoint(): string {
    return this.secureEndpoint;
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

  public setWifiSsid(ssid: string) {
    this.wifiSsid = ssid.trim();
    this.wifiConnected = true;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('esp32_wifi_ssid', this.wifiSsid);
      } catch (e) {
        // ignore
      }
    }
  }

  /**
   * Explicit RESET WIFI: Only clears Wi-Fi credentials when explicitly called by the user
   */
  public resetWifi() {
    this.wifiSsid = '';
    this.wifiConnected = false;
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('esp32_wifi_ssid');
        localStorage.setItem('esp32_autoconnect', 'false');
      } catch (e) {
        // ignore
      }
    }
    this.disconnect();
  }

  /**
   * Resolve target WebSocket URL based on connection mode
   */
  public getResolvedUrl(): string {
    if (this.connectionMode === 'LOCAL') {
      return `ws://${this.localHost}:${this.localPort}`;
    } else {
      let ep = this.secureEndpoint.trim();
      ep = ep.replace(/^wss?:\/\//i, '');
      return `wss://${ep}`;
    }
  }

  public setConfig(options: {
    mode?: WebSocketConnectionMode;
    host?: string;
    port?: number;
    secureEndpoint?: string;
    protocol?: 'ws' | 'wss';
    baudRate?: number;
    wifiSsid?: string;
  }) {
    if (options.mode) this.connectionMode = options.mode;
    if (options.host) this.localHost = options.host.trim();
    if (options.port) this.localPort = options.port;
    if (options.secureEndpoint) this.secureEndpoint = options.secureEndpoint.trim();
    if (options.baudRate) this.currentBaudRate = options.baudRate;
    if (options.wifiSsid) {
      this.wifiSsid = options.wifiSsid.trim();
      this.wifiConnected = true;
    }

    // Synchronize protocol with mode unless explicitly overridden
    if (options.protocol) {
      this.currentProtocol = options.protocol;
    } else {
      this.currentProtocol = this.connectionMode === 'SECURE' ? 'wss' : 'ws';
    }

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('esp32_conn_mode', this.connectionMode);
        localStorage.setItem('esp32_host', this.localHost);
        localStorage.setItem('esp32_port', this.localPort.toString());
        localStorage.setItem('esp32_secure_endpoint', this.secureEndpoint);
        localStorage.setItem('esp32_proto', this.currentProtocol);
        localStorage.setItem('esp32_baud', this.currentBaudRate.toString());
        if (this.wifiSsid) localStorage.setItem('esp32_wifi_ssid', this.wifiSsid);
      } catch (e) {
        // ignore
      }
    }
  }

  /**
   * Helper to check if an address is a private/local network address
   */
  private isPrivateIp(hostOrUrl: string): boolean {
    const cleanHost = hostOrUrl.replace(/^wss?:\/\//i, '').split(':')[0].split('/')[0].trim();
    if (cleanHost === 'localhost' || cleanHost === '127.0.0.1') return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(cleanHost)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanHost)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(cleanHost)) return true;
    return false;
  }

  /**
   * HTTP ping check to test if ESP32 web server is reachable on LAN
   */
  public async checkEsp32Http(host?: string): Promise<{ reachable: boolean; latencyMs?: number; message?: string }> {
    const targetHost = host ? host.trim() : this.localHost;
    const testUrl = `http://${targetHost}/`;
    const startTime = Date.now();

    const isHttpsOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';
    if (isHttpsOrigin) {
      return {
        reachable: false,
        message: `HTTP ping is blocked on HTTPS origin by browser mixed-content policy. Open Ground Station on http:// origin to ping http://${targetHost}/ directly.`
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const resp = await fetch(testUrl, {
        method: 'GET',
        mode: 'no-cors', // Avoid CORS preflight block for simple ping
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;
      return {
        reachable: true,
        latencyMs,
        message: `ESP32 reachable at ${targetHost} (${latencyMs}ms)`
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { reachable: false, message: `ESP32 at ${targetHost} timed out (2.5s). Ensure phone/laptop is on the same local Wi-Fi network.` };
      }
      return { reachable: false, message: `Could not reach http://${targetHost}/: ${err.message || 'Host unreachable'}` };
    }
  }

  /**
   * Connect to ESP32 WebSocket server (Single WebSocket Connection Guaranteed)
   */
  public async connect(options?: Esp32WebSocketOptions): Promise<boolean> {
    if (!this.isAvailable()) {
      this.notifyState({
        phase: 'USB_NOT_DETECTED',
        message: 'WebSocket is not supported in this browser environment.'
      });
      return false;
    }

    if (options) {
      this.setConfig(options);
    }

    // Reset manual disconnect flag on explicit connect
    this.manualDisconnect = false;
    this.reconnectAttempts = 0;
    this.clearAllTimers();

    // Clean up any existing socket before opening a new one (strictly 1 WebSocket)
    this.cleanupSocket(false);

    const pageProtocol = typeof window !== 'undefined' ? window.location.protocol.replace(':', '').toUpperCase() : 'HTTP';
    const isHttpsOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const wsUrl = this.getResolvedUrl();
    const isLocalPrivateTarget = this.isPrivateIp(this.connectionMode === 'LOCAL' ? this.localHost : this.secureEndpoint);

    console.log(`[WS] PAGE PROTOCOL = ${pageProtocol}`);
    console.log(`[WS] CONNECTION MODE = ${this.connectionMode}`);
    console.log(`[WS] ENDPOINT = ${wsUrl}`);
    console.log(`[WS] WIFI SSID = ${this.wifiSsid || 'Default'}`);

    // Check for Mixed-Content restriction upfront on HTTPS origins
    if (isHttpsOrigin && this.connectionMode === 'LOCAL' && wsUrl.startsWith('ws://')) {
      const blockedMsg = `[WS ERROR] HTTPS → insecure WS blocked. Browser security blocks insecure ws:// connections from secure HTTPS pages (${window.location.origin}).`;
      console.error(blockedMsg);
      console.warn('[WS ERROR] For local testing, open Ground Station over http:// (e.g. http://192.168.x.x:5173 or Android app). For HTTPS deployment, use SECURE mode with a WSS relay.');
      
      this.notifyState({
        phase: 'SERIAL_OPEN_FAILED',
        message: `[WS ERROR] HTTPS → insecure WS blocked: Browser blocked ws:// on HTTPS origin (Mixed Content Security). Open Ground Station on http:// origin or native Android app, or switch to SECURE (WSS) mode with a TLS relay.`,
        error: 'HTTPS → insecure WS blocked (Mixed Content)'
      });
      return false;
    }

    return new Promise<boolean>((resolve) => {
      this.isConnecting = true;
      this.notifyState({
        phase: 'SERIAL_OPENING',
        message: `[WS] Connecting to ${this.connectionMode} MAVLink bridge at ${wsUrl}...`
      });

      // 6-second timeout watchdog
      this.connectTimeoutTimer = setTimeout(() => {
        if (this.isConnecting && (!this.socket || this.socket.readyState !== WebSocket.OPEN)) {
          this.isConnecting = false;
          this.cleanupSocket(false);

          let timeoutDetails = '';
          if (this.connectionMode === 'SECURE') {
            if (isLocalPrivateTarget) {
              timeoutDetails = ' [WS ERROR] WSS TLS CONNECTION FAILED: Local private IP cannot establish direct WSS without a valid TLS certificate. ESP32 does not terminate TLS natively.';
            } else {
              timeoutDetails = ' [WS ERROR] WSS HOST NOT FOUND / TIMEOUT: Could not reach secure WSS relay. Verify relay is running and port is accessible.';
            }
          } else {
            timeoutDetails = isHttpsOrigin
              ? ' [WS ERROR] HTTPS → insecure WS blocked (Mixed Content Security).'
              : ' Check ESP32 IP address and ensure phone/PC is on the same local Wi-Fi.';
          }

          console.error(`[WS ERROR] Connection to ${wsUrl} timed out.${timeoutDetails}`);
          
          this.notifyState({
            phase: 'SERIAL_OPEN_FAILED',
            message: `Connection to (${wsUrl}) timed out.${timeoutDetails}`,
            error: this.connectionMode === 'SECURE' ? 'WSS TLS Connection Timeout' : 'WebSocket connection timeout'
          });
          resolve(false);
        }
      }, 6000);

      try {
        const socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';
        this.socket = socket;

        socket.onopen = () => {
          this.clearAllTimers();
          this.isConnecting = false;
          this.reconnectAttempts = 0;

          // Save autoconnect state so page reload seamlessly reconnects
          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem('esp32_autoconnect', 'true');
            } catch (e) {
              // ignore
            }
          }

          const successMsg = this.connectionMode === 'SECURE'
            ? `[WS] WSS CONNECTED: Connected to secure MAVLink relay (${wsUrl}) ✓. Waiting for Pixhawk Heartbeat…`
            : `[WS] WS CONNECTED: Connected to local ESP32 bridge (${wsUrl}) ✓. Waiting for Pixhawk Heartbeat…`;

          console.log(successMsg);

          this.notifyState({
            phase: 'SERIAL_OPEN',
            message: successMsg,
            device: {
              deviceName: this.connectionMode === 'SECURE'
                ? `Secure WSS Relay (${this.secureEndpoint})`
                : `ESP32-S3 Wireless Bridge (${this.localHost}:${this.localPort})`,
              productName: `ESP32-S3 MAVLink WebSocket [${this.connectionMode}] (${this.currentBaudRate} baud)`,
              manufacturerName: 'Espressif / SAEISS',
              driverType: 'ESP32_WEBSOCKET',
              hasPermission: true,
              baudRate: this.currentBaudRate
            }
          });
          resolve(true);
        };

        socket.onmessage = (event: MessageEvent) => {
          this.lastPacketTimestamp = Date.now();
          
          if (event.data instanceof ArrayBuffer) {
            const chunk = new Uint8Array(event.data);
            this.cumulativeRxBytes += chunk.length;
            console.log(`[ESP32 WS RX] length = ${chunk.length}`);
            this.dataListeners.forEach((fn) => fn(chunk));
          } else if (event.data instanceof Blob) {
            const reader = new FileReader();
            reader.onload = () => {
              if (reader.result instanceof ArrayBuffer) {
                const chunk = new Uint8Array(reader.result);
                this.cumulativeRxBytes += chunk.length;
                console.log(`[ESP32 WS RX] length = ${chunk.length}`);
                this.dataListeners.forEach((fn) => fn(chunk));
              }
            };
            reader.readAsArrayBuffer(event.data);
          } else if (typeof event.data === 'string') {
            const encoder = new TextEncoder();
            const chunk = encoder.encode(event.data);
            this.cumulativeRxBytes += chunk.length;
            console.log(`[ESP32 WS RX] length = ${chunk.length}`);
            this.dataListeners.forEach((fn) => fn(chunk));
          }
        };

        socket.onerror = (err: Event) => {
          this.clearAllTimers();
          this.isConnecting = false;
          
          let errMsg = '';
          let errorType = 'WebSocket connection failed';

          if (isHttpsOrigin && this.currentProtocol === 'ws') {
            errMsg = `[WS ERROR] HTTPS → insecure WS blocked: Browser blocked ws:// on HTTPS origin (Mixed Content Security). Open Ground Station on http:// origin or native Android app.`;
            errorType = 'HTTPS → insecure WS blocked';
          } else if (this.currentProtocol === 'wss') {
            if (isLocalPrivateTarget) {
              errMsg = `[WS ERROR] WSS TLS CONNECTION FAILED: Local IP (${this.secureEndpoint || this.localHost}) cannot establish direct WSS without a valid SSL/TLS certificate. ESP32 does not support native WSS without TLS reverse-proxy relay.`;
              errorType = 'WSS TLS Connection Failed (No TLS Certificate on Local IP)';
            } else {
              errMsg = `[WS ERROR] WSS TLS CONNECTION FAILED / HOST NOT FOUND: WebSocket connection to ${wsUrl} failed. Verify TLS reverse-proxy relay is running and certificate is trusted.`;
              errorType = 'WSS TLS Connection Failed';
            }
          } else {
            errMsg = `[WS ERROR] WebSocket connection to ${wsUrl} failed. Ensure device and ESP32 are connected to the same Wi-Fi network.`;
            errorType = 'WebSocket connection failed';
          }

          console.error(errMsg, err);

          this.notifyState({
            phase: 'SERIAL_OPEN_FAILED',
            message: errMsg,
            error: errorType
          });
          resolve(false);
        };

        socket.onclose = (event: CloseEvent) => {
          this.clearAllTimers();
          this.isConnecting = false;
          this.socket = null;

          // If manually disconnected by user, do NOT reconnect
          if (this.manualDisconnect) {
            this.notifyState({
              phase: 'DISCONNECTED',
              message: 'ESP32-S3 bridge disconnected by user.'
            });
            return;
          }

          // Unexpected disconnect - attempt controlled reconnect (Wi-Fi is still preserved)
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delays = [1000, 2000, 3000, 5000, 10000];
            const delay = delays[this.reconnectAttempts - 1] || 5000;

            this.notifyState({
              phase: 'WAITING_FOR_MAVLINK',
              message: `[WS] Connection lost. Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay / 1000}s…`
            });

            this.reconnectTimer = setTimeout(() => {
              if (!this.manualDisconnect) {
                this.connect();
              }
            }, delay);
          } else {
            const failMsg = this.currentProtocol === 'wss' && isLocalPrivateTarget
              ? `[WS ERROR] WSS TLS CONNECTION FAILED after ${this.maxReconnectAttempts} attempts. ESP32 local IP requires TLS reverse-proxy or LOCAL HTTP mode.`
              : `[WS ERROR] Connection failed after ${this.maxReconnectAttempts} attempts. Press CONNECT to retry.`;

            console.error(failMsg);

            this.notifyState({
              phase: 'CONNECTION_LOST',
              message: failMsg,
              error: 'Max reconnect attempts exceeded'
            });
          }
        };

      } catch (err: any) {
        this.clearAllTimers();
        this.isConnecting = false;
        const errDesc = `[WS ERROR] Failed to initialize WebSocket to ${wsUrl}: ${err.message || err}`;
        console.error(errDesc);
        this.notifyState({
          phase: 'SERIAL_OPEN_FAILED',
          message: errDesc,
          error: err.message || 'Initialization failed'
        });
        resolve(false);
      }
    });
  }

  /**
   * Explicit DISCONNECT (Browser Communication Only):
   * Closes WebSocket cleanly, stops telemetry, does NOT erase Wi-Fi credentials,
   * does NOT restart ESP32 Wi-Fi or AP.
   */
  public async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    this.reconnectAttempts = 0;
    this.isConnecting = false;
    this.clearAllTimers();

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('esp32_autoconnect', 'false');
      } catch (e) {
        // ignore
      }
    }

    this.cleanupSocket(true);

    this.notifyState({
      phase: 'DISCONNECTED',
      message: 'ESP32-S3 WebSocket bridge disconnected by user. Wi-Fi remains connected on ESP32.'
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
      } catch (e) {
        // ignore
      }
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
      console.warn('[WS TX] WebSocket is not OPEN (ReadyState: ' + (this.socket ? this.socket.readyState : 'null') + ')');
      return false;
    }
    try {
      const payload = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      this.socket.send(payload);
      this.cumulativeTxBytes += data.length;
      console.log(`[ESP32 PIXHAWK TX] forwarding = ${data.length}`);
      return true;
    } catch (e) {
      console.error('[WS TX] Failed to send MAVLink bytes over WebSocket:', e);
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
      connectionMode: this.connectionMode,
      pageProtocol,
      host: this.localHost,
      port: this.localPort,
      secureEndpoint: this.secureEndpoint,
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
      lastPacketAgeMs: this.lastPacketTimestamp > 0 ? Date.now() - this.lastPacketTimestamp : null
    };
  }
}
