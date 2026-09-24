import React, { useState, useEffect } from 'react';
import { DroneTelemetry, DecodedQRData, MissionState } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { mavlinkService } from '../../services/mavlinkService';
import { missionEngine } from '../../services/missionEngine';
import { CameraVisionHUD } from './CameraVisionHUD';
import { QRResultCard } from './QRResultCard';
import { PixhawkMonitor } from './PixhawkMonitor';
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

  // Watch telemetry and ACK changes to clear in-progress arming state or surface real-time ARM rejections
  useEffect(() => {
    if (telemetry.isArmed && isArmingInProgress) {
      setIsArmingInProgress(false);
      setArmError(null);
    }
    if (!telemetry.isArmed && isDisarmingInProgress) {
      setIsDisarmingInProgress(false);
      setArmError(null);
    }
    // If vehicle remains disarmed and Pixhawk sent a rejection ACK or pre-arm error while arming was in progress
    if (isArmingInProgress && !telemetry.isArmed) {
      const ack = pixhawkState.lastArmCommandAck || pixhawkState.lastCommandAck;
      if (ack && ack.command === 400 && ack.result !== 0) {
        setIsArmingInProgress(false);
        const reason = pixhawkState.preArmFailReason || (pixhawkState.statusHistory && pixhawkState.statusHistory.length > 0 ? pixhawkState.statusHistory[0].text : undefined);
        const failMsg = `ARM REJECTED by Pixhawk (${ack.resultName || 'FAILED'})${reason ? ` — ${reason}` : ''}`;
        setArmError(failMsg);
      } else if (pixhawkState.preArmFailReason) {
        setIsArmingInProgress(false);
        setArmError(`ARM BLOCKED: ${pixhawkState.preArmFailReason}`);
      }
    }
  }, [telemetry.isArmed, isArmingInProgress, isDisarmingInProgress, pixhawkState.lastArmCommandAck, pixhawkState.preArmFailReason]);

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

      // Watchdog timeout fallback (4 seconds)
      setTimeout(() => {
        if (!mavlinkService.getTelemetry().isArmed) {
          setIsArmingInProgress(false);
          const currentPixState = mavlinkService.getConnectionState();
          const lastAck = currentPixState.lastArmCommandAck || currentPixState.lastCommandAck;
          const preArmReason = currentPixState.preArmFailReason ||
            (currentPixState.statusHistory && currentPixState.statusHistory.length > 0 ? currentPixState.statusHistory[0].text : undefined);

          if (lastAck && lastAck.command === 400 && lastAck.result !== 0) {
            let failMsg = `ARM REJECTED (${lastAck.resultName} / Code ${lastAck.result})`;
            if (preArmReason) {
              failMsg += ` — ${preArmReason}`;
            }
            setArmError(failMsg);
          } else if (preArmReason) {
            setArmError(`ARM REJECTED: ${preArmReason}`);
          } else {
            setArmError('ARM ACK TIMEOUT (Waiting for vehicle armed confirmation)');
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

  // Scanner ON/OFF state (default OFF when Drone Core opens)
  const [scannerActive, setScannerActive] = useState<boolean>(false);

  return (
    <div className="space-y-4 font-mono select-none">
      {/* 1. AUTOMATIC DRONE CONNECTIVITY STATUS (SYNCED VIA GCS LINK - NO MANUAL CONNECTION MODE) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 sm:p-4 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-xl border shrink-0 ${
              pixhawkState.isConnected
                ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/50'
                : 'bg-amber-950/80 text-amber-400 border-amber-500/50 animate-pulse'
            }`}>
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs sm:text-sm font-black uppercase text-white tracking-wider">
                  DRONE CONNECTIVITY
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-sky-950 text-sky-300 border border-sky-600/40">
                  AUTOMATIC GCS SYNC
                </span>
                <span className={`text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-full border ${
                  pixhawkState.isConnected
                    ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/60'
                    : 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                }`}>
                  {pixhawkState.isConnected ? 'CONNECTED VIA GCS ✓' : 'WAITING FOR GCS CONNECTION'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {pixhawkState.isConnected
                  ? `Active Link: ${pixhawkState.connectionType === 'ESP32_WEBSOCKET' ? 'ESP32-S3 Wireless Bridge' : pixhawkState.isRealHardware ? 'Pixhawk USB OTG' : 'SITL Simulator'} • SysID: ${pixhawkState.systemId || 1} • Rate: ${pixhawkState.heartbeatHz || 1.0} Hz`
                  : 'Drone connection is established through Ground Control Station and automatically synced throughout the application.'}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs font-mono">
            <div className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${
              pixhawkState.isReceivingTelemetry
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}>
              MAVLink: {pixhawkState.isReceivingTelemetry ? 'STREAMING' : 'IDLE'}
            </div>
            <div className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${
              telemetry.gps.isLocked
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                : 'bg-amber-950/60 border-amber-500/40 text-amber-300'
            }`}>
              GPS: {telemetry.gps.satellites} Sats
            </div>
          </div>
        </div>
      </div>

      {/* 2. Top Bar: Mission Countdown Timer & Autonomous Mission Actions (No manual flight controls) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
        {/* Left: Mission Countdown Timer */}
        <div className="md:col-span-6 flex flex-col justify-between">
          <MissionTimer
            remainingSeconds={remainingSeconds}
            elapsedSeconds={elapsedSeconds}
            missionState={missionState}
          />
        </div>

        {/* Right: Autonomous Mission Actions Deck (Focuses on autonomous mission execution) */}
        <div className="md:col-span-6 flex flex-col justify-between bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-lg space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-black uppercase text-slate-200 tracking-wider">
                AUTONOMOUS MISSION EXECUTION
              </span>
            </div>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
              isArmed
                ? 'bg-rose-950/90 text-rose-300 border-rose-500/70 animate-pulse'
                : 'bg-slate-950 text-slate-400 border-slate-800'
            }`}>
              {isArmed ? 'VEHICLE ARMED' : 'VEHICLE DISARMED'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {/* START MISSION BUTTON */}
            <button
              type="button"
              onClick={handleStartMissionClick}
              disabled={isMissionRunning || isMissionCompleted || !pixhawkState.isConnected}
              className={`py-3.5 px-3 rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-1.5 transition shadow-lg ${
                missionState === 'STARTING'
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

            {/* EMERGENCY RTL */}
            <button
              type="button"
              onClick={onEmergencyRTL}
              className="py-3.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-1.5 shadow-lg shadow-rose-600/30 transition cursor-pointer"
              title="Immediately abort mission and fly back to Home Point"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span>RTL (HOME)</span>
            </button>
          </div>

          {/* Error Message Toast / Alert */}
          {armError && (
            <div className="p-2.5 bg-rose-950/95 border border-rose-500 rounded-lg text-rose-200 text-xs flex items-start justify-between space-x-2 shadow-lg">
              <div className="flex items-start space-x-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="font-mono break-words leading-tight">{armError}</span>
              </div>
              <button
                type="button"
                onClick={() => setArmError(null)}
                className="text-slate-400 hover:text-white text-xs shrink-0 cursor-pointer p-0.5"
              >
                ✕
              </button>
            </div>
          )}
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
              scannerActive={scannerActive}
              onScannerToggle={setScannerActive}
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
    </div>
  );
};
