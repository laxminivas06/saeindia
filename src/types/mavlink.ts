// MAVLink message structures & communication layer types

export type MAVLinkMessageType =
  | 'HEARTBEAT'
  | 'SYS_STATUS'
  | 'GLOBAL_POSITION_INT'
  | 'GPS_RAW_INT'
  | 'ATTITUDE'
  | 'BATTERY_STATUS'
  | 'STATUSTEXT'
  | 'MISSION_ITEM'
  | 'NAV_TAKEOFF'
  | 'NAV_RTL'
  | 'COMMAND_LONG'
  | 'COMMAND_ACK'
  | 'SET_MODE';

export interface MAVLinkPacket {
  seq: number;
  sysId: number;
  compId: number;
  msgId: number;
  msgName: MAVLinkMessageType;
  payload: Record<string, any>;
  timestamp: number;
}

export type FlightControllerConnection = 
  | 'USB_SERIAL' 
  | 'UDP_TELEMETRY' 
  | 'TCP_CLIENT' 
  | 'BLUETOOTH' 
  | 'IOS_ACCESSORY' 
  | 'SIMULATED';

export type ConnectionPhase =
  // Standard Connection State Machine (per SAEISS spec)
  | 'DISCONNECTED'
  | 'USB_DEVICE_DETECTED'
  | 'USB_PERMISSION_REQUIRED'
  | 'USB_PERMISSION_GRANTED'
  | 'SERIAL_OPENING'
  | 'SERIAL_OPEN'
  | 'WAITING_FOR_MAVLINK'
  | 'HEARTBEAT_RECEIVED'
  | 'PIXHAWK_CONNECTED'
  | 'TELEMETRY_ACTIVE'
  // Intermediate aliases
  | 'REQUESTING_PERMISSION'
  | 'PERMISSION_GRANTED'
  | 'OPENING_USB'
  | 'USB_CONNECTED'
  | 'WAITING_FOR_HEARTBEAT'
  | 'MAVLINK_CONNECTED'
  // Diagnostic Failure States
  | 'USB_NOT_DETECTED'
  | 'PERMISSION_DENIED'
  | 'UNSUPPORTED_DEVICE'
  | 'INTERFACE_NOT_SUPPORTED'
  | 'SERIAL_OPEN_FAILED'
  | 'NO_SERIAL_DATA'
  | 'NO_MAVLINK_HEARTBEAT'
  | 'HEARTBEAT_TIMEOUT'
  | 'CONNECTION_LOST'
  | 'MAVLINK_ERROR'
  | 'IOS_UNSUPPORTED';

export interface DiagnosticsLogEntry {
  id: string;
  timestamp: number;
  tag: 'USB' | 'MAVLINK' | 'TRANSPORT' | 'SYSTEM' | 'ERROR';
  message: string;
  level: 'info' | 'warn' | 'error' | 'success';
}

export interface UsbDeviceDiagnostics {
  deviceName?: string;
  productName?: string;
  manufacturerName?: string;
  vendorId?: number;
  productId?: number;
  interfaceCount?: number;
  selectedInterface?: number;
  interfaceType?: string;
  endpointIn?: number;
  endpointOut?: number;
  hasPermission?: boolean;
  baudRate?: number;
  totalPacketsReceived: number;
  heartbeatsCount: number;
  lastHeartbeatAgeMs?: number;
  heartbeatHz?: number;
  systemId?: number;
  componentId?: number;
  autopilotType?: string;
  vehicleType?: string;
  driverType: 'NATIVE_ANDROID_USB' | 'IOS_ACCESSORY' | 'WEBSERIAL' | 'WEBUSB' | 'UDP' | 'TCP' | 'SIMULATOR';
  lastError?: string;
  hostPowerStatus?: 'HOST_ACTIVE' | 'DEVICE_POWERED' | 'CHECK_EXTERNAL_POWER' | 'UNKNOWN';
  isUsbHostSupported?: boolean;
  connectedDeviceCount?: number;
  serialDataReceived?: boolean;
}

export interface PixhawkStatusMessage {
  id: string;
  timestamp: number;
  severity: 'EMERGENCY' | 'ALERT' | 'CRITICAL' | 'ERROR' | 'WARNING' | 'NOTICE' | 'INFO' | 'DEBUG';
  severityLevel: number;
  text: string;
}

export interface PixhawkConnectionState {
  connectionType: FlightControllerConnection;
  phase: ConnectionPhase;
  phaseMessage: string;
  isConnected: boolean; // True ONLY when MAVLink HEARTBEAT is confirmed
  isUsbConnected: boolean; // True when physical serial link is open
  portOrAddress: string;
  baudRate: number;
  bytesReceived: number;
  bytesSent: number;
  lastHeartbeat: number;
  heartbeatHz: number;
  packetLossPercent: number;
  firmwareVersion: string;
  autopilotType: string;
  mavlinkVersion: string;
  isReceivingTelemetry: boolean;
  ekfHealthy: boolean;
  preArmChecksPassed: boolean;
  preArmFailReason?: string;
  latestStatusMessage?: PixhawkStatusMessage;
  statusHistory: PixhawkStatusMessage[];
  diagnosticsLogs: DiagnosticsLogEntry[];
  isRealHardware: boolean;
  systemId?: number;
  componentId?: number;
  errorMessage?: string;
  diagnostics: UsbDeviceDiagnostics;
}

export interface MotorConfigurationInfo {
  frameType: 'QUAD_X' | 'QUAD_PLUS';
  totalMotors: 4;
  mixingControlledByPixhawk: true;
  motorNotes: string;
}
