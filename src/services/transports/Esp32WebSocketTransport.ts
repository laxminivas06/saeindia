import { MavlinkTransport, TransportStateEvent, TransportType } from '../../types/transport';

export class Esp32WebSocketTransport implements MavlinkTransport {
  public readonly id = 'esp32_websocket';
  public readonly name = 'ESP32-S3 Wireless MAVLink Bridge';
  public readonly type: TransportType = 'ESP32_WEBSOCKET';

  private dataListeners: Set<(chunk: Uint8Array) => void> = new Set();
  private stateListeners: Set<(event: TransportStateEvent) => void> = new Set();

  private socket: WebSocket | null = null;
  private currentHost: string = '192.168.4.1';
  private currentPort: number = 8080;
  private currentProtocol: 'ws' | 'wss' = 'ws';
  private currentBaudRate: number = 57600;
  
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
        const savedHost = localStorage.getItem('esp32_host');
        const savedPort = localStorage.getItem('esp32_port');
        const savedProto = localStorage.getItem('esp32_proto');
        const savedBaud = localStorage.getItem('esp32_baud');
        if (savedHost) this.currentHost = savedHost;
        if (savedPort) this.currentPort = parseInt(savedPort, 10) || 8080;
        if (savedProto === 'ws' || savedProto === 'wss') this.currentProtocol = savedProto;
        if (savedBaud) this.currentBaudRate = parseInt(savedBaud, 10) || 57600;
      } catch (e) {
        // ignore
      }
    }
  }

  public isAvailable(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  public getHost(): string {
    return this.currentHost;
  }

  public getPort(): number {
    return this.currentPort;
  }

  public getProtocol(): 'ws' | 'wss' {
    return this.currentProtocol;
  }

  public getBaudRate(): number {
    return this.currentBaudRate;
  }

  public setConfig(host: string, port: number, protocol: 'ws' | 'wss' = 'ws', baudRate: number = 57600) {
    this.currentHost = host.trim();
    this.currentPort = port;
    this.currentProtocol = protocol;
    this.currentBaudRate = baudRate;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('esp32_host', this.currentHost);
        localStorage.setItem('esp32_port', this.currentPort.toString());
        localStorage.setItem('esp32_proto', this.currentProtocol);
        localStorage.setItem('esp32_baud', this.currentBaudRate.toString());
      } catch (e) {
        // ignore
      }
    }
  }

  /**
   * HTTP ping check to test if ESP32 web server is reachable on LAN
   */
  public async checkEsp32Http(host?: string): Promise<{ reachable: boolean; latencyMs?: number; message?: string }> {
    const targetHost = host ? host.trim() : this.currentHost;
    const testUrl = `http://${targetHost}/`;
    const startTime = Date.now();

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
        return { reachable: false, message: `ESP32 at ${targetHost} timed out (2.5s). Ensure phone/laptop is on same Wi-Fi.` };
      }
      return { reachable: false, message: `Could not reach http://${targetHost}/: ${err.message || 'Host unreachable'}` };
    }
  }

  /**
   * Connect to ESP32 WebSocket server (Zero duplicate sockets guaranteed)
   */
  public async connect(options?: { host?: string; port?: number; protocol?: 'ws' | 'wss'; baudRate?: number }): Promise<boolean> {
    if (!this.isAvailable()) {
      this.notifyState({
        phase: 'USB_NOT_DETECTED',
        message: 'WebSocket is not supported in this browser environment.'
      });
      return false;
    }

    if (options?.host) this.currentHost = options.host.trim();
    if (options?.port) this.currentPort = options.port;
    if (options?.protocol) this.currentProtocol = options.protocol;
    if (options?.baudRate) this.currentBaudRate = options.baudRate;
    this.setConfig(this.currentHost, this.currentPort, this.currentProtocol, this.currentBaudRate);

    // Reset manual disconnect flag on explicit connect
    this.manualDisconnect = false;
    this.reconnectAttempts = 0;
    this.clearAllTimers();

    // Clean up any existing socket before opening a new one
    this.cleanupSocket(false);

    const isHttpsOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const wsUrl = `${this.currentProtocol}://${this.currentHost}:${this.currentPort}`;

    return new Promise<boolean>((resolve) => {
      this.isConnecting = true;
      this.notifyState({
        phase: 'SERIAL_OPENING',
        message: `Connecting to ESP32-S3 MAVLink bridge at ${wsUrl}...`
      });

      // 6-second timeout watchdog
      this.connectTimeoutTimer = setTimeout(() => {
        if (this.isConnecting && (!this.socket || this.socket.readyState !== WebSocket.OPEN)) {
          this.isConnecting = false;
          this.cleanupSocket(false);

          const mixedContentHint = isHttpsOrigin && this.currentProtocol === 'ws'
            ? ' Note: HTTPS browser security blocks plain ws:// connections to local IPs. Use http:// origin or native Android build.'
            : '';
          
          this.notifyState({
            phase: 'SERIAL_OPEN_FAILED',
            message: `Connection to ESP32-S3 (${wsUrl}) timed out.${mixedContentHint} Check ESP32 IP and ensure both devices are on the same Wi-Fi.`,
            error: 'WebSocket connection timeout'
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

          this.notifyState({
            phase: 'SERIAL_OPEN',
            message: `Connected to ESP32-S3 (${wsUrl}) ✓. Waiting for Pixhawk MAVLink Heartbeat…`,
            device: {
              deviceName: `ESP32-S3 Wireless Bridge (${this.currentHost}:${this.currentPort})`,
              productName: `ESP32-S3 TELEM2 MAVLink WebSocket (${this.currentBaudRate} baud)`,
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
            this.dataListeners.forEach((fn) => fn(chunk));
          } else if (event.data instanceof Blob) {
            const reader = new FileReader();
            reader.onload = () => {
              if (reader.result instanceof ArrayBuffer) {
                const chunk = new Uint8Array(reader.result);
                this.cumulativeRxBytes += chunk.length;
                this.dataListeners.forEach((fn) => fn(chunk));
              }
            };
            reader.readAsArrayBuffer(event.data);
          } else if (typeof event.data === 'string') {
            const encoder = new TextEncoder();
            const chunk = encoder.encode(event.data);
            this.cumulativeRxBytes += chunk.length;
            this.dataListeners.forEach((fn) => fn(chunk));
          }
        };

        socket.onerror = (err: Event) => {
          this.clearAllTimers();
          this.isConnecting = false;
          
          const isSecurityIssue = isHttpsOrigin && this.currentProtocol === 'ws';
          const errMsg = isSecurityIssue
            ? `Browser blocked ws:// on HTTPS origin (Mixed Content Security). Open Ground Station on http:// origin or Android native app.`
            : `WebSocket connection to ${wsUrl} failed. Ensure device and ESP32 are connected to the same Wi-Fi.`;

          this.notifyState({
            phase: 'SERIAL_OPEN_FAILED',
            message: errMsg,
            error: isSecurityIssue ? 'Mixed Content Blocked' : 'WebSocket connection failed'
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

          // Unexpected disconnect - attempt controlled reconnect
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delays = [1000, 2000, 3000, 5000, 10000];
            const delay = delays[this.reconnectAttempts - 1] || 5000;

            this.notifyState({
              phase: 'WAITING_FOR_MAVLINK',
              message: `ESP32 connection lost. Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay / 1000}s…`
            });

            this.reconnectTimer = setTimeout(() => {
              if (!this.manualDisconnect) {
                this.connect();
              }
            }, delay);
          } else {
            this.notifyState({
              phase: 'CONNECTION_LOST',
              message: `ESP32-S3 connection failed after ${this.maxReconnectAttempts} attempts. Press CONNECT to retry.`,
              error: 'Max reconnect attempts exceeded'
            });
          }
        };

      } catch (err: any) {
        this.clearAllTimers();
        this.isConnecting = false;
        this.notifyState({
          phase: 'SERIAL_OPEN_FAILED',
          message: `Failed to initialize WebSocket to ${wsUrl}: ${err.message || err}`,
          error: err.message
        });
        resolve(false);
      }
    });
  }

  /**
   * CRITICAL: Rock-solid disconnect. Immediately closes socket, cancels reconnects,
   * sets manualDisconnect=true, and resets state to DISCONNECTED.
   */
  public async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    this.reconnectAttempts = 0;
    this.isConnecting = false;
    this.clearAllTimers();

    this.cleanupSocket(true);

    this.notifyState({
      phase: 'DISCONNECTED',
      message: 'ESP32-S3 bridge disconnected.'
    });
  }

  private cleanupSocket(isManual: boolean) {
    if (this.socket) {
      try {
        // Remove listeners to prevent race-condition triggers
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
      console.warn('[ARM] WebSocket is not OPEN (ReadyState: ' + (this.socket ? this.socket.readyState : 'null') + ')');
      return false;
    }
    try {
      const payload = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      this.socket.send(payload);
      console.log(`[ARM] WebSocket send() called (${data.length} bytes transmitted)`);
      this.cumulativeTxBytes += data.length;
      return true;
    } catch (e) {
      console.error('[ARM] Failed to send MAVLink bytes over WebSocket:', e);
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
    return {
      host: this.currentHost,
      port: this.currentPort,
      protocol: this.currentProtocol,
      baudRate: this.currentBaudRate,
      url: `${this.currentProtocol}://${this.currentHost}:${this.currentPort}`,
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
