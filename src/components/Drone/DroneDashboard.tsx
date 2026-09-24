import React, { useState, useEffect } from 'react';
import { DroneTelemetry, DecodedQRData, MissionState } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { visionService } from '../../services/visionService';
import { CameraVisionHUD } from './CameraVisionHUD';
import { QRResultCard } from './QRResultCard';
import { 
  Camera, 
  Wifi, 
  Plane, 
  CheckCircle2, 
  AlertTriangle, 
  Radio, 
  Sparkles,
  ShieldCheck,
  Battery
} from 'lucide-react';

interface DroneDashboardProps {
  telemetry: DroneTelemetry;
  missionState: MissionState;
  remainingSeconds: number;
  elapsedSeconds: number;
  decodedQR: DecodedQRData | null;
  pixhawkState: PixhawkConnectionState;
  runnerLink: RunnerLinkState;
  runnerAckReceived: boolean;
  runnerAckLatencyMs?: number;
  onQRDetected: (data: DecodedQRData) => void;
  onEmergencyRTL: () => void;
}

export const DroneDashboard: React.FC<DroneDashboardProps> = ({
  telemetry,
  missionState,
  remainingSeconds,
  elapsedSeconds,
  decodedQR,
  pixhawkState,
  runnerLink,
  runnerAckReceived,
  runnerAckLatencyMs,
  onQRDetected,
  onEmergencyRTL
}) => {
  const [cameraState, setCameraState] = useState<any>(visionService.getCameraState());

  useEffect(() => {
    const unsub = visionService.subscribeCameraState((s) => {
      setCameraState(s);
    });
    return () => {
      unsub();
    };
  }, []);

  const isNetworkConnected = 
    pixhawkState.isConnected || 
    runnerLink.isConnected || 
    (typeof navigator !== 'undefined' && navigator.onLine);

  const isDroneConnected = 
    pixhawkState.isConnected || 
    telemetry.pixhawkConnected || 
    pixhawkState.isUsbConnected;

  const isCameraLive = cameraState.isActive;

  return (
    <div className="p-3 sm:p-5 max-w-5xl mx-auto space-y-4 font-mono select-none flex flex-col min-h-[calc(100vh-110px)]">
      {/* 1. CLEAN HEADER: DRONE CAMERA */}
      <div className="bg-slate-900/90 px-4 py-3 rounded-xl border border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-amber-950/80 border border-amber-500/40 text-amber-400">
            <Camera className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black text-white tracking-wide uppercase">
              DRONE CAMERA
            </h1>
            <p className="text-[11px] text-slate-400 font-medium">
              Continuous Live Video Stream &amp; Autonomous QR Engine
            </p>
          </div>
        </div>

        {/* Streaming & Detection Status */}
        <div className="flex items-center space-x-2">
          {decodedQR && decodedQR.isValidTwoDigit && (
            <div className="hidden sm:flex items-center space-x-1 px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 text-xs font-bold animate-pulse">
              <Sparkles className="w-3.5 h-3.5" />
              <span>QR: [{decodedQR.code}]</span>
            </div>
          )}

          <div
            className={`px-2.5 py-1 rounded text-[11px] font-black border flex items-center space-x-1.5 ${
              isCameraLive
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${isCameraLive ? 'bg-emerald-400 animate-ping' : 'bg-rose-500'}`}
              style={{ animationDuration: '2s' }}
            />
            <span>STREAM: {isCameraLive ? 'LIVE' : 'OFF'}</span>
          </div>
        </div>
      </div>

      {/* 2. MAIN CENTER: LIVE CAMERA FULL-VIEW */}
      <div className="flex-1 relative rounded-2xl overflow-hidden border border-slate-800 bg-black min-h-[380px] sm:min-h-[460px] flex flex-col">
        <CameraVisionHUD
          onQRDetected={onQRDetected}
          isScanning={true}
          decodedQR={decodedQR}
          telemetry={telemetry}
          className="w-full h-full flex-1"
        />

        {/* QR Confirmation Modal Card */}
        {decodedQR && decodedQR.isValidTwoDigit && (
          <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:max-w-md z-30">
            <QRResultCard
              decodedQR={decodedQR}
              missionState={missionState}
              runnerLink={runnerLink}
              runnerAckReceived={runnerAckReceived}
              runnerAckLatencyMs={runnerAckLatencyMs}
            />
          </div>
        )}
      </div>

      {/* 3. CLEAN BOTTOM STATUS PANEL (SECTION 4 REQUIREMENT) */}
      {/* ┌─────────────────────────┐
          │ Camera: LIVE            │
          │ Network: CONNECTED      │
          │ Drone: CONNECTED        │
          └─────────────────────────┘ */}
      <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Status 1: Camera */}
          <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <Camera className={`w-4 h-4 ${isCameraLive ? 'text-emerald-400' : 'text-slate-500'}`} />
              <span className="text-xs text-slate-300 font-bold uppercase">Camera:</span>
            </div>
            <span
              className={`text-xs font-black px-2 py-0.5 rounded border ${
                isCameraLive
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                  : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
              }`}
            >
              {isCameraLive ? 'LIVE' : 'DISCONNECTED'}
            </span>
          </div>

          {/* Status 2: Network */}
          <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <Wifi className={`w-4 h-4 ${isNetworkConnected ? 'text-sky-400' : 'text-slate-500'}`} />
              <span className="text-xs text-slate-300 font-bold uppercase">Network:</span>
            </div>
            <span
              className={`text-xs font-black px-2 py-0.5 rounded border ${
                isNetworkConnected
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                  : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
              }`}
            >
              {isNetworkConnected ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>

          {/* Status 3: Drone */}
          <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <Plane className={`w-4 h-4 ${isDroneConnected ? 'text-amber-400' : 'text-slate-500'}`} />
              <span className="text-xs text-slate-300 font-bold uppercase">Drone:</span>
            </div>
            <span
              className={`text-xs font-black px-2 py-0.5 rounded border ${
                isDroneConnected
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                  : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
              }`}
            >
              {isDroneConnected ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>
        </div>

        {/* Secondary Telemetry Strip */}
        <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <div className="flex items-center space-x-3">
            <span>Battery: <strong className="text-slate-200">{telemetry.batteryPercent}% ({telemetry.batteryVoltage}V)</strong></span>
            <span>Alt: <strong className="text-slate-200">{telemetry.altitude.toFixed(1)}m</strong></span>
          </div>
          <div className="flex items-center space-x-2">
            <span>Runner ACK: <strong className={runnerAckReceived ? 'text-emerald-400' : 'text-slate-400'}>{runnerAckReceived ? `CONFIRMED (${runnerAckLatencyMs}ms)` : 'WAITING'}</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
};
