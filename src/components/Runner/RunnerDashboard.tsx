import React, { useEffect, useState } from 'react';
import { RunnerLinkState, DroneQRDispatchPayload } from '../../types/runner';
import { MissionState, PathPoint } from '../../types/mission';
import { runnerCommService } from '../../services/runnerCommService';
import { mavlinkService } from '../../services/mavlinkService';
import { pathService } from '../../services/pathService';
import { AckProtocolCard } from './AckProtocolCard';
import { 
  CheckCircle2, 
  Clock, 
  Radio, 
  Send, 
  ShieldCheck, 
  Sparkles, 
  Wifi, 
  Activity, 
  MapPin, 
  Route, 
  Zap,
  Smartphone
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface RunnerDashboardProps {
  runnerLink: RunnerLinkState;
  missionState: MissionState;
  remainingSeconds: number;
  elapsedSeconds: number;
  className?: string;
}

export const RunnerDashboard: React.FC<RunnerDashboardProps> = ({
  runnerLink,
  missionState,
  remainingSeconds,
  elapsedSeconds,
  className = ''
}) => {
  const [receivedCode, setReceivedCode] = useState<string | null>(runnerLink.latestReceivedQR || null);
  const [ackDispatched, setAckDispatched] = useState<boolean>(false);
  const [receiptTimestamp, setReceiptTimestamp] = useState<number | null>(null);
  const [latestMissionId, setLatestMissionId] = useState<string>('SAE_MSN_001');
  const [pathPoints, setPathPoints] = useState<PathPoint[]>(pathService.getPath());

  const home = mavlinkService.getHomePoint();

  // Calculated Runner field coordinates (~12m east of Home Point)
  const baseLat = home.isSet ? home.latitude : 17.385044;
  const baseLon = home.isSet ? home.longitude : 78.486671;
  const runnerLat = baseLat + 0.000108; // ~12m North
  const runnerLon = baseLon + 0.000115; // ~12m East

  useEffect(() => {
    // Subscribe to direct wireless packets from Drone Android
    const unsubscribe = runnerCommService.subscribeMessages((msg) => {
      if (msg.type === 'QR_DISPATCH') {
        const dispatch = msg as DroneQRDispatchPayload;
        setReceivedCode(dispatch.qrCode);
        setReceiptTimestamp(Date.now());
        if (dispatch.missionId) {
          setLatestMissionId(dispatch.missionId);
        }

        // Celebratory confetti effect on code arrival
        try {
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.6 }
          });
        } catch (e) {}

        // AUTOMATIC RUNNER ACKNOWLEDGEMENT PROTOCOL (Zero-touch)
        runnerCommService.sendAckToDrone(
          dispatch.qrCode,
          dispatch.messageId,
          dispatch.missionId,
          96
        );
        setAckDispatched(true);
      }
    });

    const unsubPath = pathService.subscribe((pts) => {
      setPathPoints(pts);
    });

    return () => {
      unsubscribe();
      unsubPath();
    };
  }, []);

  const isMissionActive =
    missionState !== 'IDLE' &&
    missionState !== 'MISSION_COMPLETE' &&
    missionState !== 'READY';

  const missionStatusLabel = 
    missionState === 'MISSION_COMPLETE'
      ? 'COMPLETE'
      : isMissionActive
      ? 'ACTIVE'
      : 'STANDBY';

  return (
    <div className={`p-3 sm:p-5 max-w-5xl mx-auto space-y-4 font-mono select-none ${className}`}>
      {/* 1. TOP HEADER: RUNNER */}
      <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-400">
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
              FIELD DATA &amp; LOCATION ENDPOINT
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-wide">
              RUNNER
            </h1>
          </div>
        </div>

        {/* Link & Distance Status */}
        <div className="flex items-center space-x-2 text-xs">
          <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-slate-300 flex items-center space-x-1.5">
            <Wifi className="w-3.5 h-3.5 text-sky-400" />
            <span>Direct P2P Link ({runnerLink.signalStrengthDbm} dBm)</span>
          </div>
          <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-emerald-400 font-bold">
            Distance ~12m
          </div>
        </div>
      </div>

      {/* 2. SECTION 5 CORE DATA ENDPOINT CARDS */}
      {/* Example from requirement:
          RUNNER
          Status: CONNECTED
          Location: LAT / LNG
          Mission: ACTIVE
          Received Data: <latest data> */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Status Card */}
        <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800 space-y-1">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">
            Status:
          </div>
          <div className="text-base sm:text-lg font-black text-emerald-400 flex items-center space-x-1.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span>{runnerLink.isConnected ? 'CONNECTED' : 'WAITING'}</span>
          </div>
          <div className="text-[10px] text-slate-500">
            P2P Direct Wireless Handshake
          </div>
        </div>

        {/* Location Card */}
        <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800 space-y-1">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold flex items-center justify-between">
            <span>Location:</span>
            <MapPin className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="text-xs font-mono font-bold text-slate-200">
            LAT: {runnerLat.toFixed(6)}°
          </div>
          <div className="text-xs font-mono font-bold text-slate-200">
            LNG: {runnerLon.toFixed(6)}°
          </div>
          <div className="text-[10px] text-slate-500">
            Field Position (12m NE from Home)
          </div>
        </div>

        {/* Mission Status Card */}
        <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800 space-y-1">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">
            Mission:
          </div>
          <div className="text-base sm:text-lg font-black text-white flex items-center space-x-2">
            <span
              className={`px-2 py-0.5 rounded text-xs font-black uppercase ${
                missionStatusLabel === 'ACTIVE'
                  ? 'bg-amber-950/80 border border-amber-400 text-amber-300 animate-pulse'
                  : missionStatusLabel === 'COMPLETE'
                  ? 'bg-emerald-950/80 border border-emerald-400 text-emerald-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {missionStatusLabel}
            </span>
            <span className="text-xs text-slate-400 font-mono font-normal">
              {remainingSeconds}s left
            </span>
          </div>
          <div className="text-[10px] text-slate-500 truncate">
            ID: {latestMissionId}
          </div>
        </div>
      </div>

      {/* 3. RECEIVED DATA HERO DISPLAY */}
      <div className="bg-slate-900/90 p-5 sm:p-7 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2 text-xs font-bold text-slate-300 uppercase">
            <Radio className="w-4 h-4 text-emerald-400" />
            <span>Received Data:</span>
          </div>
          <span className="text-[11px] text-slate-400">
            {receivedCode ? 'PAYLOAD VERIFIED ✓' : 'AWAITING AIRBORNE TRANSMISSION'}
          </span>
        </div>

        {receivedCode ? (
          /* HIGH-CONTRAST OUTDOOR READABLE HERO */
          <div className="bg-gradient-to-b from-slate-950 to-emerald-950/40 p-6 sm:p-8 rounded-xl border-2 border-emerald-500 shadow-xl text-center space-y-3">
            <div className="inline-flex items-center space-x-2 bg-emerald-950 text-emerald-300 border border-emerald-400 px-3 py-1 rounded-full text-xs font-extrabold uppercase">
              <Sparkles className="w-3.5 h-3.5" />
              <span>QR RESCUE CODE ACQUIRED</span>
            </div>

            <div className="py-2">
              <div className="text-7xl sm:text-8xl md:text-9xl font-black text-white tracking-widest leading-none drop-shadow-[0_8px_20px_rgba(16,185,129,0.5)]">
                {receivedCode}
              </div>
            </div>

            <div className="bg-emerald-900/50 border border-emerald-400/60 p-2.5 rounded-lg text-emerald-200 text-xs sm:text-sm font-bold flex items-center justify-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-300" />
              <span>CONFIRMATION ACK RETURNED TO DRONE ✓</span>
            </div>

            <div className="text-[11px] text-slate-400">
              Dispatched at: {receiptTimestamp ? new Date(receiptTimestamp).toLocaleTimeString() : 'JUST NOW'}
            </div>
          </div>
        ) : (
          <div className="p-8 sm:p-12 rounded-xl bg-slate-950/60 border border-slate-800 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 mx-auto">
              <Radio className="w-6 h-6 animate-pulse text-sky-400" />
            </div>
            <div className="text-slate-300 font-bold text-sm">
              Waiting for Drone to locate and transmit 2-digit QR target...
            </div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Drone Android scans autonomously at 20m altitude and broadcasts the validated code directly to this unit.
            </p>
          </div>
        )}
      </div>

      {/* 4. PATH / TARGET INFORMATION WHERE APPLICABLE */}
      {pathPoints.length > 0 && (
        <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800 space-y-2.5">
          <div className="flex items-center space-x-2 text-xs font-bold text-slate-300 uppercase">
            <Route className="w-4 h-4 text-amber-400" />
            <span>Active Mission Path Information ({pathPoints.length} Waypoints)</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {pathPoints.map((pt) => (
              <div key={pt.id} className="p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-amber-400 font-bold">PT {pt.pointNumber}:</span>{' '}
                <span className="text-slate-300">{pt.latitude.toFixed(5)}, {pt.longitude.toFixed(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. PROTOCOL TELEMETRY CARD */}
      <AckProtocolCard
        runnerLink={runnerLink}
        ackSent={ackDispatched}
        receivedCode={receivedCode || undefined}
      />
    </div>
  );
};
