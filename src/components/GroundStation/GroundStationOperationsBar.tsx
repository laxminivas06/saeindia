import React, { useState, useEffect } from 'react';
import {
  Video,
  Scan,
  Clock,
  Settings,
  Smartphone,
  Radio,
  Power,
  Play,
  Square,
  ChevronDown,
  Navigation,
  Crosshair,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { IpCameraStatus } from '../../services/ipCameraService';
import { DecodedQRData } from '../../types/mission';
import { phoneGpsService, PhoneGpsState } from '../../services/phoneGpsService';

export type SystemDetectionStatus =
  | 'SYSTEM_READY'
  | 'DETECTING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'MISSION_ACTIVE';

interface GroundStationOperationsBarProps {
  isIpCameraOn: boolean;
  onToggleIpCamera: (on: boolean) => void;
  isScannerOn?: boolean;
  onToggleScanner?: (on: boolean) => void;
  cameraStatus: IpCameraStatus;
  streamUrl: string;
  onUpdateStreamUrl: (url: string) => void;
  detectionStatus?: SystemDetectionStatus;
  elapsedSeconds: number;
  isMissionActive: boolean;
  decodedQR?: DecodedQRData | null;
  boxDetected?: boolean;
  isArmed?: boolean;
  isFcConnected?: boolean;
  isDroneGpsLocked?: boolean;
  droneSatellites?: number;
  isReadyForMission?: boolean;
  onArm?: () => void;
  onDisarm?: () => void;
  onStartMission?: () => void;
  onStopMission?: () => void;
}

export const GroundStationOperationsBar: React.FC<GroundStationOperationsBarProps> = ({
  isIpCameraOn,
  onToggleIpCamera,
  isScannerOn = false,
  onToggleScanner,
  cameraStatus,
  streamUrl,
  onUpdateStreamUrl,
  detectionStatus,
  elapsedSeconds,
  isMissionActive,
  decodedQR,
  boxDetected,
  isArmed = false,
  isFcConnected = false,
  isDroneGpsLocked = false,
  droneSatellites = 0,
  isReadyForMission = false,
  onArm,
  onDisarm,
  onStartMission,
  onStopMission
}) => {
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [urlInput, setUrlInput] = useState(streamUrl);
  const [showPhoneGpsPopup, setShowPhoneGpsPopup] = useState(false);
  const [phoneGps, setPhoneGps] = useState<PhoneGpsState>(() => phoneGpsService.getState());

  useEffect(() => {
    const unsub = phoneGpsService.subscribe(setPhoneGps);
    return () => unsub();
  }, []);

  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSaveUrl = () => {
    if (urlInput.trim()) {
      onUpdateStreamUrl(urlInput.trim());
    }
    setShowUrlModal(false);
  };

  // Phone GPS Status configuration
  const getPhoneGpsBadge = () => {
    switch (phoneGps.status) {
      case 'CONNECTED':
        return {
          label: 'Connected',
          dot: 'bg-emerald-400 animate-pulse',
          badgeClass: 'bg-emerald-950/80 border-emerald-500/70 text-emerald-300',
        };
      case 'WAITING_FOR_LOCATION':
        return {
          label: 'Waiting for Location',
          dot: 'bg-amber-400 animate-ping',
          badgeClass: 'bg-amber-950/80 border-amber-500/70 text-amber-300',
        };
      case 'PERMISSION_DENIED':
        return {
          label: 'Permission Denied',
          dot: 'bg-rose-400',
          badgeClass: 'bg-rose-950/80 border-rose-500/70 text-rose-300',
        };
      case 'DISABLED':
      default:
        return {
          label: 'Disabled',
          dot: 'bg-slate-500',
          badgeClass: 'bg-slate-900 border-slate-700 text-slate-400',
        };
    }
  };

  const phoneBadge = getPhoneGpsBadge();

  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-2.5 sm:p-3.5 shadow-xl font-mono select-none">
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        {/* ============================================================== */}
        {/* LEFT SECTION: PHONE GPS | DRONE GPS | IP CAMERA | TIMER        */}
        {/* ============================================================== */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          {/* 1. PHONE GPS STATUS (Requirement 10) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPhoneGpsPopup(!showPhoneGpsPopup)}
              className={`flex items-center space-x-2 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${phoneBadge.badgeClass}`}
              title="Click to view Phone GPS details and reference controls"
            >
              <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
              <div className="flex items-center space-x-1.5">
                <span className="text-[10px] text-slate-300 uppercase font-black">
                  PHONE GPS:
                </span>
                <span className={`w-2 h-2 rounded-full ${phoneBadge.dot}`} />
                <span className="font-extrabold uppercase text-[10px] tracking-wider">
                  {phoneBadge.label}
                </span>
                {phoneGps.accuracy !== null && (
                  <span className="text-[9px] text-cyan-300/80 hidden xs:inline">
                    (±{phoneGps.accuracy.toFixed(1)}m)
                  </span>
                )}
              </div>
              <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
            </button>

            {/* Quick Phone GPS Popup dropdown */}
            {showPhoneGpsPopup && (
              <div className="absolute top-full left-0 mt-1.5 z-50 w-72 bg-slate-950 border border-slate-700 rounded-xl p-3 shadow-2xl space-y-2 text-xs animate-in fade-in">
                <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <span className="font-black text-cyan-300 uppercase text-[11px] flex items-center space-x-1">
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Phone GPS Details</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => phoneGpsService.toggle()}
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                      phoneGps.enabled
                        ? 'bg-cyan-950 border-cyan-500/50 text-cyan-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    {phoneGps.enabled ? 'Turn OFF' : 'Turn ON'}
                  </button>
                </div>

                <div className="space-y-1 text-[11px] text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Latitude:</span>
                    <span className="font-bold text-slate-200">
                      {phoneGps.latitude ? phoneGps.latitude.toFixed(6) : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Longitude:</span>
                    <span className="font-bold text-slate-200">
                      {phoneGps.longitude ? phoneGps.longitude.toFixed(6) : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Accuracy:</span>
                    <span className="font-bold text-emerald-400">
                      {phoneGps.accuracy ? `±${phoneGps.accuracy.toFixed(1)} m` : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Altitude:</span>
                    <span className="font-bold text-amber-300">
                      {phoneGps.altitude !== null ? `${phoneGps.altitude.toFixed(1)} m` : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Heading:</span>
                    <span className="font-bold text-sky-300">
                      {phoneGps.heading !== null ? `${Math.round(phoneGps.heading)}°` : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Last Update:</span>
                    <span className="font-bold text-slate-400">
                      {phoneGps.lastUpdateTime || '--:--:--'}
                    </span>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      phoneGpsService.centerMapOnPhone();
                      setShowPhoneGpsPopup(false);
                    }}
                    disabled={phoneGps.status !== 'CONNECTED'}
                    className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 flex items-center space-x-1 cursor-pointer disabled:opacity-40"
                  >
                    <Crosshair className="w-3 h-3" />
                    <span>Center Map on Phone</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPhoneGpsPopup(false)}
                    className="text-[10px] text-slate-400 hover:text-white cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 2. DRONE GPS STATUS (Requirement 10) */}
          <div
            className={`flex items-center space-x-2 px-2.5 py-1.5 rounded-lg border text-xs font-bold ${
              isDroneGpsLocked || (isFcConnected && droneSatellites >= 6)
                ? 'bg-sky-950/80 border-sky-500/70 text-sky-300'
                : isFcConnected
                ? 'bg-amber-950/80 border-amber-500/70 text-amber-300'
                : 'bg-rose-950/80 border-rose-500/70 text-rose-300'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-sky-400" />
            <div className="flex items-center space-x-1.5">
              <span className="text-[10px] text-slate-300 uppercase font-black">
                DRONE GPS:
              </span>
              <span
                className={`w-2 h-2 rounded-full ${
                  isDroneGpsLocked || (isFcConnected && droneSatellites >= 6)
                    ? 'bg-sky-400 animate-pulse'
                    : isFcConnected
                    ? 'bg-amber-400'
                    : 'bg-rose-400'
                }`}
              />
              <span className="font-extrabold uppercase text-[10px] tracking-wider">
                {isDroneGpsLocked || (isFcConnected && droneSatellites >= 6)
                  ? `Connected (${droneSatellites} Sats)`
                  : isFcConnected
                  ? 'Waiting for Fix'
                  : 'Disconnected'}
              </span>
            </div>
          </div>

          {/* 3. IP CAMERA TOGGLE (Requirement 10: OFF / ON) */}
          <div className="flex items-center space-x-1.5 bg-slate-950/80 border border-slate-800 p-1 rounded-lg">
            <div className="flex items-center space-x-1 px-1">
              <Video className={`w-3.5 h-3.5 ${isIpCameraOn ? 'text-sky-400' : 'text-slate-500'}`} />
              <span className="text-[10px] font-black uppercase text-slate-300 hidden xs:inline">
                IP CAMERA:
              </span>
            </div>

            <button
              type="button"
              onClick={() => onToggleIpCamera(!isIpCameraOn)}
              className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition cursor-pointer flex items-center space-x-1 border ${
                isIpCameraOn
                  ? 'bg-sky-600 hover:bg-sky-500 text-white border-sky-400/80 shadow-md shadow-sky-600/30'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isIpCameraOn ? 'bg-white' : 'bg-slate-500'}`} />
              <span>{isIpCameraOn ? 'ON' : 'OFF'}</span>
            </button>

            {isIpCameraOn && (
              <button
                type="button"
                onClick={() => {
                  setUrlInput(streamUrl);
                  setShowUrlModal(true);
                }}
                className="p-1 rounded text-slate-400 hover:text-white bg-slate-900 border border-slate-800 cursor-pointer"
                title="Configure IP Camera URL"
              >
                <Settings className="w-2.5 h-2.5" />
              </button>
            )}
          </div>

          {/* 4. TIMER (Requirement 10) */}
          <div className="flex items-center space-x-1.5 bg-slate-950/90 border border-slate-800 px-2.5 py-1 rounded-lg">
            <Clock className={`w-3.5 h-3.5 ${isMissionActive ? 'text-amber-400 animate-spin' : 'text-slate-400'}`} />
            <div className="flex items-center space-x-1">
              <span className="text-[9px] uppercase font-bold text-slate-400">
                TIMER:
              </span>
              <span className="text-xs font-black text-amber-300 tracking-wider">
                {formatTime(elapsedSeconds)}
              </span>
            </div>
          </div>
        </div>

        {/* ============================================================== */}
        {/* RIGHT SECTION: ARM | DISARM | START MISSION | STOP MISSION     */}
        {/* ============================================================== */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
          {/* ARM Button */}
          {onArm && (
            <button
              type="button"
              disabled={isArmed || !isFcConnected}
              onClick={onArm}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center space-x-1 border transition ${
                isArmed
                  ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400/80 shadow-md shadow-emerald-600/30 cursor-pointer'
              } ${!isFcConnected ? 'opacity-40 cursor-not-allowed' : ''}`}
              title="Arm flight controller"
            >
              <Power className="w-3 h-3" />
              <span>{isArmed ? 'ARMED' : 'ARM'}</span>
            </button>
          )}

          {/* DISARM Button */}
          {onDisarm && (
            <button
              type="button"
              disabled={!isArmed || !isFcConnected}
              onClick={onDisarm}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center space-x-1 border transition ${
                !isArmed
                  ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
                  : 'bg-rose-700 hover:bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-700/30 cursor-pointer'
              } ${!isFcConnected ? 'opacity-40 cursor-not-allowed' : ''}`}
              title="Disarm flight controller"
            >
              <Power className="w-3 h-3" />
              <span>DISARM</span>
            </button>
          )}

          {/* START MISSION Button (Primary Action) */}
          {onStartMission && (
            <button
              type="button"
              disabled={!isReadyForMission || isMissionActive}
              onClick={onStartMission}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center space-x-1.5 border transition shadow-md ${
                isReadyForMission && !isMissionActive
                  ? 'bg-sky-600 hover:bg-sky-500 text-white border-sky-400 shadow-sky-600/30 cursor-pointer'
                  : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
              }`}
              title="Start autonomous flight mission"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>START MISSION</span>
            </button>
          )}

          {/* STOP MISSION Button */}
          {onStopMission && (
            <button
              type="button"
              onClick={onStopMission}
              className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white border border-amber-400/80 text-[10px] font-black uppercase tracking-wider flex items-center space-x-1 shadow-md shadow-amber-600/30 transition cursor-pointer"
              title="Immediately stop / abort mission"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>STOP MISSION</span>
            </button>
          )}
        </div>
      </div>

      {/* URL Modal */}
      {showUrlModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-sm w-full space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center space-x-2 text-sky-400 font-black text-xs uppercase">
                <Video className="w-4 h-4" />
                <span>Configure IP Camera Stream</span>
              </div>
              <button
                type="button"
                onClick={() => setShowUrlModal(false)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="text-[11px] text-slate-400">
              Enter HTTP / MJPEG stream URL (e.g. from IP Webcam Android app):
            </div>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-xs text-slate-100 font-mono focus:border-sky-500 focus:outline-none"
              placeholder="http://192.168.31.194:8080/video"
            />
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowUrlModal(false)}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold uppercase cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveUrl}
                className="px-4 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-black uppercase cursor-pointer"
              >
                Save & Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GroundStationOperationsBar;
