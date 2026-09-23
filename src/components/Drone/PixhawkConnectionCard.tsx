import React, { useState } from 'react';
import { PixhawkConnectionState, ConnectionPhase } from '../../types/mavlink';
import { mavlinkService } from '../../services/mavlinkService';
import {
  Usb,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Activity,
  Cpu,
  RefreshCw,
  PowerOff,
  Sliders,
  HelpCircle,
  Radio,
  Zap,
  RotateCcw,
  Check,
  Lock
} from 'lucide-react';
import { SerialDiagnosticsModal } from './SerialDiagnosticsModal';

interface PixhawkConnectionCardProps {
  connectionState: PixhawkConnectionState;
  className?: string;
  onOpenHelp?: () => void;
}

export const PixhawkConnectionCard: React.FC<PixhawkConnectionCardProps> = ({
  connectionState,
  className = '',
  onOpenHelp
}) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const phase: ConnectionPhase = connectionState.phase;
  const isConnected = connectionState.isConnected; // MAVLink verified
  const isUsbConnected = connectionState.isUsbConnected; // Physical USB link open
  const isSimulated = connectionState.connectionType === 'SIMULATED';
  const diag = connectionState.diagnostics;

  // Granular Stage Flags
  const isUsbAttached = 
    phase !== 'DISCONNECTED' && 
    phase !== 'USB_NOT_DETECTED' && 
    phase !== 'IOS_UNSUPPORTED';

  const isPermissionGranted =
    phase === 'PERMISSION_GRANTED' ||
    phase === 'OPENING_USB' ||
    phase === 'USB_CONNECTED' ||
    phase === 'WAITING_FOR_HEARTBEAT' ||
    phase === 'MAVLINK_CONNECTED' ||
    phase === 'TELEMETRY_ACTIVE';

  const isPermissionRequested = phase === 'REQUESTING_PERMISSION';
  const isPermissionDenied = phase === 'PERMISSION_DENIED';

  const isUsbTransportOpen =
    isUsbConnected ||
    phase === 'USB_CONNECTED' ||
    phase === 'WAITING_FOR_HEARTBEAT' ||
    phase === 'MAVLINK_CONNECTED' ||
    phase === 'TELEMETRY_ACTIVE' ||
    phase === 'HEARTBEAT_TIMEOUT';

  const isWaitingHeartbeat = phase === 'WAITING_FOR_HEARTBEAT' && !isConnected;
  const isHeartbeatTimeout = phase === 'HEARTBEAT_TIMEOUT';
  const isTelemetryActive = isConnected && connectionState.isReceivingTelemetry;

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await mavlinkService.connectHardware(connectionState.baudRate || 115200);
    } catch (e) {
      console.warn('Connect error:', e);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleRequestPermission = async () => {
    setIsConnecting(true);
    try {
      await mavlinkService.requestUsbPermission();
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await mavlinkService.disconnect();
  };

  return (
    <>
      <div className={`bg-slate-900/95 border-2 rounded-2xl p-3 sm:p-4 shadow-2xl font-mono transition-all ${
        isConnected
          ? 'border-emerald-500/80 shadow-emerald-950/40'
          : isHeartbeatTimeout
          ? 'border-amber-500/80 shadow-amber-950/40'
          : phase === 'PERMISSION_DENIED' || phase === 'USB_OPEN_FAILED' || phase === 'INTERFACE_NOT_SUPPORTED'
          ? 'border-rose-500/80 shadow-rose-950/40'
          : 'border-slate-700/80 shadow-slate-950/60'
      } ${className}`}>
        
        {/* Top Header Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className={`p-2 rounded-xl border shrink-0 ${
              isConnected
                ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/50'
                : isWaitingHeartbeat
                ? 'bg-amber-950/80 text-amber-400 border-amber-500/50 animate-pulse'
                : isHeartbeatTimeout
                ? 'bg-amber-950/80 text-amber-400 border-amber-500/50'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}>
              <Usb className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs sm:text-sm font-black uppercase text-white tracking-wider">
                  PIXHAWK USB HOST LINK
                </span>
                
                {/* Real-time Status Badge */}
                <span className={`text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-full border ${
                  isConnected
                    ? isSimulated
                      ? 'bg-purple-950/80 text-purple-300 border-purple-500/50'
                      : 'bg-emerald-950/90 text-emerald-300 border-emerald-500/60'
                    : isWaitingHeartbeat
                    ? 'bg-amber-950/80 text-amber-300 border-amber-500/50 animate-pulse'
                    : isHeartbeatTimeout
                    ? 'bg-amber-950/80 text-amber-300 border-amber-500/50'
                    : phase === 'PERMISSION_DENIED'
                    ? 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                    : isUsbAttached
                    ? 'bg-sky-950/80 text-sky-300 border-sky-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  {isConnected
                    ? isSimulated
                      ? 'SIMULATED MAVLINK ✓'
                      : 'MAVLINK CONNECTED ✓'
                    : isWaitingHeartbeat
                    ? 'WAITING HEARTBEAT ⟳'
                    : isHeartbeatTimeout
                    ? 'HEARTBEAT TIMEOUT ⚠️'
                    : phase === 'PERMISSION_DENIED'
                    ? 'PERMISSION DENIED'
                    : isUsbAttached
                    ? 'USB DETECTED'
                    : 'USB DISCONNECTED'}
                </span>
              </div>
              
              <div className="text-[11px] text-slate-400 truncate max-w-[260px] sm:max-w-md">
                {connectionState.portOrAddress}
              </div>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center space-x-1.5 sm:space-x-2">
            <button
              onClick={() => setShowDiagnostics(true)}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-lg text-xs font-bold transition flex items-center space-x-1 border border-slate-700 cursor-pointer"
              title="Open Complete USB Diagnostics Screen"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Diagnostics</span>
            </button>

            {onOpenHelp && (
              <button
                onClick={onOpenHelp}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-lg text-xs font-bold transition flex items-center space-x-1 border border-slate-700 cursor-pointer"
                title="OTG Cable & Connection Troubleshooting"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span className="hidden md:inline">OTG Guide</span>
              </button>
            )}

            {!isConnected ? (
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg text-xs font-black tracking-wide uppercase transition flex items-center space-x-1.5 shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                {isConnecting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Usb className="w-3.5 h-3.5" />
                )}
                <span>{isConnecting ? 'Detecting...' : 'Connect USB'}</span>
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="px-3 py-1.5 bg-rose-950/80 hover:bg-rose-900 active:bg-rose-950 border border-rose-600 text-rose-300 rounded-lg text-xs font-bold transition flex items-center space-x-1 cursor-pointer"
              >
                <PowerOff className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            )}
          </div>
        </div>

        {/* Real-Time Connection Diagnostic Flow (6 Steps) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 my-3 text-[11px]">
          
          {/* 1. USB Device Attachment */}
          <div className={`p-2 rounded-xl border flex flex-col justify-between ${
            isUsbAttached || isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">1. USB Device</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isUsbAttached || isConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300 truncate">Detected</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Not Detected</span>
                </>
              )}
            </div>
          </div>

          {/* 2. Device Identity (VID/PID) */}
          <div className={`p-2 rounded-xl border flex flex-col justify-between ${
            isUsbAttached || isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">2. Device Info</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isUsbAttached || isConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300 truncate">{diag.productName || 'Pixhawk FC'}</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Standby</span>
                </>
              )}
            </div>
          </div>

          {/* 3. USB Permission */}
          <div className={`p-2 rounded-xl border flex flex-col justify-between ${
            isPermissionGranted || isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : isPermissionRequested
              ? 'bg-slate-950/80 border-amber-500/50 text-amber-300'
              : isPermissionDenied
              ? 'bg-rose-950/40 border-rose-500/50 text-rose-300'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">3. Permission</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isPermissionGranted || isConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">Granted</span>
                </>
              ) : isPermissionRequested ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                  <span>Requesting...</span>
                </>
              ) : isPermissionDenied ? (
                <>
                  <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span className="text-rose-300">Denied</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Pending</span>
                </>
              )}
            </div>
          </div>

          {/* 4. USB Serial Transport */}
          <div className={`p-2 rounded-xl border flex flex-col justify-between ${
            isUsbTransportOpen || isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">4. USB Transport</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isUsbTransportOpen || isConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">Open ({connectionState.baudRate})</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Closed</span>
                </>
              )}
            </div>
          </div>

          {/* 5. MAVLink Heartbeat */}
          <div className={`p-2 rounded-xl border flex flex-col justify-between ${
            isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : isWaitingHeartbeat
              ? 'bg-slate-950/80 border-amber-500/50 text-amber-300'
              : isHeartbeatTimeout
              ? 'bg-amber-950/40 border-amber-500/50 text-amber-300'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">5. Heartbeat</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">Received ✓</span>
                </>
              ) : isWaitingHeartbeat ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                  <span className="text-amber-300">Waiting...</span>
                </>
              ) : isHeartbeatTimeout ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-amber-300">Timeout</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Standby</span>
                </>
              )}
            </div>
          </div>

          {/* 6. Telemetry Stream */}
          <div className={`p-2 rounded-xl border flex flex-col justify-between ${
            isTelemetryActive
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">6. Telemetry</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isTelemetryActive ? (
                <>
                  <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">{connectionState.heartbeatHz || 1.0} Hz</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Inactive</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Contextual Guidance & Status Notifications */}
        {isHeartbeatTimeout ? (
          <div className="p-3 bg-amber-950/50 border border-amber-500/50 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-amber-200 gap-2">
            <div className="flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-amber-300">USB connected, but MAVLink heartbeat was not received.</strong>
                <p className="text-[11px] text-amber-300/80 mt-0.5">
                  Check that Pixhawk is powered on, booted up, and telemetry baud rate is 115200.
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={handleConnect}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-xs cursor-pointer"
              >
                Retry
              </button>
              <button
                onClick={() => setShowDiagnostics(true)}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg text-xs border border-slate-700 cursor-pointer"
              >
                Inspect
              </button>
            </div>
          </div>
        ) : phase === 'PERMISSION_DENIED' ? (
          <div className="p-3 bg-rose-950/50 border border-rose-500/50 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-rose-200 gap-2">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>USB permission denied by user. Grant USB permission to connect to the Pixhawk.</span>
            </div>
            <button
              onClick={handleRequestPermission}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs cursor-pointer shrink-0"
            >
              Request Permission
            </button>
          </div>
        ) : phase === 'USB_NOT_DETECTED' || phase === 'DISCONNECTED' ? (
          <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                <strong>No USB flight controller detected.</strong> Verify OTG is enabled & cable supports data.
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleConnect}
                className="px-2.5 py-1 bg-sky-900/60 hover:bg-sky-800 text-sky-300 font-bold rounded-lg text-[11px] border border-sky-600/40 transition cursor-pointer"
              >
                Scan USB
              </button>
              <button
                onClick={() => mavlinkService.switchToSimulationMode()}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-purple-300 font-bold rounded-lg text-[11px] border border-purple-500/30 transition cursor-pointer"
              >
                Bench Simulator
              </button>
            </div>
          </div>
        ) : isWaitingHeartbeat ? (
          <div className="p-2.5 bg-amber-950/40 border border-amber-500/40 rounded-xl flex items-center space-x-2 text-xs text-amber-200">
            <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
            <span>USB connection active. Waiting for MAVLink heartbeat from Pixhawk…</span>
          </div>
        ) : null}
      </div>

      {/* Complete Connection Diagnostics Screen Modal */}
      <SerialDiagnosticsModal
        isOpen={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        connectionState={connectionState}
      />
    </>
  );
};
