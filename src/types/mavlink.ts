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

export interface PixhawkStatusMessage {
  id: string;
  timestamp: number;
  severity: 'EMERGENCY' | 'ALERT' | 'CRITICAL' | 'ERROR' | 'WARNING' | 'NOTICE' | 'INFO' | 'DEBUG';
  severityLevel: number;
  text: string;
}

export interface PixhawkConnectionState {
  connectionType: FlightControllerConnection;
  isConnected: boolean;
  portOrAddress: string;
  baudRate: number;
  bytesReceived: number;
  bytesSent: number;
  lastHeartbeat: number;
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
}

export interface MotorConfigurationInfo {
  frameType: 'QUAD_X' | 'QUAD_PLUS';
  totalMotors: 4;
  mixingControlledByPixhawk: true;
  motorNotes: string;
}
