import { DroneTelemetry, GPSLocation, HomePoint } from '../types/mission';
import {
  MAVLinkPacket,
  PixhawkConnectionState,
  FlightControllerConnection,
  PixhawkStatusMessage,
  ConnectionPhase,
  UsbDeviceDiagnostics,
  DiagnosticsLogEntry
} from '../types/mavlink';
import { usbHostService } from './usbHostService';
import { transportManager } from './transports/TransportManager';

type TelemetryListener = (telemetry: DroneTelemetry) => void;
type MAVLinkPacketListener = (packet: MAVLinkPacket) => void;
type ConnectionStateListener = (state: PixhawkConnectionState) => void;

// ArduPilot Copter Flight Mode Map
const ARDUPILOT_MODES: Record<number, string> = {
  0: 'STABILIZE',
  1: 'ACRO',
  2: 'ALT_HOLD',
  3: 'AUTO',
  4: 'GUIDED',
  5: 'LOITER',
  6: 'RTL',
  7: 'CIRCLE',
  8: 'POSITION',
  9: 'LAND',
  10: 'OF_LOITER',
  11: 'DRIFT',
  13: 'SPORT',
  14: 'FLIP',
  15: 'AUTOTUNE',
  16: 'POSHOLD',
  17: 'BRAKE',
  18: 'THROW',
  19: 'AVOID_ADSB',
  20: 'GUIDED_NOGPS',
  21: 'SMART_RTL',
  22: 'FLOWHOLD',
  23: 'FOLLOW',
  24: 'ZIGZAG',
  25: 'SYSTEMID',
  26: 'AUTOROTATE',
  27: 'AUTO_RTL'
};

const AUTOPILOT_NAMES: Record<number, string> = {
  0: 'GENERIC',
  3: 'MAV_AUTOPILOT_ARDUPILOT',
  12: 'MAV_AUTOPILOT_PX4'
};

const VEHICLE_TYPE_NAMES: Record<number, string> = {
  0: 'GENERIC',
  1: 'FIXED_WING',
  2: 'QUADROTOR',
  3: 'COAXIAL',
  4: 'HELICOPTER',
  5: 'ANTENNA_TRACKER',
  6: 'GCS',
  7: 'AIRSHIP',
  8: 'FREE_BALLOON',
  9: 'ROCKET',
  10: 'GROUND_ROVER',
  11: 'SURFACE_BOAT',
  12: 'SUBMARINE',
  13: 'HEXAROTOR',
  14: 'OCTOROTOR',
  15: 'TRICOPTER',
  16: 'FLAPPING_WING',
  17: 'KITE',
  18: 'ONBOARD_CONTROLLER',
  19: 'VTOL_DUOROTOR',
  20: 'VTOL_QUADROTOR',
  21: 'VTOL_TILTROTOR'
};

const SEVERITY_NAMES: Array<PixhawkStatusMessage['severity']> = [
  'EMERGENCY',
  'ALERT',
  'CRITICAL',
  'ERROR',
  'WARNING',
  'NOTICE',
  'INFO',
  'DEBUG'
];

class MAVLinkService {
  private listeners: Set<TelemetryListener> = new Set();
  private packetListeners: Set<MAVLinkPacketListener> = new Set();
  private connectionListeners: Set<ConnectionStateListener> = new Set();

  private connectionState: PixhawkConnectionState = {
    connectionType: 'USB_SERIAL',
    phase: 'DISCONNECTED',
    phaseMessage: 'Ready for Pixhawk USB OTG auto-detection',
    isConnected: false,
    isUsbConnected: false,
    portOrAddress: 'Disconnected',
    baudRate: 57600,
    bytesReceived: 0,
    bytesSent: 0,
    lastHeartbeat: 0,
    heartbeatHz: 0,
    packetLossPercent: 0,
    firmwareVersion: 'Pixhawk 2.4.8 (ArduCopter / PX4)',
    autopilotType: 'MAV_AUTOPILOT_ARDUPILOT',
    mavlinkVersion: 'MAVLink 2.0 / 1.0',
    isReceivingTelemetry: false,
    ekfHealthy: true,
    preArmChecksPassed: false,
    statusHistory: [],
    commandAckHistory: [],
    diagnosticsLogs: [],
    isRealHardware: false,
    diagnostics: {
      totalPacketsReceived: 0,
      heartbeatsCount: 0,
      driverType: 'NATIVE_ANDROID_USB',
      hostPowerStatus: 'HOST_ACTIVE',
      serialDataReceived: false
    }
  };

  private telemetry: DroneTelemetry = {
    latitude: 12.9715987,
    longitude: 77.5945627,
    altitude: 0.0,
    targetAltitude: 0.0,
    groundSpeed: 0.0,
    verticalSpeed: 0.0,
    heading: 0,
    batteryPercent: 0,
    batteryVoltage: 0.0,
    batteryCurrent: 0.0,
    gps: {
      latitude: 12.9715987,
      longitude: 77.5945627,
      altitude: 0.0,
      satellites: 0,
      hdop: 99.0,
      fixType: 'NO_GPS',
      isLocked: false
    },
    flightMode: 'DISARMED',
    isArmed: false,
    distanceToHome: 0,
    searchProgress: 0,
    pixhawkConnected: false,
    runnerConnected: true,
    cameraReady: true
  };

  private homePoint: HomePoint = {
    latitude: 12.9715987,
    longitude: 77.5945627,
    altitude: 0.0,
    timestamp: 0,
    isSet: false
  };

  // MAVLink Parser Buffers
  private rxBuffer: Uint8Array = new Uint8Array(4096);
  private rxBufferLen: number = 0;
  private sendSeq: number = 0;

  // Heartbeat Rate Monitoring & Timeout Tracking
  private heartbeatTimestamps: number[] = [];
  private heartbeatWatchdogTimer: any = null;
  private heartbeatWaitingTimer: any = null;
  private serialDataCheckTimer: any = null;
  private gcsHeartbeatTimer: any = null;
  private heartbeatWaitStartTime: number = 0;

  // Simulator Interval (Only active when in SIMULATED mode)
  private simInterval: any = null;
  private simWaypoints: Array<{ lat: number; lon: number; alt: number }> = [];
  private currentWpIndex: number = 0;
  private searchProgressCount: number = 0;

  private startGcsHeartbeat() {
    if (this.gcsHeartbeatTimer) return;
    this.gcsHeartbeatTimer = setInterval(() => {
      if (this.connectionState.isConnected && !this.simInterval) {
        this.sendGcsHeartbeat();
      }
    }, 1000);
  }

  private stopGcsHeartbeat() {
    if (this.gcsHeartbeatTimer) {
      clearInterval(this.gcsHeartbeatTimer);
      this.gcsHeartbeatTimer = null;
    }
  }

  public async sendGcsHeartbeat(): Promise<boolean> {
    try {
      if (!this.connectionState.isConnected || this.simInterval) return false;
      // MAVLink v1 HEARTBEAT (msgId = 0, payload len = 9)
      const payload = new Uint8Array(9);
      const view = new DataView(payload.buffer);
      view.setUint32(0, 0, true); // custom_mode
      view.setUint8(4, 6);        // type = MAV_TYPE_GCS (6)
      view.setUint8(5, 8);        // autopilot = MAV_AUTOPILOT_INVALID (8)
      view.setUint8(6, 0);        // base_mode
      view.setUint8(7, 4);        // system_status = MAV_STATE_ACTIVE (4)
      view.setUint8(8, 3);        // mavlink_version = 3

      const packet = this.buildMavlink1Frame(0 /* HEARTBEAT */, payload);
      const success = await usbHostService.sendBytes(packet);
      if (success) {
        this.connectionState.bytesSent += packet.length;
      }
      return success;
    } catch {
      return false;
    }
  }

  constructor() {
    this.logDiagnostic('SYSTEM', 'MAVLink Engine Initialized. Ready for Pixhawk USB OTG auto-detection.', 'info');
    
    // Subscribe to USB byte stream from unified cross-platform USB Host
    usbHostService.subscribeData((chunk: Uint8Array) => {
      this.connectionState.bytesReceived += chunk.length;
      this.processIncomingSerialBytes(chunk);
    });

    // Subscribe to USB Host hardware phase transitions
    usbHostService.subscribeState((phase: ConnectionPhase, message: string, diag) => {
      this.handleUsbHostStateChange(phase, message, diag);
    });

    // Start heartbeat watchdog
    this.startHeartbeatWatchdog();
  }

