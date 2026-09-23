import React from 'react';
import { Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { MissionState } from '../../types/mission';

interface MissionTimerProps {
  remainingSeconds: number;
  elapsedSeconds: number;
  missionState: MissionState;
  className?: string;
  compact?: boolean;
}

export const MissionTimer: React.FC<MissionTimerProps> = ({
  remainingSeconds,
  elapsedSeconds,
  missionState,
  className = '',
  compact = false
}) => {
  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const isCritical = remainingSeconds <= 45 && remainingSeconds > 0;
  const isWarning = remainingSeconds > 45 && remainingSeconds <= 90;
  const isExpired = remainingSeconds === 0;
  const isComplete = missionState === 'MISSION_COMPLETE';

  // Dynamic status styling
  let timerColor = 'text-sky-400 border-sky-500/30 bg-sky-950/20';
  let pulseClass = '';

  if (isComplete) {
    timerColor = 'text-emerald-400 border-emerald-500/40 bg-emerald-950/30';
  } else if (isExpired) {
    timerColor = 'text-rose-500 border-rose-500/60 bg-rose-950/40 animate-pulse';
  } else if (isCritical) {
    timerColor = 'text-rose-400 border-rose-500/50 bg-rose-950/30 animate-pulse-fast';
    pulseClass = 'animate-pulse';
  } else if (isWarning) {
    timerColor = 'text-amber-400 border-amber-500/40 bg-amber-950/20';
  }

  if (compact) {
    return (
      <div className={`flex items-center space-x-2 font-mono px-3 py-1.5 rounded border ${timerColor} ${className}`}>
        <Clock className={`w-3.5 h-3.5 ${pulseClass}`} />
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold text-slate-400">MISSION TIME</span>
          <span className="text-base font-extrabold tracking-wider leading-none">
            {formatTime(remainingSeconds)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-3 sm:p-4 rounded-xl border backdrop-blur-md font-mono ${timerColor} ${className}`}>
      <div className="flex items-center justify-between pb-1.5 border-b border-slate-700/50 mb-2">
        <div className="flex items-center space-x-1.5">
          <Clock className={`w-4 h-4 ${pulseClass}`} />
          <span className="text-xs uppercase font-extrabold tracking-wider text-slate-300">
            3-MINUTE MISSION TIMER
          </span>
        </div>
        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
          MAX 180s
        </span>
      </div>

      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">
            REMAINING TIME
          </div>
          <div className="text-3xl sm:text-4xl md:text-5xl font-black tracking-widest leading-none">
            {formatTime(remainingSeconds)}
          </div>
        </div>

        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">
            ELAPSED
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-300">
            +{formatTime(elapsedSeconds)}
          </div>
        </div>
      </div>

      {/* Progress Bar of the 3-minute window */}
      <div className="w-full bg-slate-800/80 h-2 rounded-full overflow-hidden mt-3 border border-slate-700/50">
        <div
          className={`h-full transition-all duration-1000 ${
            isCritical
              ? 'bg-rose-500'
              : isWarning
              ? 'bg-amber-500'
              : isComplete
              ? 'bg-emerald-500'
              : 'bg-sky-500'
          }`}
          style={{ width: `${(remainingSeconds / 180) * 100}%` }}
        />
      </div>

      {/* Dynamic Warning Alert banner */}
      {isCritical && !isComplete && (
        <div className="mt-2.5 flex items-center space-x-1.5 text-rose-300 text-xs font-bold animate-pulse">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
          <span>CRITICAL: Approaching 3-minute mission limit! Safe RTL standby.</span>
        </div>
      )}
      {isComplete && (
        <div className="mt-2.5 flex items-center space-x-1.5 text-emerald-300 text-xs font-bold">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>MISSION COMPLETED WITHIN TIME WINDOW</span>
        </div>
      )}
    </div>
  );
};
