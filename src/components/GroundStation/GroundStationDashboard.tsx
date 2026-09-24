import React, { useState, useEffect } from 'react';
import { DroneTelemetry, HomePoint, MissionState, PreFlightChecklist as ChecklistType } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { mavlinkService } from '../../services/mavlinkService';
import { MissionTimer } from '../common/MissionTimer';
import { TelemetryHUD } from '../common/TelemetryHUD';
import { StatusBadge } from '../common/StatusBadge';
import { HomePointSetter } from './HomePointSetter';
import { PreArmChecksPanel } from '../common/PreArmChecksPanel';
import { ControlModePanel } from '../common/ControlModePanel';
import { TacticalMap } from './TacticalMap';
import { PixhawkConnectionCard } from '../Drone/PixhawkConnectionCard';
import { 
  Play, 
  RotateCcw, 
  ShieldAlert, 
  Plane, 
  Info, 
  CheckCircle, 
  Radio, 
  ArrowRight, 
  Zap, 
  Power,
  PowerOff,
  ShieldCheck,
  Loader2,
  AlertTriangle
} from 'lucide-react';

interface GroundStationDashboardProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  missionState: MissionState;
  remainingSeconds: number;
  elapsedSeconds: number;
  checklist: ChecklistType;
  isReadyForMission: boolean;
  pixhawkState: PixhawkConnectionState;
  runnerLink: RunnerLinkState;
  onSetHomePoint: () => void;
  onStartMission: () => void;
  onEmergencyRTL: () => void;
}

