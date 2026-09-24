import React, { useState, useEffect } from 'react';
import { DroneTelemetry, HomePoint, MissionState, PreFlightChecklist as ChecklistType } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { mavlinkService } from '../../services/mavlinkService';
import { missionEngine } from '../../services/missionEngine';
import { LiveVideoFeed } from './LiveVideoFeed';
import { TacticalMap } from './TacticalMap';
import { ConnectionStatusDeck } from '../common/ConnectionStatusDeck';
import { MissionTimer } from '../common/MissionTimer';
import { TelemetryHUD } from '../common/TelemetryHUD';
import { StatusBadge } from '../common/StatusBadge';
import { HomePointSetter } from './HomePointSetter';
import { PreArmChecksPanel } from '../common/PreArmChecksPanel';
import { ControlModePanel } from '../common/ControlModePanel';
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
  AlertTriangle,
  Sliders,
  ChevronDown,
  ChevronUp,
  Cpu
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
  onSwitchToManual?: () => void;
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
  onEmergencyRTL,
  onSwitchToManual
}) => {
  const [isArming, setIsArming] = useState(false);
  const [isDisarming, setIsDisarming] = useState(false);
  const [armFeedback, setArmFeedback] = useState<string | null>(null);
  const [showAdvancedHardware, setShowAdvancedHardware] = useState<boolean>(false);

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
      } else {
        const currentPixState = mavlinkService.getConnectionState();
        const lastAck = currentPixState.lastArmCommandAck || currentPixState.lastCommandAck;
        if (lastAck && lastAck.command === 400 && lastAck.result !== 0) {
          setIsArming(false);
          clearInterval(watchdog);
          const preArmReason = currentPixState.preArmFailReason || 
            (currentPixState.statusHistory && currentPixState.statusHistory.length > 0 ? currentPixState.statusHistory[0].text : undefined);
          let failMsg = `ARM REJECTED by Pixhawk (${lastAck.resultName || 'FAILED'})`;
          if (preArmReason) failMsg += ` — ${preArmReason}`;
          setArmFeedback(failMsg);
          return;
        }
        if (Date.now() - startWait > 4500) {
          setIsArming(false);
          clearInterval(watchdog);
          const preArmReason = currentPixState.preArmFailReason;
          if (preArmReason) {
            setArmFeedback(`ARM REJECTED: ${preArmReason}`);
          } else {
            setArmFeedback('ARM ACK TIMEOUT (Waiting for vehicle armed confirmation)');
          }
        }
      }
    }, 200);
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
    <div className="p-3 sm:p-5 max-w-7xl mx-auto space-y-4 sm:space-y-5 font-mono select-none">
      {/* ========================================================================= */}
      {/* 1. TOP VIDEO + MAP SECTION: 2-COLUMN (DESKTOP) / STACKED (MOBILE)          */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Column (Desktop) / Top (Mobile): Continuous Live Video Screen */}
        <div className="w-full">
          <LiveVideoFeed className="h-[280px] sm:h-[360px] lg:h-[420px]" large={true} />
        </div>

        {/* Right Column (Desktop) / Second (Mobile): Tactical Mission Map */}
        <div className="w-full">
          <TacticalMap
            telemetry={telemetry}
            homePoint={homePoint}
            className="h-[280px] sm:h-[360px] lg:h-[420px]"
          />
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. SYSTEM CONNECTION STATUS: 7 INDEPENDENT STATES (SECTION 13)            */}
      {/* ========================================================================= */}
      <ConnectionStatusDeck
        pixhawkState={pixhawkState}
        runnerLink={runnerLink}
        telemetry={telemetry}
      />

      {/* ========================================================================= */}
      {/* 3. STATUS / MISSION / TELEMETRY DECK                                      */}
      {/* ========================================================================= */}
      <div className="space-y-4">
        {/* Status Strip: Mission State & Drone Engine Info */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90 p-3 sm:p-4 rounded-xl border border-slate-800">
          <div className="space-y-1">
            <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider flex items-center space-x-1.5">
              <span>GROUND STATION ANDROID CONTROLLER</span>
              <span className="text-slate-500">•</span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-black border flex items-center space-x-1 ${
                  isDroneAirborne
                    ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300 animate-pulse'
                    : telemetry.isArmed
                    ? 'bg-amber-950/80 border-amber-400 text-amber-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                <Power className="w-3 h-3" />
                <span>
                  {isDroneAirborne
                    ? 'DRONE AIRBORNE (AUTO)'
                    : telemetry.isArmed
                    ? 'DRONE ARMED ON GROUND'
                    : 'DRONE DISARMED ON GROUND'}
                </span>
              </span>
            </div>
            <StatusBadge state={missionState} size="lg" />
          </div>

          {/* Quick Manual Override Access */}
          {onSwitchToManual && (
            <button
              onClick={onSwitchToManual}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-950/80 text-rose-300 border border-slate-700 hover:border-rose-500/50 text-xs font-bold uppercase flex items-center space-x-2 transition self-start sm:self-auto cursor-pointer"
            >
              <Sliders className="w-4 h-4 text-rose-400" />
              <span>MANUAL OVERRIDE</span>
            </button>
          )}
        </div>

        {/* Telemetry Numbers HUD */}
        <TelemetryHUD telemetry={telemetry} />
      </div>

      {/* ========================================================================= */}
      {/* 4. CONTROL / ACTIONS SECTION: MISSION, HOME POINT, AND FLIGHT CONTROLS     */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Mission Controls & Timer (lg: 6 cols) */}
        <div className="lg:col-span-6 space-y-4">
          {/* Master 3-Minute Timer */}
          <MissionTimer
            remainingSeconds={remainingSeconds}
            elapsedSeconds={elapsedSeconds}
            missionState={missionState}
          />

          {/* Primary Action Button Grid: START MISSION + EMERGENCY RTL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
        </div>

        {/* Right Column: Pre-Flight Checklist & Flight Control Panel (lg: 6 cols) */}
        <div className="lg:col-span-6 space-y-4">
          {/* Pre-Arm Checklist & Validation */}
          <PreArmChecksPanel
            connectionState={pixhawkState}
            telemetry={telemetry}
            homePoint={homePoint}
            isReady={isReadyForMission}
          />

          {/* Touch-Safe Flight Control Interface: Arm/Disarm & RC/No-RC */}
          <ControlModePanel
            telemetry={telemetry}
            connectionState={pixhawkState}
            onArmClick={handleDedicatedArmClick}
            onDisarmClick={handleDedicatedDisarmClick}
            isArmingInProgress={isArming}
            isDisarmingInProgress={isDisarming}
          />

          {/* Arm Feedback Banner if failed */}
          {armFeedback && !isArmed && (
            <div className="p-3 bg-rose-950/70 border border-rose-500/50 rounded-xl text-rose-300 text-xs flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{armFeedback}</span>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 5. ADVANCED HARDWARE & ESP32 CONFIGURATION DRAWER (COLLAPSIBLE)            */}
      {/* ========================================================================= */}
      <div className="border-t border-slate-800/80 pt-2">
        <button
          onClick={() => setShowAdvancedHardware(!showAdvancedHardware)}
          className="w-full py-2 px-3 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800 text-xs text-slate-400 hover:text-slate-200 flex items-center justify-between transition cursor-pointer"
        >
          <span className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-sky-400" />
            <span>ADVANCED HARDWARE &amp; ESP32-S3 BRIDGE SETTINGS</span>
          </span>
          {showAdvancedHardware ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showAdvancedHardware && (
          <div className="mt-3">
            <PixhawkConnectionCard connectionState={pixhawkState} />
          </div>
        )}
      </div>
    </div>
  );
};