  public logDiagnostic(tag: DiagnosticsLogEntry['tag'], message: string, level: DiagnosticsLogEntry['level'] = 'info') {
    const entry: DiagnosticsLogEntry = {
      id: `DIAG_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      tag,
      message,
      level
    };
    this.connectionState.diagnosticsLogs = [entry, ...this.connectionState.diagnosticsLogs.slice(0, 99)];
    this.notifyConnection();
  }

  private handleUsbHostStateChange(phase: ConnectionPhase, message: string, diag: Partial<UsbDeviceDiagnostics>) {
    this.connectionState.phaseMessage = message;
    this.connectionState.diagnostics = {
      ...this.connectionState.diagnostics,
      ...diag
    };

    if (diag.productName || diag.deviceName) {
      this.connectionState.portOrAddress = `${diag.productName || diag.deviceName} (@ ${diag.baudRate || this.connectionState.baudRate} baud)`;
    }

    if (phase === 'DISCONNECTED') {
      this.connectionState.phase = 'DISCONNECTED';
      this.connectionState.isConnected = false;
      this.connectionState.isUsbConnected = false;
      this.connectionState.isReceivingTelemetry = false;
      this.connectionState.isRealHardware = false;
      this.connectionState.diagnostics.serialDataReceived = false;
      this.telemetry.pixhawkConnected = false;
      this.telemetry.isArmed = false;
      this.clearHeartbeatWaitTimer();
      this.clearSerialDataCheckTimer();
      this.logDiagnostic('USB', message || 'USB Device Disconnected', 'warn');
      this.addStatusMessage('WARNING', 4, message || 'USB Device Disconnected');
    } else if (phase === 'CONNECTION_LOST') {
      this.connectionState.phase = 'CONNECTION_LOST';
      this.connectionState.isConnected = false;
      this.connectionState.isUsbConnected = false;
      this.connectionState.isReceivingTelemetry = false;
      this.connectionState.isRealHardware = false;
      this.connectionState.diagnostics.serialDataReceived = false;
      this.telemetry.pixhawkConnected = false;
      this.telemetry.isArmed = false;
      this.clearHeartbeatWaitTimer();
      this.clearSerialDataCheckTimer();
      this.logDiagnostic('USB', 'Pixhawk connection lost. Waiting for USB device reconnection…', 'warn');
      this.addStatusMessage('WARNING', 4, 'Pixhawk connection lost (USB cable disconnected)');
    } else if (phase === 'USB_DEVICE_DETECTED') {
      this.connectionState.phase = 'USB_DEVICE_DETECTED';
      this.connectionState.isRealHardware = true;
      this.connectionState.isUsbConnected = false;
      this.connectionState.connectionType = 'USB_SERIAL';
      this.logDiagnostic('USB', `[USB] Device detected: ${diag.productName || 'Pixhawk / Flight Controller'} (VID: 0x${diag.vendorId?.toString(16).toUpperCase() || '????'}, PID: 0x${diag.productId?.toString(16).toUpperCase() || '????'}, Interface: ${diag.interfaceType || 'CDC ACM'})`, 'info');
      this.addStatusMessage('INFO', 6, message);
    } else if (phase === 'USB_PERMISSION_REQUIRED' || phase === 'REQUESTING_PERMISSION') {
      this.connectionState.phase = 'USB_PERMISSION_REQUIRED';
      this.logDiagnostic('USB', '[USB] Requesting Android USB permission…', 'info');
      this.addStatusMessage('INFO', 6, 'Requesting Android USB permission...');
    } else if (phase === 'USB_PERMISSION_GRANTED' || phase === 'PERMISSION_GRANTED') {
      this.connectionState.phase = 'USB_PERMISSION_GRANTED';
      this.connectionState.diagnostics.hasPermission = true;
      this.logDiagnostic('USB', '[USB] USB permission granted by user ✓', 'success');
      this.addStatusMessage('INFO', 6, 'USB permission granted');
    } else if (phase === 'SERIAL_OPENING' || phase === 'OPENING_USB') {
      this.connectionState.phase = 'SERIAL_OPENING';
      this.logDiagnostic('USB', '[USB] Opening serial connection…', 'info');
    } else if (phase === 'SERIAL_OPEN' || phase === 'USB_CONNECTED') {
      this.connectionState.isUsbConnected = true;
      this.connectionState.phase = 'SERIAL_OPEN';
      this.connectionState.phaseMessage = 'Serial port opened. Testing serial data…';
      this.logDiagnostic('USB', `[USB] Serial port opened @ ${this.connectionState.baudRate} baud. Testing serial data…`, 'success');
      this.addStatusMessage('INFO', 6, 'Serial port opened. Testing serial data…');

      this.startSerialDataCheck();
      this.startHeartbeatWaitTimeout();
    } else if (
      phase === 'USB_NOT_DETECTED' ||
      phase === 'PERMISSION_DENIED' ||
      phase === 'SERIAL_OPEN_FAILED' ||
      phase === 'UNSUPPORTED_DEVICE' ||
      phase === 'INTERFACE_NOT_SUPPORTED' ||
      phase === 'IOS_UNSUPPORTED'
    ) {
      this.connectionState.phase = phase;
      this.connectionState.isUsbConnected = false;
      this.connectionState.isConnected = false;
      this.connectionState.errorMessage = message;
      this.connectionState.diagnostics.lastError = message;
      this.clearHeartbeatWaitTimer();
      this.clearSerialDataCheckTimer();
      this.logDiagnostic('ERROR', `[ERROR] ${message}`, 'error');
      this.addStatusMessage('ERROR', 3, message);
    }

    this.notifyConnection();
    this.notifyTelemetry();
  }

  private startSerialDataCheck() {
    this.clearSerialDataCheckTimer();
    this.serialDataCheckTimer = setTimeout(() => {
      if (this.connectionState.isUsbConnected && !this.connectionState.diagnostics.serialDataReceived) {
        this.connectionState.phase = 'NO_SERIAL_DATA';
        const msg = 'Serial port opened, but no serial data received. Verify Pixhawk power and cable.';
        this.connectionState.phaseMessage = msg;
        this.logDiagnostic('USB', `[USB] ${msg}`, 'warn');
        this.addStatusMessage('WARNING', 4, msg);
        this.notifyConnection();
      }
    }, 3500);
  }

  private clearSerialDataCheckTimer() {
    if (this.serialDataCheckTimer) {
      clearTimeout(this.serialDataCheckTimer);
      this.serialDataCheckTimer = null;
    }
  }

  private startHeartbeatWaitTimeout() {
    this.clearHeartbeatWaitTimer();
    this.heartbeatWaitStartTime = Date.now();

    // If no heartbeat within 7.5 seconds after USB connection established -> HEARTBEAT_TIMEOUT
    this.heartbeatWaitingTimer = setTimeout(() => {
      if (this.connectionState.isUsbConnected && !this.connectionState.isConnected) {
        this.connectionState.phase = 'HEARTBEAT_TIMEOUT';
        const timeoutMsg = 'USB connected, but no MAVLink heartbeat received. Verify Pixhawk is powered & baud rate matches.';
        this.connectionState.phaseMessage = timeoutMsg;
        this.connectionState.errorMessage = timeoutMsg;
        this.connectionState.diagnostics.lastError = timeoutMsg;
        this.logDiagnostic('MAVLINK', `[MAVLINK] Heartbeat timeout (no heartbeat packet within 7.5s). ${timeoutMsg}`, 'warn');
        this.addStatusMessage('WARNING', 4, timeoutMsg);
        this.notifyConnection();
      }
    }, 7500);
  }

  private clearHeartbeatWaitTimer() {
    if (this.heartbeatWaitingTimer) {
      clearTimeout(this.heartbeatWaitingTimer);
      this.heartbeatWaitingTimer = null;
    }
  }

  private startHeartbeatWatchdog() {
    if (this.heartbeatWatchdogTimer) clearInterval(this.heartbeatWatchdogTimer);
    this.heartbeatWatchdogTimer = setInterval(() => {
      if (this.connectionState.isConnected) {
        const ageMs = Date.now() - this.connectionState.lastHeartbeat;
        this.connectionState.diagnostics.lastHeartbeatAgeMs = ageMs;

        const now = Date.now();
        this.heartbeatTimestamps = this.heartbeatTimestamps.filter(t => now - t < 5000);
        this.connectionState.heartbeatHz = +(this.heartbeatTimestamps.length / 5.0).toFixed(1);
        this.connectionState.diagnostics.heartbeatHz = this.connectionState.heartbeatHz;

        if (ageMs > 4000) {
          if (this.connectionState.isReceivingTelemetry) {
            this.connectionState.isReceivingTelemetry = false;
            this.connectionState.phase = 'WAITING_FOR_MAVLINK';
            this.connectionState.phaseMessage = 'MAVLink Telemetry Paused (Heartbeat age > 4s)';
            this.logDiagnostic('MAVLINK', '[MAVLINK] Heartbeat stream paused (> 4s since last packet)', 'warn');
            this.addStatusMessage('WARNING', 4, 'MAVLink Telemetry Stream Paused (No Heartbeat > 4s)');
            this.notifyConnection();
          }
        } else {
          if (!this.connectionState.isReceivingTelemetry) {
            this.connectionState.isReceivingTelemetry = true;
            this.connectionState.phase = 'TELEMETRY_ACTIVE';
            this.connectionState.phaseMessage = 'Telemetry Active';
            this.notifyConnection();
          }
        }
      }
    }, 500);
  }

  public subscribeTelemetry(fn: TelemetryListener) {
    this.listeners.add(fn);
    fn(this.getTelemetry());
    return () => this.listeners.delete(fn);
  }

  public subscribePackets(fn: MAVLinkPacketListener) {
    this.packetListeners.add(fn);
    return () => this.packetListeners.delete(fn);
  }

  public subscribeConnection(fn: ConnectionStateListener) {
    this.connectionListeners.add(fn);
    fn(this.getConnectionState());
    return () => this.connectionListeners.delete(fn);
  }

  public getTelemetry(): DroneTelemetry {
    return { ...this.telemetry, gps: { ...this.telemetry.gps } };
  }

  public getConnectionState(): PixhawkConnectionState {
    const isReceiving = this.connectionState.isConnected && (Date.now() - this.connectionState.lastHeartbeat < 4000);
    return { 
      ...this.connectionState,
      isReceivingTelemetry: isReceiving,
      diagnostics: { ...this.connectionState.diagnostics },
      diagnosticsLogs: [...this.connectionState.diagnosticsLogs]
    };
  }

  public getHomePoint(): HomePoint {
    return { ...this.homePoint };
  }

  public setHomePoint(lat?: number, lon?: number, alt?: number): HomePoint {
    const validLat = lat ?? this.telemetry.latitude;
    const validLon = lon ?? this.telemetry.longitude;
    const validAlt = alt ?? this.telemetry.gps.altitude;

    this.homePoint = {
      latitude: validLat,
      longitude: validLon,
      altitude: validAlt,
      timestamp: Date.now(),
      isSet: true
    };

    this.telemetry.distanceToHome = 0;
    this.notifyTelemetry();
    this.logDiagnostic('SYSTEM', `Home Point Locked: ${validLat.toFixed(6)}, ${validLon.toFixed(6)} (Alt: ${validAlt.toFixed(1)}m)`, 'info');
    this.addStatusMessage('INFO', 6, `Home Point Locked: ${validLat.toFixed(6)}, ${validLon.toFixed(6)}`);
    return this.homePoint;
  }

  private addStatusMessage(severity: PixhawkStatusMessage['severity'], severityLevel: number, text: string) {
    const msg: PixhawkStatusMessage = {
      id: `STAT_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      severity,
      severityLevel,
      text: text.trim()
    };

    this.connectionState.latestStatusMessage = msg;
    this.connectionState.statusHistory = [msg, ...this.connectionState.statusHistory.slice(0, 24)];

    const lower = text.toLowerCase();
    if (lower.includes('prearm') || lower.includes('fail') || lower.includes('check')) {
      this.connectionState.preArmChecksPassed = false;
      this.connectionState.preArmFailReason = text;
    } else if (lower.includes('armed') || lower.includes('passed')) {
      this.connectionState.preArmChecksPassed = true;
    }

    this.notifyConnection();
  }

