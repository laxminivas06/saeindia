import React, { useState, useEffect } from 'react';
import { Monitor, Smartphone, Wifi, Radio, Video, CheckCircle2, AlertCircle } from 'lucide-react';
import { phoneGpsService, PhoneGpsState } from '../../services/phoneGpsService';
import { ipCameraService, IpCameraStatus } from '../../services/ipCameraService';
import { PixhawkConnectionState } from '../../types/mavlink';

interface IndependentConnectionStatusBarProps {
  pixhawkState: PixhawkConnectionState;
  onOpenConnectionModal?: () => void;
  className?: string;
}

export const IndependentConnectionStatusBar: React.FC<IndependentConnectionStatusBarProps> = ({
  pixhawkState,
  onOpenConnectionModal,
  className = ''
}) => {
  const [phoneGps, setPhoneGps] = useState<PhoneGpsState>(() => phoneGpsService.getState());
  const [cameraStatus, setCameraStatus] = useState<IpCameraStatus>(() => ipCameraService.getStatus());
  const [isCameraOn, setIsCameraOn] = useState<boolean>(() => ipCameraService.isIpCameraEnabled());

  useEffect(() => {
    const unsubGps = phoneGpsService.subscribe(setPhoneGps);
    const unsubCam = ipCameraService.subscribeStatus(setCameraStatus);
    const unsubToggle = ipCameraService.subscribeToggle(setIsCameraOn);
    return () => {
      unsubGps();
      unsubCam();
      unsubToggle();
    };
  }, []);

  const isEsp32Connected =
    pixhawkState.isUsbConnected ||
    (pixhawkState.connectionType === 'ESP32_WEBSOCKET' && pixhawkState.isConnected);

  const isPixhawkConnected = pixhawkState.isConnected;

  return (
    <div
      className={`bg-slate-950/95 border border-slate-800 rounded-xl px-3 py-2 text-[11px] font-mono select-none flex flex-wrap items-center justify-between gap-2 shadow-lg ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* 1. GROUND STATION (Client SPA - Always Ready) */}
        <div className="flex items-center space-x-1.5 px-2 py-1 rounded bg-slate-900 border border-slate-800">
          <Monitor className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[10px] text-slate-400 font-bold uppercase">GROUND STATION</span>
          <span className="flex items-center space-x-1 text-emerald-400 font-black">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
            <span>Ready</span>
          </span>
        </div>

        {/* 2. PHONE GPS (Local Browser Geolocation - Clickable to toggle) */}
        <div
          onClick={() => {
            if (phoneGps.status === 'CONNECTED' || phoneGps.status === 'WAITING_FOR_LOCATION') {
              phoneGpsService.stopWatching();
            } else {
              phoneGpsService.startWatching();
            }
          }}
          title="Phone GPS Location. Click to toggle tracking."
          className={`flex items-center space-x-1.5 px-2 py-1 rounded border cursor-pointer transition hover:scale-105 ${
            phoneGps.status === 'CONNECTED'
              ? 'bg-cyan-950/40 border-cyan-500/40 text-cyan-300 hover:border-cyan-400'
              : phoneGps.status === 'WAITING_FOR_LOCATION'
              ? 'bg-amber-950/40 border-amber-500/40 text-amber-300 animate-pulse hover:border-amber-400'
              : phoneGps.status === 'PERMISSION_DENIED'
              ? 'bg-rose-950/40 border-rose-500/40 text-rose-300 hover:border-rose-400'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[10px] text-slate-400 font-bold uppercase">PHONE GPS</span>
          <span className="flex items-center space-x-1 font-black">
            <span
              className={`w-2 h-2 rounded-full ${
                phoneGps.status === 'CONNECTED'
                  ? 'bg-cyan-400 animate-pulse'
                  : phoneGps.status === 'WAITING_FOR_LOCATION'
                  ? 'bg-amber-400'
                  : phoneGps.status === 'PERMISSION_DENIED'
                  ? 'bg-rose-400'
                  : 'bg-slate-500'
              }`}
            />
            <span>
              {phoneGps.status === 'CONNECTED'
                ? 'Connected'
                : phoneGps.status === 'WAITING_FOR_LOCATION'
                ? 'Waiting'
                : phoneGps.status === 'PERMISSION_DENIED'
                ? 'Denied'
                : 'Off'}
            </span>
          </span>
        </div>

        {/* 3. ESP32 (Persistent Wireless / Bridge Link - Clickable to open connection modal) */}
        <div
          onClick={onOpenConnectionModal}
          title="ESP32 Wireless Bridge. Click to connect or configure."
          className={`flex items-center space-x-1.5 px-2 py-1 rounded border cursor-pointer transition hover:scale-105 ${
            isEsp32Connected
              ? 'bg-purple-950/40 border-purple-500/40 text-purple-300 hover:border-purple-400'
              : pixhawkState.esp32LinkState === 'CONNECTING' || pixhawkState.esp32LinkState === 'RECONNECTING'
              ? 'bg-amber-950/40 border-amber-500/40 text-amber-300 animate-pulse hover:border-amber-400'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600'
          }`}
        >
          <Wifi className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-[10px] text-slate-400 font-bold uppercase">ESP32</span>
          <span className="flex items-center space-x-1 font-black">
            <span
              className={`w-2 h-2 rounded-full ${
                isEsp32Connected
                  ? 'bg-purple-400 shadow-sm shadow-purple-400/50'
                  : pixhawkState.esp32LinkState === 'CONNECTING' || pixhawkState.esp32LinkState === 'RECONNECTING'
                  ? 'bg-amber-400'
                  : 'bg-slate-500'
              }`}
            />
            <span>
              {isEsp32Connected
                ? 'Connected'
                : pixhawkState.esp32LinkState === 'CONNECTING'
                ? 'Connecting'
                : pixhawkState.esp32LinkState === 'RECONNECTING'
                ? 'Reconnecting'
                : 'Disconnected'}
            </span>
          </span>
        </div>

        {/* 4. PIXHAWK (MAVLink Flight Controller - Clickable to open connection modal) */}
        <div
          onClick={onOpenConnectionModal}
          title="Pixhawk MAVLink Controller. Click to connect or configure."
          className={`flex items-center space-x-1.5 px-2 py-1 rounded border cursor-pointer transition hover:scale-105 ${
            isPixhawkConnected
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 hover:border-emerald-400'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600'
          }`}
        >
          <Radio className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-[10px] text-slate-400 font-bold uppercase">PIXHAWK</span>
          <span className="flex items-center space-x-1 font-black">
            <span
              className={`w-2 h-2 rounded-full ${
                isPixhawkConnected
                  ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50'
                  : 'bg-slate-500'
              }`}
            />
            <span>{isPixhawkConnected ? 'Connected' : 'Disconnected'}</span>
          </span>
        </div>

        {/* 5. IP CAMERA (Browser-direct video stream - Clickable to toggle) */}
        <div
          onClick={() => ipCameraService.setIpCameraEnabled(!isCameraOn)}
          title="IP Camera Video Stream. Click to toggle on/off."
          className={`flex items-center space-x-1.5 px-2 py-1 rounded border cursor-pointer transition hover:scale-105 ${
            isCameraOn && cameraStatus === 'LIVE'
              ? 'bg-sky-950/40 border-sky-500/40 text-sky-300 hover:border-sky-400'
              : isCameraOn && cameraStatus === 'CONNECTING'
              ? 'bg-amber-950/40 border-amber-500/40 text-amber-300 animate-pulse hover:border-amber-400'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600'
          }`}
        >
          <Video className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-[10px] text-slate-400 font-bold uppercase">IP CAMERA</span>
          <span className="flex items-center space-x-1 font-black">
            <span
              className={`w-2 h-2 rounded-full ${
                !isCameraOn
                  ? 'bg-slate-500'
                  : cameraStatus === 'LIVE'
                  ? 'bg-sky-400'
                  : 'bg-amber-400'
              }`}
            />
            <span>
              {!isCameraOn
                ? 'Off'
                : cameraStatus === 'LIVE'
                ? 'Live'
                : cameraStatus === 'CONNECTING'
                ? 'Connecting'
                : 'Offline'}
            </span>
          </span>
        </div>
      </div>

      {/* Direct Connect Action Button */}
      {onOpenConnectionModal && (
        <button
          onClick={onOpenConnectionModal}
          className={`px-3 py-1.5 rounded-lg font-bold text-[11px] flex items-center space-x-1.5 shadow-md transition cursor-pointer ${
            isPixhawkConnected
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
              : isEsp32Connected
              ? 'bg-purple-600 hover:bg-purple-500 text-white'
              : 'bg-sky-600 hover:bg-sky-500 text-white animate-pulse'
          }`}
          title="Open Hardware Connection Setup Dialog"
        >
          <Wifi className="w-3.5 h-3.5" />
          <span>{isPixhawkConnected ? 'HARDWARE SETTINGS' : 'CONNECT HARDWARE'}</span>
        </button>
      )}
    </div>
  );
};

export default IndependentConnectionStatusBar;
