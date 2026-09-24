import React, { useState } from 'react';
import { PixhawkConnectionState, PixhawkStatusMessage, MAVLinkCommandAck } from '../../types/mavlink';
import { DroneTelemetry, HomePoint } from '../../types/mission';
import { mavlinkService } from '../../services/mavlinkService';
import { 
  ShieldCheck, 
  AlertTriangle, 
  Info, 
  CheckCircle2, 
  XCircle, 
  ChevronDown, 
  ChevronUp, 
  Activity,
  Battery,
  Compass,
  Navigation,
  Radio,
  Sliders,
  RotateCcw,
  Terminal,
  ShieldAlert,
  HelpCircle,
  Cpu
} from 'lucide-react';

interface PreArmChecksPanelProps {
  connectionState: PixhawkConnectionState;
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  isReady?: boolean;
  className?: string;
}

export type PreArmCheckStatus = 'BLOCKING' | 'INFO' | 'PASS';

export interface PreArmCheckItem {
  id: string;
  category: string;
  title: string;
  description: string;
  status: PreArmCheckStatus;
  rawMessage?: string;
  timestamp?: number;
}

export const PreArmChecksPanel: React.FC<PreArmChecksPanelProps> = ({
  connectionState,
  telemetry,
  homePoint,
  isReady,
  className = ''
}) => {
  const [showStatusHistory, setShowStatusHistory] = useState(false);
  const [showArmDebug, setShowArmDebug] = useState(true);
  
  const activeMode = (telemetry.flightMode || 'DISARMED').toUpperCase();
  const isPosDependent = mavlinkService.isModePositionDependent(activeMode);
  const isAltHoldOrStabilize = !isPosDependent;

  // Compile full list of validation items
  const items: PreArmCheckItem[] = [];

  // 1. Connection & Heartbeat Stream Check
  if (!connectionState.isConnected) {
    items.push({
      id: 'conn_missing',
      category: 'COMMUNICATION LINK',
      title: 'MAVLink Connection & Heartbeat',
      description: 'Pixhawk flight controller is not connected or no MAVLink heartbeat received.',
      status: 'BLOCKING'
    });
  } else {
    items.push({
      id: 'conn_ok',
      category: 'COMMUNICATION LINK',
      title: 'MAVLink Telemetry Link',
      description: `Active link @ ${connectionState.baudRate} baud (SysID ${connectionState.systemId || 1}, ${connectionState.heartbeatHz || 1.0} Hz heartbeat)`,
      status: 'PASS'
    });
  }

  // 2. Hardware Pre-Arm Failures from ArduPilot STATUSTEXT
  const preArmMessages: PixhawkStatusMessage[] = (connectionState.statusHistory || []).filter((msg) => {
    const text = (msg.text || '').toLowerCase();
    return text.includes('prearm') || text.includes('arming') || text.includes('compass') || text.includes('ahrs') || text.includes('battery') || text.includes('ekf') || text.includes('mag');
  });

  if (connectionState.preArmFailReason && !telemetry.isArmed) {
    items.push({
      id: 'ardu_prearm_fail',
      category: 'ARDUPILOT FC PRE-ARM',
      title: 'Pre-Arm Safety Check Rejected by Pixhawk',
      description: connectionState.preArmFailReason,
      rawMessage: connectionState.preArmFailReason,
      status: 'BLOCKING'
    });
  }

  // 3. Mode-Aware GPS 3D Fix Requirement
  const hasGps3DFix = telemetry.gps.isLocked && telemetry.gps.satellites >= 6;
  if (isPosDependent) {
    // Position-dependent mode (e.g. AUTO, LOITER, GUIDED) REQUIRES GPS
    if (hasGps3DFix) {
      items.push({
        id: 'gps_mode_pass',
        category: 'NAVIGATION SENSORS',
        title: `GPS 3D Fix (${activeMode} Mode)`,
        description: `Position estimate locked with ${telemetry.gps.satellites} satellites (HDOP: ${telemetry.gps.hdop.toFixed(1)})`,
        status: 'PASS'
      });
    } else {
      items.push({
        id: 'gps_mode_blocking',
        category: 'NAVIGATION SENSORS',
        title: `GPS 3D Fix Required for ${activeMode}`,
        description: `Position estimate unavailable (${telemetry.gps.satellites} sats visible, fix: ${telemetry.gps.fixType}). ${activeMode} mode requires a valid 3D GPS position fix before arming.`,
        status: 'BLOCKING'
      });
    }
  } else {
    // Mode does NOT require GPS (e.g. ALT_HOLD, STABILIZE)
    if (hasGps3DFix) {
      items.push({
        id: 'gps_althold_pass',
        category: 'NAVIGATION SENSORS',
        title: `GPS 3D Fix (Optional in ${activeMode})`,
        description: `3D fix available (${telemetry.gps.satellites} satellites visible).`,
        status: 'PASS'
      });
    } else {
      items.push({
        id: 'gps_althold_info',
        category: 'NAVIGATION SENSORS',
        title: `GPS 3D Fix Unavailable (Not Required for ${activeMode})`,
        description: `${activeMode} is a barometric altitude-control mode. GPS position is NOT required for arming or flight.`,
        status: 'INFO'
      });
    }
  }

  // 4. Mode-Aware Home Point Requirement
  const hasHomePoint = homePoint.isSet && homePoint.latitude !== 0;
  if (isPosDependent) {
    if (hasHomePoint) {
      items.push({
        id: 'home_pass',
        category: 'HOME POSITION',
        title: 'Home Point Configured',
        description: `Locked at ${homePoint.latitude.toFixed(6)}, ${homePoint.longitude.toFixed(6)} (Alt: ${homePoint.altitude.toFixed(1)}m)`,
        status: 'PASS'
      });
    } else {
      items.push({
        id: 'home_blocking',
        category: 'HOME POSITION',
        title: `Home Point Required for ${activeMode}`,
        description: `Home position is not set. Position-dependent mode (${activeMode}) requires a valid home origin for navigation and RTL.`,
        status: 'BLOCKING'
      });
    }
  } else {
    if (hasHomePoint) {
      items.push({
        id: 'home_opt_pass',
        category: 'HOME POSITION',
        title: `Home Point Configured (${activeMode})`,
        description: `Home origin set at ${homePoint.latitude.toFixed(6)}, ${homePoint.longitude.toFixed(6)}`,
        status: 'PASS'
      });
    } else {
      items.push({
        id: 'home_opt_info',
        category: 'HOME POSITION',
        title: `Home Point Not Set (Not Required for ${activeMode})`,
        description: `${activeMode} mode does not use autonomous waypoints or automatic RTL, so home point is optional.`,
        status: 'INFO'
      });
    }
  }

  // 5. Battery Telemetry (Display exact reported values from Pixhawk without fabricating)
  const isBatteryReported = telemetry.batteryVoltage > 0;
  if (isBatteryReported) {
    if (telemetry.batteryVoltage < 10.5 && telemetry.batteryVoltage > 5.0) {
      items.push({
        id: 'batt_low',
        category: 'POWER SYSTEM',
        title: 'Battery Voltage Low',
        description: `Pixhawk reports ${telemetry.batteryVoltage.toFixed(2)} V (${telemetry.batteryPercent}%). Pre-arm battery check threshold may trigger rejection. Verify physical pack voltage and power module calibration.`,
        status: 'BLOCKING'
      });
    } else {
      items.push({
        id: 'batt_ok',
        category: 'POWER SYSTEM',
        title: 'Battery Voltage Telemetry',
        description: `Reported by Pixhawk: ${telemetry.batteryVoltage.toFixed(2)} V (${telemetry.batteryPercent}%)`,
        status: 'PASS'
      });
    }
  } else {
    items.push({
      id: 'batt_unknown',
      category: 'POWER SYSTEM',
      title: 'Battery Telemetry',
      description: 'No battery voltage reported from flight controller power module.',
      status: 'INFO'
    });
  }

  // Exact Counter Metrics (Replaces misleading "0 errors" with transparent telemetry stats)
  const preArmFailuresCount = preArmMessages.length + (connectionState.preArmFailReason ? 1 : 0);
  const totalPixhawkMessages = connectionState.statusHistory?.length || 0;
  const ackFailuresCount = (connectionState.commandAckHistory || []).filter((ack) => ack.result !== 0).length;

  const blockingCount = items.filter((i) => i.status === 'BLOCKING').length;
  const infoCount = items.filter((i) => i.status === 'INFO').length;
  const passCount = items.filter((i) => i.status === 'PASS').length;

  // Last Command ACK details
  const lastAck: MAVLinkCommandAck | undefined = connectionState.lastCommandAck;
  const latestStatustext = connectionState.latestStatusMessage?.text || 
    (connectionState.statusHistory && connectionState.statusHistory.length > 0 ? connectionState.statusHistory[0].text : undefined);

  return (
    <div className={`bg-slate-900/95 rounded-2xl p-3 sm:p-4.5 border border-slate-800 shadow-xl font-mono space-y-3 ${className}`}>
      
      {/* Panel Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="text-xs sm:text-sm font-black uppercase text-white tracking-wider">
            PRE-ARM VALIDATION &amp; ARDUPILOT CHECKS
          </span>
        </div>

        {/* Flight Mode Indicator */}
        <div className="flex items-center space-x-1.5 text-[10px]">
          <span className="px-2 py-0.5 rounded bg-purple-950/80 border border-purple-500/50 text-purple-300 font-bold">
            MODE: {activeMode}
          </span>
          {blockingCount > 0 ? (
            <span className="px-2 py-0.5 rounded bg-rose-950/80 border border-rose-500/60 text-rose-300 font-black flex items-center space-x-1">
              <XCircle className="w-3 h-3 text-rose-400" />
              <span>{blockingCount} BLOCKING</span>
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 font-black flex items-center space-x-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>ALL PASSED</span>
            </span>
          )}
          {infoCount > 0 && (
            <span className="px-2 py-0.5 rounded bg-sky-950/80 border border-sky-500/50 text-sky-300 font-bold">
              {infoCount} INFO
            </span>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* EXPLICIT METRIC COUNTERS (SECTION 6: REPLACES MISLEADING "0 ERRORS")      */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div className={`p-2 rounded-xl border flex flex-col justify-between ${
          preArmFailuresCount > 0 
            ? 'bg-rose-950/40 border-rose-500/60 text-rose-300' 
            : 'bg-slate-950/80 border-slate-800 text-slate-300'
        }`}>
          <span className="text-[9px] uppercase text-slate-400 font-bold">Pre-arm failures</span>
          <span className={`text-sm sm:text-base font-black mt-0.5 ${preArmFailuresCount > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {preArmFailuresCount}
          </span>
        </div>

        <div className="p-2 rounded-xl border bg-slate-950/80 border-slate-800 text-slate-300 flex flex-col justify-between">
          <span className="text-[9px] uppercase text-slate-400 font-bold">Pixhawk messages</span>
          <span className="text-sm sm:text-base font-black text-sky-400 mt-0.5">
            {totalPixhawkMessages}
          </span>
        </div>

        <div className={`p-2 rounded-xl border flex flex-col justify-between ${
          ackFailuresCount > 0 
            ? 'bg-amber-950/40 border-amber-500/60 text-amber-300' 
            : 'bg-slate-950/80 border-slate-800 text-slate-300'
        }`}>
          <span className="text-[9px] uppercase text-slate-400 font-bold">Command ACK failures</span>
          <span className={`text-sm sm:text-base font-black mt-0.5 ${ackFailuresCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {ackFailuresCount}
          </span>
        </div>
      </div>

      {/* Flight Mode Behavioral Banner */}
      {isAltHoldOrStabilize ? (
        <div className="p-2.5 bg-sky-950/40 border border-sky-500/30 rounded-xl text-xs text-sky-200 flex items-start space-x-2">
          <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
            <strong className="text-sky-300">{activeMode} Mode Active:</strong> Barometric altitude-stabilized flight. GPS 3D position lock and Home Point are <strong>not required</strong> for arming.
          </div>
        </div>
      ) : (
        <div className="p-2.5 bg-purple-950/40 border border-purple-500/30 rounded-xl text-xs text-purple-200 flex items-start space-x-2">
          <Navigation className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
            <strong className="text-purple-300">{activeMode} Mode Active:</strong> Autonomous navigation &amp; position holding. GPS 3D fix &amp; Home Point are <strong>mandatory</strong> before arming.
          </div>
        </div>
      )}

      {/* Responsive Pre-Arm Items List (No height clipping, text wraps naturally) */}
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`p-3 rounded-xl border transition flex flex-col space-y-1.5 ${
              item.status === 'BLOCKING'
                ? 'bg-rose-950/30 border-rose-500/60 text-rose-200'
                : item.status === 'INFO'
                ? 'bg-sky-950/20 border-sky-500/40 text-sky-200'
                : 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center space-x-2 min-w-0">
                {item.status === 'BLOCKING' ? (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : item.status === 'INFO' ? (
                  <Info className="w-4 h-4 text-sky-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span className="text-xs font-black text-white uppercase tracking-wide">
                  {item.title}
                </span>
              </div>

              {/* Status Badge */}
              <span className={`text-[10px] font-black px-2 py-0.5 rounded border uppercase shrink-0 ${
                item.status === 'BLOCKING'
                  ? 'bg-rose-950 border-rose-500 text-rose-300'
                  : item.status === 'INFO'
                  ? 'bg-sky-950 border-sky-500 text-sky-300'
                  : 'bg-emerald-950 border-emerald-500 text-emerald-300'
              }`}>
                {item.status}
              </span>
            </div>

            {/* Full Message Text without Truncation (Section 9) */}
            <p
              className="text-[11px] leading-relaxed text-slate-300"
              style={{
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word'
              }}
            >
              {item.description}
            </p>
          </div>
        ))}
      </div>

      {/* ========================================================================= */}
      {/* SECTION 10 & 11: MAVLink ARM DEBUG & ACK DIAGNOSTICS (COLLAPSIBLE)       */}
      {/* ========================================================================= */}
      <div className="pt-2 border-t border-slate-800">
        <button
          onClick={() => setShowArmDebug(!showArmDebug)}
          className="text-[11px] text-slate-300 hover:text-white flex items-center justify-between w-full py-1.5 cursor-pointer font-bold"
        >
          <span className="flex items-center space-x-1.5">
            <Terminal className="w-3.5 h-3.5 text-sky-400" />
            <span>MAVLink ARM DEBUG &amp; ACK DIAGNOSTICS</span>
          </span>
          {showArmDebug ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showArmDebug && (
          <div className="mt-2 p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] space-y-2.5">
            
            {/* Section 10 Live Diagnostics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-[10px]">
              {/* 1. WebSocket */}
              <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">WebSocket</div>
                <div className={`font-black mt-0.5 ${connectionState.isUsbConnected || connectionState.isConnected ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {connectionState.isUsbConnected || connectionState.isConnected ? 'CONNECTED ✓' : 'DISCONNECTED'}
                </div>
              </div>

              {/* 2. Pixhawk RX */}
              <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">Pixhawk RX</div>
                <div className="font-black text-emerald-400 mt-0.5">{connectionState.bytesReceived} bytes</div>
              </div>

              {/* 3. Pixhawk TX */}
              <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">Pixhawk TX</div>
                <div className="font-black text-sky-400 mt-0.5">{connectionState.bytesSent} bytes</div>
              </div>

              {/* 4. Target System & Component */}
              <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">Target Sys / Comp</div>
                <div className="font-black text-purple-300 mt-0.5">
                  SysID: {connectionState.systemId ?? '—'} / CompID: {connectionState.componentId ?? '—'}
                </div>
              </div>

              {/* 5. Last MAVLink Command */}
              <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">Last Command Sent</div>
                <div className="font-black text-sky-300 mt-0.5">
                  {connectionState.lastSentCommandId ? `CMD_${connectionState.lastSentCommandId} (${connectionState.lastSentCommandId === 400 ? 'ARM_DISARM' : connectionState.lastSentCommandId})` : 'None'}
                </div>
              </div>

              {/* 6. Last COMMAND_ACK & Result */}
              <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">Last COMMAND_ACK</div>
                <div className="font-black text-amber-300 mt-0.5">
                  {lastAck ? `CMD_${lastAck.command}: ${lastAck.resultName}` : 'None'}
                </div>
              </div>

              {/* 7. Vehicle Armed */}
              <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">Vehicle Armed</div>
                <div className={`font-black mt-0.5 ${telemetry.isArmed ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {telemetry.isArmed ? 'YES (ARMED)' : 'NO (DISARMED)'}
                </div>
              </div>

              {/* 8. Flight Mode */}
              <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">Flight Mode</div>
                <div className="font-black text-purple-300 mt-0.5">{activeMode}</div>
              </div>
            </div>

            {/* TX ARM COMMAND Details */}
            <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-[10px] font-bold text-sky-400 uppercase">
                <span>TX: MAV_CMD_COMPONENT_ARM_DISARM (400)</span>
                <span className="text-slate-400">Target: SysID {connectionState.systemId || 1}, CompID {connectionState.componentId || 1}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px] text-slate-300">
                <div><strong>Command:</strong> 400 (ARM_DISARM)</div>
                <div><strong>Action:</strong> ARM</div>
                <div><strong>Param1:</strong> 1.0 (ARM)</div>
                <div><strong>Param2:</strong> 0.0 (Standard)</div>
              </div>
            </div>

            {/* RX ARM COMMAND_ACK */}
            <div className={`p-2 rounded-lg border space-y-1 ${
              !connectionState.lastArmCommandAck 
                ? 'bg-slate-900 border-slate-800 text-slate-400'
                : connectionState.lastArmCommandAck.result === 0
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
            }`}>
              <div className="flex items-center justify-between text-[10px] font-bold uppercase">
                <span>RX: ARM COMMAND_ACK (Command 400)</span>
                {connectionState.lastArmCommandAck && <span>{new Date(connectionState.lastArmCommandAck.timestamp).toLocaleTimeString()}</span>}
              </div>
              {connectionState.lastArmCommandAck ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-[10px]">
                  <div><strong>Command:</strong> 400 (MAV_CMD_COMPONENT_ARM_DISARM)</div>
                  <div>
                    <strong>Result:</strong>{' '}
                    <span className={`font-black ${connectionState.lastArmCommandAck.result === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {connectionState.lastArmCommandAck.resultName} ({connectionState.lastArmCommandAck.result})
                    </span>
                  </div>
                  {connectionState.lastArmCommandAck.resultParam2 !== undefined && (
                    <div><strong>Result Param2:</strong> {connectionState.lastArmCommandAck.resultParam2}</div>
                  )}
                </div>
              ) : (
                <div className="text-[10px] text-slate-500 italic">
                  No COMMAND_ACK received for command 400 yet. Press ARM to send.
                </div>
              )}
            </div>

            {/* RX HEARTBEAT ARMED STATE */}
            <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between text-[10px]">
              <div>
                <span className="text-slate-400 font-bold uppercase">RX: HEARTBEAT ARMED STATE</span>
                <div className="text-slate-300 mt-0.5">
                  Bitmask: <code>(HEARTBEAT.base_mode &amp; MAV_MODE_FLAG_SAFETY_ARMED (128)) !== 0</code>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded font-black text-xs border ${
                telemetry.isArmed 
                  ? 'bg-emerald-950 border-emerald-400 text-emerald-300' 
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}>
                {telemetry.isArmed ? 'ARMED (TRUE)' : 'DISARMED (FALSE)'}
              </span>
            </div>

            {/* RX STATUSTEXT / PRE-ARM FAILURES */}
            <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 space-y-1">
              <div className="text-[10px] font-bold text-purple-400 uppercase">
                RX: LAST STATUSTEXT MESSAGE
              </div>
              <p
                className="text-[11px] leading-relaxed text-slate-200"
                style={{
                  whiteSpace: 'normal',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word'
                }}
              >
                {latestStatustext ? latestStatustext : 'No STATUSTEXT reason received from Pixhawk.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ArduPilot Live STATUSTEXT Feed (Expandable, newest first) */}
      <div className="pt-1 border-t border-slate-800">
        <button
          onClick={() => setShowStatusHistory(!showStatusHistory)}
          className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center justify-between w-full py-1 cursor-pointer"
        >
          <span className="flex items-center space-x-1.5 font-bold">
            <Activity className="w-3.5 h-3.5 text-purple-400" />
            <span>ArduPilot STATUSTEXT Stream ({connectionState.statusHistory?.length || 0} messages)</span>
          </span>
          {showStatusHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showStatusHistory && (
          <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {(!connectionState.statusHistory || connectionState.statusHistory.length === 0) ? (
              <div className="text-[10px] text-slate-500 p-2 bg-slate-950 rounded-lg text-center">
                No STATUSTEXT messages received from Pixhawk yet.
              </div>
            ) : (
              connectionState.statusHistory.slice(0, 10).map((msg) => (
                <div
                  key={msg.id}
                  className={`p-2 rounded-lg text-[10px] border flex items-start space-x-2 ${
                    msg.severityLevel <= 3
                      ? 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                      : msg.severityLevel === 4
                      ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                      : 'bg-slate-950 border-slate-800 text-slate-300'
                  }`}
                >
                  <span className="font-bold uppercase text-[9px] px-1 py-0.5 rounded bg-slate-900 border border-slate-700 shrink-0">
                    {msg.severity}
                  </span>
                  <span
                    className="flex-1 leading-relaxed"
                    style={{
                      whiteSpace: 'normal',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word'
                    }}
                  >
                    {msg.text}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
