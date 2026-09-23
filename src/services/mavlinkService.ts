import { DroneTelemetry, GPSLocation, HomePoint } from '../types/mission';
import { MAVLinkPacket, PixhawkConnectionState, FlightControllerConnection, PixhawkStatusMessage } from '../types/mavlink';

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
  9: 'LAND',
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
    connectionType: 'SIMULATED',
    isConnected: false,
    portOrAddress: 'Disconnected',
    baudRate: 115200,
    bytesReceived: 0,
    bytesSent: 0,
    lastHeartbeat: 0,
    packetLossPercent: 0,
    firmwareVersion: 'Pixhawk 2.4.8 (ArduCopter / PX4)',
    autopilotType: 'MAV_AUTOPILOT_ARDUPILOT',
    mavlinkVersion: 'MAVLink 2.4.8',
    isReceivingTelemetry: false,
    ekfHealthy: true,
    preArmChecksPassed: false,
    statusHistory: [],
    isRealHardware: false
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

  // WebSerial Real Hardware Handles
  private serialPort: any = null;
  private serialReader: any = null;
  private serialWriter: any = null;
  private isReadingSerial: boolean = false;
  private rxBuffer: Uint8Array = new Uint8Array(4096);
  private rxBufferLen: number = 0;
  private sendSeq: number = 0;

  // Simulator Interval (Only active when in SIMULATED mode)
  private simInterval: any = null;
  private simWaypoints: Array<{ lat: number; lon: number; alt: number }> = [];
  private currentWpIndex: number = 0;
  private searchProgressCount: number = 0;

  constructor() {
    // Start in clean disconnected state, ready for 1-click real hardware connect
    this.addStatusMessage('NOTICE', 5, 'MAVLink Engine Initialized. Ready for Pixhawk USB OTG connection.');
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
    const isReceiving = this.connectionState.isConnected && (Date.now() - this.connectionState.lastHeartbeat < 3500);
    return { 
      ...this.connectionState,
      isReceivingTelemetry: isReceiving
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

    // Check if message is pre-arm failure
    if (text.toLowerCase().includes('prearm') || text.toLowerCase().includes('fail') || text.toLowerCase().includes('check')) {
      this.connectionState.preArmChecksPassed = false;
      this.connectionState.preArmFailReason = text;
    } else if (text.toLowerCase().includes('armed') || text.toLowerCase().includes('passed')) {
      this.connectionState.preArmChecksPassed = true;
    }

    this.notifyConnection();
  }

  /**
   * Evaluates if Pixhawk is ready to arm
   */
  public evaluatePreArmSafety(): { passed: boolean; reason?: string } {
    if (!this.connectionState.isConnected) {
      return { passed: false, reason: 'Pixhawk FC Disconnected (Connect USB OTG)' };
    }

    if (Date.now() - this.connectionState.lastHeartbeat > 3500) {
      return { passed: false, reason: 'MAVLink Telemetry Lost (No Heartbeat from FC)' };
    }

    if (this.connectionState.isRealHardware) {
      // For real hardware, check if FC sent pre-arm failure recently
      if (this.connectionState.preArmFailReason && !this.telemetry.isArmed) {
        return { passed: false, reason: `Pixhawk FC Error: ${this.connectionState.preArmFailReason}` };
      }
    } else {
      if (!this.telemetry.gps.isLocked || this.telemetry.gps.satellites < 6) {
        return { passed: false, reason: `GPS Not Ready (${this.telemetry.gps.satellites} Sats visible)` };
      }
      if (this.telemetry.batteryPercent > 0 && this.telemetry.batteryPercent < 15) {
        return { passed: false, reason: `Low Battery (${this.telemetry.batteryPercent}%)` };
      }
    }

    return { passed: true };
  }

  /**
   * Real 1-Click WebSerial Hardware Connection Handler
   */
  private usbDevice: any = null;
  private usbInEndpoint: number = 1;
  private usbOutEndpoint: number = 2;

  /**
   * Real 1-Click Hardware Connection Handler (Supports WebSerial on Desktop & WebUSB on Android Phones)
   */
  public async connectWebSerial(baudRate: number = 115200): Promise<boolean> {
    // 1. TRY WEBSERIAL FIRST (Desktop Chrome / Android with experimental flags)
    if (typeof navigator !== 'undefined' && 'serial' in navigator) {
      try {
        this.addStatusMessage('INFO', 6, `Requesting Serial Port @ ${baudRate} baud...`);
        const port = await (navigator as any).serial.requestPort();
        await port.open({ baudRate });

        this.serialPort = port;
        this.serialWriter = port.writable.getWriter();
        this.connectionState.connectionType = 'USB_SERIAL';
        this.connectionState.isConnected = true;
        this.connectionState.isRealHardware = true;
        this.connectionState.portOrAddress = `Pixhawk 2.4.8 (USB Serial @ ${baudRate})`;
        this.connectionState.baudRate = baudRate;
        this.telemetry.pixhawkConnected = true;

        if (this.simInterval) clearInterval(this.simInterval);

        this.addStatusMessage('INFO', 6, `Connected to Pixhawk Serial Port @ ${baudRate} baud. Listening for MAVLink...`);
        this.notifyConnection();
        this.notifyTelemetry();

        this.startSerialReaderLoop(port);
        this.requestMavlinkDataStreams();
        return true;
      } catch (err: any) {
        if (err.name === 'NotFoundError') {
          this.addStatusMessage('WARNING', 4, 'Port selection cancelled.');
          return false;
        }
        console.warn('WebSerial connection error, falling back to WebUSB', err);
      }
    }

    // 2. FALLBACK TO WEBUSB (Supported natively on Android Phone Chrome over USB-OTG)
    if (typeof navigator !== 'undefined' && 'usb' in navigator) {
      try {
        this.addStatusMessage('INFO', 6, 'Android Phone detected: Requesting USB-OTG Flight Controller...');
        let device: any = null;
        try {
          // Request all USB devices with zero restrictions
          device = await (navigator as any).usb.requestDevice({ filters: [] });
        } catch (e: any) {
          // If browser requires explicit filter list
          device = await (navigator as any).usb.requestDevice({
            filters: [
              { vendorId: 0x26ac }, // Pixhawk / 3DR
              { vendorId: 0x1209 }, // Generic STM32 ArduPilot
              { vendorId: 0x0483 }, // STMicroelectronics VCP
              { vendorId: 0x10c4 }, // Silicon Labs CP2102 UART
              { vendorId: 0x0403 }, // FTDI FT232R UART
              { vendorId: 0x1a86 }, // WCH CH340 UART
              { vendorId: 0x067b }, // Prolific PL2303 UART
              { vendorId: 0x2e3c }, // CH9102 UART
              { vendorId: 0x303a }  // ESP32-S2/S3 USB CDC
            ]
          });
        }

        if (!device) return false;

        await device.open();
        if (device.configuration === null) {
          await device.selectConfiguration(1);
        }

        // Find interfaces and endpoints
        const iface = device.configuration.interfaces[0];
        await device.claimInterface(iface.interfaceNumber);

        // Find in/out endpoints
        for (const ep of iface.alternate.endpoints) {
          if (ep.direction === 'in') this.usbInEndpoint = ep.endpointNumber;
          if (ep.direction === 'out') this.usbOutEndpoint = ep.endpointNumber;
        }

        this.usbDevice = device;
        this.connectionState.connectionType = 'USB_SERIAL';
        this.connectionState.isConnected = true;
        this.connectionState.isRealHardware = true;
        this.connectionState.portOrAddress = `${device.productName || 'Pixhawk FC'} (Android USB-OTG @ ${baudRate})`;
        this.connectionState.baudRate = baudRate;
        this.telemetry.pixhawkConnected = true;

        if (this.simInterval) clearInterval(this.simInterval);

        this.addStatusMessage('INFO', 6, `Android USB-OTG Connected: ${device.productName || 'Pixhawk'}. Reading MAVLink...`);
        this.notifyConnection();
        this.notifyTelemetry();

        this.startWebUsbReaderLoop(device);
        this.requestMavlinkDataStreams();
        return true;
      } catch (usbErr: any) {
        console.warn('WebUSB connection error', usbErr);
        this.addStatusMessage('ERROR', 3, `USB-OTG Connection: ${usbErr.message || 'Device Not Selected or OTG Disabled'}`);
        return false;
      }
    }

    this.addStatusMessage('ERROR', 3, 'Enable OTG in phone settings or use Chrome over HTTPS.');
    return false;
  }

  private async startWebUsbReaderLoop(device: any) {
    this.isReadingSerial = true;
    while (this.isReadingSerial && this.usbDevice) {
      try {
        const result = await device.transferIn(this.usbInEndpoint, 64);
        if (result.data && result.data.byteLength > 0) {
          const chunk = new Uint8Array(result.data.buffer);
          this.connectionState.bytesReceived += chunk.length;
          this.processIncomingSerialBytes(chunk);
        }
      } catch (e) {
        if (!this.isReadingSerial) break;
        await new Promise(r => setTimeout(r, 20));
      }
    }
  }

  public async disconnectSerial() {
    this.isReadingSerial = false;
    if (this.serialReader) {
      try {
        await this.serialReader.cancel();
        this.serialReader.releaseLock();
      } catch (e) {}
      this.serialReader = null;
    }
    if (this.serialWriter) {
      try {
        this.serialWriter.releaseLock();
      } catch (e) {}
      this.serialWriter = null;
    }
    if (this.serialPort) {
      try {
        await this.serialPort.close();
      } catch (e) {}
      this.serialPort = null;
    }
    if (this.usbDevice) {
      try {
        await this.usbDevice.close();
      } catch (e) {}
      this.usbDevice = null;
    }

    this.connectionState.isConnected = false;
    this.connectionState.isRealHardware = false;
    this.telemetry.pixhawkConnected = false;
    this.telemetry.isArmed = false;
    this.addStatusMessage('WARNING', 4, 'Pixhawk Serial Port Disconnected.');
    this.notifyConnection();
    this.notifyTelemetry();
  }

  /**
   * Reads raw bytes from WebSerial stream and parses MAVLink v1 / v2 frames
   */
  private async startSerialReaderLoop(port: any) {
    this.isReadingSerial = true;
    while (port.readable && this.isReadingSerial) {
      try {
        this.serialReader = port.readable.getReader();
        while (this.isReadingSerial) {
          const { value, done } = await this.serialReader.read();
          if (done) break;
          if (value && value.length > 0) {
            this.connectionState.bytesReceived += value.length;
            this.processIncomingSerialBytes(value);
          }
        }
      } catch (err) {
        console.warn('Serial Read Error:', err);
        break;
      } finally {
        if (this.serialReader) {
          this.serialReader.releaseLock();
          this.serialReader = null;
        }
      }
    }
  }

  /**
   * MAVLink Byte Stream Parser
   */
  private processIncomingSerialBytes(chunk: Uint8Array) {
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i];

      if (this.rxBufferLen === 0) {
        if (b === 0xFE || b === 0xFD) { // MAVLink v1 (0xFE) or MAVLink v2 (0xFD)
          this.rxBuffer[0] = b;
          this.rxBufferLen = 1;
        }
        continue;
      }

      this.rxBuffer[this.rxBufferLen++] = b;
      const isV2 = this.rxBuffer[0] === 0xFD;

      if (!isV2 && this.rxBufferLen >= 6) { // MAVLink 1 header
        const payloadLen = this.rxBuffer[1];
        const totalLen = 6 + payloadLen + 2; // header + payload + crc
        if (this.rxBufferLen >= totalLen) {
          this.decodeMavlink1Packet(this.rxBuffer.subarray(0, totalLen));
          this.rxBufferLen = 0;
        }
      } else if (isV2 && this.rxBufferLen >= 10) { // MAVLink 2 header
        const payloadLen = this.rxBuffer[1];
        const totalLen = 10 + payloadLen + 2;
        if (this.rxBufferLen >= totalLen) {
          this.decodeMavlink2Packet(this.rxBuffer.subarray(0, totalLen));
          this.rxBufferLen = 0;
        }
      }

      if (this.rxBufferLen >= 280) {
        this.rxBufferLen = 0; // overflow safety
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

    this.handleParsedMavlinkMessage(msgId, payload, seq, sysId, compId);
  }

  private decodeMavlink2Packet(frame: Uint8Array) {
    const payloadLen = frame[1];
    const seq = frame[4];
    const sysId = frame[5];
    const compId = frame[6];
    const msgId = frame[7] | (frame[8] << 8) | (frame[9] << 16);
    const payload = frame.subarray(10, 10 + payloadLen);

    this.handleParsedMavlinkMessage(msgId, payload, seq, sysId, compId);
  }

  private handleParsedMavlinkMessage(msgId: number, payload: Uint8Array, seq: number, sysId: number, compId: number) {
    const now = Date.now();
    this.connectionState.lastHeartbeat = now;
    this.connectionState.isConnected = true;
    this.telemetry.pixhawkConnected = true;

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

    switch (msgId) {
      // HEARTBEAT (msgId = 0)
      case 0: {
        if (payload.length >= 9) {
          const customMode = view.getUint32(0, true);
          const baseMode = view.getUint8(6);
          const isArmed = (baseMode & 128) !== 0;
          const flightModeName = ARDUPILOT_MODES[customMode] || `MODE_${customMode}`;

          this.telemetry.isArmed = isArmed;
          this.telemetry.flightMode = isArmed ? flightModeName : 'DISARMED';
          this.notifyTelemetry();
          this.notifyConnection();
        }
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
          const eph = view.getUint16(16, true) / 100; // HDOP
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
          const relativeAlt = view.getInt32(16, true) / 1000; // Relative to home/takeoff
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

      // STATUSTEXT (msgId = 253) -> Live Pixhawk Messages & Errors!
      case 253: {
        if (payload.length >= 1) {
          const severityLevel = view.getUint8(0);
          const severity = SEVERITY_NAMES[severityLevel] || 'INFO';
          const textBytes = payload.subarray(1);
          let text = '';
          for (let i = 0; i < textBytes.length; i++) {
            if (textBytes[i] === 0) break;
            text += String.fromCharCode(textBytes[i]);
          }
          if (text.length > 0) {
            this.addStatusMessage(severity, severityLevel, text);
          }
        }
        break;
      }

      // COMMAND_ACK (msgId = 77)
      case 77: {
        if (payload.length >= 3) {
          const command = view.getUint16(0, true);
          const result = view.getUint8(2);
          const resultNames = ['ACCEPTED', 'TEMP_REJECTED', 'DENIED', 'UNSUPPORTED', 'FAILED', 'IN_PROGRESS'];
          this.addStatusMessage(
            result === 0 ? 'INFO' : 'WARNING',
            result === 0 ? 6 : 4,
            `Command ${command} ACK: ${resultNames[result] || `CODE_${result}`}`
          );
          this.emitPacket('COMMAND_ACK', { command, result });
        }
        break;
      }
    }
  }

  /**
   * Request MAVLink Telemetry Streams (10Hz) from Pixhawk
   */
  public async requestMavlinkDataStreams() {
    // MAV_CMD_SET_MESSAGE_INTERVAL for all essential streams
    await this.sendMavlinkCommandLong(511 /* MAV_CMD_SET_MESSAGE_INTERVAL */, 0 /* HEARTBEAT */, 1000000 /* 1Hz */);
    await this.sendMavlinkCommandLong(511, 1 /* SYS_STATUS */, 200000 /* 5Hz */);
    await this.sendMavlinkCommandLong(511, 24 /* GPS_RAW_INT */, 200000 /* 5Hz */);
    await this.sendMavlinkCommandLong(511, 33 /* GLOBAL_POSITION_INT */, 100000 /* 10Hz */);
    await this.sendMavlinkCommandLong(511, 30 /* ATTITUDE */, 100000 /* 10Hz */);
  }

  /**
   * Real One-Click Arming Command
   */
  public async armDrone(): Promise<boolean> {
    this.addStatusMessage('NOTICE', 5, 'Sending MAVLink ARM Command to Pixhawk FC...');
    if (this.connectionState.isRealHardware && (this.serialWriter || this.usbDevice)) {
      // 1. Set mode to GUIDED (or STABILIZE)
      await this.setFlightMode('GUIDED');
      // 2. Send ARM command
      await this.sendMavlinkCommandLong(400 /* MAV_CMD_COMPONENT_ARM_DISARM */, 1 /* Arm */, 21196 /* Force check override if permitted */);
      return true;
    } else {
      // Simulated arm
      this.telemetry.isArmed = true;
      this.telemetry.flightMode = 'GUIDED';
      this.addStatusMessage('INFO', 6, 'SIMULATOR: Drone Armed (Motors Spinning)');
      this.notifyTelemetry();
      return true;
    }
  }

  /**
   * Real One-Click Disarm Command
   */
  public async disarmDrone(): Promise<boolean> {
    this.addStatusMessage('NOTICE', 5, 'Sending MAVLink DISARM Command to Pixhawk FC...');
    if (this.connectionState.isRealHardware && (this.serialWriter || this.usbDevice)) {
      await this.sendMavlinkCommandLong(400 /* MAV_CMD_COMPONENT_ARM_DISARM */, 0 /* Disarm */);
      return true;
    } else {
      this.telemetry.isArmed = false;
      this.telemetry.flightMode = 'DISARMED';
      this.telemetry.altitude = 0;
      this.addStatusMessage('INFO', 6, 'SIMULATOR: Drone Disarmed');
      this.notifyTelemetry();
      return true;
    }
  }

  /**
   * Set Flight Mode (GUIDED, AUTO, STABILIZE, LOITER, RTL, LAND)
   */
  public async setFlightMode(modeName: 'GUIDED' | 'AUTO' | 'STABILIZE' | 'LOITER' | 'RTL' | 'LAND'): Promise<boolean> {
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

    if (this.connectionState.isRealHardware && (this.serialWriter || this.usbDevice)) {
      // MAV_CMD_DO_SET_MODE = 176
      await this.sendMavlinkCommandLong(176, 1 /* MAV_MODE_FLAG_CUSTOM_MODE_ENABLED */, customMode);
      return true;
    } else {
      this.telemetry.flightMode = modeName;
      this.notifyTelemetry();
      return true;
    }
  }

  /**
   * Takeoff Command (MAV_CMD_NAV_TAKEOFF = 22)
   */
  public async commandTakeoff(targetAltMeters: number = 20): Promise<boolean> {
    this.addStatusMessage('NOTICE', 5, `Sending Takeoff Command to ${targetAltMeters}m...`);
    if (this.connectionState.isRealHardware && (this.serialWriter || this.usbDevice)) {
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

  public async commandStartSearch(): Promise<boolean> {
    this.addStatusMessage('NOTICE', 5, 'Starting Autonomous Search Pattern...');
    if (this.connectionState.isRealHardware && (this.serialWriter || this.usbDevice)) {
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
    if (this.connectionState.isRealHardware && (this.serialWriter || this.usbDevice)) {
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
    if (this.connectionState.isRealHardware && (this.serialWriter || this.usbDevice)) {
      await this.setFlightMode('LAND');
      return true;
    } else {
      this.telemetry.flightMode = 'LAND';
      this.telemetry.targetAltitude = 0;
      this.notifyTelemetry();
      return true;
    }
  }

  /**
   * Encodes & Sends a MAVLink 1.0 COMMAND_LONG packet (msgId = 76)
   */
  private async sendMavlinkCommandLong(
    command: number,
    param1: number = 0,
    param2: number = 0,
    param3: number = 0,
    param4: number = 0,
    param5: number = 0,
    param6: number = 0,
    param7: number = 0
  ) {
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
    view.setUint8(30, 1); // target_system = 1
    view.setUint8(31, 1); // target_component = 1
    view.setUint8(32, 0); // confirmation = 0

    const packet = this.buildMavlink1Frame(76 /* COMMAND_LONG */, payload);
    try {
      if (this.serialWriter) {
        await this.serialWriter.write(packet);
        this.connectionState.bytesSent += packet.length;
      } else if (this.usbDevice) {
        await this.usbDevice.transferOut(this.usbOutEndpoint, packet);
        this.connectionState.bytesSent += packet.length;
      }
    } catch (e) {
      console.warn('Failed to write MAVLink packet', e);
    }
  }

  private buildMavlink1Frame(msgId: number, payload: Uint8Array): Uint8Array {
    this.sendSeq = (this.sendSeq + 1) % 256;
    const len = payload.length;
    const frame = new Uint8Array(6 + len + 2);
    frame[0] = 0xFE; // MAVLink 1 STX
    frame[1] = len;
    frame[2] = this.sendSeq;
    frame[3] = 255; // GCS System ID
    frame[4] = 190; // GCS Component ID
    frame[5] = msgId;

    frame.set(payload, 6);

    // Calculate MAVLink CRC
    const crc = this.calculateMavlinkCrc(frame.subarray(1, 6 + len), msgId);
    frame[6 + len] = crc & 0xFF;
    frame[6 + len + 1] = (crc >> 8) & 0xFF;

    return frame;
  }

  private calculateMavlinkCrc(buffer: Uint8Array, msgId: number): number {
    // CRC-16/MCRF4XX
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
      let b = buffer[i] ^ (crc & 0xFF);
      b ^= (b << 4) & 0xFF;
      crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);
    }

    // CRC Extra for message types
    const crcExtras: Record<number, number> = {
      0: 50,    // HEARTBEAT
      1: 124,   // SYS_STATUS
      24: 30,   // GPS_RAW_INT
      30: 39,   // ATTITUDE
      33: 104,  // GLOBAL_POSITION_INT
      76: 152,  // COMMAND_LONG
      77: 143,  // COMMAND_ACK
      147: 154, // BATTERY_STATUS
      253: 83   // STATUSTEXT
    };

    const extra = crcExtras[msgId] ?? 0;
    let b = extra ^ (crc & 0xFF);
    b ^= (b << 4) & 0xFF;
    crc = (crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4);

    return crc;
  }

  private calculateLiPoPercentage(voltage: number): number {
    if (voltage <= 0) return 0;
    // Auto-detect LiPo cell count: 3S (~11.1V-12.6V), 4S (~14.8V-16.8V), 6S (~22.2V-25.2V)
    let cells = 3;
    if (voltage > 18.0) cells = 6;
    else if (voltage > 13.0) cells = 4;
    else cells = 3;

    const cellVoltage = voltage / cells;
    const minCell = 3.3; // 0% discharged threshold
    const maxCell = 4.2; // 100% full charge
    const pct = Math.max(0, Math.min(100, Math.round(((cellVoltage - minCell) / (maxCell - minCell)) * 100)));
    return pct;
  }

  // Switch to Simulation / SITL mode for bench tests
  public switchToSimulationMode() {
    this.connectionState.connectionType = 'SIMULATED';
    this.connectionState.isConnected = true;
    this.connectionState.isRealHardware = false;
    this.connectionState.portOrAddress = 'SITL Simulator (Bench Test)';
    this.connectionState.lastHeartbeat = Date.now();
    this.telemetry.pixhawkConnected = true;
    this.telemetry.batteryPercent = 98;
    this.telemetry.batteryVoltage = 24.8;
    this.telemetry.gps.isLocked = true;
    this.telemetry.gps.satellites = 18;
    this.telemetry.gps.hdop = 0.8;
    this.telemetry.gps.fixType = '3D_FIX';

    this.addStatusMessage('INFO', 6, 'Switched to SITL Simulation Mode.');
    this.startSimLoop();
    this.notifyConnection();
    this.notifyTelemetry();
  }

  private generateSearchGridWaypoints() {
    const originLat = this.homePoint.isSet ? this.homePoint.latitude : this.telemetry.latitude;
    const originLon = this.homePoint.isSet ? this.homePoint.longitude : this.telemetry.longitude;

    const delta = 0.00035;
    this.simWaypoints = [
      { lat: originLat + delta * 0.8, lon: originLon + delta * 0.5, alt: 22 },
      { lat: originLat + delta * 1.6, lon: originLon + delta * 0.5, alt: 25 },
      { lat: originLat + delta * 1.6, lon: originLon - delta * 0.5, alt: 25 },
      { lat: originLat + delta * 2.4, lon: originLon - delta * 0.5, alt: 25 },
      { lat: originLat + delta * 2.4, lon: originLon + delta * 1.2, alt: 25 },
      { lat: originLat + delta * 1.2, lon: originLon + delta * 1.2, alt: 25 },
    ];
    this.currentWpIndex = 0;
  }

  private startSimLoop() {
    if (this.simInterval) clearInterval(this.simInterval);
    let tick = 0;
    this.simInterval = setInterval(() => {
      if (this.connectionState.isRealHardware) return; // don't simulate if on real hardware
      tick++;

      if (tick % 10 === 0 && this.connectionState.isConnected) {
        this.connectionState.lastHeartbeat = Date.now();
        this.emitPacket('HEARTBEAT', {
          customMode: this.telemetry.flightMode,
          baseMode: this.telemetry.isArmed ? 128 : 0,
          systemStatus: 4
        });
        this.notifyConnection();
      }

      if (this.connectionState.isConnected && this.telemetry.isArmed) {
        const altDiff = this.telemetry.targetAltitude - this.telemetry.altitude;
        if (Math.abs(altDiff) > 0.1) {
          const climbRate = Math.sign(altDiff) * Math.min(2.5, Math.abs(altDiff) * 0.6);
          this.telemetry.verticalSpeed = +climbRate.toFixed(2);
          this.telemetry.altitude = +(this.telemetry.altitude + climbRate * 0.1).toFixed(2);
        } else {
          this.telemetry.verticalSpeed = 0;
          this.telemetry.altitude = this.telemetry.targetAltitude;
        }

        if (this.simWaypoints.length > 0 && this.telemetry.altitude >= 15) {
          const targetWp = this.simWaypoints[this.currentWpIndex];
          if (targetWp) {
            const dLat = targetWp.lat - this.telemetry.latitude;
            const dLon = targetWp.lon - this.telemetry.longitude;
            const dist = Math.hypot(dLat, dLon);

            if (dist < 0.00008) {
              this.currentWpIndex = (this.currentWpIndex + 1) % this.simWaypoints.length;
              this.searchProgressCount = Math.min(100, this.searchProgressCount + 15);
              this.telemetry.searchProgress = this.searchProgressCount;
            } else {
              const speed = 0.00003;
              this.telemetry.latitude += (dLat / dist) * speed;
              this.telemetry.longitude += (dLon / dist) * speed;
              this.telemetry.groundSpeed = 6.2;
              this.telemetry.heading = +((Math.atan2(dLon, dLat) * 180) / Math.PI + 360).toFixed(0) % 360;
            }
          }
        }
        this.notifyTelemetry();
      }
    }, 100);
  }

  private emitPacket(msgName: MAVLinkPacket['msgName'], payload: Record<string, any>) {
    const packet: MAVLinkPacket = {
      seq: this.sendSeq,
      sysId: 1,
      compId: 1,
      msgId: 0,
      msgName,
      payload,
      timestamp: Date.now()
    };
    this.packetListeners.forEach((fn) => fn(packet));
  }

  private notifyTelemetry() {
    const t = this.getTelemetry();
    this.listeners.forEach((fn) => fn(t));
  }

  private notifyConnection() {
    const c = this.getConnectionState();
    this.connectionListeners.forEach((fn) => fn(c));
  }
}

export const mavlinkService = new MAVLinkService();
