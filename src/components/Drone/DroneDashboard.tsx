import React, { useState, useEffect } from 'react';
import { DroneTelemetry, DecodedQRData, MissionState } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { mavlinkService } from '../../services/mavlinkService';
import { missionEngine } from '../../services/missionEngine';
import { CameraVisionHUD } from './CameraVisionHUD';
import { QRResultCard } from './QRResultCard';
import { PixhawkMonitor } from './PixhawkMonitor';
import { PixhawkConnectionCard } from './PixhawkConnectionCard';
import { PreArmChecksPanel } from '../common/PreArmChecksPanel';
import { MissionTimer } from '../common/MissionTimer';
import {
  Play,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Zap,
  Cpu,
  Navigation,
  Battery,
  Wifi,
  Radio,
  Usb,
  RefreshCw,
  X,
  AlertOctagon,
  Activity,
  Power,
  PowerOff,
  PlaneTakeoff,
  Terminal,
  HelpCircle,
  Smartphone,
  Check,
  Shield,
  Loader2,
  CheckCircle
} from 'lucide-react';

interface DroneDashboardProps {
  telemetry: DroneTelemetry;
  missionState: MissionState;
  remainingSeconds: number;
  elapsedSeconds: number;
  decodedQR: DecodedQRData | null;
  pixhawkState: PixhawkConnectionState;
  runnerLink: RunnerLinkState;
  runnerAckReceived: boolean;
  runnerAckLatencyMs?: number;
  onQRDetected: (data: DecodedQRData) => void;
  onEmergencyRTL: () => void;
}

