import React, { useState, useEffect } from 'react';
import { HomePoint, GPSCoordinates } from '../../types/mission';
import { missionEngine } from '../../services/missionEngine';
import { phoneGpsService, PhoneGpsState } from '../../services/phoneGpsService';
import {
  MapPin,
  CheckCircle2,
  XCircle,
  Home,
  Compass,
  Trash2,
  Crosshair,
  Smartphone,
  Radio,
  Navigation,
  Clock,
  Layers,
  Send,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface CompactHomePointCardProps {
  homePoint: HomePoint;
  gps: GPSCoordinates;
  onSetHomePoint: (coords?: { lat: number; lng: number }) => void;
  disabled?: boolean;
  className?: string;
  phoneGpsProp?: PhoneGpsState;
}

export const CompactHomePointCard: React.FC<CompactHomePointCardProps> = ({
  homePoint,
  gps,
  onSetHomePoint,
  disabled = false,
  className = '',
  phoneGpsProp
}) => {
  // Active Tab: 'DRONE_GPS' | 'PHONE_GPS' | 'DUAL'
  const [activeTab, setActiveTab] = useState<'DRONE_GPS' | 'PHONE_GPS' | 'DUAL'>('DUAL');
  const [showAdvancedTransmit, setShowAdvancedTransmit] = useState<boolean>(false);
  const [phoneGps, setPhoneGps] = useState<PhoneGpsState>(() => phoneGpsProp || phoneGpsService.getState());

  useEffect(() => {
    const unsub = phoneGpsService.subscribe((state) => {
      setPhoneGps(state);
    });
    return () => unsub();
  }, []);

  const isHomeSet = homePoint.isSet;
  const hasDroneGpsCoordinates = gps.latitude !== 0 && gps.longitude !== 0;
  const hasPhoneGps =
    phoneGps.status === 'CONNECTED' &&
    phoneGps.latitude !== null &&
    phoneGps.longitude !== null;

  const handleClearHome = () => {
    if (disabled) return;
    missionEngine.clearHomePoint();
  };

  const handleSetCurrentDroneGps = () => {
    if (disabled) return;
    onSetHomePoint();
  };

  const handleSetPhoneGpsAsHome = async () => {
    if (disabled || !hasPhoneGps || phoneGps.latitude === null || phoneGps.longitude === null) return;
    onSetHomePoint({ lat: phoneGps.latitude, lng: phoneGps.longitude });
  };

  const handleTogglePhoneGps = () => {
    phoneGpsService.toggle();
  };

  const handleToggleReference = () => {
    phoneGpsService.setUseAsReference(!phoneGps.useAsReference);
  };

  const handleCenterPhone = () => {
    phoneGpsService.centerMapOnPhone();
  };

  const getCompassDirection = (deg: number | null): string => {
    if (deg === null || isNaN(deg)) return '';
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round(deg / 45) % 8;
    return directions[idx];
  };

  return (
    <div className={`bg-slate-900/95 border border-slate-800 rounded-xl p-3 sm:p-4 shadow-xl font-mono select-none space-y-3 ${className}`}>
      {/* Top Navigation Tabs: Phone GPS vs Drone GPS vs Dual */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div className="flex items-center space-x-1.5 p-0.5 bg-slate-950/80 border border-slate-800 rounded-lg text-xs">
          {/* Dual View Option */}
          <button
            type="button"
            onClick={() => setActiveTab('DUAL')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase transition cursor-pointer flex items-center space-x-1 ${
              activeTab === 'DUAL'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span className="hidden xs:inline">DUAL VIEW</span>
          </button>

          {/* Drone GPS Tab */}
          <button
            type="button"
            onClick={() => setActiveTab('DRONE_GPS')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'DRONE_GPS'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3 h-3" />
            <span>DRONE GPS</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                hasDroneGpsCoordinates ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
              }`}
            />
          </button>

          {/* Phone GPS Tab */}
          <button
            type="button"
            onClick={() => setActiveTab('PHONE_GPS')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'PHONE_GPS'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Smartphone className="w-3 h-3" />
            <span>PHONE GPS</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                phoneGps.status === 'CONNECTED'
                  ? 'bg-emerald-400 animate-pulse'
                  : phoneGps.status === 'WAITING_FOR_LOCATION'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-rose-400'
              }`}
            />
          </button>
        </div>

        {/* Quick Reference Status Pill */}
        <div className="flex items-center space-x-2 text-[10px] self-end sm:self-auto">
          {phoneGps.useAsReference && (
            <span className="px-2 py-0.5 rounded bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 font-bold flex items-center space-x-1">
              <CheckCircle2 className="w-3 h-3 text-cyan-400" />
              <span>PHONE REF ACTIVE</span>
            </span>
          )}
          {isHomeSet && (
            <span className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 font-bold flex items-center space-x-1">
              <Home className="w-3 h-3 text-emerald-400" />
              <span>PIXHAWK HOME SET</span>
            </span>
          )}
        </div>
      </div>

      {/* Main Grid: Shows 1 or 2 Columns depending on activeTab */}
      <div className={`grid gap-3 ${activeTab === 'DUAL' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
        {/* ============================================================== */}
        {/* 1. PHONE GPS PANEL (Requirements 1, 2, 3, 4, 5, 6, 8)          */}
        {/* ============================================================== */}
        {(activeTab === 'PHONE_GPS' || activeTab === 'DUAL') && (
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-2.5">
            {/* Phone GPS Header & On/Off Toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-1 rounded bg-cyan-950 border border-cyan-500/40 text-cyan-400">
                  <Smartphone className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-xs font-black tracking-wider text-slate-100 uppercase">
                    PHONE GPS
                  </span>
                  <span className="text-[10px] text-cyan-400/80 ml-2 font-semibold">
                    (Operator Reference)
                  </span>
                </div>
              </div>

              {/* Enable / Disable Toggle (Requirement 1) */}
              <div className="flex items-center space-x-1.5">
                <span className="text-[10px] uppercase font-bold text-slate-400">Power:</span>
                <button
                  type="button"
                  onClick={handleTogglePhoneGps}
                  className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition cursor-pointer border ${
                    phoneGps.enabled
                      ? 'bg-cyan-600 hover:bg-cyan-500 text-white border-cyan-400/80 shadow-sm'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {phoneGps.enabled ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>
            </div>

            {/* Clear Status Indicator (Requirement 2.8) */}
            <div className="flex items-center justify-between text-[11px] font-bold">
              <div
                className={`px-2 py-1 rounded border flex items-center space-x-1.5 w-full ${
                  phoneGps.status === 'CONNECTED'
                    ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300'
                    : phoneGps.status === 'WAITING_FOR_LOCATION'
                    ? 'bg-amber-950/70 border-amber-500/50 text-amber-300 animate-pulse'
                    : phoneGps.status === 'PERMISSION_DENIED'
                    ? 'bg-rose-950/70 border-rose-500/50 text-rose-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    phoneGps.status === 'CONNECTED'
                      ? 'bg-emerald-400 animate-pulse'
                      : phoneGps.status === 'WAITING_FOR_LOCATION'
                      ? 'bg-amber-400 animate-ping'
                      : phoneGps.status === 'PERMISSION_DENIED'
                      ? 'bg-rose-400'
                      : 'bg-slate-500'
                  }`}
                />
                <span className="uppercase tracking-wider font-extrabold text-[10px]">
                  {phoneGps.status === 'CONNECTED' && 'PHONE GPS: CONNECTED'}
                  {phoneGps.status === 'WAITING_FOR_LOCATION' && 'PHONE GPS: WAITING FOR LOCATION'}
                  {phoneGps.status === 'PERMISSION_DENIED' && 'PHONE GPS: PERMISSION DENIED'}
                  {phoneGps.status === 'DISABLED' && 'PHONE GPS: DISABLED'}
                  {phoneGps.status === 'UNSUPPORTED' && 'PHONE GPS: UNSUPPORTED ON THIS DEVICE'}
                </span>
              </div>
            </div>

            {/* Coordinate & Accuracy Readouts (Requirement 1 & 2) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-slate-900/90 p-2.5 rounded-lg border border-slate-800 text-xs">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Latitude:</span>
                <span className="font-extrabold text-slate-100">
                  {hasPhoneGps ? phoneGps.latitude!.toFixed(6) : '--.------'}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Longitude:</span>
                <span className="font-extrabold text-slate-100">
                  {hasPhoneGps ? phoneGps.longitude!.toFixed(6) : '--.------'}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Accuracy:</span>
                <span
                  className={`font-extrabold ${
                    phoneGps.accuracy !== null && phoneGps.accuracy <= 10
                      ? 'text-emerald-400'
                      : 'text-amber-300'
                  }`}
                >
                  {phoneGps.accuracy !== null ? `±${phoneGps.accuracy.toFixed(1)} m` : '-- m'}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Altitude (MSL):</span>
                <span className="font-extrabold text-amber-300">
                  {phoneGps.altitude !== null ? `${phoneGps.altitude.toFixed(1)} m` : 'N/A'}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Heading:</span>
                <span className="font-extrabold text-sky-300 flex items-center space-x-1">
                  {phoneGps.heading !== null ? (
                    <>
                      <Navigation
                        className="w-3 h-3 text-cyan-400 inline transform"
                        style={{ transform: `rotate(${phoneGps.heading}deg)` }}
                      />
                      <span>
                        {Math.round(phoneGps.heading)}° {getCompassDirection(phoneGps.heading)}
                      </span>
                    </>
                  ) : (
                    <span>N/A</span>
                  )}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Last Update:</span>
                <span className="font-extrabold text-slate-300 flex items-center space-x-1">
                  <Clock className="w-2.5 h-2.5 text-slate-500" />
                  <span>{phoneGps.lastUpdateTime || '--:--:--'}</span>
                </span>
              </div>
            </div>

            {/* Requirement 4: USE PHONE LOCATION AS REFERENCE */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 bg-slate-900/60 rounded border border-cyan-900/40">
              <label className="flex items-start sm:items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={phoneGps.useAsReference}
                  onChange={handleToggleReference}
                  className="mt-0.5 sm:mt-0 w-3.5 h-3.5 rounded border-slate-700 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
                />
                <div>
                  <span className="text-xs font-black text-cyan-300 uppercase tracking-wide">
                    USE PHONE LOCATION AS REFERENCE
                  </span>
                  <div className="text-[10px] text-slate-400 leading-tight">
                    Anchors mission planning & route starting point to phone coordinates
                  </div>
                </div>
              </label>

              <button
                type="button"
                disabled={!hasPhoneGps}
                onClick={handleCenterPhone}
                className="px-2.5 py-1.5 rounded bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-500/40 text-[10px] font-black uppercase flex items-center justify-center space-x-1 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title="Center Google Map on Phone GPS coordinates"
              >
                <Crosshair className="w-3 h-3 text-cyan-400" />
                <span>Center Map</span>
              </button>
            </div>

            {/* Phone GPS Actions (Set Phone as Pixhawk Home - Explicit action per Req 4) */}
            <div className="flex items-center space-x-2">
              <button
                type="button"
                disabled={disabled || !hasPhoneGps}
                onClick={handleSetPhoneGpsAsHome}
                className="flex-1 py-1.5 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/40 text-[10px] font-black uppercase flex items-center justify-center space-x-1 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title="Explicitly send MAVLink command to set Pixhawk Home to Phone GPS coordinates"
              >
                <Home className="w-3 h-3 text-cyan-400" />
                <span>Set Phone as Pixhawk Home</span>
              </button>

              {/* Advanced Transmission Toggle (Requirement 5 & 6) */}
              <button
                type="button"
                onClick={() => setShowAdvancedTransmit(!showAdvancedTransmit)}
                className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-[10px] font-bold flex items-center space-x-1 cursor-pointer"
                title="Configure Phone GPS transmission to ESP32"
              >
                <Radio className="w-3 h-3 text-slate-400" />
                <span>ESP32 Sync</span>
                {showAdvancedTransmit ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>

            {/* Optional Phone GPS Transmission Panel (Requirement 5 & 6) */}
            {showAdvancedTransmit && (
              <div className="p-2.5 bg-slate-900/90 rounded border border-slate-700 space-y-2 animate-in fade-in text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1 text-slate-300 font-bold text-[11px]">
                    <Radio className="w-3.5 h-3.5 text-cyan-400" />
                    <span>ESP32 MAVLink Transmission (Req 5)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => phoneGpsService.setTransmitToEsp32(!phoneGps.transmitToEsp32)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border cursor-pointer ${
                      phoneGps.transmitToEsp32
                        ? 'bg-emerald-600 text-white border-emerald-400'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {phoneGps.transmitToEsp32 ? 'TRANSMITTING (1 Hz)' : 'DISABLED'}
                  </button>
                </div>

                <div className="text-[10px] text-slate-400 leading-snug">
                  Transmits Phone GPS (Lat, Lon, Alt, Accuracy, Timestamp, Heading) over WebSocket to ESP32.
                </div>

                {/* Safety Badge (Requirement 6) */}
                <div className="p-1.5 bg-amber-950/40 border border-amber-500/30 rounded text-[9px] text-amber-300/90 flex items-start space-x-1.5">
                  <ShieldCheck className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>SAFETY ISOLATED:</strong> Used as GCS reference and operator location. Pixhawk's onboard GPS remains primary for autonomous flight control.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* 2. DRONE GPS PANEL (Requirement 3: Kept completely separate)    */}
        {/* ============================================================== */}
        {(activeTab === 'DRONE_GPS' || activeTab === 'DUAL') && (
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-2.5">
            {/* Drone GPS Header & Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-1 rounded bg-sky-950 border border-sky-500/40 text-sky-400">
                  <Radio className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-xs font-black tracking-wider text-slate-100 uppercase">
                    DRONE GPS
                  </span>
                  <span className="text-[10px] text-sky-400/80 ml-2 font-semibold">
                    (Pixhawk Navigation)
                  </span>
                </div>
              </div>

              {/* Status Pill */}
              <div className="flex items-center space-x-1">
                {isHomeSet ? (
                  <span className="text-[10px] font-extrabold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/40 flex items-center space-x-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>Home Set</span>
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/40 flex items-center space-x-1">
                    <XCircle className="w-3 h-3 text-amber-400" />
                    <span>Home Not Set</span>
                  </span>
                )}
              </div>
            </div>

            {/* Drone GPS Fix Status */}
            <div className="flex items-center justify-between text-[11px] font-bold">
              <div
                className={`px-2 py-1 rounded border flex items-center space-x-1.5 w-full ${
                  hasDroneGpsCoordinates
                    ? 'bg-sky-950/70 border-sky-500/50 text-sky-300'
                    : 'bg-rose-950/70 border-rose-500/50 text-rose-300'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    hasDroneGpsCoordinates ? 'bg-sky-400 animate-pulse' : 'bg-rose-400'
                  }`}
                />
                <span className="uppercase tracking-wider font-extrabold text-[10px]">
                  {hasDroneGpsCoordinates
                    ? `DRONE GPS: ${gps.satellites || 0} SATELLITES LOCKED (${gps.fixType || '3D_FIX'})`
                    : 'DRONE GPS: NO FIX / WAITING FOR PIXHAWK'}
                </span>
              </div>
            </div>

            {/* Coordinate Readouts */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-slate-900/90 p-2.5 rounded-lg border border-slate-800 text-xs">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Latitude:</span>
                <span className="font-extrabold text-slate-100">
                  {isHomeSet
                    ? homePoint.latitude.toFixed(6)
                    : hasDroneGpsCoordinates
                    ? gps.latitude.toFixed(6)
                    : '--.------'}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Longitude:</span>
                <span className="font-extrabold text-slate-100">
                  {isHomeSet
                    ? homePoint.longitude.toFixed(6)
                    : hasDroneGpsCoordinates
                    ? gps.longitude.toFixed(6)
                    : '--.------'}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Altitude (MSL):</span>
                <span className="font-extrabold text-amber-300">
                  {isHomeSet
                    ? `${homePoint.altitude.toFixed(1)} m`
                    : hasDroneGpsCoordinates
                    ? `${gps.altitude.toFixed(1)} m`
                    : '--.- m'}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Satellites:</span>
                <span className="font-extrabold text-emerald-400">
                  {gps.satellites || 0} Sats
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">HDOP / Acc:</span>
                <span className="font-extrabold text-slate-300">
                  {gps.hdop ? `${gps.hdop.toFixed(2)}` : '1.10'}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Fix Type:</span>
                <span className="font-extrabold text-sky-300">
                  {gps.fixType || '3D_FIX'}
                </span>
              </div>
            </div>

            {/* Drone GPS Action Buttons */}
            <div className="flex items-center space-x-2 pt-1">
              <button
                type="button"
                disabled={disabled || !hasDroneGpsCoordinates}
                onClick={handleSetCurrentDroneGps}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition ${
                  isHomeSet
                    ? 'bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/40 cursor-pointer'
                    : 'bg-sky-600 hover:bg-sky-500 text-white shadow-md shadow-sky-600/30 cursor-pointer'
                } ${disabled || !hasDroneGpsCoordinates ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>Set Drone GPS as Home</span>
              </button>

              <button
                type="button"
                disabled={disabled || !isHomeSet}
                onClick={handleClearHome}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/80 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-500/50 text-xs font-bold uppercase flex items-center space-x-1 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                title="Clear Pixhawk Home Position"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CompactHomePointCard;
