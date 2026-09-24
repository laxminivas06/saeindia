import React, { useState } from 'react';
import { 
  Radio, 
  Gamepad2, 
  Power, 
  ArrowUp, 
  ArrowDown, 
  ArrowLeft, 
  ArrowRight, 
  ShieldCheck, 
  Compass, 
  PlaneTakeoff, 
  PlaneLanding, 
  Home, 
  Hand,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { DroneTelemetry } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { mavlinkService } from '../../services/mavlinkService';

interface ControlModePanelProps {
  telemetry: DroneTelemetry;
  connectionState: PixhawkConnectionState;
  onArmClick: () => void;
  onDisarmClick: () => void;
  isArmingInProgress?: boolean;
  isDisarmingInProgress?: boolean;
}

export const ControlModePanel: React.FC<ControlModePanelProps> = ({
  telemetry,
  connectionState,
  onArmClick,
  onDisarmClick,
  isArmingInProgress = false,
  isDisarmingInProgress = false
}) => {
  const [controlMode, setControlModeState] = useState<'RC' | 'NO_RC'>('NO_RC');
  const [activeDirection, setActiveDirection] = useState<string | null>(null);

  const isArmed = telemetry.isArmed;
  const rcDetected = telemetry.rcSignalDetected ?? connectionState.rcSignalDetected ?? false;

  const handleModeSwitch = (mode: 'RC' | 'NO_RC') => {
    if (controlMode === mode) return;
    setControlModeState(mode);
    mavlinkService.setControlMode(mode);
  };

  const handleDirectionPress = (dir: 'FORWARD' | 'BACKWARD' | 'LEFT' | 'RIGHT' | 'HOLD') => {
    setActiveDirection(dir);
    mavlinkService.commandManualMove(dir);
    setTimeout(() => setActiveDirection(null), 300);
  };

  const handleTakeoff = () => {
    mavlinkService.commandTakeoff(20);
  };

  const handleLand = () => {
    mavlinkService.commandLand();
  };

  const handleRTL = () => {
    mavlinkService.commandRTL();
  };

  const handleHold = () => {
    mavlinkService.commandHold();
  };

  return (
    <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-3.5 sm:p-5 shadow-xl font-mono text-slate-100 space-y-4">
      {/* 1. Header: Control Mode Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-sky-950/80 border border-sky-500/40 text-sky-400">
            {controlMode === 'RC' ? <Radio className="w-5 h-5 animate-pulse" /> : <Gamepad2 className="w-5 h-5 text-emerald-400" />}
          </div>
          <div>
            <div className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-200">
              FLIGHT CONTROL INTERFACE
            </div>
            <div className="text-[10px] text-slate-400">
              {controlMode === 'RC' ? 'Physical RC Transmitter Mode' : 'MAVLink Web Ground Station Control'}
            </div>
          </div>
        </div>

        {/* RC / NO-RC Selector Tabs */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => handleModeSwitch('RC')}
            className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase transition-all duration-150 flex items-center space-x-1.5 ${
              controlMode === 'RC'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>RC MODE</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('NO_RC')}
            className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase transition-all duration-150 flex items-center space-x-1.5 ${
              controlMode === 'NO_RC'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5" />
            <span>NO RC</span>
          </button>
        </div>
      </div>

      {/* 2. Mode-Specific Panel Body */}
      {controlMode === 'RC' ? (
        /* ================= RC MODE DISPLAY ================= */
        <div className="p-4 sm:p-6 bg-slate-950/90 rounded-xl border border-purple-500/30 space-y-4 text-center">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-950/80 border border-purple-500/50 text-purple-300 text-xs font-bold uppercase">
            <Radio className="w-3.5 h-3.5" />
            <span>RC CONTROL ACTIVE</span>
          </div>

          <div className="max-w-md mx-auto space-y-2">
            <div className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
              rcDetected 
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300' 
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}>
              <div className="flex items-center space-x-2">
                {rcDetected ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
                <span className="font-bold uppercase">RC SIGNAL:</span>
              </div>
              <span className="font-black">{rcDetected ? 'DETECTED ✓' : 'NOT DETECTED'}</span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed text-left">
              Physical RC transmitter has primary flight authority. Ground Station provides live telemetry monitoring without sending overriding control setpoints.
            </p>
          </div>
        </div>
      ) : (
        /* ================= NO-RC MODE INTERFACE ================= */
        <div className="space-y-4">
          {/* A. ARM & DISARM BUTTONS (SPACED APART & TOUCH-SAFE) */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {/* ARM BUTTON */}
            <button
              type="button"
              onClick={onArmClick}
              disabled={isArmed || isArmingInProgress || isDisarmingInProgress || !connectionState.isConnected}
              className={`py-3.5 sm:py-4 px-4 rounded-xl font-black text-sm sm:text-base uppercase tracking-wider flex items-center justify-center space-x-2 border transition-all duration-150 ${
                isArmed
                  ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                  : isArmingInProgress
                  ? 'bg-amber-950 border-amber-500 text-amber-300 animate-pulse cursor-wait'
                  : !connectionState.isConnected
                  ? 'bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-lg shadow-emerald-950/50 active:scale-[0.98] cursor-pointer'
              }`}
            >
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <span>{isArmingInProgress ? 'ARMING...' : isArmed ? 'ARMED' : 'ARM MOTORS'}</span>
            </button>

            {/* DISARM BUTTON */}
            <button
              type="button"
              onClick={onDisarmClick}
              disabled={!isArmed || isArmingInProgress || isDisarmingInProgress || !connectionState.isConnected}
              className={`py-3.5 sm:py-4 px-4 rounded-xl font-black text-sm sm:text-base uppercase tracking-wider flex items-center justify-center space-x-2 border transition-all duration-150 ${
                !isArmed
                  ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                  : isDisarmingInProgress
                  ? 'bg-amber-950 border-amber-500 text-amber-300 animate-pulse cursor-wait'
                  : !connectionState.isConnected
                  ? 'bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-rose-600 hover:bg-rose-500 text-white border-rose-400 shadow-lg shadow-rose-950/50 active:scale-[0.98] cursor-pointer'
              }`}
            >
              <Power className="w-5 h-5 shrink-0" />
              <span>{isDisarmingInProgress ? 'DISARMING...' : 'DISARM'}</span>
            </button>
          </div>

          {/* ArduPilot DISARM_DELAY Safety Notice */}
          <div className="p-2.5 rounded-lg bg-sky-950/40 border border-sky-800/40 flex items-start space-x-2 text-[11px] text-sky-300">
            <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <div className="leading-snug">
              <span className="font-bold">ArduPilot Ground Auto-Disarm:</span> ArduCopter firmware automatically disarms motors after <span className="font-bold underline">10 seconds</span> on the ground if throttle/takeoff is not initiated (<code className="bg-slate-900 px-1 py-0.5 rounded text-[10px]">DISARM_DELAY</code>). Press <span className="font-bold text-emerald-300">TAKEOFF</span> after arming.
            </div>
          </div>

          {/* B. DIRECTIONAL CONTROLS & FLIGHT ACTIONS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 1. D-PAD DIRECTIONAL CONTROLLER */}
            <div className="p-3.5 bg-slate-950/90 rounded-xl border border-slate-800 flex flex-col items-center justify-center space-y-2">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5 self-start">
                <Compass className="w-3.5 h-3.5 text-sky-400" />
                <span>MANUAL DIRECTIONAL CONTROLS</span>
              </div>

              <div className="grid grid-cols-3 gap-2 w-full max-w-[240px] pt-1">
                {/* Row 1: Forward */}
                <div />
                <button
                  type="button"
                  onClick={() => handleDirectionPress('FORWARD')}
                  disabled={!connectionState.isConnected}
                  className={`p-3.5 rounded-xl border flex flex-col items-center justify-center font-bold text-xs transition active:scale-95 cursor-pointer ${
                    activeDirection === 'FORWARD'
                      ? 'bg-sky-500 text-white border-sky-300'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                  }`}
                  title="Move Forward"
                >
                  <ArrowUp className="w-5 h-5" />
                  <span className="text-[9px] mt-0.5 font-mono">FWD</span>
                </button>
                <div />

                {/* Row 2: Left, Hold, Right */}
                <button
                  type="button"
                  onClick={() => handleDirectionPress('LEFT')}
                  disabled={!connectionState.isConnected}
                  className={`p-3 rounded-xl border flex flex-col items-center justify-center font-bold text-xs transition active:scale-95 cursor-pointer ${
                    activeDirection === 'LEFT'
                      ? 'bg-sky-500 text-white border-sky-300'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                  }`}
                  title="Move Left"
                >
                  <ArrowLeft className="w-5 h-5" />
                  <span className="text-[9px] mt-0.5 font-mono">LEFT</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDirectionPress('HOLD')}
                  disabled={!connectionState.isConnected}
                  className={`p-3 rounded-xl border flex flex-col items-center justify-center font-black text-xs transition active:scale-95 cursor-pointer ${
                    activeDirection === 'HOLD'
                      ? 'bg-amber-500 text-white border-amber-300'
                      : 'bg-amber-950/60 hover:bg-amber-900/60 border-amber-500/50 text-amber-300'
                  }`}
                  title="Position Hold"
                >
                  <Hand className="w-5 h-5" />
                  <span className="text-[9px] mt-0.5 font-mono">HOLD</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDirectionPress('RIGHT')}
                  disabled={!connectionState.isConnected}
                  className={`p-3 rounded-xl border flex flex-col items-center justify-center font-bold text-xs transition active:scale-95 cursor-pointer ${
                    activeDirection === 'RIGHT'
                      ? 'bg-sky-500 text-white border-sky-300'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                  }`}
                  title="Move Right"
                >
                  <ArrowRight className="w-5 h-5" />
                  <span className="text-[9px] mt-0.5 font-mono">RIGHT</span>
                </button>

                {/* Row 3: Backward */}
                <div />
                <button
                  type="button"
                  onClick={() => handleDirectionPress('BACKWARD')}
                  disabled={!connectionState.isConnected}
                  className={`p-3.5 rounded-xl border flex flex-col items-center justify-center font-bold text-xs transition active:scale-95 cursor-pointer ${
                    activeDirection === 'BACKWARD'
                      ? 'bg-sky-500 text-white border-sky-300'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                  }`}
                  title="Move Backward"
                >
                  <ArrowDown className="w-5 h-5" />
                  <span className="text-[9px] mt-0.5 font-mono">BWD</span>
                </button>
                <div />
              </div>
            </div>

            {/* 2. FLIGHT ACTIONS GRID */}
            <div className="p-3.5 bg-slate-950/90 rounded-xl border border-slate-800 flex flex-col justify-between space-y-2">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                <PlaneTakeoff className="w-3.5 h-3.5 text-emerald-400" />
                <span>FLIGHT COMMANDS</span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {/* TAKEOFF */}
                <button
                  type="button"
                  onClick={handleTakeoff}
                  disabled={!isArmed || !connectionState.isConnected}
                  className={`p-3 rounded-xl border font-bold text-xs flex items-center justify-center space-x-2 transition ${
                    isArmed && connectionState.isConnected
                      ? 'bg-emerald-950/80 hover:bg-emerald-900 border-emerald-500/50 text-emerald-300 cursor-pointer active:scale-95'
                      : 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
                  }`}
                >
                  <PlaneTakeoff className="w-4 h-4" />
                  <span>TAKEOFF (20m)</span>
                </button>

                {/* LAND */}
                <button
                  type="button"
                  onClick={handleLand}
                  disabled={!connectionState.isConnected}
                  className={`p-3 rounded-xl border font-bold text-xs flex items-center justify-center space-x-2 transition ${
                    connectionState.isConnected
                      ? 'bg-amber-950/80 hover:bg-amber-900 border-amber-500/50 text-amber-300 cursor-pointer active:scale-95'
                      : 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
                  }`}
                >
                  <PlaneLanding className="w-4 h-4" />
                  <span>LAND</span>
                </button>

                {/* RTL */}
                <button
                  type="button"
                  onClick={handleRTL}
                  disabled={!connectionState.isConnected}
                  className={`p-3 rounded-xl border font-bold text-xs flex items-center justify-center space-x-2 transition ${
                    connectionState.isConnected
                      ? 'bg-rose-950/80 hover:bg-rose-900 border-rose-500/50 text-rose-300 cursor-pointer active:scale-95'
                      : 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
                  }`}
                >
                  <Home className="w-4 h-4" />
                  <span>RTL</span>
                </button>

                {/* HOLD */}
                <button
                  type="button"
                  onClick={handleHold}
                  disabled={!connectionState.isConnected}
                  className={`p-3 rounded-xl border font-bold text-xs flex items-center justify-center space-x-2 transition ${
                    connectionState.isConnected
                      ? 'bg-sky-950/80 hover:bg-sky-900 border-sky-500/50 text-sky-300 cursor-pointer active:scale-95'
                      : 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
                  }`}
                >
                  <Hand className="w-4 h-4" />
                  <span>HOLD / LOITER</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
