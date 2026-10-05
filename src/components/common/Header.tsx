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
  Smartphone,
  Info,
  X,
  Wifi,
  Map,
  ExternalLink,
  Plane
} from 'lucide-react';
import { audioService } from '../../services/audioService';
import { ThemeController } from './ThemeController';
import { authService } from '../../services/authService';
import { mavlinkService } from '../../services/mavlinkService';

interface HeaderProps {
  currentRole: AppRole;
  missionState: MissionState;
  telemetry: DroneTelemetry;
  pixhawkState: PixhawkConnectionState;
  runnerLink: RunnerLinkState;
  onSwitchRole: () => void;
  onOpenHistory: () => void;
  onOpenConnectionModal?: () => void;
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
  onOpenConnectionModal,
  onResetMission
}) => {
  const [muted, setMuted] = React.useState(audioService.getMuted());
  const [showTeamInfo, setShowTeamInfo] = React.useState(false);

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
    <header className="bg-slate-900/98 border-b border-slate-800 backdrop-blur-md px-3 sm:px-5 py-2.5 flex items-center justify-between text-xs sm:text-sm select-none z-50 sticky top-0 shadow-lg shadow-black/40">
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
            {/* Team Skycon info trigger badge */}
            <button
              onClick={() => setShowTeamInfo(true)}
              className="ml-1 px-1.5 py-0.5 rounded bg-sky-950/60 hover:bg-sky-900/60 border border-sky-500/40 text-sky-300 text-[10px] font-mono font-bold flex items-center space-x-1 cursor-pointer transition"
              title="Team & Project Info: Team Skycon (ADDC20260123)"
            >
              <Info className="w-3 h-3 text-sky-400" />
              <span>Skycon</span>
            </button>
          </div>
          <span className={`text-[10px] font-mono font-bold tracking-tight border px-1.5 py-0.2 rounded w-fit mt-0.5 ${getRoleBadgeColor()}`}>
            {getRoleLabel()}
          </span>
        </div>
        {/* Quick Mode Switcher (Google Maps vs Drone Ops) */}
        <div className="flex items-center space-x-1 bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => authService.switchRole('GROUND_STATION')}
            className={`px-2 py-1 rounded text-[10px] font-mono font-bold flex items-center space-x-1 cursor-pointer transition ${
              currentRole === 'GROUND_STATION'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Switch to Ground Station with Interactive Google Maps & Mission Workspace"
          >
            <Map className="w-3 h-3 text-sky-300" />
            <span>GOOGLE MAPS</span>
          </button>

          <button
            type="button"
            onClick={() => authService.switchRole('DRONE')}
            className={`px-2 py-1 rounded text-[10px] font-mono font-bold flex items-center space-x-1 cursor-pointer transition ${
              currentRole === 'DRONE'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Switch to Drone Onboard Avionics & Subsystems"
          >
            <Plane className="w-3 h-3 text-amber-300" />
            <span>DRONE OPS</span>
          </button>

          <a
            href="/googlemaps.html"
            target="_blank"
            rel="noopener noreferrer"
            className="px-2 py-1 rounded text-[10px] font-mono font-bold flex items-center space-x-1 text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 transition"
            title="Open Nivas's Standalone Google Maps Boundary Admin Tool"
          >
            <ExternalLink className="w-3 h-3" />
            <span className="hidden xl:inline">BOUNDARY HTML</span>
          </a>
        </div>
      </div>

      {/* Center: Realtime Field Status Badges */}
      <div className="hidden md:flex items-center space-x-2.5 font-mono text-[11px]">
        {/* MAVLink / Pixhawk */}
        <div 
          onClick={onOpenConnectionModal}
          title="Flight Controller MAVLink Status. Click to configure connection."
          className={`flex items-center space-x-1.5 px-2 py-1 rounded border cursor-pointer transition hover:scale-105 ${
          pixhawkState.isConnected 
            ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400 hover:border-emerald-500/60' 
            : 'bg-rose-950/40 border-rose-500/30 text-rose-400 animate-pulse hover:border-rose-500/60'
        }`}>
          <Radio className="w-3 h-3" />
          <span>MAVLink: {pixhawkState.isConnected ? 'LOCKED ✓' : 'DISCONNECTED'}</span>
        </div>

        {/* ESP32 WebSocket Bridge Status */}
        <div 
          onClick={onOpenConnectionModal}
          title="ESP32 Wireless Bridge Link. Click to configure connection."
          className={`flex items-center space-x-1.5 px-2 py-1 rounded border cursor-pointer transition hover:scale-105 ${
          pixhawkState.isUsbConnected
            ? 'bg-purple-950/40 border-purple-500/30 text-purple-300 hover:border-purple-500/60'
            : pixhawkState.esp32LinkState === 'CONNECTING' || pixhawkState.esp32LinkState === 'RECONNECTING'
            ? 'bg-amber-950/40 border-amber-500/30 text-amber-300 animate-pulse hover:border-amber-500/60'
            : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
        }`}>
          <Wifi className="w-3 h-3 text-purple-400" />
          <span>ESP32: {pixhawkState.isUsbConnected ? 'CONNECTED ✓' : pixhawkState.esp32LinkState === 'CONNECTING' ? 'CONNECTING' : pixhawkState.esp32LinkState === 'RECONNECTING' ? 'RECONNECTING' : 'DISCONNECTED'}</span>
        </div>

        {/* GPS */}
        {(() => {
          const fixType = telemetry.gps.fixType || 'NO_FIX';
          const isGpsReady = telemetry.gps.isLocked || (telemetry.gps.satellites >= 6 && fixType !== 'NO_GPS' && fixType !== 'NO_FIX');
          const fixLabel = fixType === '3D_FIX' ? '3D' : fixType.replace('_', ' ');
          return (
            <div className={`flex items-center space-x-1.5 px-2 py-1 rounded border ${
              isGpsReady 
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400' 
                : 'bg-amber-950/40 border-amber-500/30 text-amber-400'
            }`}>
              <Satellite className="w-3 h-3" />
              <span>{isGpsReady ? 'GPS READY' : 'GPS NO LOCK'} | Sat: {telemetry.gps.satellites} | {fixLabel}</span>
            </div>
          );
        })()}

        {/* Battery Telemetry Badge (Clickable to probe flight controller) */}
        <div 
          onClick={() => mavlinkService.requestMavlinkDataStreams()}
          title="Telemetry Battery Monitor. Click to probe flight controller telemetry stream."
          className={`flex items-center space-x-1.5 px-2 py-1 rounded border cursor-pointer transition select-none ${
            telemetry.batteryVoltage > 0
              ? (telemetry.batteryPercent > 30 
                  ? 'bg-slate-800/80 border-slate-700 text-slate-200 hover:border-slate-600' 
                  : 'bg-rose-950/50 border-rose-500/40 text-rose-400 animate-pulse')
              : 'bg-amber-950/40 border-amber-500/40 text-amber-300 hover:bg-amber-900/50'
          }`}
        >
          <Battery className={`w-3.5 h-3.5 ${telemetry.batteryVoltage > 0 ? 'text-emerald-400' : 'text-amber-400'}`} />
          <span className="font-bold">
            {telemetry.batteryVoltage > 0 
              ? `${telemetry.batteryPercent}% (${telemetry.batteryVoltage.toFixed(1)}V • ${telemetry.batteryCellCount || 3}S)` 
              : 'BATTERY: NO SIGNAL (POLL)'}
          </span>
        </div>

        {/* Runner Wireless Link */}
        <div className={`flex items-center space-x-1.5 px-2 py-1 rounded border ${
          runnerLink.isConnected 
            ? 'bg-sky-950/40 border-sky-500/30 text-sky-400' 
            : 'bg-slate-800 border-slate-700 text-slate-400'
        }`}>
          <Activity className="w-3 h-3" />
          <span>Runner: {runnerLink.isConnected ? `${runnerLink.signalStrengthDbm} dBm` : 'WAITING'}</span>
        </div>
      </div>

      {/* Right: Quick Action Buttons & Theme Controller */}
      <div className="flex items-center space-x-1.5 sm:space-x-2">
        {/* Prominent Responsive Connect / Hardware Link Button */}
        {onOpenConnectionModal && (
          <button
            onClick={onOpenConnectionModal}
            className={`flex items-center space-x-1 sm:space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border font-mono text-[11px] sm:text-xs font-bold transition shadow-md cursor-pointer ${
              pixhawkState.isConnected
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/60 shadow-emerald-950/30'
                : pixhawkState.esp32LinkState === 'CONNECTING' || pixhawkState.esp32LinkState === 'RECONNECTING'
                ? 'bg-amber-950/80 border-amber-500/50 text-amber-300 hover:bg-amber-900/60 animate-pulse shadow-amber-950/30'
                : 'bg-rose-950/80 border-rose-500/60 text-rose-300 hover:bg-rose-900/80 animate-pulse shadow-rose-950/50'
            }`}
            title="Open Hardware Connection Manager (ESP32, Pixhawk & Phone GPS)"
          >
            <Wifi className={`w-3.5 h-3.5 ${pixhawkState.isConnected ? 'text-emerald-400' : 'text-rose-400'}`} />
            <span>
              {pixhawkState.isConnected
                ? 'LINKED ✓'
                : pixhawkState.esp32LinkState === 'CONNECTING'
                ? 'LINKING...'
                : 'CONNECT'}
            </span>
          </button>
        )}

        {/* App-Wide Theme Controller */}
        <ThemeController />

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

      {/* Project & Team Branding Modal */}
      {showTeamInfo && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-sky-500 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 font-mono text-slate-200 shadow-2xl relative">
            <button
              onClick={() => setShowTeamInfo(false)}
              className="absolute top-4 right-4 p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center space-x-2 text-sky-400 font-black text-sm uppercase tracking-wider border-b border-slate-800 pb-3">
              <Info className="w-5 h-5 text-sky-400 shrink-0" />
              <span>PROJECT &amp; TEAM SPECIFICATIONS</span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Institution</div>
                <div className="text-white font-bold text-sm">Spurthi Engineering College</div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Team Name</div>
                  <div className="text-sky-300 font-black text-sm">Skycon</div>
                  <div className="text-[10px] text-slate-400">Team Skycon</div>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Team ID</div>
                  <div className="text-emerald-400 font-mono font-black text-sm">ADDC20260123</div>
                  <div className="text-[10px] text-slate-400">SAE India Autonomous</div>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Mission System</div>
                <div className="text-slate-200 font-medium">SAE Portal for Autonomous Drone</div>
                <div className="text-[10px] text-slate-400">Real-time MAVLink Telemetry • Autonomous Vision Search • Direct Runner ACK</div>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => setShowTeamInfo(false)}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
