import React, { useState, useEffect } from 'react';
import { DroneTelemetry, DecodedQRData, MissionState, FlightCommandAuthority } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { mavlinkService } from '../../services/mavlinkService';
import { missionEngine } from '../../services/missionEngine';
import { CameraVisionHUD } from './CameraVisionHUD';
import { QRResultCard } from './QRResultCard';
import { PixhawkMonitor } from './PixhawkMonitor';
import { PreArmChecksPanel } from '../common/PreArmChecksPanel';
import { MissionTimer } from '../common/MissionTimer';
import { AutonomousMissionStatusBar } from '../Mission/AutonomousMissionStatusBar';
import { AutonomousMissionConfigModal } from '../Mission/AutonomousMissionConfigModal';
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
  CheckCircle,
  Settings,
  Gamepad2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Hand,
  Compass
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
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);

  // RTL Confirmation Modal State
  const [isRtlConfirmOpen, setIsRtlConfirmOpen] = useState<boolean>(false);

  // Manual Backup Mode & Authority
  const [commandAuthority, setCommandAuthority] = useState<FlightCommandAuthority>(missionEngine.getCommandAuthority());
  const [isManualDrawerOpen, setIsManualDrawerOpen] = useState<boolean>(false);
  const [manualSwitchError, setManualSwitchError] = useState<string | null>(null);

  const homePoint = mavlinkService.getHomePoint();
  const missionValidation = missionEngine.validateMission();
  const missionConfig = missionEngine.getMissionConfig();

  const isScanning =
    missionState === 'SEARCHING' ||
    missionState === 'OBJECT_DETECTED' ||
    missionState === 'BOX_DETECTED' ||
    missionState === 'INSPECTING' ||
    missionState === 'QR_DETECTION' ||
    missionState === 'QR_DETECTED' ||
    missionState === 'QR_SCANNING';

  // Live Telemetry & Pre-Arm State
  const isGpsReady = telemetry.gps.isLocked && telemetry.gps.satellites >= 6 && telemetry.gps.hdop <= 2.5;
  const isTelemetryReceiving = pixhawkState.isConnected && pixhawkState.isReceivingTelemetry;
  const isArmed = telemetry.isArmed;
  const isMissionRunning =
    missionState === 'STARTING' ||
    missionState === 'TAKEOFF' ||
    missionState === 'CLIMBING' ||
    missionState === 'CLIMBING_TO_ALTITUDE' ||
    missionState === 'ALTITUDE_STABILIZING' ||
    missionState === 'SEARCHING' ||
    missionState === 'OBJECT_DETECTED' ||
    missionState === 'INSPECTING' ||
    missionState === 'QR_SCANNING';
  const isMissionCompleted = missionState === 'MISSION_COMPLETE' || missionState === 'DATA_CONFIRMED' || missionState === 'LANDED';
  const isRtlActive = missionState === 'RTL_REQUESTED' || missionState === 'RTL' || missionState === 'RETURNING_HOME' || missionState === 'LANDING';
  const isMissionAborted =
    missionState === 'EMERGENCY_RTL' ||
    missionState === 'MISSION_TIMEOUT' ||
    missionState === 'CONNECTION_LOST' ||
    missionState === 'GPS_ERROR' ||
    missionState === 'CAMERA_ERROR' ||
    missionState === 'BOUNDARY_ERROR' ||
    missionState === 'FAILSAFE' ||
    missionState === 'ERROR';

  useEffect(() => {
    const unsubAuthority = missionEngine.subscribeAuthority((auth) => {
      setCommandAuthority(auth);
    });
    return () => unsubAuthority();
  }, []);

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

    const check = missionEngine.validateMission();
    if (!check.isValid) {
      setPreArmError(check.errors.join(' | '));
      return;
    }

    const res = missionEngine.startMission();
    if (!res) {
      setArmError('Mission start rejected: Safety checks failed.');
    }
  };

  // Handler: Mode Switching (Autonomous <-> Manual Backup)
  const handleToggleMode = (targetMode: 'AUTONOMOUS' | 'MANUAL') => {
    setManualSwitchError(null);
    if (targetMode === 'MANUAL') {
      const res = missionEngine.switchToManualControl();
      if (res.success) {
        setIsManualDrawerOpen(true);
      }
    } else {
      const res = missionEngine.switchToAutonomousControl();
      if (!res.success && res.errors) {
        setManualSwitchError(`Cannot switch to Autonomous: ${res.errors.join(' • ')}`);
        setTimeout(() => setManualSwitchError(null), 5000);
      } else {
        setIsManualDrawerOpen(false);
      }
    }
  };

  const handleConfirmRTL = () => {
    setIsRtlConfirmOpen(false);
    missionEngine.triggerEmergencyRTL('Operator Confirmed RTL');
  };

  return (
    <div className="space-y-4 font-mono select-none">
      {/* 0. RESPONSIVE STATUS HUD HEADER (Requirement #13) */}
      <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-2xl">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs">
          {/* DRONE */}
          <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-bold uppercase">DRONE</span>
            <span className={`text-[10px] font-black flex items-center space-x-1 ${pixhawkState.isConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pixhawkState.isConnected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              <span>{pixhawkState.isConnected ? 'CONNECTED' : 'OFFLINE'}</span>
            </span>
          </div>

          {/* MAVLink */}
          <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-bold uppercase">MAVLink</span>
            <span className={`text-[10px] font-black flex items-center space-x-1 ${pixhawkState.isReceivingTelemetry ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pixhawkState.isReceivingTelemetry ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <span>{pixhawkState.isReceivingTelemetry ? 'HEALTHY' : 'IDLE'}</span>
            </span>
          </div>

          {/* GPS */}
          <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-bold uppercase">GPS</span>
            <span className={`text-[10px] font-black flex items-center space-x-1 ${isGpsReady ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isGpsReady ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <span>{isGpsReady ? 'LOCKED' : 'ACQUIRING'}</span>
            </span>
          </div>

          {/* Heartbeat */}
          <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-bold uppercase">Heartbeat</span>
            <span className={`text-[10px] font-black flex items-center space-x-1 ${pixhawkState.heartbeatHz >= 0.5 ? 'text-emerald-400' : 'text-rose-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pixhawkState.heartbeatHz >= 0.5 ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              <span>{pixhawkState.heartbeatHz >= 0.5 ? `${pixhawkState.heartbeatHz.toFixed(1)} Hz` : 'LOST'}</span>
            </span>
          </div>

          {/* MODE */}
          <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-bold uppercase">MODE</span>
            <span className={`text-[10px] font-extrabold ${commandAuthority === 'MANUAL' ? 'text-amber-400' : 'text-sky-400'}`}>
              {commandAuthority === 'MANUAL' ? 'MANUAL' : 'AUTONOMOUS'}
            </span>
          </div>

          {/* ALTITUDE */}
          <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-bold uppercase">ALTITUDE</span>
            <span className="text-[10px] font-extrabold text-amber-300">{telemetry.altitude.toFixed(1)} m</span>
          </div>

          {/* TARGET */}
          <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-bold uppercase">TARGET</span>
            <span className={`text-[10px] font-extrabold ${decodedQR ? 'text-emerald-400' : isScanning ? 'text-sky-300' : 'text-slate-400'}`}>
              {decodedQR ? 'FOUND ✓' : isScanning ? 'SEARCHING' : 'STANDBY'}
            </span>
          </div>

          {/* QR */}
          <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-bold uppercase">QR</span>
            <span className={`text-[10px] font-extrabold ${decodedQR ? 'text-emerald-400' : isScanning ? 'text-amber-400 animate-pulse' : 'text-slate-400'}`}>
              {decodedQR ? `[${decodedQR.code}] ✓` : isScanning ? 'SCANNING' : 'STANDBY'}
            </span>
          </div>
        </div>
      </div>

      {/* 1. SUCCESS / FAILSAFE STATUS ALERT BANNER */}
      {isMissionCompleted && (
        <div className="p-3 bg-emerald-950/90 border-2 border-emerald-500 rounded-xl text-emerald-200 text-xs flex items-center justify-between shadow-2xl shadow-emerald-600/30 animate-in fade-in duration-200">
          <div className="flex items-center space-x-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <div className="font-black uppercase tracking-wider text-white flex items-center space-x-2">
                <span>MISSION COMPLETE ✓</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900 border border-emerald-400 text-emerald-300">
                  QR DATA RECEIVED ✓
                </span>
              </div>
              <div className="text-[11px] text-emerald-300/80 mt-0.5">
                {isRtlActive ? 'Automatic RTL Active: Flight controller returning to Home Reference.' : 'Target verified. Ready for landing or manual control.'}
              </div>
            </div>
          </div>
          {isRtlActive && (
            <span className="px-3 py-1 rounded-full bg-emerald-900/80 border border-emerald-400 text-emerald-200 text-[10px] font-black uppercase tracking-wider animate-pulse">
              RETURNING HOME
            </span>
          )}
        </div>
      )}

      {/* Critical Failure / Failsafe Warning Alert */}
      {isMissionAborted && (
        <div className="p-3 bg-rose-950/95 border-2 border-rose-500 rounded-xl text-rose-200 text-xs flex items-center justify-between shadow-2xl shadow-rose-600/30 animate-in fade-in duration-200">
          <div className="flex items-center space-x-2.5">
            <AlertOctagon className="w-5 h-5 text-rose-400 shrink-0 animate-bounce" />
            <div>
              <div className="font-black uppercase tracking-wider text-rose-100 flex items-center space-x-2">
                <span>AUTONOMOUS FAILURE → SAFE FAILSAFE</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-rose-900 border border-rose-400 text-rose-200">
                  {missionState.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="text-[11px] text-rose-300/90 mt-0.5">
                Autonomous search halted. Flight controller failsafe active. Automatic RTL requested.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleToggleMode('MANUAL')}
            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-black text-[10px] uppercase tracking-wider transition cursor-pointer shadow-lg"
          >
            MANUAL OVERRIDE
          </button>
        </div>
      )}

      {/* Manual Switch Error Toast */}
      {manualSwitchError && (
        <div className="p-2.5 bg-rose-950/90 border border-rose-500 rounded-lg text-rose-200 text-xs flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{manualSwitchError}</span>
        </div>
      )}

      {/* 2. RESPONSIVE AUTONOMOUS MISSION STATUS BAR */}
      <AutonomousMissionStatusBar
        telemetry={telemetry}
        missionState={missionState}
        pixhawkState={pixhawkState}
        onOpenConfig={() => setIsConfigModalOpen(true)}
        isAuthorizedOperator={true}
      />

      {/* 3. Top Action Grid: Mission Countdown Timer & Command Authority Mode Deck */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
        {/* Left: Mission Countdown Timer */}
        <div className="md:col-span-6 flex flex-col justify-between">
          <MissionTimer
            remainingSeconds={remainingSeconds}
            elapsedSeconds={elapsedSeconds}
            missionState={missionState}
          />
        </div>

        {/* Right: Command Authority & Mission Actions Deck */}
        <div className="md:col-span-6 flex flex-col justify-between bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-lg space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            {/* Mode Switch: Autonomous vs Manual Backup */}
            <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => handleToggleMode('AUTONOMOUS')}
                className={`px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider transition cursor-pointer ${
                  commandAuthority !== 'MANUAL'
                    ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                AUTONOMOUS
              </button>
              <button
                type="button"
                onClick={() => handleToggleMode('MANUAL')}
                className={`px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider transition cursor-pointer ${
                  commandAuthority === 'MANUAL'
                    ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                MANUAL BACKUP
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setIsConfigModalOpen(true)}
                className="px-2 py-1 rounded-lg bg-amber-600/80 hover:bg-amber-600 text-white text-[10px] font-bold uppercase flex items-center space-x-1 cursor-pointer transition"
                title="Configure Autonomous Mission"
              >
                <Settings className="w-3 h-3" />
                <span>CONFIG</span>
              </button>

              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                isArmed
                  ? 'bg-rose-950/90 text-rose-300 border-rose-500/70 animate-pulse'
                  : 'bg-slate-950 text-slate-400 border-slate-800'
              }`}>
                {isArmed ? 'ARMED' : 'DISARMED'}
              </span>
            </div>
          </div>

          {/* Action Buttons: START MISSION vs RTL — RETURN TO LAUNCH */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* START MISSION BUTTON */}
            <button
              type="button"
              onClick={handleStartMissionClick}
              disabled={isMissionRunning || isMissionCompleted || !pixhawkState.isConnected || !missionValidation.isValid || commandAuthority === 'MANUAL'}
              className={`py-3.5 px-3 rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-1.5 transition shadow-lg ${
                missionState === 'STARTING'
                  ? 'bg-amber-600 text-white animate-pulse'
                  : isMissionRunning
                  ? 'bg-sky-600 text-white shadow-sky-600/30 animate-pulse cursor-default'
                  : isMissionCompleted
                  ? 'bg-emerald-800 text-emerald-200 border border-emerald-500 cursor-default'
                  : isMissionAborted
                  ? 'bg-rose-950 border border-rose-500 text-rose-300'
                  : pixhawkState.isConnected && missionValidation.isValid && commandAuthority !== 'MANUAL'
                  ? 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-emerald-600/30 cursor-pointer animate-pulse'
                  : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
              }`}
              title={!missionValidation.isValid ? 'START DISABLED: Check 9 pre-flight validation conditions' : 'Start Autonomous Search & QR Rescue Mission'}
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

            {/* RTL — RETURN TO LAUNCH BUTTON (Requirement #3) */}
            <button
              type="button"
              onClick={() => setIsRtlConfirmOpen(true)}
              className="py-3.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-1.5 shadow-lg shadow-rose-600/30 transition cursor-pointer"
              title="Return to Launch: Operator triggers automatic return to Home Reference"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span>RTL — RETURN TO LAUNCH</span>
            </button>
          </div>

          {/* Arm / Command Error Toast */}
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

          {/* Hidden / Expandable Backup Manual Engineering Control Panel (Requirement #10) */}
          {commandAuthority === 'MANUAL' && (
            <div className="bg-slate-900/95 border-2 border-amber-500/80 rounded-2xl p-4 shadow-2xl space-y-3 animate-in fade-in duration-150">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center space-x-2">
                  <Gamepad2 className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-black uppercase text-amber-300 tracking-wider">
                    MANUAL BACKUP FLIGHT CONTROLLER
                  </span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-500/40">
                  AUTHORITY: MANUAL
                </span>
              </div>

              {/* D-Pad Direction Controls for Manual Backup */}
              <div className="grid grid-cols-3 gap-2 max-w-[220px] mx-auto pt-1">
                <div />
                <button
                  type="button"
                  onClick={() => mavlinkService.commandManualMove('FORWARD')}
                  className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-amber-600 text-white flex items-center justify-center cursor-pointer transition shadow"
                  title="Forward Pitch"
                >
                  <ArrowUp className="w-5 h-5" />
                </button>
                <div />

                <button
                  type="button"
                  onClick={() => mavlinkService.commandManualMove('LEFT')}
                  className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-amber-600 text-white flex items-center justify-center cursor-pointer transition shadow"
                  title="Roll Left"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => mavlinkService.commandHold()}
                  className="p-3 rounded-xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-black text-xs flex items-center justify-center cursor-pointer transition shadow-lg shadow-amber-600/40"
                  title="Position Hold (LOITER)"
                >
                  HOLD
                </button>
                <button
                  type="button"
                  onClick={() => mavlinkService.commandManualMove('RIGHT')}
                  className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-amber-600 text-white flex items-center justify-center cursor-pointer transition shadow"
                  title="Roll Right"
                >
                  <ArrowRight className="w-5 h-5" />
                </button>

                <div />
                <button
                  type="button"
                  onClick={() => mavlinkService.commandManualMove('BACKWARD')}
                  className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-amber-600 text-white flex items-center justify-center cursor-pointer transition shadow"
                  title="Backward Pitch"
                >
                  <ArrowDown className="w-5 h-5" />
                </button>
                <div />
              </div>

              <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                <button
                  type="button"
                  onClick={isArmed ? handleDisarmClick : handleArmClick}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase transition ${
                    isArmed ? 'bg-rose-700 hover:bg-rose-600 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  {isArmed ? 'DISARM MOTORS' : 'ARM MOTORS'}
                </button>

                <button
                  type="button"
                  onClick={() => handleToggleMode('AUTONOMOUS')}
                  className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-black text-xs uppercase cursor-pointer"
                >
                  RESUME AUTONOMOUS
                </button>
              </div>
            </div>
          )}

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

      {/* CONFIRM RTL MODAL (Requirement #3) */}
      {isRtlConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-rose-500 rounded-2xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl shadow-rose-600/30">
            <div className="w-14 h-14 rounded-full bg-rose-950/80 border border-rose-400 flex items-center justify-center text-rose-400 mx-auto">
              <RotateCcw className="w-7 h-7 animate-spin" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-black uppercase text-white tracking-wider">
                CONFIRM RETURN TO LAUNCH?
              </h3>
              <p className="text-xs text-slate-400">
                The drone will abort the current autonomous path and navigate back to the Home Reference point ({homePoint.latitude.toFixed(5)}, {homePoint.longitude.toFixed(5)}) at {telemetry.altitude.toFixed(1)}m.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setIsRtlConfirmOpen(false)}
                className="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={handleConfirmRTL}
                className="py-3 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-black text-xs uppercase tracking-wider transition shadow-lg shadow-rose-600/40 cursor-pointer"
              >
                RETURN TO LAUNCH
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Autonomous Mission Configuration Modal */}
      <AutonomousMissionConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        telemetry={telemetry}
        homePoint={homePoint}
        pixhawkState={pixhawkState}
        missionState={missionState}
        onStartMission={handleStartMissionClick}
      />
    </div>
  );
};
