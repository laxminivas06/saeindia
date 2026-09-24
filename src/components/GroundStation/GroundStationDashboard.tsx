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
import { LiveVideoFeed } from './LiveVideoFeed';
import { ConnectionStatusDeck } from '../common/ConnectionStatusDeck';
import { PixhawkConnectionCard } from '../Drone/PixhawkConnectionCard';
import { missionEngine } from '../../services/missionEngine';
import { AutonomousMissionStatusBar } from '../Mission/AutonomousMissionStatusBar';
import { AutonomousMissionConfigModal } from '../Mission/AutonomousMissionConfigModal';
import {
  Play,
  ShieldAlert,
  Power,
  Loader2,
  AlertTriangle,
  Sliders,
  Cpu,
  ChevronDown,
  ChevronUp,
  Clock,
  Settings,
  MapPin
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
  const [showHardware, setShowHardware] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);

  const missionValidation = missionEngine.validateMission();
  const missionConfig = missionEngine.getMissionConfig();

  const configuredSecs = missionEngine.getMissionDurationSeconds();
  const [selectedDuration, setSelectedDuration] = useState<number>(configuredSecs);
  const [isCustom, setIsCustom] = useState<boolean>(![60, 120, 180, 300, 600].includes(configuredSecs));
  const [customMinutes, setCustomMinutes] = useState<string>(
    ![60, 120, 180, 300, 600].includes(configuredSecs) ? String(Math.round(configuredSecs / 60) || 1) : '4'
  );

  const isMissionActive =
    missionState !== 'IDLE' &&
    missionState !== 'HOME_SET' &&
    missionState !== 'READY' &&
    missionState !== 'MISSION_COMPLETE';

  const handleDurationChange = (seconds: number) => {
    if (isMissionActive) return;
    setSelectedDuration(seconds);
    setIsCustom(false);
    missionEngine.setMissionDuration(seconds);
  };

  const handleCustomMinutesChange = (val: string) => {
    setCustomMinutes(val);
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      const secs = Math.round(num * 60);
      setSelectedDuration(secs);
      missionEngine.setMissionDuration(secs);
    }
  };

  const isDroneAirborne = telemetry.isArmed && telemetry.altitude > 1.0;
  const isArmed = telemetry.isArmed;

  useEffect(() => {
    if (isArmed) { setIsArming(false); setArmFeedback(null); }
    else { setIsDisarming(false); }
  }, [isArmed]);

  const handleDedicatedArmClick = async () => {
    if (!pixhawkState.isConnected) { setArmFeedback('Flight controller not connected. Connect first.'); return; }
    setArmFeedback(null);
    setIsArming(true);
    const sent = await mavlinkService.sendArmCommand();
    if (!sent) { setIsArming(false); setArmFeedback('ARM TRANSMISSION FAILED: Check WebSocket / ESP32 TX Link.'); return; }
    const startWait = Date.now();
    const watchdog = setInterval(() => {
      if (mavlinkService.getTelemetry().isArmed) {
        setIsArming(false); setArmFeedback(null); clearInterval(watchdog);
      } else {
        const s = mavlinkService.getConnectionState();
        const lastAck = s.lastArmCommandAck || s.lastCommandAck;
        if (lastAck && lastAck.command === 400 && lastAck.result !== 0) {
          setIsArming(false); clearInterval(watchdog);
          const reason = s.preArmFailReason || (s.statusHistory?.length ? s.statusHistory[0].text : undefined);
          let msg = `ARM REJECTED by Pixhawk (${lastAck.resultName || 'FAILED'})`;
          if (reason) msg += ` — ${reason}`;
          setArmFeedback(msg); return;
        }
        if (Date.now() - startWait > 4500) {
          setIsArming(false); clearInterval(watchdog);
          setArmFeedback(s.preArmFailReason ? `ARM REJECTED: ${s.preArmFailReason}` : 'ARM ACK TIMEOUT');
        }
      }
    }, 200);
  };

  const handleDedicatedDisarmClick = async () => {
    if (!pixhawkState.isConnected) { setArmFeedback('Flight controller not connected. Connect first.'); return; }
    setArmFeedback(null);
    setIsDisarming(true);
    const sent = await mavlinkService.sendDisarmCommand();
    if (!sent) { setIsDisarming(false); setArmFeedback('Disarm command transmission failed.'); return; }
    const startWait = Date.now();
    const watchdog = setInterval(() => {
      if (!mavlinkService.getTelemetry().isArmed) { setIsDisarming(false); setArmFeedback(null); clearInterval(watchdog); }
      else if (Date.now() - startWait > 4500) { setIsDisarming(false); clearInterval(watchdog); }
    }, 250);
  };

  return (
    <div className="p-3 sm:p-5 max-w-7xl mx-auto space-y-4 sm:space-y-5 font-mono select-none">

      {/* ============================================================ */}
      {/* 1. CONNECTION STATUS DECK (7 independent states)             */}
      {/* ============================================================ */}
      <ConnectionStatusDeck
        pixhawkState={pixhawkState}
        runnerLink={runnerLink}
        telemetry={telemetry}
      />

      {/* ============================================================ */}
      {/* 2. ESP32 / PIXHAWK CONNECTION CARD (always visible)          */}
      {/* ============================================================ */}
      <PixhawkConnectionCard connectionState={pixhawkState} />

      {/* ============================================================ */}
      {/* 2.5 RESPONSIVE AUTONOMOUS MISSION STATUS BAR (Requirement 7) */}
      {/* ============================================================ */}
      <AutonomousMissionStatusBar
        telemetry={telemetry}
        missionState={missionState}
        pixhawkState={pixhawkState}
        onOpenConfig={() => setIsConfigModalOpen(true)}
        isAuthorizedOperator={true}
      />

      {/* ============================================================ */}
      {/* 3. LIVE VIDEO + MAP (2-column desktop, stacked mobile)       */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LiveVideoFeed className="h-[260px] sm:h-[340px] lg:h-[400px]" />
        <TacticalMap
          telemetry={telemetry}
          homePoint={homePoint}
          className="h-[260px] sm:h-[340px] lg:h-[400px]"
        />
      </div>

      {/* ============================================================ */}
      {/* 4. STATUS STRIP + MANUAL OVERRIDE ACCESS                     */}
      {/* ============================================================ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90 p-3 sm:p-4 rounded-xl border border-slate-800">
        <div className="space-y-1">
          <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider flex items-center space-x-1.5">
            <span>GROUND STATION ANDROID CONTROLLER</span>
            <span className="text-slate-500">•</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-black border flex items-center space-x-1 ${
              isDroneAirborne
                ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300 animate-pulse'
                : telemetry.isArmed
                ? 'bg-amber-950/80 border-amber-400 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}>
              <Power className="w-3 h-3" />
              <span>{isDroneAirborne ? 'AIRBORNE (AUTO)' : telemetry.isArmed ? 'ARMED ON GROUND' : 'DISARMED'}</span>
            </span>
          </div>
          <StatusBadge state={missionState} size="lg" />
        </div>
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

      {/* ============================================================ */}
      {/* 5. TELEMETRY HUD                                              */}
      {/* ============================================================ */}
      <TelemetryHUD telemetry={telemetry} />

      {/* ============================================================ */}
      {/* 6. CONTROLS: MISSION + PREFLIGHT + FLIGHT CONTROLS           */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Mission Controls */}
        <div className="lg:col-span-6 space-y-4">
          {/* ============================================================ */}
          {/* AUTONOMOUS MISSION CONFIGURATION QUICK CARD (Prompt 1 Specs) */}
          {/* ============================================================ */}
          <div className="bg-slate-900/90 p-3.5 sm:p-4 rounded-xl border border-amber-500/30 hud-border font-mono space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-xs font-black uppercase text-amber-300 tracking-wider">
                  AUTONOMOUS MISSION CONFIGURATION
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIsConfigModalOpen(true)}
                className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-black uppercase tracking-wider flex items-center space-x-1 cursor-pointer transition shadow-sm shadow-amber-600/30"
              >
                <Settings className="w-3 h-3" />
                <span>CONFIGURE</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Search Altitude</div>
                <div className="font-extrabold text-amber-300 text-sm mt-0.5">
                  [ {missionConfig.searchAltitude} m ]
                </div>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Search Area</div>
                <div className="font-extrabold text-sky-300 text-xs mt-0.5 truncate">
                  [ {missionConfig.searchBoundary.type} ]
                </div>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Search Algorithm</div>
                <div className="font-extrabold text-slate-200 text-xs mt-0.5 truncate">
                  [ {missionConfig.searchAlgorithm.replace('_', ' ')} ]
                </div>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400 uppercase font-bold">RTL on QR Confirmation</div>
                <div className={`font-extrabold text-xs mt-0.5 ${missionConfig.rtlOnQrConfirmation ? 'text-emerald-400' : 'text-amber-400'}`}>
                  [ {missionConfig.rtlOnQrConfirmation ? 'ON' : 'OFF'} ]
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800/80">
              <span className="text-slate-400">Pre-Flight Readiness:</span>
              <span className={`font-bold flex items-center space-x-1 ${
                missionValidation.isValid ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                <span>{missionValidation.conditions.filter(c => c.passed).length}/9 Checks Passed</span>
              </span>
            </div>
          </div>

          {/* Mission Duration Configuration (Operator/Admin) */}
          <div className="bg-slate-900/90 p-3 sm:p-3.5 rounded-xl border border-slate-800 hud-border font-mono space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Clock className="w-3.5 h-3.5 text-sky-400" />
                <span className="text-[11px] font-black uppercase text-slate-300 tracking-wider">
                  MISSION DURATION CONFIG
                </span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                isMissionActive ? 'bg-amber-950/80 text-amber-300 border border-amber-500/40' : 'bg-slate-800 text-sky-400'
              }`}>
                {isMissionActive ? 'LOCKED IN FLIGHT' : `ACTIVE: ${Math.round(selectedDuration / 60)}M (${selectedDuration}s)`}
              </span>
            </div>

            {/* Presets Grid */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {[
                { label: '1 MIN', secs: 60 },
                { label: '2 MIN', secs: 120 },
                { label: '3 MIN (DEF)', secs: 180 },
                { label: '5 MIN', secs: 300 },
                { label: '10 MIN', secs: 600 },
                { label: 'CUSTOM', secs: -1, isCustomOption: true },
              ].map((opt) => {
                const isSelected = opt.isCustomOption ? isCustom : (!isCustom && selectedDuration === opt.secs);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    disabled={isMissionActive}
                    onClick={() => {
                      if (opt.isCustomOption) {
                        setIsCustom(true);
                      } else {
                        handleDurationChange(opt.secs);
                      }
                    }}
                    className={`py-1.5 px-1 rounded-lg text-[10px] font-extrabold uppercase transition border text-center ${
                      isSelected
                        ? 'bg-sky-600 border-sky-400 text-white shadow-md shadow-sky-600/30 font-black'
                        : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    } ${isMissionActive ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Custom Input */}
            {isCustom && !isMissionActive && (
              <div className="flex items-center space-x-2 pt-1 border-t border-slate-800/80">
                <span className="text-[10px] text-slate-400 uppercase font-bold">Custom Window:</span>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="number"
                    min="1"
                    max="60"
                    step="1"
                    value={customMinutes}
                    onChange={(e) => handleCustomMinutesChange(e.target.value)}
                    className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono text-center focus:border-sky-500 focus:outline-none"
                    placeholder="Mins"
                  />
                  <span className="text-[10px] text-slate-400">Minutes ({Math.round((parseFloat(customMinutes) || 1) * 60)}s)</span>
                </div>
              </div>
            )}
          </div>

          <MissionTimer
            remainingSeconds={remainingSeconds}
            elapsedSeconds={elapsedSeconds}
            missionState={missionState}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={onStartMission}
              disabled={!missionValidation.isValid || isMissionActive}
              className={`py-3.5 sm:py-4 px-3 rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center space-x-2 transition shadow-lg ${
                missionValidation.isValid && !isMissionActive
                  ? 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white shadow-sky-600/30 cursor-pointer animate-pulse'
                  : 'bg-slate-800/80 text-slate-500 border border-slate-700/50 cursor-not-allowed'
              }`}
              title={!missionValidation.isValid ? 'START DISABLED: Satisfy all 9 pre-flight validation conditions' : 'Start Autonomous Mission'}
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

          <HomePointSetter
            homePoint={homePoint}
            gps={telemetry.gps}
            onSetHomePoint={onSetHomePoint}
            disabled={isMissionActive}
          />
        </div>

        {/* Right: Pre-flight + Arm Controls */}
        <div className="lg:col-span-6 space-y-4">
          <PreArmChecksPanel
            connectionState={pixhawkState}
            telemetry={telemetry}
            homePoint={homePoint}
            isReady={missionValidation.isValid}
          />

          <ControlModePanel
            telemetry={telemetry}
            connectionState={pixhawkState}
            onArmClick={handleDedicatedArmClick}
            onDisarmClick={handleDedicatedDisarmClick}
            isArmingInProgress={isArming}
            isDisarmingInProgress={isDisarming}
          />

          {armFeedback && !isArmed && (
            <div className="p-3 bg-rose-950/70 border border-rose-500/50 rounded-xl text-rose-300 text-xs flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{armFeedback}</span>
            </div>
          )}
        </div>
      </div>

      {/* Autonomous Mission Configuration Modal */}
      <AutonomousMissionConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        telemetry={telemetry}
        homePoint={homePoint}
        pixhawkState={pixhawkState}
        missionState={missionState}
        onStartMission={onStartMission}
      />
    </div>
  );
};