export const GroundStationDashboard: React.FC<GroundStationDashboardProps> = ({
  telemetry,
  homePoint,
  missionState,
  remainingSeconds,
  elapsedSeconds,
  checklist,
  isReadyForMission,
  pixhawkState,
  runnerLink,
  onSetHomePoint,
  onStartMission,
  onEmergencyRTL
}) => {
  const [isArming, setIsArming] = useState(false);
  const [isDisarming, setIsDisarming] = useState(false);
  const [armFeedback, setArmFeedback] = useState<string | null>(null);

  const isMissionActive =
    missionState !== 'IDLE' &&
    missionState !== 'HOME_SET' &&
    missionState !== 'READY' &&
    missionState !== 'MISSION_COMPLETE';

  const isDroneAirborne = telemetry.isArmed && telemetry.altitude > 1.0;
  const isArmed = telemetry.isArmed;

  // Authoritative state clearing: When FC telemetry confirms armed/disarmed state, clear transient states
  useEffect(() => {
    if (isArmed) {
      setIsArming(false);
      setArmFeedback(null);
    } else {
      setIsDisarming(false);
    }
  }, [isArmed]);

  // Dedicated ARM Handler (MAV_CMD_COMPONENT_ARM_DISARM param1=1.0 param2=0.0)
  const handleDedicatedArmClick = async () => {
    if (!pixhawkState.isConnected) {
      setArmFeedback('Flight controller not connected. Connect first.');
      return;
    }

    setArmFeedback(null);
    setIsArming(true);

    const sent = await mavlinkService.sendArmCommand();
    if (!sent) {
      setIsArming(false);
      setArmFeedback('ARM TRANSMISSION FAILED: Check WebSocket / ESP32 TX Link.');
      return;
    }

    // Awaiting COMMAND_ACK and HEARTBEAT confirmation
    const startWait = Date.now();
    const watchdog = setInterval(() => {
      if (mavlinkService.getTelemetry().isArmed) {
        setIsArming(false);
        setArmFeedback(null);
        clearInterval(watchdog);
      } else if (Date.now() - startWait > 4500) {
        setIsArming(false);
        clearInterval(watchdog);
        if (!mavlinkService.getTelemetry().isArmed) {
          const lastAck = pixhawkState.lastArmCommandAck;
          if (lastAck && lastAck.result !== 0) {
            const preArmReason = pixhawkState.preArmFailReason || 
              (pixhawkState.statusHistory && pixhawkState.statusHistory.length > 0 ? pixhawkState.statusHistory[0].text : undefined);
            let failMsg = `ARM REJECTED (${lastAck.resultName})`;
            if (preArmReason) failMsg += ` — ${preArmReason}`;
            setArmFeedback(failMsg);
          } else {
            setArmFeedback('ARM ACK TIMEOUT (Waiting for vehicle armed state)');
          }
        }
      }
    }, 250);
  };

  // Dedicated DISARM Handler (MAV_CMD_COMPONENT_ARM_DISARM param1=0.0 param2=0.0)
  const handleDedicatedDisarmClick = async () => {
    if (!pixhawkState.isConnected) {
      setArmFeedback('Flight controller not connected. Connect first.');
      return;
    }

    setArmFeedback(null);
    setIsDisarming(true);

    const sent = await mavlinkService.sendDisarmCommand();
    if (!sent) {
      setIsDisarming(false);
      setArmFeedback('Disarm command transmission failed: Check connection.');
      return;
    }

    const startWait = Date.now();
    const watchdog = setInterval(() => {
      if (!mavlinkService.getTelemetry().isArmed) {
        setIsDisarming(false);
        setArmFeedback(null);
        clearInterval(watchdog);
      } else if (Date.now() - startWait > 4500) {
        setIsDisarming(false);
        clearInterval(watchdog);
      }
    }, 250);
  };

  return (
    <div className="p-3 sm:p-5 max-w-7xl mx-auto space-y-4 sm:space-y-5 font-mono">
      {/* Top Pixhawk USB-OTG & ESP32-S3 Connection Card */}
      <PixhawkConnectionCard connectionState={pixhawkState} />

      {/* Top Banner: Drone Status Indicator & Mission State */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90 p-3 sm:p-4 rounded-xl border border-slate-800 hud-border">
        <div className="space-y-1">
          <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider flex items-center space-x-1.5">
            <span>GROUND STATION ANDROID CONTROLLER</span>
            <span className="text-slate-500">•</span>
            {/* DRONE STARTED / AIRBORNE INDICATOR */}
            <span className={`px-2 py-0.5 rounded text-[10px] font-black border flex items-center space-x-1 ${
              isDroneAirborne
                ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300 animate-pulse'
                : telemetry.isArmed
                ? 'bg-amber-950/80 border-amber-400 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}>
              <Power className="w-3 h-3" />
              <span>
                {isDroneAirborne
                  ? 'DRONE STARTED: AIRBORNE (AUTO)'
                  : telemetry.isArmed
                  ? 'DRONE ARMED: READY ON GROUND'
                  : 'DRONE ON GROUND: DISARMED'}
              </span>
            </span>
          </div>
          <StatusBadge state={missionState} size="lg" />
        </div>

        {/* GCS Rule banner */}
        <div className="bg-slate-950/80 px-3 py-2 rounded-lg border border-slate-800 text-[11px] text-slate-400 flex items-center space-x-2">
          <Info className="w-4 h-4 text-sky-400 shrink-0" />
          <span>
            <strong>GCS Focus:</strong> Pre-flight setup, Start Mission, &amp; Telemetry monitoring. QR data sends directly to Runner.
          </span>
        </div>
      </div>

      {/* Main Grid: Responsive 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Timer & Controls & Preflight (lg: 5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Master 3-Minute Timer (Persists on Reload) */}
          <MissionTimer
            remainingSeconds={remainingSeconds}
            elapsedSeconds={elapsedSeconds}
            missionState={missionState}
          />

          {/* Primary Action Button Grid: START MISSION + EMERGENCY RTL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono">
            <button
              onClick={onStartMission}
              disabled={!isReadyForMission || isMissionActive}
              className={`py-3.5 sm:py-4 px-3 rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center space-x-2 transition shadow-lg ${
                isReadyForMission && !isMissionActive
                  ? 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white shadow-sky-600/30 cursor-pointer animate-pulse'
                  : 'bg-slate-800/80 text-slate-500 border border-slate-700/50 cursor-not-allowed'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>START MISSION</span>
            </button>

            <button
              onClick={onEmergencyRTL}
              className="py-3.5 sm:py-4 px-3 rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center space-x-2 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-lg shadow-rose-600/30 transition cursor-pointer"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>EMERGENCY RTL</span>
            </button>
          </div>

          {/* Home Point Setter Card */}
          <HomePointSetter
            homePoint={homePoint}
            gps={telemetry.gps}
            onSetHomePoint={onSetHomePoint}
            disabled={isMissionActive}
          />

          {/* Mode-Aware Responsive Pre-Arm Checks & Validation Panel */}
          <PreArmChecksPanel
            connectionState={pixhawkState}
            telemetry={telemetry}
            homePoint={homePoint}
            isReady={isReadyForMission}
          />

          {/* ========================================================================= */}
          {/* FLIGHT CONTROL INTERFACE: RC / NO-RC TOGGLE & TOUCH-SAFE CONTROLS         */}
          {/* ========================================================================= */}
          <ControlModePanel
            telemetry={telemetry}
            connectionState={pixhawkState}
            onArmClick={handleDedicatedArmClick}
            onDisarmClick={handleDedicatedDisarmClick}
            isArmingInProgress={isArming}
            isDisarmingInProgress={isDisarming}
          />

          {/* Error Feedback if Arm Fails */}
          {armFeedback && !isArmed && (
            <div className="p-2.5 bg-rose-950/70 border border-rose-500/50 rounded-xl text-rose-300 text-xs flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{armFeedback}</span>
            </div>
          )}
        </div>

        {/* Right Column: Telemetry HUD & Tactical Map (lg: 7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Primary Telemetry Deck */}
          <TelemetryHUD telemetry={telemetry} />

          {/* Live Tactical Map */}
          <TacticalMap
            telemetry={telemetry}
            homePoint={homePoint}
            className="h-[360px] sm:h-[420px]"
          />

          {/* Telemetry Detail Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase">Drone Engine</div>
              <div className={`font-bold mt-0.5 ${isDroneAirborne ? 'text-emerald-400' : 'text-slate-300'}`}>
                {isDroneAirborne ? 'RUNNING (AUTO)' : 'STANDBY'}
              </div>
              <div className="text-[10px] text-slate-500">Altitude: {telemetry.altitude.toFixed(1)}m</div>
            </div>

            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase">Pixhawk MAVLink</div>
              <div className="font-bold text-slate-200 mt-0.5">{pixhawkState.connectionType}</div>
              <div className="text-[10px] text-emerald-400">Loss: {pixhawkState.packetLossPercent}%</div>
            </div>

            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 col-span-2 sm:col-span-1">
              <div className="text-[10px] text-slate-400 uppercase">Search Grid</div>
              <div className="font-bold text-amber-400 mt-0.5">ZONE A (100x80m)</div>
              <div className="text-[10px] text-slate-400">Timer: 3-Min Persisted ✓</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