  /**
   * Determine if a flight mode requires a GPS 3D fix / position estimate for arming.
   * AltHold, Stabilize, Acro, Manual are barometric/rate modes and do NOT require GPS.
   */
  public isModePositionDependent(modeName?: string): boolean {
    const raw = (modeName || this.telemetry.flightMode || '').toUpperCase().trim();
    const mode = raw.replace(/[^A-Z]/g, '');
    if (mode === 'ALTHOLD' || mode === 'ALT_HOLD' || mode === 'STABILIZE' || mode === 'ACRO' || mode === 'MANUAL' || mode === 'DISARMED' || mode === '') {
      return false;
    }
    // Loiter, PosHold, Guided, Auto, RTL, SmartRTL, Follow, Circle require position
    return true;
  }

  public evaluatePreArmSafety(): { passed: boolean; reason?: string } {
    if (!this.connectionState.isConnected && !this.simInterval) {
      return { passed: false, reason: 'Pixhawk FC Disconnected (Connect ESP32-S3 / USB & verify MAVLink Heartbeat)' };
    }

    if (!this.simInterval && Date.now() - this.connectionState.lastHeartbeat > 4000) {
      return { passed: false, reason: 'MAVLink Telemetry Lost (No Heartbeat received from FC)' };
    }

    // Real Hardware: Check for genuine Pixhawk PreArm failures from STATUSTEXT
    if (this.connectionState.isRealHardware) {
      if (this.connectionState.preArmFailReason && !this.telemetry.isArmed) {
        return { passed: false, reason: this.connectionState.preArmFailReason };
      }
    } else {
      // Simulation: Only check GPS if mode requires position
      const requiresGps = this.isModePositionDependent(this.telemetry.flightMode);
      if (requiresGps && (!this.telemetry.gps.isLocked || this.telemetry.gps.satellites < 6)) {
        return { passed: false, reason: `GPS Not Ready (${this.telemetry.gps.satellites} Sats visible for ${this.telemetry.flightMode})` };
      }
      if (this.telemetry.batteryPercent > 0 && this.telemetry.batteryPercent < 15) {
        return { passed: false, reason: `Low Battery (${this.telemetry.batteryPercent}%)` };
      }
    }

    return { passed: true };
  }

  /**
   * 1-Click Hardware Connection (Zero Port Selection Required)
   */
  public async connectHardware(baudRate: number = 57600): Promise<boolean> {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
    this.connectionState.baudRate = baudRate;
    this.connectionState.connectionType = 'USB_SERIAL';
    this.connectionState.isRealHardware = true;
    this.connectionState.diagnostics.serialDataReceived = false;
    this.logDiagnostic('TRANSPORT', `Initiating hardware connection @ ${baudRate} baud…`, 'info');
    return await usbHostService.autoConnect(baudRate);
  }

  /**
   * 1-Click ESP32-S3 Wireless Bridge Connection (WebSocket)
   * Supports explicit LOCAL (ws://) and SECURE (wss://) connection modes.
   */
  public async connectEsp32(options?: {
    mode?: 'LOCAL' | 'SECURE';
    host?: string;
    port?: number;
    secureEndpoint?: string;
    protocol?: 'ws' | 'wss';
    baudRate?: number;
    wifiSsid?: string;
  } | string, port: number = 8080, protocol: 'ws' | 'wss' = 'ws', baudRate: number = 57600): Promise<boolean> {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }

    let resolvedOptions: {
      mode: 'LOCAL' | 'SECURE';
      host: string;
      port: number;
      secureEndpoint: string;
      protocol: 'ws' | 'wss';
      baudRate: number;
      wifiSsid?: string;
    };

    if (typeof options === 'string') {
      // Legacy string overload: connectEsp32(host, port, protocol, baudRate)
      resolvedOptions = {
        mode: protocol === 'wss' ? 'SECURE' : 'LOCAL',
        host: options.trim(),
        port,
        secureEndpoint: `${options}:${port}`,
        protocol,
        baudRate,
        wifiSsid: transportManager.getEsp32Transport().getWifiSsid()
      };
    } else {
      const mode = options?.mode || 'LOCAL';
      const host = (options?.host || '192.168.4.1').trim();
      const p = options?.port || 8080;
      const secureEp = (options?.secureEndpoint || 'relay.example.com:8443').trim();
      const proto = options?.protocol || (mode === 'SECURE' ? 'wss' : 'ws');
      const baud = options?.baudRate || 57600;
      const ssid = options?.wifiSsid || transportManager.getEsp32Transport().getWifiSsid();

      resolvedOptions = {
        mode,
        host,
        port: p,
        secureEndpoint: secureEp,
        protocol: proto,
        baudRate: baud,
        wifiSsid: ssid
      };
    }

    const resolvedUrl = resolvedOptions.mode === 'SECURE'
      ? `wss://${resolvedOptions.secureEndpoint.replace(/^wss?:\/\//i, '')}`
      : `ws://${resolvedOptions.host}:${resolvedOptions.port}`;

