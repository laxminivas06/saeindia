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
  private bytesReceived: number = 0;
  private bytesSent: number = 0;
  private lastPacketTimestamp: number = 0;
  private connectTimeoutTimer: any = null;

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

    // Clean up any active socket
    await this.disconnect();

    const isHttpsOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const wsUrl = `${this.currentProtocol}://${this.currentHost}:${this.currentPort}`;

    return new Promise<boolean>((resolve) => {
      this.isConnecting = true;
      this.notifyState({
        phase: 'SERIAL_OPENING',
        message: `Connecting to ESP32-S3 MAVLink bridge at ${wsUrl}...`
      });

      // 6-second timeout watchdog
      if (this.connectTimeoutTimer) clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = setTimeout(() => {
        if (this.isConnecting && (!this.socket || this.socket.readyState !== WebSocket.OPEN)) {
          this.isConnecting = false;
          if (this.socket) {
            try { this.socket.close(); } catch (e) { /* ignore */ }
            this.socket = null;
          }
          const mixedContentHint = isHttpsOrigin && this.currentProtocol === 'ws'
            ? ' Note: HTTPS browser security blocks plain ws:// connections to local IPs.'
            : '';
          this.notifyState({
            phase: 'SERIAL_OPEN_FAILED',
            message: `Connection to ESP32-S3 (${wsUrl}) timed out.${mixedContentHint} Verify Wi-Fi network and ESP32 IP.`,
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
          if (this.connectTimeoutTimer) clearTimeout(this.connectTimeoutTimer);
          this.isConnecting = false;
          this.notifyState({
            phase: 'SERIAL_OPEN',
            message: `Connected to ESP32-S3 (${wsUrl}) ✓. Waiting for Pixhawk MAVLink Heartbeat...`,
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
          let chunk: Uint8Array;
          if (event.data instanceof ArrayBuffer) {
            chunk = new Uint8Array(event.data);
          } else if (event.data instanceof Blob) {
            const reader = new FileReader();
            reader.onload = () => {
              if (reader.result instanceof ArrayBuffer) {
                const b = new Uint8Array(reader.result);
                this.bytesReceived += b.length;
                this.dataListeners.forEach((fn) => fn(b));
              }
            };
            reader.readAsArrayBuffer(event.data);
            return;
          } else if (typeof event.data === 'string') {
            const encoder = new TextEncoder();
            chunk = encoder.encode(event.data);
          } else {
            return;
          }

          this.bytesReceived += chunk.length;
          this.dataListeners.forEach((fn) => fn(chunk));
        };

        socket.onerror = (err: Event) => {
          if (this.connectTimeoutTimer) clearTimeout(this.connectTimeoutTimer);
          this.isConnecting = false;
          const isSecurityIssue = isHttpsOrigin && this.currentProtocol === 'ws';
          const errMsg = isSecurityIssue
            ? `Browser blocked ws:// on HTTPS origin (Mixed Content Security). Use Android App or http:// local connection.`
            : `WebSocket connection to ${wsUrl} failed. Verify phone is on same Wi-Fi as ESP32 (${this.currentHost}).`;

          this.notifyState({
            phase: 'SERIAL_OPEN_FAILED',
            message: errMsg,
            error: isSecurityIssue ? 'Mixed Content Blocked' : 'WebSocket connection failed'
          });
          resolve(false);
        };

        socket.onclose = (event: CloseEvent) => {
          if (this.connectTimeoutTimer) clearTimeout(this.connectTimeoutTimer);
          this.isConnecting = false;
          this.socket = null;
          this.notifyState({
            phase: 'DISCONNECTED',
            message: event.wasClean ? 'ESP32-S3 bridge disconnected.' : 'ESP32-S3 connection closed unexpectedly.'
          });
        };

      } catch (err: any) {
        if (this.connectTimeoutTimer) clearTimeout(this.connectTimeoutTimer);
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

  public async disconnect(): Promise<void> {
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
    this.isConnecting = false;
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {
        // ignore
      }
      this.socket = null;
    }
    this.notifyState({
      phase: 'DISCONNECTED',
      message: 'ESP32-S3 bridge disconnected'
    });
  }

  public async send(data: Uint8Array): Promise<boolean> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.socket.send(data.buffer);
      this.bytesSent += data.length;
      return true;
    } catch (e) {
      console.error('Failed to send MAVLink bytes over ESP32 WebSocket', e);
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
      bytesReceived: this.bytesReceived,
      bytesSent: this.bytesSent,
      lastPacketTimestamp: this.lastPacketTimestamp,
      lastPacketAgeMs: this.lastPacketTimestamp > 0 ? Date.now() - this.lastPacketTimestamp : null
    };
  }
}
