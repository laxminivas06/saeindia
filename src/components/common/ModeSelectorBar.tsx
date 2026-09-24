import React from 'react';
import { AppRole } from '../../types/mission';
import { 
  Laptop, 
  Plane, 
  Smartphone, 
  Sliders, 
  ShieldAlert, 
  Radio, 
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

interface ModeSelectorBarProps {
  currentRole: AppRole;
  onSelectRole: (role: AppRole) => void;
  isManualOverrideActive?: boolean;
  isMissionPaused?: boolean;
  className?: string;
}

export const ModeSelectorBar: React.FC<ModeSelectorBarProps> = ({
  currentRole,
  onSelectRole,
  isManualOverrideActive = false,
  isMissionPaused = false,
  className = ''
}) => {
  const modes: Array<{
    id: AppRole;
    label: string;
    shortLabel: string;
    icon: React.ElementType;
    activeClass: string;
    borderClass: string;
  }> = [
    {
      id: 'GROUND_STATION',
      label: 'GROUND STATION',
      shortLabel: 'Ground',
      icon: Laptop,
      activeClass: 'bg-sky-600 text-white shadow-lg shadow-sky-600/30 border-sky-400',
      borderClass: 'hover:border-sky-500/50'
    },
    {
      id: 'DRONE',
      label: 'DRONE ANDROID',
      shortLabel: 'Drone',
      icon: Plane,
      activeClass: 'bg-amber-600 text-white shadow-lg shadow-amber-600/30 border-amber-400',
      borderClass: 'hover:border-amber-500/50'
    },
    {
      id: 'RUNNER',
      label: 'RUNNER ANDROID',
      shortLabel: 'Runner',
      icon: Smartphone,
      activeClass: 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 border-emerald-400',
      borderClass: 'hover:border-emerald-500/50'
    },
    {
      id: 'MANUAL',
      label: 'MANUAL CONTROL',
      shortLabel: 'Manual',
      icon: Sliders,
      activeClass: 'bg-rose-600 text-white shadow-lg shadow-rose-600/30 border-rose-400 animate-pulse',
      borderClass: 'hover:border-rose-500/50'
    }
  ];

  return (
    <div className={`bg-slate-900/95 border-b border-slate-800 px-3 sm:px-5 py-2 select-none sticky top-0 z-40 backdrop-blur-md ${className}`}>
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-2">
        {/* System Title & Override Notice */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping" style={{ animationDuration: '3s' }} />
            <span className="font-mono font-black text-xs sm:text-sm text-slate-100 tracking-wider uppercase">
              DRONE CONTROL SYSTEM
            </span>
          </div>

          {/* Active Override Indicator if in manual mode or paused */}
          {(isManualOverrideActive || isMissionPaused) && (
            <div className="md:hidden flex items-center space-x-1 px-2 py-0.5 rounded bg-rose-950/80 border border-rose-500/50 text-[10px] font-mono font-bold text-rose-300">
              <AlertTriangle className="w-3 h-3 text-rose-400 animate-bounce" />
              <span>OVERRIDE</span>
            </div>
          )}
        </div>

        {/* 4 Mode Buttons */}
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2 font-mono">
          {modes.map((mode) => {
            const Icon = mode.icon;
            const isSelected = currentRole === mode.id;

            return (
              <button
                key={mode.id}
                onClick={() => onSelectRole(mode.id)}
                className={`flex items-center justify-center space-x-1.5 px-2 sm:px-3 py-2 sm:py-2.5 rounded-xl border text-[11px] sm:text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  isSelected
                    ? mode.activeClass
                    : `bg-slate-950/70 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 ${mode.borderClass}`
                }`}
                title={`Switch to ${mode.label} Mode`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-slate-400'}`} />
                <span className="hidden md:inline">{mode.label}</span>
                <span className="md:hidden">{mode.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Desktop Active Override Badge */}
        {(isManualOverrideActive || isMissionPaused) && (
          <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-rose-950/80 border border-rose-500/50 text-[11px] font-mono font-bold text-rose-300">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
            <span>{isManualOverrideActive ? 'MANUAL OVERRIDE ACTIVE' : 'MISSION PAUSED'}</span>
          </div>
        )}
      </div>
    </div>
  );
};