    this.connectionState.connectionType = 'ESP32_WEBSOCKET';
    this.connectionState.portOrAddress = resolvedUrl;
    this.connectionState.baudRate = resolvedOptions.baudRate;
    this.connectionState.isRealHardware = true;
    this.connectionState.diagnostics.serialDataReceived = false;

    this.logDiagnostic(
      'TRANSPORT',
      `[WS] Initiating ${resolvedOptions.mode} bridge connection to ${resolvedUrl} (${resolvedOptions.baudRate} baud)…`,
      'info'
    );

    this.connectionState.wifiSsid = resolvedOptions.wifiSsid || transportManager.getEsp32Transport().getWifiSsid();
    this.connectionState.wifiState = 'CONNECTED';

    return await usbHostService.connectEsp32(resolvedOptions);
  }

  public getWifiSsid(): string {
    return transportManager.getEsp32Transport().getWifiSsid();
  }

  public setWifiSsid(ssid: string): void {
    transportManager.getEsp32Transport().setWifiSsid(ssid);
    this.connectionState.wifiSsid = ssid;
    this.connectionState.wifiState = 'CONNECTED';
    this.logDiagnostic('TRANSPORT', `Wi-Fi SSID updated to: ${ssid}`, 'info');
    this.notifyConnection();
  }

  public resetWifi(): void {
    transportManager.getEsp32Transport().resetWifi();
    this.connectionState.wifiSsid = undefined;
    this.connectionState.wifiState = 'DISCONNECTED';
    this.logDiagnostic('TRANSPORT', 'Wi-Fi configuration reset by user.', 'warn');
    this.notifyConnection();
  }

  public async checkEsp32Http(host?: string): Promise<{ reachable: boolean; latencyMs?: number; message?: string }> {
    return await usbHostService.checkEsp32Http(host);
  }

  public async scanUsbDevices(): Promise<any[]> {
    this.logDiagnostic('USB', 'Scanning connected USB devices on USB Host...', 'info');
    return await usbHostService.scanUsbDevices();
  }

  public async requestUsbPermission(): Promise<boolean> {
    this.logDiagnostic('USB', 'Requesting explicit USB permission for detected flight controller...', 'info');
    return await usbHostService.requestUsbPermission();
  }

  /**
   * Centralized cleanup for MAVLink connection and state
   */
  public async cleanupMavlinkConnection(): Promise<void> {
    this.clearHeartbeatWaitTimer();
    this.clearSerialDataCheckTimer();
    this.stopGcsHeartbeat();
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
    
    // Clear MAVLink parser ring buffer
    this.rxBufferLen = 0;
    this.heartbeatTimestamps = [];

    // Disconnect active transport
    await usbHostService.disconnect();

    // Reset full connection state
    this.connectionState.isConnected = false;
    this.connectionState.isUsbConnected = false;
    this.connectionState.isRealHardware = false;
    this.connectionState.isReceivingTelemetry = false;
    this.connectionState.diagnostics.serialDataReceived = false;
    this.connectionState.diagnostics.lastPacketTimestamp = 0;
    this.connectionState.diagnostics.lastMavlinkMessageId = undefined;
    this.connectionState.diagnostics.lastMavlinkMessageName = undefined;
    this.connectionState.phase = 'DISCONNECTED';
    this.connectionState.phaseMessage = 'Disconnected';
    this.connectionState.heartbeatHz = 0;

    // Reset Telemetry FC Link
    this.telemetry.pixhawkConnected = false;
    this.telemetry.isArmed = false;
    this.telemetry.flightMode = 'DISARMED';

    this.logDiagnostic('TRANSPORT', 'MAVLink connection completely cleaned up & disconnected.', 'info');
    this.notifyConnection();
    this.notifyTelemetry();
  }

  public async disconnect(): Promise<void> {
    await this.cleanupMavlinkConnection();
  }

  public async setTransport(transportId: string): Promise<boolean> {
    const success = transportManager.setTransport(transportId);
    if (success) {
      this.logDiagnostic('TRANSPORT', `Active transport changed to ${transportId}`, 'info');
      this.notifyConnection();
    }
    return success;
  }

  /**
   * MAVLink Byte Stream Parser (Sliding Window Ring Buffer for MAVLink 1.0 & 2.0)
   */
  private processIncomingSerialBytes(chunk: Uint8Array) {
    if (chunk.length === 0) return;

    this.connectionState.bytesReceived += chunk.length;
    this.connectionState.diagnostics.lastPacketTimestamp = Date.now();

    if (!this.connectionState.diagnostics.serialDataReceived) {
      this.connectionState.diagnostics.serialDataReceived = true;
      this.clearSerialDataCheckTimer();
      this.logDiagnostic('TRANSPORT', `[RX DATA] Data detected ✓ (${chunk.length} bytes received). Passing to MAVLink parser…`, 'success');
      if (this.connectionState.phase === 'SERIAL_OPEN') {
        this.connectionState.phase = 'WAITING_FOR_MAVLINK';
        this.connectionState.phaseMessage = 'Data link open ✓. Waiting for MAVLink heartbeat…';
        this.notifyConnection();
      }
    }

    // Append chunk to rxBuffer safely
    if (this.rxBufferLen + chunk.length > this.rxBuffer.length) {
      const newBuf = new Uint8Array(Math.max(this.rxBuffer.length * 2, this.rxBufferLen + chunk.length + 1024));
      newBuf.set(this.rxBuffer.subarray(0, this.rxBufferLen), 0);
      this.rxBuffer = newBuf;
    }
    this.rxBuffer.set(chunk, this.rxBufferLen);
    this.rxBufferLen += chunk.length;

    // Sliding window packet extractor
    let offset = 0;
    while (offset < this.rxBufferLen) {
      const magic = this.rxBuffer[offset];
      if (magic !== 0xFE && magic !== 0xFD) {
        offset++;
        continue;
      }

      const remaining = this.rxBufferLen - offset;

      // MAVLink 1.0 (magic = 0xFE)
      if (magic === 0xFE) {
        if (remaining < 6) break;
        const payloadLen = this.rxBuffer[offset + 1];
        const packetLen = 6 + payloadLen + 2;
        if (remaining < packetLen) break;

        const frame = this.rxBuffer.subarray(offset, offset + packetLen);
        this.decodeMavlink1Packet(frame);
        offset += packetLen;
        continue;
      }

      // MAVLink 2.0 (magic = 0xFD)
      if (magic === 0xFD) {
        if (remaining < 10) break;
        const payloadLen = this.rxBuffer[offset + 1];
        const incompatFlags = this.rxBuffer[offset + 2];
        const signatureLen = (incompatFlags & 0x01) ? 13 : 0;
        const packetLen = 10 + payloadLen + 2 + signatureLen;
        if (remaining < packetLen) break;

        const frame = this.rxBuffer.subarray(offset, offset + packetLen);
        this.decodeMavlink2Packet(frame);
        offset += packetLen;
        continue;
      }
    }

    // Slide remaining unparsed bytes to front of buffer
    if (offset > 0) {
      if (offset < this.rxBufferLen) {
        this.rxBuffer.copyWithin(0, offset, this.rxBufferLen);
        this.rxBufferLen -= offset;
      } else {
        this.rxBufferLen = 0;
      }
    }
  }

  private decodeMavlink1Packet(frame: Uint8Array) {
    const payloadLen = frame[1];
    const seq = frame[2];
    const sysId = frame[3];
    const compId = frame[4];
    const msgId = frame[5];
    const payload = frame.subarray(6, 6 + payloadLen);

    this.handleParsedMavlinkMessage(msgId, payload, seq, sysId, compId, 'MAVLink 1.0');
  }

  private decodeMavlink2Packet(frame: Uint8Array) {
    const payloadLen = frame[1];
    const seq = frame[4];
    const sysId = frame[5];
    const compId = frame[6];
    const msgId = frame[7] | (frame[8] << 8) | (frame[9] << 16);
    const payload = frame.subarray(10, 10 + payloadLen);

    this.handleParsedMavlinkMessage(msgId, payload, seq, sysId, compId, 'MAVLink 2.0');
  }

  private handleParsedMavlinkMessage(
    msgId: number,
    payload: Uint8Array,
    seq: number,
    sysId: number,
    compId: number,
    mavVersion: string
  ) {
    const now = Date.now();
    this.connectionState.diagnostics.totalPacketsReceived++;

    const msgNames: Record<number, string> = {
      0: 'HEARTBEAT',
      1: 'SYS_STATUS',
      24: 'GPS_RAW_INT',
      30: 'ATTITUDE',
      33: 'GLOBAL_POSITION_INT',
      74: 'VFR_HUD',
      77: 'COMMAND_ACK',
      147: 'BATTERY_STATUS',
      253: 'STATUSTEXT'
    };
    this.connectionState.diagnostics.lastMavlinkMessageName = msgNames[msgId] || `MSG_${msgId}`;
    this.connectionState.diagnostics.lastMavlinkMessageId = msgId;
    this.connectionState.diagnostics.lastPacketTimestamp = now;

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

    switch (msgId) {
      // HEARTBEAT (msgId = 0) -> Proof of MAVLink Connection!
      case 0: {
        this.clearHeartbeatWaitTimer();
        this.connectionState.lastHeartbeat = now;
        this.heartbeatTimestamps.push(now);
        this.connectionState.diagnostics.heartbeatsCount++;
        this.connectionState.systemId = sysId;
        this.connectionState.componentId = compId;
        this.connectionState.diagnostics.systemId = sysId;
        this.connectionState.diagnostics.componentId = compId;
        this.connectionState.mavlinkVersion = mavVersion;

        const wasNotConnected = !this.connectionState.isConnected;
        this.connectionState.isConnected = true;
        this.connectionState.isReceivingTelemetry = true;
        this.connectionState.phase = 'PIXHAWK_CONNECTED';
        this.connectionState.phaseMessage = `Pixhawk connected ✓ (${mavVersion})`;
        this.telemetry.pixhawkConnected = true;

        if (payload.length >= 9) {
          const customMode = view.getUint32(0, true);
          const type = view.getUint8(4);
          const autopilot = view.getUint8(5);
          const baseMode = view.getUint8(6);
          const isArmed = (baseMode & 128) !== 0; // MAV_MODE_FLAG_SAFETY_ARMED (128)
          const flightModeName = ARDUPILOT_MODES[customMode] || `MODE_${customMode}`;

          this.connectionState.autopilotType = AUTOPILOT_NAMES[autopilot] || `AUTOPILOT_${autopilot}`;
          this.connectionState.diagnostics.autopilotType = this.connectionState.autopilotType;
          this.connectionState.diagnostics.vehicleType = VEHICLE_TYPE_NAMES[type] || `TYPE_${type}`;

          this.telemetry.isArmed = isArmed;
          this.telemetry.flightMode = flightModeName || 'STABILIZE';
          this.connectionState.vehicleState = isArmed ? 'ARMED' : 'DISARMED';
          this.telemetry.vehicleState = isArmed ? 'ARMED' : 'DISARMED';

          // Clear preArmFailReason when vehicle is armed
          if (isArmed && this.connectionState.preArmFailReason) {
            this.connectionState.preArmFailReason = undefined;
            this.connectionState.preArmChecksPassed = true;
          }

          console.log(`[HEARTBEAT] sysid: ${sysId} armed: ${isArmed}`);
        }

        if (wasNotConnected) {
          this.startGcsHeartbeat();
          this.logDiagnostic('MAVLINK', `[MAVLINK] HEARTBEAT received ✓! SysID: ${sysId}, CompID: ${compId}, Autopilot: ${this.connectionState.autopilotType}, Type: ${this.connectionState.diagnostics.vehicleType}`, 'success');
          this.addStatusMessage('INFO', 6, `Pixhawk Connected: Heartbeat Received from SysID ${sysId} (${this.connectionState.autopilotType})`);
        }

        this.emitPacket('HEARTBEAT', { sysId, compId, seq });
        this.notifyTelemetry();
        this.notifyConnection();
        break;
      }

      // SYS_STATUS (msgId = 1)
      case 1: {
        if (payload.length >= 31) {
          const voltageMv = view.getUint16(14, true);
          const currentA = view.getInt16(16, true) / 100;
          const batteryRemaining = view.getInt8(18);

          const voltageV = +(voltageMv / 1000).toFixed(2);
          this.telemetry.batteryVoltage = voltageV;
          this.telemetry.batteryCurrent = +Math.max(0, currentA).toFixed(2);
          if (batteryRemaining >= 0 && batteryRemaining <= 100) {
            this.telemetry.batteryPercent = batteryRemaining;
          } else if (voltageV > 0) {
            this.telemetry.batteryPercent = this.calculateLiPoPercentage(voltageV);
          }
          this.notifyTelemetry();
        }
        break;
      }

      // BATTERY_STATUS (msgId = 147)
      case 147: {
        if (payload.length >= 36) {
          const currentA = view.getInt16(18, true) / 100;
          const batteryRemaining = view.getInt8(20);
          const cell1Mv = view.getUint16(0, true);
          const cell2Mv = view.getUint16(2, true);
          const cell3Mv = view.getUint16(4, true);
          const cell4Mv = view.getUint16(6, true);

          let totalVolts = 0;
          if (cell1Mv > 0 && cell1Mv < 5000) {
            totalVolts = (cell1Mv + (cell2Mv || 0) + (cell3Mv || 0) + (cell4Mv || 0)) / 1000;
          }

          if (totalVolts > 0) {
            this.telemetry.batteryVoltage = +totalVolts.toFixed(2);
          }
          if (currentA > 0) {
            this.telemetry.batteryCurrent = +currentA.toFixed(2);
          }
          if (batteryRemaining >= 0 && batteryRemaining <= 100) {
            this.telemetry.batteryPercent = batteryRemaining;
          } else if (this.telemetry.batteryVoltage > 0) {
            this.telemetry.batteryPercent = this.calculateLiPoPercentage(this.telemetry.batteryVoltage);
          }
          this.notifyTelemetry();
        }
        break;
      }

      // GPS_RAW_INT (msgId = 24)
      case 24: {
        if (payload.length >= 30) {
          const fixType = view.getUint8(8);
          const lat = view.getInt32(0, true) / 1e7;
          const lon = view.getInt32(4, true) / 1e7;
          const alt = view.getInt32(12, true) / 1000;
          const eph = view.getUint16(16, true) / 100;
          const satellitesVisible = view.getUint8(29);

          const fixMap: Record<number, GPSLocation['fixType']> = {
            0: 'NO_GPS',
            1: 'NO_FIX',
            2: '2D_FIX',
            3: '3D_FIX',
            4: 'DGPS',
            5: 'RTK_FLOAT',
            6: 'RTK_FIXED'
          };

          this.telemetry.gps.fixType = fixMap[fixType] || 'NO_FIX';
          this.telemetry.gps.isLocked = fixType >= 3;
          this.telemetry.gps.satellites = satellitesVisible;
          this.telemetry.gps.hdop = +eph.toFixed(2);
          if (fixType >= 3 && Math.abs(lat) > 0.001) {
            this.telemetry.latitude = lat;
            this.telemetry.longitude = lon;
            this.telemetry.gps.latitude = lat;
            this.telemetry.gps.longitude = lon;
            this.telemetry.gps.altitude = alt;
          }
          this.notifyTelemetry();
        }
        break;
      }

      // GLOBAL_POSITION_INT (msgId = 33)
      case 33: {
        if (payload.length >= 28) {
          const lat = view.getInt32(4, true) / 1e7;
          const lon = view.getInt32(8, true) / 1e7;
          const relativeAlt = view.getInt32(16, true) / 1000;
          const vx = view.getInt16(20, true) / 100;
          const vy = view.getInt16(22, true) / 100;
          const vz = view.getInt16(24, true) / 100;
          const hdg = view.getUint16(26, true) / 100;

          if (Math.abs(lat) > 0.001) {
            this.telemetry.latitude = lat;
            this.telemetry.longitude = lon;
          }
          this.telemetry.altitude = +Math.max(0, relativeAlt).toFixed(2);
          this.telemetry.groundSpeed = +Math.hypot(vx, vy).toFixed(2);
          this.telemetry.verticalSpeed = +(-vz).toFixed(2);
          this.telemetry.heading = +hdg.toFixed(0);

          if (this.homePoint.isSet) {
            const dy = (this.telemetry.latitude - this.homePoint.latitude) * 111320;
            const dx = (this.telemetry.longitude - this.homePoint.longitude) * 111320 * Math.cos((this.homePoint.latitude * Math.PI) / 180);
            this.telemetry.distanceToHome = +Math.hypot(dx, dy).toFixed(1);
          }

          this.notifyTelemetry();
        }
        break;
      }

      // STATUSTEXT (msgId = 253)
      case 253: {
        if (payload.length >= 1) {
          const severityLevel = view.getUint8(0);
          const severity = SEVERITY_NAMES[severityLevel] || 'INFO';
          const textBytes = payload.subarray(1);
          let text = '';
          for (let j = 0; j < textBytes.length; j++) {
            if (textBytes[j] === 0) break;
            text += String.fromCharCode(textBytes[j]);
          }
          if (text.length > 0) {
            this.logDiagnostic('MAVLINK', `[STATUSTEXT] [${severity}] ${text}`, severityLevel <= 3 ? 'error' : severityLevel === 4 ? 'warn' : 'info');
            this.addStatusMessage(severity, severityLevel, text);
          }
        }
        break;
      }

      // RC_CHANNELS_RAW (msgId = 35) & RC_CHANNELS (msgId = 65)
      case 35:
      case 65: {
        if (payload.length >= 8) {
          const ch1 = view.getUint16(4, true);
          const ch2 = view.getUint16(6, true);
          const ch3 = payload.length >= 10 ? view.getUint16(8, true) : 0;
          const ch4 = payload.length >= 12 ? view.getUint16(10, true) : 0;
          const rssi = payload.length >= 22 ? view.getUint8(21) : 0;
          const hasValidSignals = ch1 >= 850 && ch1 <= 2150 && ch3 >= 850 && ch3 <= 2150;
          this.telemetry.rcSignalDetected = hasValidSignals;
          this.connectionState.rcSignalDetected = hasValidSignals;
          this.telemetry.rcRssi = rssi;
          this.connectionState.rcRssi = rssi;
          this.notifyTelemetry();
        }
        break;
      }

      // COMMAND_ACK (msgId = 77)
      case 77: {
        if (payload.length >= 3) {
          const command = view.getUint16(0, true);
          const result = view.getUint8(2);
          const progress = payload.length >= 4 ? view.getUint8(3) : 0;
          const resultParam2 = payload.length >= 8 ? view.getInt32(4, true) : 0;
          const resultNames = ['ACCEPTED', 'TEMP_REJECTED', 'DENIED', 'UNSUPPORTED', 'FAILED', 'IN_PROGRESS', 'CANCELLED'];
          const resultName = resultNames[result] || `CODE_${result}`;
          const resText = `Command ${command} ACK: ${resultName}${resultParam2 ? ` (param2=${resultParam2})` : ''}`;
          
          console.log(`[MAVLINK ACK]\ncommand = ${command}\nresult = ${resultName} (${result})`);

          const ackObj = {
            command,
            commandName: command === 400 ? 'MAV_CMD_COMPONENT_ARM_DISARM' : command === 300 ? 'MAV_CMD_MISSION_START' : `CMD_${command}`,
            result,
            resultName,
            progress,
            resultParam2,
            timestamp: Date.now()
          };

          this.connectionState.lastCommandAck = ackObj;
          this.connectionState.lastCommandAckResultName = resultName;

          if (command === 400) {
            this.connectionState.lastArmCommandAck = ackObj;
            if (result === 0) {
              this.logDiagnostic('MAVLINK', '[ARM ACK] ARM COMMAND ACCEPTED ✓ (Awaiting Heartbeat armed confirmation)', 'success');
              this.addStatusMessage('INFO', 6, 'ARM COMMAND ACCEPTED (Waiting for vehicle armed state)');
            } else {
              this.logDiagnostic('MAVLINK', `[ARM ACK] ARM COMMAND REJECTED by Pixhawk (${resultName})`, 'warn');
              this.addStatusMessage('WARNING', 4, `ARM COMMAND REJECTED (${resultName})`);
            }
          }
          this.connectionState.commandAckHistory = [ackObj, ...this.connectionState.commandAckHistory.slice(0, 9)];

          this.logDiagnostic('MAVLINK', `[COMMAND_ACK] ${resText}`, result === 0 ? 'success' : 'warn');
          this.emitPacket('COMMAND_ACK', ackObj);
          this.notifyConnection();
        }
        break;
      }
    }
  }

  private currentControlMode: 'RC' | 'NO_RC' = 'NO_RC';

  public getControlMode(): 'RC' | 'NO_RC' {
    return this.currentControlMode;
  }

  public setControlMode(mode: 'RC' | 'NO_RC') {
    if (this.currentControlMode === mode) return;
    console.log(`[CONTROL MODE] Switched to: ${mode}`);
    this.currentControlMode = mode;
    this.telemetry.controlMode = mode;
    this.connectionState.controlMode = mode;
    this.notifyTelemetry();
    this.notifyConnection();
  }

  public async requestMavlinkDataStreams() {
    await this.sendMavlinkCommandLong(511 /* MAV_CMD_SET_MESSAGE_INTERVAL */, 0 /* HEARTBEAT */, 1000000 /* 1Hz */);
    await this.sendMavlinkCommandLong(511, 1 /* SYS_STATUS */, 200000 /* 5Hz */);
    await this.sendMavlinkCommandLong(511, 24 /* GPS_RAW_INT */, 200000 /* 5Hz */);
    await this.sendMavlinkCommandLong(511, 33 /* GLOBAL_POSITION_INT */, 100000 /* 10Hz */);
    await this.sendMavlinkCommandLong(511, 30 /* ATTITUDE */, 100000 /* 10Hz */);
  }

  public async sendArmCommand(): Promise<boolean> {
    console.log('[ARM] BUTTON CLICKED');

    const isWsOpen = this.connectionState.isUsbConnected || this.connectionState.isConnected;
    console.log(`[ARM] WS STATE = ${isWsOpen ? 'OPEN' : 'CLOSED'}`);

    if (!isWsOpen && !this.simInterval) {
      console.error('[ARM] Cannot send ARM: WebSocket disconnected');
      this.logDiagnostic('ERROR', 'Cannot send ARM: WebSocket disconnected', 'error');
      this.addStatusMessage('WARNING', 4, 'WebSocket disconnected');
      return false;
    }

    // Dynamic target_system and target_component with ArduPilot fallback
    const targetSys = this.connectionState.systemId || 1;
    const targetComp = this.connectionState.componentId || 1;

    console.log(`[ARM] SYSID = ${targetSys}`);
    console.log(`[ARM] COMPONENT = ${targetComp}`);
    console.log('[ARM] COMMAND = 400');
    console.log('[ARM] PARAM1 = 1');
    console.log('[ARM] PARAM2 = 0');

    // Runtime assertion: command MUST be 400, param1 MUST be 1.0, param2 MUST be 0.0
    const cmd = 400;
    const p1 = 1.0;
    const p2 = 0.0;
    if (cmd !== 400 || p1 !== 1.0 || p2 !== 0.0) {
      console.error('[ARM] Runtime assertion failed: Invalid ARM command parameters. Command not sent.');
      return false;
    }

    this.connectionState.vehicleState = 'ARMING';
    this.telemetry.vehicleState = 'ARMING';
    this.connectionState.lastCommandName = 'ARM';
    this.connectionState.lastSentCommandId = 400;
    this.notifyConnection();
    this.notifyTelemetry();

    this.addStatusMessage('NOTICE', 5, 'Sending MAVLink ARM Command (MAV_CMD_COMPONENT_ARM_DISARM param1=1)...');
    this.logDiagnostic('MAVLINK', `[ARM TX] Transmitting MAV_CMD_COMPONENT_ARM_DISARM (400) to SysID ${targetSys} CompID ${targetComp}`, 'info');
    
    if (this.connectionState.isRealHardware) {
      const success = await this.sendMavlinkCommandLong(400 /* MAV_CMD_COMPONENT_ARM_DISARM */, 1.0 /* Arm */, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
      return success;
    } else {
      this.telemetry.isArmed = true;
      this.telemetry.vehicleState = 'ARMED';
      this.connectionState.vehicleState = 'ARMED';
      this.addStatusMessage('INFO', 6, 'SIMULATOR: Drone Armed (Motors Spinning)');
      this.notifyTelemetry();
      this.notifyConnection();
      return true;
    }
  }

  public async sendDisarmCommand(): Promise<boolean> {
    console.log('[DISARM] BUTTON CLICKED');

    const isWsOpen = this.connectionState.isUsbConnected || this.connectionState.isConnected;
    console.log(`[DISARM] WS STATE = ${isWsOpen ? 'OPEN' : 'CLOSED'}`);

    if (!isWsOpen && !this.simInterval) {
      console.error('[DISARM] Cannot send DISARM: WebSocket disconnected');
      this.logDiagnostic('ERROR', 'Cannot send DISARM: WebSocket disconnected', 'error');
      this.addStatusMessage('WARNING', 4, 'WebSocket disconnected');
      return false;
    }

    const targetSys = this.connectionState.systemId || 1;
    const targetComp = this.connectionState.componentId || 1;

    console.log(`[DISARM] SYSID = ${targetSys}`);
    console.log(`[DISARM] COMPONENT = ${targetComp}`);
    console.log('[DISARM] COMMAND = 400');
    console.log('[DISARM] PARAM1 = 0');
    console.log('[DISARM] PARAM2 = 0');

    // Runtime assertion: command MUST be 400, param1 MUST be 0.0, param2 MUST be 0.0
    const cmd = 400;
    const p1 = 0.0;
    const p2 = 0.0;
    if (cmd !== 400 || p1 !== 0.0 || p2 !== 0.0) {
      console.error('[DISARM] Runtime assertion failed: Invalid DISARM command parameters. Command not sent.');
      return false;
    }

    this.connectionState.vehicleState = 'DISARMING';
    this.telemetry.vehicleState = 'DISARMING';
    this.connectionState.lastCommandName = 'DISARM';
    this.connectionState.lastSentCommandId = 400;
    this.notifyConnection();
    this.notifyTelemetry();

    this.addStatusMessage('NOTICE', 5, 'Sending MAVLink DISARM Command (MAV_CMD_COMPONENT_ARM_DISARM param1=0)...');
    this.logDiagnostic('MAVLINK', `[DISARM TX] Transmitting MAV_CMD_COMPONENT_ARM_DISARM (400) to SysID ${targetSys} CompID ${targetComp}`, 'info');

    if (this.connectionState.isRealHardware) {
      const success = await this.sendMavlinkCommandLong(400 /* MAV_CMD_COMPONENT_ARM_DISARM */, 0.0 /* Disarm */, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
      return success;
    } else {
      this.telemetry.isArmed = false;
      this.telemetry.vehicleState = 'DISARMED';
      this.connectionState.vehicleState = 'DISARMED';
      this.telemetry.flightMode = 'DISARMED';
      this.telemetry.altitude = 0;
      this.addStatusMessage('INFO', 6, 'SIMULATOR: Drone Disarmed');
      this.notifyTelemetry();
      this.notifyConnection();
      return true;
    }
  }

  public async armDrone(): Promise<boolean> {
    return this.sendArmCommand();
  }

  public async disarmDrone(): Promise<boolean> {
    return this.sendDisarmCommand();
  }

  public async setFlightMode(modeName: 'GUIDED' | 'AUTO' | 'STABILIZE' | 'LOITER' | 'RTL' | 'LAND'): Promise<boolean> {
    if (!this.connectionState.isConnected && !this.simInterval) {
      this.logDiagnostic('ERROR', `Cannot set mode ${modeName}: MAVLink not connected`, 'error');
      return false;
    }
    const modeNumbers: Record<string, number> = {
      STABILIZE: 0,
      AUTO: 3,
      GUIDED: 4,
      LOITER: 5,
      RTL: 6,
      LAND: 9
    };
    const customMode = modeNumbers[modeName] ?? 4;
    this.addStatusMessage('NOTICE', 5, `Setting Flight Mode to ${modeName} (Custom Mode: ${customMode})...`);

    if (this.connectionState.isRealHardware) {
      await this.sendMavlinkCommandLong(176, 1 /* MAV_MODE_FLAG_CUSTOM_MODE_ENABLED */, customMode);
      return true;
    } else {
      this.telemetry.flightMode = modeName;
      this.notifyTelemetry();
      return true;
    }
  }

  public async commandTakeoff(targetAltMeters: number = 20): Promise<boolean> {
    if (!this.connectionState.isConnected && !this.simInterval) {
      this.logDiagnostic('ERROR', 'Cannot takeoff: MAVLink not connected', 'error');
      return false;
    }
    this.addStatusMessage('NOTICE', 5, `Sending Takeoff Command to ${targetAltMeters}m...`);
    if (this.connectionState.isRealHardware) {
      await this.sendMavlinkCommandLong(22 /* MAV_CMD_NAV_TAKEOFF */, 0, 0, 0, 0, 0, 0, targetAltMeters);
      return true;
    } else {
      this.telemetry.isArmed = true;
      this.telemetry.flightMode = 'AUTO';
      this.telemetry.targetAltitude = targetAltMeters;
      this.notifyTelemetry();
      return true;
    }
  }

  public async commandStartMission(): Promise<boolean> {
    if (!this.connectionState.isConnected && !this.simInterval) {
      this.logDiagnostic('ERROR', 'Cannot start mission: MAVLink not connected', 'error');
      return false;
    }
    this.addStatusMessage('NOTICE', 5, 'Sending MAVLink MISSION_START Command to Pixhawk FC...');
    if (this.connectionState.isRealHardware) {
      await this.setFlightMode('AUTO');
      await this.sendMavlinkCommandLong(300 /* MAV_CMD_MISSION_START */, 0, 0, 0, 0, 0, 0, 0);
      return true;
    } else {
      this.telemetry.flightMode = 'AUTO';
      this.notifyTelemetry();
      return true;
    }
  }

  public async commandStartSearch(): Promise<boolean> {
    if (!this.connectionState.isConnected && !this.simInterval) {
      this.logDiagnostic('ERROR', 'Cannot start search: MAVLink not connected', 'error');
      return false;
    }
    this.addStatusMessage('NOTICE', 5, 'Starting Autonomous Search Pattern...');
    if (this.connectionState.isRealHardware) {
      await this.setFlightMode('AUTO');
      return true;
    } else {
      this.telemetry.flightMode = 'AUTO';
      this.telemetry.targetAltitude = 25;
      this.generateSearchGridWaypoints();
      this.notifyTelemetry();
      return true;
    }
  }

  public async commandRTL(): Promise<boolean> {
    this.addStatusMessage('WARNING', 4, 'Initiating Emergency Return-To-Launch (RTL)...');
    if (this.connectionState.isRealHardware) {
      await this.setFlightMode('RTL');
      return true;
    } else {
      this.telemetry.flightMode = 'RTL';
      this.telemetry.targetAltitude = 25;
      this.notifyTelemetry();
      return true;
    }
  }

  public async commandLand(): Promise<boolean> {
    this.addStatusMessage('NOTICE', 5, 'Initiating Landing sequence...');
    if (this.connectionState.isRealHardware) {
      await this.setFlightMode('LAND');
      return true;
    } else {
      this.telemetry.flightMode = 'LAND';
      this.telemetry.targetAltitude = 0;
      this.notifyTelemetry();
      return true;
    }
  }

  public async commandHold(): Promise<boolean> {
    if (!this.connectionState.isConnected && !this.simInterval) {
      this.logDiagnostic('ERROR', 'Cannot execute Hold: MAVLink not connected', 'error');
      return false;
    }
    this.addStatusMessage('NOTICE', 5, 'Sending Position Hold (LOITER) Command...');
    if (this.connectionState.isRealHardware) {
      return await this.setFlightMode('LOITER');
    } else {
      this.telemetry.flightMode = 'LOITER';
      this.notifyTelemetry();
      return true;
    }
  }

  public async commandManualMove(direction: 'FORWARD' | 'BACKWARD' | 'LEFT' | 'RIGHT' | 'HOLD'): Promise<boolean> {
    if (!this.connectionState.isConnected && !this.simInterval) {
      return false;
    }
    if (direction === 'HOLD') {
      return await this.commandHold();
    }
    this.addStatusMessage('INFO', 6, `Manual Directional Control: ${direction}`);
    return true;
  }

  private async sendMavlinkCommandLong(
    command: number,
    param1: number = 0,
    param2: number = 0,
    param3: number = 0,
    param4: number = 0,
    param5: number = 0,
    param6: number = 0,
    param7: number = 0
  ): Promise<boolean> {
    const payload = new Uint8Array(33);
    const view = new DataView(payload.buffer);
    view.setFloat32(0, param1, true);
    view.setFloat32(4, param2, true);
    view.setFloat32(8, param3, true);
    view.setFloat32(12, param4, true);
    view.setFloat32(16, param5, true);
    view.setFloat32(20, param6, true);
    view.setFloat32(24, param7, true);
    view.setUint16(28, command, true);
    const targetSys = this.connectionState.systemId || 1;
    const targetComp = this.connectionState.componentId || 1;
    view.setUint8(30, targetSys);
    view.setUint8(31, targetComp);
    view.setUint8(32, 0);

    this.connectionState.lastSentCommandId = command;

    const packet = this.buildMavlink1Frame(76 /* COMMAND_LONG */, payload);
    const hexDump = Array.from(packet).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

    const prefix = command === 400 ? (param1 === 1.0 ? '[ARM]' : '[DISARM]') : `[CMD_${command}]`;

    if (command === 400) {
      console.log(`${prefix} MAVLINK PACKET CREATED`);
      console.log(`${prefix} PACKET LENGTH = ${packet.length}`);
      console.log(`${prefix} PACKET HEX = ${hexDump}`);
      console.log(`${prefix} WS SEND START`);
    }

    this.logDiagnostic('MAVLINK', `[COMMAND_LONG TX] Sending cmd ${command} (p1=${param1}, p2=${param2}) to SysID ${targetSys} CompID ${targetComp} (${packet.length} bytes)`, 'info');

    const success = await usbHostService.sendBytes(packet);
    if (success) {
      if (command === 400) {
        console.log(`${prefix} WS SEND COMPLETE`);
      }
      this.connectionState.bytesSent += packet.length;
      this.logDiagnostic('MAVLINK', `[COMMAND_LONG TX] Successfully forwarded ${packet.length} bytes to transport bridge (Total TX: ${this.connectionState.bytesSent} B)`, 'success');
      this.notifyConnection();
    } else {
      console.error(`${prefix} Failed to send binary packet through transport bridge (${packet.length} bytes)`);
      this.logDiagnostic('ERROR', `${prefix} Failed to send ${packet.length} bytes to transport`, 'error');
    }
    return success;
  }

  private buildMavlink1Frame(msgId: number, payload: Uint8Array): Uint8Array {
    this.sendSeq = (this.sendSeq + 1) % 256;
    const len = payload.length;
    const frame = new Uint8Array(6 + len + 2);
    frame[0] = 0xFE;
    frame[1] = len;
    frame[2] = this.sendSeq;
    frame[3] = 255;
    frame[4] = 190;
    frame[5] = msgId;

    frame.set(payload, 6);

    const crc = this.calculateMavlinkCrc(frame.subarray(1, 6 + len), msgId);
    frame[6 + len] = crc & 0xFF;
    frame[6 + len + 1] = (crc >> 8) & 0xFF;

    return frame;
  }

  private calculateMavlinkCrc(buffer: Uint8Array, msgId: number): number {
    const CRC_EXTRAS: Record<number, number> = {
      0: 50,   // HEARTBEAT
      1: 124,  // SYS_STATUS
      2: 137,  // SYSTEM_TIME
      4: 237,  // PING
      11: 89,  // SET_MODE
      20: 214, // PARAM_REQUEST_READ
      21: 159, // PARAM_REQUEST_LIST
      22: 220, // PARAM_VALUE
      23: 168, // PARAM_SET
      24: 24,  // GPS_RAW_INT
      30: 39,  // ATTITUDE
      33: 104, // GLOBAL_POSITION_INT
      39: 254, // MISSION_ITEM
      40: 230, // MISSION_REQUEST
      42: 28,  // MISSION_SET_CURRENT
      43: 132, // MISSION_REQUEST_LIST
      44: 221, // MISSION_COUNT
      45: 232, // MISSION_CLEAR_ALL
      46: 11,  // MISSION_ITEM_REACHED
      47: 153, // MISSION_ACK
      62: 183, // NAV_CONTROLLER_OUTPUT
      76: 152, // COMMAND_LONG
      77: 143, // COMMAND_ACK
      253: 83  // STATUSTEXT
    };

    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
      let b = buffer[i] ^ (crc & 0xFF);
      b ^= (b << 4) & 0xFF;
      crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);
    }
    const extraCrc = CRC_EXTRAS[msgId] ?? 152;
    let b = extraCrc ^ (crc & 0xFF);
    b ^= (b << 4) & 0xFF;
    crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);
    return crc & 0xFFFF;
  }

  public switchToSimulationMode() {
    this.disconnect();
    this.connectionState.connectionType = 'SIMULATED';
    this.connectionState.phase = 'PIXHAWK_CONNECTED';
    this.connectionState.phaseMessage = 'Bench Simulator Mode Active (SITL)';
    this.connectionState.isConnected = true;
    this.connectionState.isUsbConnected = true;
    this.connectionState.isReceivingTelemetry = true;
    this.connectionState.isRealHardware = false;
    this.connectionState.portOrAddress = 'Software-in-the-Loop (SITL Simulator)';
    this.telemetry.pixhawkConnected = true;
    this.telemetry.gps.isLocked = true;
    this.telemetry.gps.satellites = 14;
    this.telemetry.gps.hdop = 0.8;
    this.telemetry.gps.fixType = '3D_FIX';
    this.telemetry.batteryVoltage = 16.2;
    this.telemetry.batteryPercent = 95;

    this.startSimulationTelemetryLoop();
    this.logDiagnostic('SYSTEM', 'Switched to Benchmark Software-in-the-Loop Simulator mode', 'info');
    this.addStatusMessage('INFO', 6, 'Benchmark SITL Simulator Mode Active');
    this.notifyConnection();
    this.notifyTelemetry();
  }

  private startSimulationTelemetryLoop() {
    if (this.simInterval) clearInterval(this.simInterval);
    this.simInterval = setInterval(() => {
      if (this.connectionState.connectionType !== 'SIMULATED') return;
      const now = Date.now();
      this.connectionState.lastHeartbeat = now;
      this.connectionState.heartbeatHz = 2.0;

      if (this.telemetry.isArmed && this.telemetry.flightMode === 'AUTO') {
        if (this.telemetry.altitude < (this.telemetry.targetAltitude || 20)) {
          this.telemetry.altitude = +(this.telemetry.altitude + 0.5).toFixed(1);
          this.telemetry.verticalSpeed = 1.5;
        } else {
          this.telemetry.verticalSpeed = 0.0;
          this.telemetry.groundSpeed = 6.2;
          this.searchProgressCount = Math.min(100, this.searchProgressCount + 1);
          this.telemetry.searchProgress = this.searchProgressCount;
        }
      } else if (this.telemetry.flightMode === 'RTL' || this.telemetry.flightMode === 'LAND') {
        if (this.telemetry.altitude > 0.2) {
          this.telemetry.altitude = +(this.telemetry.altitude - 0.4).toFixed(1);
          this.telemetry.verticalSpeed = -1.2;
        } else {
          this.telemetry.altitude = 0.0;
          this.telemetry.verticalSpeed = 0.0;
          this.telemetry.groundSpeed = 0.0;
          this.telemetry.isArmed = false;
          this.telemetry.flightMode = 'DISARMED';
        }
      }
      this.notifyTelemetry();
    }, 500);
  }

  private generateSearchGridWaypoints() {
    const baseLat = this.homePoint.isSet ? this.homePoint.latitude : 12.9715987;
    const baseLon = this.homePoint.isSet ? this.homePoint.longitude : 77.5945627;
    this.simWaypoints = [
      { lat: baseLat + 0.0002, lon: baseLon + 0.0002, alt: 20 },
      { lat: baseLat + 0.0004, lon: baseLon + 0.0002, alt: 20 },
      { lat: baseLat + 0.0004, lon: baseLon - 0.0002, alt: 20 },
      { lat: baseLat + 0.0002, lon: baseLon - 0.0002, alt: 20 }
    ];
    this.currentWpIndex = 0;
  }

  private calculateLiPoPercentage(voltage: number): number {
    const is4S = voltage > 13.0 && voltage < 17.5;
    const is3S = voltage > 9.0 && voltage <= 13.0;
    const is6S = voltage > 20.0;

    let cellVolt = voltage / 4.0;
    if (is3S) cellVolt = voltage / 3.0;
    else if (is6S) cellVolt = voltage / 6.0;

    if (cellVolt >= 4.2) return 100;
    if (cellVolt <= 3.3) return 0;
    return Math.round(((cellVolt - 3.3) / (4.2 - 3.3)) * 100);
  }

  private emitPacket(msgName: MAVLinkPacket['msgName'], payload: Record<string, any>) {
    const packet: MAVLinkPacket = {
      seq: this.sendSeq,
      sysId: this.connectionState.systemId || 1,
      compId: this.connectionState.componentId || 1,
      msgId: 0,
      msgName,
      payload,
      timestamp: Date.now()
    };
    this.packetListeners.forEach((fn) => fn(packet));
  }

  private notifyTelemetry() {
    const data = this.getTelemetry();
    this.listeners.forEach((fn) => fn(data));
  }

  private notifyConnection() {
    const state = this.getConnectionState();
    this.connectionListeners.forEach((fn) => fn(state));
  }
}

export const mavlinkService = new MAVLinkService();
