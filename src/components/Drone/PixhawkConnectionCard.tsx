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
  Settings,
  HelpCircle,
  Radio,
  Sliders
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
  const isConnected = connectionState.isConnected;
  const isSimulated = connectionState.connectionType === 'SIMULATED';
  const diag = connectionState.diagnostics;

  // Step 1: USB Device Detected
  const isUsbDetected = phase !== 'DISCONNECTED' && phase !== 'ERROR';
  // Step 2: Permission Granted
  const isPermissionGranted =
    phase === 'USB_PERMISSION_GRANTED' ||
    phase === 'USB_INTERFACE_DETECTED' ||
    phase === 'SERIAL_INTERFACE_OPENED' ||
    phase === 'MAVLINK_INITIALIZING' ||
    phase === 'MAVLINK_HEARTBEAT_RECEIVED' ||
    phase === 'FLIGHT_CONTROLLER_CONNECTED';
  const isPermissionRequested = phase === 'USB_PERMISSION_REQUESTED';
  const isPermissionDenied = phase === 'ERROR' && connectionState.errorMessage?.toLowerCase().includes('permission');

  // Step 3: Serial Interface Opened
  const isSerialOpened =
    phase === 'SERIAL_INTERFACE_OPENED' ||
    phase === 'MAVLINK_INITIALIZING' ||
    phase === 'MAVLINK_HEARTBEAT_RECEIVED' ||
    phase === 'FLIGHT_CONTROLLER_CONNECTED';

  // Step 4: MAVLink Heartbeat Received & Confirmed
  const isHeartbeatReceiving = isConnected && connectionState.isReceivingTelemetry;
  const isWaitingHeartbeat = phase === 'MAVLINK_INITIALIZING' && !isConnected;

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

  const handleDisconnect = async () => {
    await mavlinkService.disconnect();
  };

  return (
    <>
      <div className={`bg-slate-900/95 border-2 rounded-2xl p-3.5 sm:p-4 shadow-2xl font-mono transition-all ${
        isConnected
          ? 'border-emerald-500/80 shadow-emerald-950/40'
          : phase === 'ERROR' || isPermissionDenied
          ? 'border-rose-500/80 shadow-rose-950/40'
          : 'border-slate-700/80 shadow-slate-950/60'
      } ${className}`}>
        
        {/* Header Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className={`p-2 rounded-xl border ${
              isConnected
                ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/50'
                : isWaitingHeartbeat
                ? 'bg-amber-950/80 text-amber-400 border-amber-500/50 animate-pulse'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}>
              <Usb className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs sm:text-sm font-black uppercase text-white tracking-wider">
                  FLIGHT CONTROLLER LINK
                </span>
                <span className={`text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-full border ${
                  isConnected
                    ? isSimulated
                      ? 'bg-purple-950/80 text-purple-300 border-purple-500/50'
                      : 'bg-emerald-950/90 text-emerald-300 border-emerald-500/60'
                    : isWaitingHeartbeat
                    ? 'bg-amber-950/80 text-amber-300 border-amber-500/50'
                    : 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                }`}>
                  {isConnected
                    ? isSimulated
                      ? 'BENCH SIMULATED'
                      : 'PIXHAWK LIVE ✓'
                    : isWaitingHeartbeat
                    ? 'WAITING HEARTBEAT ⟳'
                    : 'DISCONNECTED'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 truncate max-w-xs sm:max-w-md">
                {connectionState.portOrAddress}
              </div>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center space-x-1.5 sm:space-x-2">
            <button
              onClick={() => setShowDiagnostics(true)}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-800 text-slate-300 rounded-lg text-xs font-bold transition flex items-center space-x-1 border border-slate-700 cursor-pointer"
              title="Open Advanced Serial Diagnostics"
            >
              <Sliders className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">Diagnostics</span>
            </button>

            {onOpenHelp && (
              <button
                onClick={onOpenHelp}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-lg text-xs font-bold transition flex items-center space-x-1 border border-slate-700 cursor-pointer"
                title="OTG Cable Connection Help"
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
                <span>{isConnecting ? 'Detecting...' : 'CONNECT PIXHAWK'}</span>
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="px-3 py-1.5 bg-rose-950/80 hover:bg-rose-900 active:bg-rose-950 border border-rose-600 text-rose-300 rounded-lg text-xs font-bold transition flex items-center space-x-1 cursor-pointer"
              >
                <PowerOff className="w-3.5 h-3.5" />
                <span>DISCONNECT</span>
              </button>
            )}
          </div>
        </div>

        {/* Real-Time Connection Stage Machine Checklist */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 my-3 text-[11px]">
          
          {/* 1. USB OTG Hardware Connection */}
          <div className={`p-2 rounded-xl border flex flex-col justify-between ${
            isUsbDetected || isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">1. USB OTG</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isUsbDetected || isConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">Connected</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Not Detected</span>
                </>
              )}
            </div>
          </div>

          {/* 2. Pixhawk Device Identification */}
          <div className={`p-2 rounded-xl border flex flex-col justify-between ${
            isUsbDetected || isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">2. Pixhawk Device</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isUsbDetected || isConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300 truncate">{diag.productName || 'Detected'}</span>
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

          {/* 4. Serial Interface */}
          <div className={`p-2 rounded-xl border flex flex-col justify-between ${
            isSerialOpened || isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">4. Serial Port</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isSerialOpened || isConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">{connectionState.baudRate} bps</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Auto-Select</span>
                </>
              )}
            </div>
          </div>

          {/* 5. MAVLink Stream */}
          <div className={`p-2 rounded-xl border flex flex-col justify-between ${
            isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : isWaitingHeartbeat
              ? 'bg-slate-950/80 border-amber-500/50 text-amber-300'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">5. MAVLink</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">Active</span>
                </>
              ) : isWaitingHeartbeat ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                  <span className="text-amber-300">Waiting...</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Standby</span>
                </>
              )}
            </div>
          </div>

          {/* 6. Heartbeat Confirmation */}
          <div className={`p-2 rounded-xl border flex flex-col justify-between ${
            isHeartbeatReceiving
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">6. Heartbeat</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isHeartbeatReceiving ? (
                <>
                  <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">{connectionState.heartbeatHz || 1.0} Hz</span>
                </>
              ) : isWaitingHeartbeat ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                  <span className="text-amber-300">Listening</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>None</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Contextual Guidance & Status Message */}
        {phase === 'ERROR' || isPermissionDenied ? (
          <div className="p-2.5 bg-rose-950/40 border border-rose-500/40 rounded-xl flex items-center justify-between text-xs text-rose-200 gap-2">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{connectionState.errorMessage || 'USB Connection Error. Check OTG cable & settings.'}</span>
            </div>
            <button
              onClick={handleConnect}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs cursor-pointer shrink-0"
            >
              Retry
            </button>
          </div>
        ) : isWaitingHeartbeat ? (
          <div className="p-2.5 bg-amber-950/40 border border-amber-500/40 rounded-xl flex items-center space-x-2 text-xs text-amber-200">
            <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
            <span>Serial interface established. Waiting for Pixhawk MAVLink Heartbeat (ensure Pixhawk has booted)...</span>
          </div>
        ) : !isConnected && (
          <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
              <span>Plug Pixhawk into phone via USB-OTG. The app connects automatically with zero manual port selection.</span>
            </div>
            <button
              onClick={() => mavlinkService.switchToSimulationMode()}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-purple-300 font-bold rounded-lg text-[11px] border border-purple-500/30 transition cursor-pointer"
            >
              Bench Test Simulation
            </button>
          </div>
        )}
      </div>

      {/* Advanced Diagnostics Modal */}
      <SerialDiagnosticsModal
        isOpen={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        connectionState={connectionState}
      />
    </>
  );
};
