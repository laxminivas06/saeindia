// MAVLink 2.4.8 message structures & communication layer types

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

export type FlightControllerConnection = 'USB_SERIAL' | 'UDP_TELEMETRY' | 'TCP_CLIENT' | 'BLUETOOTH' | 'SIMULATED';

export type ConnectionPhase =
  | 'DISCONNECTED'
  | 'USB_DEVICE_DETECTED'
  | 'USB_PERMISSION_REQUESTED'
  | 'USB_PERMISSION_GRANTED'
  | 'USB_INTERFACE_DETECTED'
  | 'SERIAL_INTERFACE_OPENED'
  | 'MAVLINK_INITIALIZING'
  | 'MAVLINK_HEARTBEAT_RECEIVED'
  | 'FLIGHT_CONTROLLER_CONNECTED'
  | 'ERROR';

export interface UsbDeviceDiagnostics {
  deviceName?: string;
  productName?: string;
  manufacturerName?: string;
  vendorId?: number;
  productId?: number;
  interfaceCount?: number;
  selectedInterface?: number;
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
  driverType: 'NATIVE_ANDROID_USB' | 'WEBSERIAL' | 'WEBUSB' | 'SIMULATOR';
  lastError?: string;
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
  isConnected: boolean; // Only true when valid HEARTBEAT is verified
  portOrAddress: string;
  baudRate: number;
  bytesReceived: number;
  bytesSent: number;
  lastHeartbeat: number;
  heartbeatHz: number;
  packetLossPercent: number;
  firmwareVersion: string;
  autopilotType: string;
  mavlinkVersion: string; // 'MAVLink 2.4.8'
  isReceivingTelemetry: boolean;
  ekfHealthy: boolean;
  preArmChecksPassed: boolean;
  preArmFailReason?: string;
  latestStatusMessage?: PixhawkStatusMessage;
  statusHistory: PixhawkStatusMessage[];
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