export const DroneDashboard: React.FC<DroneDashboardProps> = ({
  telemetry,
  missionState,
  remainingSeconds,
  elapsedSeconds,
  decodedQR,
  pixhawkState,
  runnerLink,
  runnerAckReceived,
  runnerAckLatencyMs,
  onQRDetected,
  onEmergencyRTL
}) => {
  const [showPhoneOtgHelp, setShowPhoneOtgHelp] = useState(false);
  const [preArmError, setPreArmError] = useState<string | null>(null);

  // Real Arm / Disarm & Mission Button States
  const [isArmingInProgress, setIsArmingInProgress] = useState<boolean>(false);
  const [isDisarmingInProgress, setIsDisarmingInProgress] = useState<boolean>(false);
  const [armError, setArmError] = useState<string | null>(null);
  const homePoint = mavlinkService.getHomePoint();

  const isScanning = missionState === 'SEARCHING' || missionState === 'QR_DETECTED' || missionState === 'QR_SCANNING';

  // Live Telemetry & Pre-Arm State
  const isGpsReady = telemetry.gps.isLocked && telemetry.gps.satellites >= 6 && telemetry.gps.hdop <= 2.5;
  const isTelemetryReceiving = pixhawkState.isConnected && pixhawkState.isReceivingTelemetry;
  const isArmed = telemetry.isArmed;
  const isMissionRunning = missionState === 'STARTING' || missionState === 'TAKEOFF' || missionState === 'SEARCHING' || missionState === 'QR_SCANNING';
  const isMissionCompleted = missionState === 'MISSION_COMPLETE';
  const isMissionAborted = missionState === 'EMERGENCY_RTL' || missionState === 'MISSION_TIMEOUT' || missionState === 'CONNECTION_LOST';

  // Watch telemetry changes to clear in-progress arming state
  useEffect(() => {
    if (telemetry.isArmed && isArmingInProgress) {
      setIsArmingInProgress(false);
      setArmError(null);
    }
    if (!telemetry.isArmed && isDisarmingInProgress) {
      setIsDisarmingInProgress(false);
      setArmError(null);
    }
  }, [telemetry.isArmed, isArmingInProgress, isDisarmingInProgress]);

  // Handler: Explicit Real ARM Command
  const handleArmClick = async () => {
    setArmError(null);
    setPreArmError(null);
    setIsArmingInProgress(true);

    try {
      const res = await mavlinkService.sendArmCommand();
      if (!res) {
        setArmError('ARM TRANSMISSION FAILED: Check WebSocket / ESP32 TX Link.');
        setIsArmingInProgress(false);
        return;
      }

      // 4-second watchdog for telemetry confirmation
      setTimeout(() => {
        if (!mavlinkService.getTelemetry().isArmed) {
          setIsArmingInProgress(false);
          const lastAck = pixhawkState.lastArmCommandAck || pixhawkState.lastCommandAck;
          const preArmReason = pixhawkState.preArmFailReason ||
            (pixhawkState.statusHistory && pixhawkState.statusHistory.length > 0 ? pixhawkState.statusHistory[0].text : undefined);

          if (lastAck && lastAck.command === 400 && lastAck.result !== 0) {
            let failMsg = `ARM REJECTED (${lastAck.resultName} / Code ${lastAck.result})`;
            if (preArmReason) {
              failMsg += ` — ${preArmReason}`;
            }
            setArmError(failMsg);
          } else {
            setArmError('ARM ACK TIMEOUT (Waiting for vehicle armed state)');
          }
        }
      }, 4000);
    } catch (e: any) {
      setIsArmingInProgress(false);
      setArmError(`Arm command failed: ${e?.message || e}`);
    }
  };

  // Handler: Explicit Real DISARM Command
  const handleDisarmClick = async () => {
    setArmError(null);
    setIsDisarmingInProgress(true);
    try {
      await mavlinkService.sendDisarmCommand();
      setTimeout(() => {
        if (mavlinkService.getTelemetry().isArmed) {
          setIsDisarmingInProgress(false);
          setArmError('Disarm command timed out.');
        }
      }, 5000);
    } catch (e: any) {
      setIsDisarmingInProgress(false);
      setArmError(`Disarm failed: ${e?.message || e}`);
    }
  };

  // Handler: Explicit Real START MISSION Command
  const handleStartMissionClick = () => {
    setArmError(null);
    setPreArmError(null);
    missionEngine.startMission();
  };

  return (
    <div className="space-y-4 font-mono select-none">
      {/* 1. AUTOMATIC USB-OTG & ESP32-S3 WI-FI CONNECTION CARD WITH STATE MACHINE & DIAGNOSTICS */}
      <PixhawkConnectionCard
        connectionState={pixhawkState}
        onOpenHelp={() => setShowPhoneOtgHelp(true)}
      />

      {/* 2. Top Bar: Official Mission Timer & Master Flight Controls (ARM, START MISSION, RTL, DISARM) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
        {/* Left: 8-Minute Official Mission Countdown */}
        <div className="md:col-span-6 flex flex-col justify-between">
          <MissionTimer
            remainingSeconds={remainingSeconds}
            elapsedSeconds={elapsedSeconds}
            missionState={missionState}
          />
        </div>

        {/* Right: Master Flight Commands (ARM / DISARM, START MISSION, RTL) */}
        <div className="md:col-span-6 flex flex-col justify-between space-y-2.5 bg-slate-900/90 p-3 sm:p-3.5 rounded-2xl border border-slate-800 shadow-xl">

          {/* Action Header */}
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-800/80">
            <span className="flex items-center space-x-1.5">
              <Shield className="w-3.5 h-3.5 text-sky-400" />
              <span>Flight &amp; Mission Controls</span>
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${isArmed
                ? 'bg-rose-950/80 border-rose-500 text-rose-300 animate-pulse'
                : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}>
              {isArmed ? 'MOTORS ARMED' : 'DISARMED / SAFE'}
            </span>
          </div>

          {/* Primary Action Button Grid: ARM/DISARM + START MISSION + RTL */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">

            {/* 1. RESTORED DEDICATED ARM / DISARM BUTTON */}
            {!isArmed ? (
              <button
                onClick={handleArmClick}
                disabled={isArmingInProgress || !pixhawkState.isConnected}
                className={`py-3 px-3 rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-1.5 transition shadow-lg cursor-pointer ${isArmingInProgress
                    ? 'bg-amber-600 text-white animate-pulse'
                    : pixhawkState.isConnected
                      ? 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-emerald-600/30'
                      : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                  }`}
                title="Send MAVLink ARM Command to Pixhawk FC"
              >
                {isArmingInProgress ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>ARMING...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>ARM</span>
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleDisarmClick}
                disabled={isDisarmingInProgress}
                className="py-3 px-3 rounded-xl bg-rose-950 hover:bg-rose-900 border-2 border-rose-500 text-rose-200 font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-1.5 shadow-lg shadow-rose-950/50 transition cursor-pointer"
                title="Send MAVLink DISARM Command to Pixhawk FC"
              >
                {isDisarmingInProgress ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>DISARMING...</span>
                  </>
                ) : (
                  <>
                    <PowerOff className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>DISARM</span>
                  </>
                )}
              </button>
            )}

            {/* 2. RESTORED DEDICATED START MISSION BUTTON */}
            <button
              onClick={handleStartMissionClick}
              disabled={isMissionRunning || isMissionCompleted || !pixhawkState.isConnected}
              className={`py-3 px-3 rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-1.5 transition shadow-lg ${missionState === 'STARTING'
                  ? 'bg-amber-600 text-white animate-pulse'
                  : isMissionRunning
                    ? 'bg-sky-600 text-white shadow-sky-600/30 animate-pulse cursor-default'
                    : isMissionCompleted
                      ? 'bg-emerald-800 text-emerald-200 border border-emerald-500 cursor-default'
                      : isMissionAborted
                        ? 'bg-rose-950 border border-rose-500 text-rose-300'
                        : pixhawkState.isConnected
                          ? 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white shadow-sky-600/30 cursor-pointer'
                          : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                }`}
              title="Start Autonomous Search & QR Rescue Mission"
            >
              {missionState === 'STARTING' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>STARTING...</span>
                </>
              ) : isMissionRunning ? (
                <>
                  <Activity className="w-4 h-4 shrink-0 animate-spin" />
                  <span>MISSION RUNNING</span>
                </>
              ) : isMissionCompleted ? (
                <>
                  <CheckCircle className="w-4 h-4 shrink-0 text-emerald-300" />
                  <span>COMPLETED</span>
                </>
              ) : isMissionAborted ? (
                <>
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>MISSION FAILED</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current shrink-0" />
                  <span>START MISSION</span>
                </>
              )}
            </button>

            {/* 3. EMERGENCY RTL (RETURN-TO-LAUNCH) */}
            <button
              onClick={onEmergencyRTL}
              className="py-3 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-1.5 shadow-lg shadow-rose-600/30 transition cursor-pointer"
              title="Immediately abort mission and fly back to Home Point"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span>RTL (HOME)</span>
            </button>
          </div>

          {/* Error Message Toast / Alert */}
          {armError && (
            <div className="p-2 bg-rose-950/90 border border-rose-500/80 rounded-lg text-rose-200 text-[11px] flex items-center justify-between space-x-2">
              <div className="flex items-center space-x-1.5 min-w-0">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span className="truncate">{armError}</span>
              </div>
              <button
                onClick={() => setArmError(null)}
                className="text-slate-400 hover:text-white text-xs shrink-0 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Quick Flight Mode Action Bar */}
          <div className="flex items-center justify-between space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px]">
            {(['GUIDED', 'AUTO', 'LOITER', 'RTL', 'LAND'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => mavlinkService.setFlightMode(mode)}
                className={`px-2 py-1 rounded font-bold transition flex-1 text-center cursor-pointer ${telemetry.flightMode === mode
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. System Health & Mission Readiness Telemetry Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 shadow-lg">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {/* FC Link */}
          <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
            <div className="text-[10px] text-slate-500 uppercase font-bold flex items-center space-x-1">
              <Cpu className="w-3 h-3 text-sky-400" />
              <span>FC Link</span>
            </div>
            <div className={`font-black text-xs sm:text-sm mt-0.5 ${pixhawkState.isConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
              {pixhawkState.isConnected
                ? (pixhawkState.connectionType === 'ESP32_WEBSOCKET' ? 'ESP32-S3 (Wi-Fi)' : pixhawkState.isRealHardware ? 'Pixhawk (USB)' : 'SITL (Sim)')
                : 'Offline'}
            </div>
          </div>

          {/* GPS Status */}
          <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
            <div className="text-[10px] text-slate-500 uppercase font-bold flex items-center space-x-1">
              <Navigation className="w-3 h-3 text-emerald-400" />
              <span>GPS Satellites</span>
            </div>
            <div className={`font-black text-xs sm:text-sm mt-0.5 ${isGpsReady ? 'text-emerald-400' : 'text-amber-400'}`}>
              {telemetry.gps.satellites} Sats ({telemetry.gps.fixType})
            </div>
          </div>

          {/* Battery */}
          <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
            <div className="text-[10px] text-slate-500 uppercase font-bold flex items-center justify-between">
              <div className="flex items-center space-x-1">
                <Battery className={`w-3 h-3 ${telemetry.batteryPercent > 50 ? 'text-emerald-400' : telemetry.batteryPercent > 20 ? 'text-amber-400' : 'text-rose-400'}`} />
                <span>Battery</span>
              </div>
              <span className="text-[9px] text-slate-400 font-mono">{telemetry.batteryVoltage}V</span>
            </div>
            <div className={`font-black text-xs sm:text-sm mt-0.5 flex items-baseline justify-between ${telemetry.batteryPercent > 50 ? 'text-emerald-400' : telemetry.batteryPercent > 20 ? 'text-amber-400' : 'text-rose-400'}`}>
              <span>{telemetry.batteryPercent}%</span>
              <span className="text-[10px] text-slate-400 font-normal">{telemetry.batteryCurrent}A</span>
            </div>
            {/* Battery Level Progress Bar */}
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
              <div
                className={`h-full transition-all duration-300 ${telemetry.batteryPercent > 50
                    ? 'bg-emerald-500'
                    : telemetry.batteryPercent > 20
                      ? 'bg-amber-500'
                      : 'bg-rose-500 animate-pulse'
                  }`}
                style={{ width: `${Math.max(0, Math.min(100, telemetry.batteryPercent))}%` }}
              />
            </div>
          </div>

          {/* Flight Mode */}
          <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
            <div className="text-[10px] text-slate-500 uppercase font-bold flex items-center space-x-1">
              <Zap className="w-3 h-3 text-sky-400" />
              <span>Flight Mode</span>
            </div>
            <div className="font-black text-xs sm:text-sm text-sky-300 mt-0.5 truncate">
              {telemetry.flightMode}
            </div>
          </div>

          {/* Armed */}
          <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
            <div className="text-[10px] text-slate-500 uppercase font-bold flex items-center space-x-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span>Armed</span>
            </div>
            <div className={`font-black text-xs sm:text-sm mt-0.5 ${isArmed ? 'text-rose-400 animate-pulse font-extrabold' : 'text-slate-400'}`}>
              {isArmed ? 'YES (ARMED)' : 'No (Safe)'}
            </div>
          </div>

          {/* Telemetry Receiving */}
          <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
            <div className="text-[10px] text-slate-500 uppercase font-bold flex items-center space-x-1">
              <Radio className="w-3 h-3 text-sky-400" />
              <span>Telemetry</span>
            </div>
            <div className={`font-black text-xs sm:text-sm mt-0.5 ${isTelemetryReceiving ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isTelemetryReceiving ? 'Receiving' : 'Not Receiving'}
            </div>
          </div>
        </div>

        {/* Pre-Arm Safety Error Alert (Full Text Without Truncation) */}
        {preArmError && (
          <div className="mt-3 p-3 bg-rose-950/90 border-2 border-rose-500 rounded-xl text-rose-200 text-xs flex items-start space-x-2.5 shadow-lg">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed" style={{ overflowWrap: 'anywhere', whiteSpace: 'normal', wordBreak: 'break-word' }}>
              <strong className="text-rose-300">Pre-Arm Check Failed:</strong> {preArmError}
            </div>
          </div>
        )}
      </div>

      {/* 4. Main Grid: Full-Screen Live Camera Preview & Subsystems */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Live Full-Screen Responsive Optical QR Scanner */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-xl overflow-hidden border border-slate-800 shadow-2xl h-[420px] sm:h-[480px]">
            <CameraVisionHUD
              onQRDetected={onQRDetected}
              isScanning={isScanning}
              decodedQR={decodedQR}
              telemetry={telemetry}
              className="w-full h-full"
            />
          </div>
        </div>

        {/* Right: Target Confirmation, Telemetry Deck, & Pre-Arm Panel */}
        <div className="lg:col-span-5 space-y-4">
          {/* Decoded QR Target Result */}
          <QRResultCard
            decodedQR={decodedQR}
            runnerLink={runnerLink}
            runnerAckReceived={runnerAckReceived}
            runnerAckLatencyMs={runnerAckLatencyMs}
            missionState={missionState}
          />

          {/* Dedicated Mode-Aware Pre-Arm Validation Panel */}
          <PreArmChecksPanel
            connectionState={pixhawkState}
            telemetry={telemetry}
            homePoint={homePoint}
          />

          {/* Pixhawk Hardware Telemetry & Message Log Monitor */}
          <PixhawkMonitor
            connectionState={pixhawkState}
          />
        </div>
      </div>

      {/* 5. ANDROID PHONE OTG SETUP GUIDE MODAL */}
      {showPhoneOtgHelp && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-emerald-500 rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 text-slate-200 font-mono shadow-2xl relative">
            <button
              onClick={() => setShowPhoneOtgHelp(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-2 text-emerald-400 font-black text-sm uppercase tracking-wider border-b border-slate-800 pb-3">
              <Smartphone className="w-5 h-5" />
              <span>How to Connect Phone to Pixhawk UART / USB-OTG</span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="font-bold text-amber-400 flex items-center space-x-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Step 1: Turn ON "OTG Connection" in Phone Settings</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Most Android phones (OnePlus, Realme, Oppo, Xiaomi, Vivo, Samsung) turn OTG off by default. Go to:
                </p>
                <div className="bg-slate-900 px-3 py-1.5 rounded border border-slate-800 text-emerald-300 font-bold text-[11px]">
                  Phone Settings ➔ Additional Settings ➔ Turn ON "OTG Connection"
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="font-bold text-sky-400 flex items-center space-x-1.5">
                  <Usb className="w-4 h-4 shrink-0" />
                  <span>Step 2: Connect Cables (Method A, B or C)</span>
                </div>
                <div className="text-slate-300 space-y-1 text-[11px]">
                  <div><strong>Method A (Direct USB):</strong> Micro-USB to USB-C OTG cable from Pixhawk Micro-USB port to Phone.</div>
                  <div><strong>Method B (TELEM1 / UART):</strong> Pixhawk TELEM1 port ➔ CP2102/FTDI UART Module (57600 baud) ➔ USB-OTG ➔ Phone.</div>
                  <div><strong>Method C (ESP32-S3 Wi-Fi):</strong> Pixhawk TELEM2 port ➔ ESP32-S3 ➔ Wi-Fi WebSocket (ws://192.168.4.1:8080).</div>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="font-bold text-purple-400 flex items-center space-x-1.5">
                  <Radio className="w-4 h-4 shrink-0" />
                  <span>Step 3: Pixhawk Baud Rate Configuration</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Ensure ArduPilot parameter <strong>SERIAL1_PROTOCOL = 2</strong> (MAVLink2) and <strong>SERIAL1_BAUD = 57</strong> (57600 baud).
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3 pt-2">
              <button
                onClick={() => setShowPhoneOtgHelp(false)}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={async () => {
                  setShowPhoneOtgHelp(false);
                  await mavlinkService.connectHardware();
                }}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-xl transition flex items-center justify-center space-x-1.5 shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                <Usb className="w-4 h-4" />
                <span>TRY CONNECTING NOW</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
