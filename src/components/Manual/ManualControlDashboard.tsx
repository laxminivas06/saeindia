import React, { useState, useEffect } from 'react';
import { DroneTelemetry, HomePoint, MissionState, PathPoint } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { mavlinkService } from '../../services/mavlinkService';
import { missionEngine } from '../../services/missionEngine';
import { pathService } from '../../services/pathService';
import { TacticalMap } from '../GroundStation/TacticalMap';
import { TelemetryHUD } from '../common/TelemetryHUD';
import { 
  Sliders, 
  AlertTriangle, 
  Play, 
  Pause, 
  RotateCcw, 
  MapPin, 
  Trash2, 
  Plus, 
  ShieldAlert, 
  Navigation, 
  ArrowUp, 
  ArrowDown, 
  ArrowLeft, 
  ArrowRight, 
  Compass, 
  Layers, 
  Power, 
  PowerOff, 
  Route, 
  CheckCircle2, 
  Crosshair,
  ShieldCheck,
  Zap
} from 'lucide-react';

interface ManualControlDashboardProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  pixhawkState: PixhawkConnectionState;
  missionState: MissionState;
}

export const ManualControlDashboard: React.FC<ManualControlDashboardProps> = ({
  telemetry,
  homePoint,
  pixhawkState,
  missionState
}) => {
  const [pathPoints, setPathPoints] = useState<PathPoint[]>(pathService.getPath());
  const [isPathActive, setIsPathActive] = useState<boolean>(pathService.isPathActive());
  const [isManualOverride, setIsManualOverride] = useState<boolean>(missionEngine.isManualOverride());
  const [isMissionPaused, setIsMissionPaused] = useState<boolean>(missionEngine.isMissionPaused());
  const [lastAction, setLastAction] = useState<string>('MANUAL STANDBY');
  const [isArming, setIsArming] = useState<boolean>(false);
  const [isDisarming, setIsDisarming] = useState<boolean>(false);
  const [armFeedback, setArmFeedback] = useState<string | null>(null);

  // Activate manual override priority when in this mode
  useEffect(() => {
    missionEngine.setManualOverride(true);
    setIsManualOverride(true);
    setIsMissionPaused(missionEngine.isMissionPaused());

    const unsubPath = pathService.subscribe((pts, active) => {
      setPathPoints(pts);
      setIsPathActive(active);
    });

    return () => {
      unsubPath();
    };
  }, []);

  const handleResumeMission = () => {
    missionEngine.resumeFromManualOverride();
    setIsMissionPaused(false);
    setIsManualOverride(false);
    setLastAction('RESUMED AUTOMATED MISSION');
  };

  const handleAddPointFromMap = (lat: number, lon: number) => {
    pathService.addPoint(lat, lon, 20);
    setLastAction(`ADDED WAYPOINT: ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
  };

  const handleAddCurrentDronePosition = () => {
    if (telemetry.latitude && telemetry.longitude) {
      pathService.addPoint(telemetry.latitude, telemetry.longitude, telemetry.altitude || 20);
      setLastAction(`ADDED CURRENT DRONE POSITION AS WAYPOINT`);
    }
  };

  const handleRemovePoint = (id: string) => {
    pathService.removePoint(id);
    setLastAction(`REMOVED WAYPOINT`);
  };

  const handleClearPath = () => {
    pathService.clearPath();
    setLastAction(`CLEARED GPS ROUTE`);
  };

  // Directional Manual Control Actions (MAVLink prioritized)
  const handleManualDirection = async (direction: 'FORWARD' | 'BACKWARD' | 'LEFT' | 'RIGHT' | 'HOLD') => {
    setLastAction(`MANUAL COMMAND: ${direction}`);
    await mavlinkService.commandManualMove(direction);
  };

  const handleHoldPosition = async () => {
    setLastAction('MANUAL COMMAND: POSITION HOLD (LOITER)');
    await mavlinkService.commandHold();
  };

  const handleEmergencyRTL = async () => {
    setLastAction('MANUAL EMERGENCY RTL INITIATED');
    await mavlinkService.commandRTL();
  };

  // Dedicated Explicit ARM
  const handleArm = async () => {
    if (!pixhawkState.isConnected) {
      setArmFeedback('Flight controller disconnected');
      return;
    }
    setIsArming(true);
    setArmFeedback(null);
    const sent = await mavlinkService.sendArmCommand();
    if (!sent) {
      setIsArming(false);
      setArmFeedback('ARM transmission failed');
    } else {
      setTimeout(() => setIsArming(false), 2000);
    }
  };

  // Dedicated Explicit DISARM
  const handleDisarm = async () => {
    if (!pixhawkState.isConnected) {
      setArmFeedback('Flight controller disconnected');
      return;
    }
    setIsDisarming(true);
    setArmFeedback(null);
    const sent = await mavlinkService.sendDisarmCommand();
    if (!sent) {
      setIsDisarming(false);
      setArmFeedback('DISARM transmission failed');
    } else {
      setTimeout(() => setIsDisarming(false), 2000);
    }
  };

  const boundary = pathService.getBoundary();

  return (
    <div className="p-3 sm:p-5 max-w-7xl mx-auto space-y-4 sm:space-y-5 font-mono select-none">
      {/* 1. TOP PROMINENT MANUAL OVERRIDE WARNING BANNER */}
      <div className="bg-gradient-to-r from-rose-950 via-slate-900 to-rose-950 p-4 rounded-xl border-2 border-rose-500 shadow-xl shadow-rose-950/40 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-rose-900/60 border border-rose-400 flex items-center justify-center text-rose-300 shrink-0 shadow-lg">
            <AlertTriangle className="w-6 h-6 animate-bounce" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-base sm:text-lg font-black text-white tracking-wider uppercase">
                MANUAL OVERRIDE ACTIVE
              </span>
              <span className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black uppercase">
                PRIORITY: 1
              </span>
            </div>
            <p className="text-xs text-rose-200/90 font-medium">
              Operator manual inputs override automated navigation. Automated movement commands are suppressed.
            </p>
          </div>
        </div>

        {/* Priority Chain & Mission Resume */}
        <div className="flex flex-wrap items-center gap-2">
          {isMissionPaused && (
            <button
              onClick={handleResumeMission}
              className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-black text-xs uppercase flex items-center space-x-1.5 transition shadow-lg shadow-emerald-600/30 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>RESUME MISSION</span>
            </button>
          )}

          <div className="bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800 text-[10px] text-slate-300">
            <span className="text-slate-400">PRIORITY HIERARCHY:</span>{' '}
            <strong className="text-rose-400">MANUAL</strong> &gt;{' '}
            <span className="text-amber-400">AUTO MISSION</span> &gt;{' '}
            <span className="text-emerald-400">RUNNER</span>
          </div>
        </div>
      </div>

      {/* 2. MAIN 2-COLUMN GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: GPS Map & Path Planning Area (lg: 7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Interactive Map with Path Route Display */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Route className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  GPS MAP &amp; PATH PLANNING
                </span>
              </div>

              {/* Path Active Badge */}
              <span
                className={`px-2.5 py-1 rounded text-[11px] font-extrabold border flex items-center space-x-1 ${
                  isPathActive
                    ? 'bg-amber-950/80 border-amber-500/60 text-amber-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                <span>{isPathActive ? 'PATH ACTIVE' : 'NO PATH'}</span>
                <span className="text-slate-500">•</span>
                <span>{pathPoints.length} Points</span>
              </span>
            </div>

            <TacticalMap
              telemetry={telemetry}
              homePoint={homePoint}
              interactive={true}
              onMapClick={handleAddPointFromMap}
              className="h-[360px] sm:h-[400px]"
            />
          </div>

          {/* Path Planning Controls & Point List */}
          <div className="bg-slate-900/90 p-3 sm:p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div className="text-xs font-bold text-slate-300 uppercase flex items-center space-x-1.5">
                <MapPin className="w-3.5 h-3.5 text-sky-400" />
                <span>WAYPOINT ROUTE LIST ({pathPoints.length})</span>
              </div>

              <div className="flex items-center space-x-1.5 text-xs">
                <button
                  onClick={handleAddCurrentDronePosition}
                  className="px-2.5 py-1.5 rounded-lg bg-sky-950/80 hover:bg-sky-900 text-sky-300 border border-sky-600/40 text-[11px] font-bold flex items-center space-x-1 transition cursor-pointer"
                  title="Add drone's current GPS as a point"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Drone Pos</span>
                </button>

                <button
                  onClick={handleClearPath}
                  disabled={pathPoints.length === 0}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/80 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-600/50 text-[11px] font-bold flex items-center space-x-1 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Route</span>
                </button>
              </div>
            </div>

            {/* Path Constraint Notice */}
            <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 flex items-start space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                <strong>Operating Area Constraint:</strong>{' '}
                {isPathActive
                  ? 'Autonomous flight is strictly constrained inside the defined path boundary with 15m safety corridor.'
                  : 'No path defined. Drone operates in standard mission corridor.'}
              </span>
            </div>

            {/* Scrollable Waypoints List */}
            {pathPoints.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 font-mono space-y-1">
                <p>No GPS path created yet.</p>
                <p className="text-[11px] text-slate-600">
                  Tap or click anywhere on the tactical map above to add sequential GPS waypoints.
                </p>
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 text-xs">
                {pathPoints.map((pt, idx) => {
                  const isStart = idx === 0;
                  const isEnd = idx === pathPoints.length - 1;
                  return (
                    <div
                      key={pt.id}
                      className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between text-slate-300"
                    >
                      <div className="flex items-center space-x-2">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                            isStart
                              ? 'bg-emerald-600 text-white'
                              : isEnd
                              ? 'bg-rose-600 text-white'
                              : 'bg-amber-600 text-slate-900'
                          }`}
                        >
                          {pt.pointNumber}
                        </span>

                        <div className="font-mono text-[11px]">
                          <span className="font-bold text-slate-200">
                            POINT {pt.pointNumber}
                          </span>
                          {isStart && <span className="text-emerald-400 ml-1.5 font-black">[START]</span>}
                          {isEnd && <span className="text-rose-400 ml-1.5 font-black">[END]</span>}
                          <div className="text-[10px] text-slate-400">
                            Lat: {pt.latitude.toFixed(6)} • Lon: {pt.longitude.toFixed(6)}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleRemovePoint(pt.id)}
                        className="p-1 text-slate-500 hover:text-rose-400 transition"
                        title="Remove Point"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Directional Manual Flight Controls & Telemetry (lg: 5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Real-time Telemetry HUD */}
          <TelemetryHUD telemetry={telemetry} />

          {/* MANUAL FLIGHT CONTROL DIRECTIONAL PAD */}
          <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-slate-200 uppercase flex items-center space-x-1.5">
                <Navigation className="w-4 h-4 text-rose-400" />
                <span>MANUAL FLIGHT CONTROLS</span>
              </span>
              <span className="text-[10px] text-rose-400 font-bold">OPERATOR OVERRIDE</span>
            </div>

            {/* Directional D-Pad (Touch-friendly large buttons) */}
            <div className="flex flex-col items-center justify-center space-y-2 py-2">
              {/* Forward */}
              <button
                onClick={() => handleManualDirection('FORWARD')}
                className="w-20 h-14 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-sky-600 border border-slate-700 active:border-sky-400 flex flex-col items-center justify-center space-y-0.5 text-slate-200 active:text-white transition shadow cursor-pointer"
                title="Pitch Forward"
              >
                <ArrowUp className="w-5 h-5 text-sky-400" />
                <span className="text-[10px] font-black uppercase">FWD</span>
              </button>

              {/* Left / Hold / Right */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleManualDirection('LEFT')}
                  className="w-20 h-14 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-sky-600 border border-slate-700 active:border-sky-400 flex flex-col items-center justify-center space-y-0.5 text-slate-200 active:text-white transition shadow cursor-pointer"
                  title="Roll Left"
                >
                  <ArrowLeft className="w-5 h-5 text-sky-400" />
                  <span className="text-[10px] font-black uppercase">LEFT</span>
                </button>

                <button
                  onClick={handleHoldPosition}
                  className="w-20 h-14 rounded-xl bg-rose-950/80 hover:bg-rose-900 active:bg-rose-700 border-2 border-rose-500/80 text-rose-200 active:text-white flex flex-col items-center justify-center space-y-0.5 transition shadow-lg cursor-pointer"
                  title="Position Hold (LOITER)"
                >
                  <Pause className="w-5 h-5 text-rose-400 fill-current" />
                  <span className="text-[10px] font-black uppercase">HOLD</span>
                </button>

                <button
                  onClick={() => handleManualDirection('RIGHT')}
                  className="w-20 h-14 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-sky-600 border border-slate-700 active:border-sky-400 flex flex-col items-center justify-center space-y-0.5 text-slate-200 active:text-white transition shadow cursor-pointer"
                  title="Roll Right"
                >
                  <ArrowRight className="w-5 h-5 text-sky-400" />
                  <span className="text-[10px] font-black uppercase">RIGHT</span>
                </button>
              </div>

              {/* Backward */}
              <button
                onClick={() => handleManualDirection('BACKWARD')}
                className="w-20 h-14 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-sky-600 border border-slate-700 active:border-sky-400 flex flex-col items-center justify-center space-y-0.5 text-slate-200 active:text-white transition shadow cursor-pointer"
                title="Pitch Backward"
              >
                <ArrowDown className="w-5 h-5 text-sky-400" />
                <span className="text-[10px] font-black uppercase">BACK</span>
              </button>
            </div>

            {/* Emergency Actions */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={handleHoldPosition}
                className="py-3 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition"
              >
                <Pause className="w-4 h-4 text-amber-400" />
                <span>LOITER HOLD</span>
              </button>

              <button
                onClick={handleEmergencyRTL}
                className="py-3 px-2 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center space-x-1.5 shadow-lg shadow-rose-600/30 transition cursor-pointer"
              >
                <ShieldAlert className="w-4 h-4" />
                <span>MANUAL RTL</span>
              </button>
            </div>
          </div>

          {/* EXPLICIT TOUCH-SAFE ARM / DISARM PANEL (Does NOT auto-ARM on entering Manual) */}
          <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase flex items-center space-x-1.5">
                <Power className="w-4 h-4 text-amber-400" />
                <span>MOTOR ARM / DISARM SAFETY</span>
              </span>
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded border ${
                  telemetry.isArmed
                    ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {telemetry.isArmed ? 'ARMED' : 'DISARMED'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleArm}
                disabled={telemetry.isArmed || isArming}
                className={`py-3 px-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center space-x-1.5 transition ${
                  !telemetry.isArmed && !isArming
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 cursor-pointer'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                }`}
              >
                <Power className="w-4 h-4" />
                <span>{isArming ? 'ARMING...' : 'ARM MOTORS'}</span>
              </button>

              <button
                onClick={handleDisarm}
                disabled={!telemetry.isArmed || isDisarming}
                className={`py-3 px-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center space-x-1.5 transition ${
                  telemetry.isArmed && !isDisarming
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 cursor-pointer'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                }`}
              >
                <PowerOff className="w-4 h-4" />
                <span>{isDisarming ? 'DISARMING...' : 'DISARM MOTORS'}</span>
              </button>
            </div>

            {armFeedback && (
              <p className="text-xs text-rose-400 text-center">{armFeedback}</p>
            )}

            <div className="text-[10px] text-slate-500 leading-tight">
              Safety rule: Manual mode does not auto-arm or auto-disarm. ARM and DISARM are explicit operator actions.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
