import React from 'react';
import { AppRole, MissionState } from '../../types/mission';
import { DroneTelemetry } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { 
  Radio, 
  Battery, 
  Satellite, 
  Compass, 
  ShieldAlert, 
  RotateCcw, 
  Flame, 
  Activity, 
  Volume2, 
  VolumeX, 
  Layers,
  History,
  Smartphone
} from 'lucide-react';
import { audioService } from '../../services/audioService';

interface HeaderProps {
  currentRole: AppRole;
  missionState: MissionState;
  telemetry: DroneTelemetry;
  pixhawkState: PixhawkConnectionState;
  runnerLink: RunnerLinkState;
  onSwitchRole: () => void;
  onOpenHistory: () => void;
  onResetMission?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentRole,
  missionState,
  telemetry,
  pixhawkState,
  runnerLink,
  onSwitchRole,
  onOpenHistory,
  onResetMission
}) => {
  const [muted, setMuted] = React.useState(audioService.getMuted());

  const toggleMute = () => {
    const next = !muted;
    audioService.setMuted(next);
    setMuted(next);
  };

  const getRoleLabel = () => {
    switch (currentRole) {
      case 'GROUND_STATION':
        return 'GROUND STATION ANDROID';
      case 'DRONE':
        return 'DRONE ANDROID MISSION CORE';
      case 'RUNNER':
        return 'RUNNER ANDROID FIELD UNIT';
      case 'TESTBENCH':
        return 'FIELD OPS SIMULATOR & TESTBENCH';
      default:
        return 'SAE INDIA MISSION SYSTEM';
    }
  };

  const getRoleBadgeColor = () => {
    switch (currentRole) {
      case 'GROUND_STATION':
        return 'bg-sky-500/20 text-sky-400 border-sky-500/40';
      case 'DRONE':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
      case 'RUNNER':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
      default:
        return 'bg-purple-500/20 text-purple-400 border-purple-500/40';
    }
  };

  return (
    <header className="bg-slate-900/90 border-b border-slate-800 backdrop-blur-md px-3 sm:px-5 py-2.5 flex items-center justify-between text-xs sm:text-sm select-none z-30 sticky top-0">
      {/* Left: Branding & Role */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        <button
          onClick={onSwitchRole}
          className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 px-2.5 py-1.5 rounded border border-slate-700 transition"
          title="Switch Role Mode"
        >
          <Smartphone className="w-3.5 h-3.5 text-sky-400" />
          <span className="font-mono text-[11px] sm:text-xs font-semibold uppercase">Mode</span>
        </button>

        <div className="flex flex-col">
          <div className="flex items-center space-x-1.5">
            <span className="font-mono font-extrabold text-white tracking-wider text-xs sm:text-sm">
              SAE INDIA
            </span>
            <span className="text-slate-500 text-[10px] hidden sm:inline">|</span>
            <span className="text-slate-400 font-medium text-[11px] hidden sm:inline">AUTONOMOUS RESCUE</span>
          </div>
          <span className={`text-[10px] font-mono font-bold tracking-tight border px-1.5 py-0.2 rounded w-fit mt-0.5 ${getRoleBadgeColor()}`}>
            {getRoleLabel()}
          </span>
        </div>
      </div>

      {/* Center: Realtime Field Status Badges */}
      <div className="hidden md:flex items-center space-x-3 font-mono text-[11px]">
        {/* MAVLink / Pixhawk */}
        <div className={`flex items-center space-x-1.5 px-2 py-1 rounded border ${
          pixhawkState.isConnected 
            ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400' 
            : 'bg-rose-950/40 border-rose-500/30 text-rose-400 animate-pulse'
        }`}>
          <Radio className="w-3 h-3" />
          <span>MAVLink: {pixhawkState.isConnected ? 'LOCKED ✓' : 'DISCONNECTED'}</span>
        </div>

        {/* GPS */}
        <div className={`flex items-center space-x-1.5 px-2 py-1 rounded border ${
          telemetry.gps.isLocked 
            ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400' 
            : 'bg-amber-950/40 border-amber-500/30 text-amber-400'
        }`}>
          <Satellite className="w-3 h-3" />
          <span>GPS: {telemetry.gps.satellites} Sats ({telemetry.gps.fixType})</span>
        </div>

        {/* Battery */}
        <div className={`flex items-center space-x-1.5 px-2 py-1 rounded border ${
          telemetry.batteryPercent > 30 
            ? 'bg-slate-800/80 border-slate-700 text-slate-200' 
            : 'bg-rose-950/50 border-rose-500/40 text-rose-400'
        }`}>
          <Battery className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-bold">{telemetry.batteryPercent}% ({telemetry.batteryVoltage}V)</span>
        </div>

        {/* Runner Wireless Link */}
        <div className={`flex items-center space-x-1.5 px-2 py-1 rounded border ${
          runnerLink.isConnected 
            ? 'bg-sky-950/40 border-sky-500/30 text-sky-400' 
            : 'bg-slate-800 border-slate-700 text-slate-400'
        }`}>
          <Activity className="w-3 h-3" />
          <span>Runner Link: {runnerLink.isConnected ? `${runnerLink.signalStrengthDbm} dBm` : 'WAITING'}</span>
        </div>
      </div>

      {/* Right: Quick Action Buttons */}
      <div className="flex items-center space-x-1.5 sm:space-x-2">
        <button
          onClick={toggleMute}
          className={`p-1.5 sm:p-2 rounded border transition ${
            muted ? 'bg-slate-800 border-slate-700 text-slate-500' : 'bg-slate-800 border-slate-700 text-sky-400 hover:bg-slate-700'
          }`}
          title={muted ? 'Unmute Audio' : 'Mute Audio'}
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        <button
          onClick={onOpenHistory}
          className="flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 px-2 sm:px-2.5 py-1.5 rounded border border-slate-700 text-[11px] sm:text-xs font-mono transition"
          title="Mission Logs & Export"
        >
          <History className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Logs</span>
        </button>

        {onResetMission && (
          <button
            onClick={onResetMission}
            className="flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 px-2 sm:px-2.5 py-1.5 rounded border border-slate-700 text-[11px] sm:text-xs font-mono transition"
            title="Reset Mission"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        )}
      </div>
    </header>
  );
};
