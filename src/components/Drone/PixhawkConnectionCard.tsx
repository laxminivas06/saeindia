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
  Lock,
  Search,
  ChevronDown,
  ChevronUp
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
  const [isScanning, setIsScanning] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [selectedBaud, setSelectedBaud] = useState<number>(connectionState.baudRate || 115200);
  const [activeMethod, setActiveMethod] = useState<'USB' | 'NETWORK' | 'SIM'>('USB');

  const phase: ConnectionPhase = connectionState.phase;
  const isConnected = connectionState.isConnected; // MAVLink verified
  const isUsbConnected = connectionState.isUsbConnected; // Physical USB link open
  const isSimulated = connectionState.connectionType === 'SIMULATED';
  const diag = connectionState.diagnostics;

  // Granular Stage Flags
  const isUsbDetected = 
    phase !== 'DISCONNECTED' && 
    phase !== 'USB_NOT_DETECTED' && 
    phase !== 'IOS_UNSUPPORTED';

  const isPermissionGranted =
    phase === 'USB_PERMISSION_GRANTED' ||
    phase === 'PERMISSION_GRANTED' ||
    phase === 'SERIAL_OPENING' ||
    phase === 'SERIAL_OPEN' ||
    phase === 'WAITING_FOR_MAVLINK' ||
    phase === 'HEARTBEAT_RECEIVED' ||
    phase === 'PIXHAWK_CONNECTED' ||
    phase === 'TELEMETRY_ACTIVE' ||
    phase === 'OPENING_USB' ||
    phase === 'USB_CONNECTED' ||
    phase === 'WAITING_FOR_HEARTBEAT' ||
    phase === 'MAVLINK_CONNECTED';

  const isPermissionRequested = phase === 'USB_PERMISSION_REQUIRED' || phase === 'REQUESTING_PERMISSION';
  const isPermissionDenied = phase === 'PERMISSION_DENIED';

  const isSerialOpen =
    isUsbConnected ||
    phase === 'SERIAL_OPEN' ||
    phase === 'WAITING_FOR_MAVLINK' ||
    phase === 'HEARTBEAT_RECEIVED' ||
    phase === 'PIXHAWK_CONNECTED' ||
    phase === 'TELEMETRY_ACTIVE' ||
    phase === 'USB_CONNECTED' ||
    phase === 'WAITING_FOR_HEARTBEAT' ||
    phase === 'MAVLINK_CONNECTED' ||
    phase === 'HEARTBEAT_TIMEOUT';

  const isWaitingMavlink = (phase === 'WAITING_FOR_MAVLINK' || phase === 'WAITING_FOR_HEARTBEAT' || phase === 'SERIAL_OPEN') && !isConnected;
  const isHeartbeatTimeout = phase === 'HEARTBEAT_TIMEOUT' || phase === 'NO_MAVLINK_HEARTBEAT';
  const isNoSerialData = phase === 'NO_SERIAL_DATA';
  const isTelemetryActive = isConnected && connectionState.isReceivingTelemetry;

  const handleScan = async () => {
    setIsScanning(true);
    try {
      await mavlinkService.scanUsbDevices();
      await mavlinkService.connectHardware(selectedBaud);
    } finally {
      setIsScanning(false);
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await mavlinkService.connectHardware(selectedBaud);
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

  const handleBaudChange = (newBaud: number) => {
    setSelectedBaud(newBaud);
    if (isUsbConnected) {
      mavlinkService.connectHardware(newBaud);
    }
  };

  return (
    <>
      <div className={`bg-slate-900/95 border-2 rounded-2xl p-3 sm:p-4.5 shadow-2xl font-mono transition-all ${
        isConnected
          ? 'border-emerald-500/80 shadow-emerald-950/40'
          : isHeartbeatTimeout
          ? 'border-amber-500/80 shadow-amber-950/40'
          : phase === 'PERMISSION_DENIED' || phase === 'SERIAL_OPEN_FAILED' || phase === 'UNSUPPORTED_DEVICE' || phase === 'INTERFACE_NOT_SUPPORTED'
          ? 'border-rose-500/80 shadow-rose-950/40'
          : 'border-slate-700/80 shadow-slate-950/60'
      } ${className}`}>
        
        {/* Top Header & Connection Method Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className={`p-2 rounded-xl border shrink-0 ${
              isConnected
                ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/50'
                : isWaitingMavlink
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
                  PIXHAWK CONNECTION
                </span>
                
                {/* Real-time Status Badge */}
                <span className={`text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-full border ${
                  isConnected
                    ? isSimulated
                      ? 'bg-purple-950/80 text-purple-300 border-purple-500/50'
                      : 'bg-emerald-950/90 text-emerald-300 border-emerald-500/60'
                    : isWaitingMavlink
                    ? 'bg-amber-950/80 text-amber-300 border-amber-500/50 animate-pulse'
                    : isHeartbeatTimeout
                    ? 'bg-amber-950/80 text-amber-300 border-amber-500/50'
                    : phase === 'PERMISSION_DENIED'
                    ? 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                    : isUsbDetected
                    ? 'bg-sky-950/80 text-sky-300 border-sky-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  {isConnected
                    ? isSimulated
                      ? 'SIMULATED MAVLINK ✓'
                      : 'PIXHAWK CONNECTED ✓'
                    : isWaitingMavlink
                    ? 'WAITING HEARTBEAT ⟳'
                    : isHeartbeatTimeout
                    ? 'HEARTBEAT TIMEOUT ⚠️'
                    : isNoSerialData
                    ? 'NO SERIAL DATA'
                    : phase === 'PERMISSION_DENIED'
                    ? 'PERMISSION DENIED'
                    : isUsbDetected
                    ? 'DEVICE DETECTED'
                    : 'NOT CONNECTED'}
                </span>
              </div>
              
              <div className="text-[11px] text-slate-400 truncate max-w-[260px] sm:max-w-md">
                {connectionState.portOrAddress}
              </div>
            </div>
          </div>

          {/* Connection Method Selector Pills */}
          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs shrink-0">
            <button
              onClick={() => setActiveMethod('USB')}
              className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1 ${
                activeMethod === 'USB'
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Usb className="w-3 h-3" />
              <span>USB OTG</span>
            </button>
            <button
              onClick={() => {
                setActiveMethod('NETWORK');
                mavlinkService.setTransport('udp');
              }}
              className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1 ${
                activeMethod === 'NETWORK'
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Radio className="w-3 h-3" />
              <span>Wireless</span>
            </button>
            <button
              onClick={() => {
                setActiveMethod('SIM');
                mavlinkService.switchToSimulationMode();
              }}
              className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1 ${
                isSimulated
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-purple-400 hover:text-purple-200'
              }`}
            >
              <Cpu className="w-3 h-3" />
              <span>Simulator</span>
            </button>
          </div>
        </div>

        {/* Dedicated Responsive State Cards Grid (Section 10 Requirements) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 my-3 text-[11px]">
          
          {/* 1. USB Status */}
          <div className={`p-2.5 rounded-xl border flex flex-col justify-between ${
            isUsbDetected || isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">USB Status</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isConnected || isUsbConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">Connected ✓</span>
                </>
              ) : isUsbDetected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span className="text-sky-300">Device Detected</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Not Connected</span>
                </>
              )}
            </div>
          </div>

          {/* 2. Device Identity */}
          <div className={`p-2.5 rounded-xl border flex flex-col justify-between ${
            isUsbDetected || isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">Device</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isUsbDetected || isConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300 truncate" title={diag.productName || 'Pixhawk / USB Serial'}>
                    {diag.productName || 'Pixhawk / USB Serial'}
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Not Detected</span>
                </>
              )}
            </div>
          </div>

          {/* 3. USB Permission */}
          <div className={`p-2.5 rounded-xl border flex flex-col justify-between ${
            isPermissionGranted || isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : isPermissionRequested
              ? 'bg-slate-950/80 border-amber-500/50 text-amber-300'
              : isPermissionDenied
              ? 'bg-rose-950/40 border-rose-500/50 text-rose-300'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">Permission</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isPermissionGranted || isConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">Granted ✓</span>
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
                  <span className="text-slate-500 font-bold">—</span>
                </>
              )}
            </div>
          </div>

          {/* 4. Serial Port & Baud Rate */}
          <div className={`p-2.5 rounded-xl border flex flex-col justify-between ${
            isSerialOpen || isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">Serial</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isSerialOpen || isConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">Open ({selectedBaud})</span>
                </>
              ) : isUsbDetected ? (
                <span className="text-slate-400">Closed</span>
              ) : (
                <span className="text-slate-500 font-bold">—</span>
              )}
            </div>
          </div>

          {/* 5. MAVLink Status */}
          <div className={`p-2.5 rounded-xl border flex flex-col justify-between ${
            isConnected
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : isWaitingMavlink
              ? 'bg-slate-950/80 border-amber-500/50 text-amber-300'
              : isHeartbeatTimeout
              ? 'bg-amber-950/40 border-amber-500/50 text-amber-300'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">MAVLink</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">Connected ✓</span>
                </>
              ) : isWaitingMavlink ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                  <span className="text-amber-300">Waiting...</span>
                </>
              ) : isHeartbeatTimeout ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-amber-300">No Heartbeat</span>
                </>
              ) : (
                <span className="text-slate-500 font-bold">—</span>
              )}
            </div>
          </div>

          {/* 6. Heartbeat Stream */}
          <div className={`p-2.5 rounded-xl border flex flex-col justify-between ${
            isTelemetryActive
              ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] uppercase text-slate-500 font-bold">Heartbeat</span>
            <div className="flex items-center space-x-1.5 mt-1 font-bold">
              {isTelemetryActive ? (
                <>
                  <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">Receiving ✓ ({connectionState.heartbeatHz || 1.0} Hz)</span>
                </>
              ) : (
                <span className="text-slate-500 font-bold">—</span>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
          {/* Baud Rate Selector */}
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-slate-400 font-bold uppercase text-[10px]">Baud:</span>
            <select
              value={selectedBaud}
              onChange={(e) => handleBaudChange(Number(e.target.value))}
              className="bg-slate-950 text-slate-200 text-xs px-2.5 py-1 rounded-lg border border-slate-700 cursor-pointer"
            >
              <option value={115200}>115200 (Default)</option>
              <option value={57600}>57600 (Telemetry 1/2)</option>
              <option value={921600}>921600 (High-Speed)</option>
              <option value={38400}>38400 (Legacy)</option>
            </select>
          </div>

          {/* Dynamic Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {!isUsbDetected && !isConnected ? (
              <button
                onClick={handleScan}
                disabled={isScanning}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-black uppercase tracking-wide transition flex items-center space-x-1.5 shadow-lg shadow-sky-600/30 cursor-pointer"
              >
                {isScanning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>SCAN USB DEVICES</span>
              </button>
            ) : !isConnected ? (
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg text-xs font-black uppercase tracking-wide transition flex items-center space-x-1.5 shadow-lg shadow-emerald-600/30 cursor-pointer animate-pulse"
              >
                {isConnecting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Usb className="w-3.5 h-3.5" />
                )}
                <span>CONNECT PIXHAWK</span>
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="px-3 py-1.5 bg-rose-950/80 hover:bg-rose-900 border border-rose-600 text-rose-300 rounded-lg text-xs font-bold transition flex items-center space-x-1 cursor-pointer"
              >
                <PowerOff className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            )}

            <button
              onClick={() => setShowDiagnostics(true)}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-lg text-xs font-bold transition flex items-center space-x-1 border border-slate-700 cursor-pointer"
              title="Open Complete USB Diagnostics Screen"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>USB Diagnostics</span>
            </button>

            {onOpenHelp && (
              <button
                onClick={onOpenHelp}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-lg text-xs font-bold transition flex items-center space-x-1 border border-slate-700 cursor-pointer"
                title="OTG Cable & Troubleshooting Guide"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">OTG Guide</span>
              </button>
            )}
          </div>
        </div>

        {/* Diagnostic Failure / Timeout Notification Panels */}
        {isHeartbeatTimeout ? (
          <div className="mt-3 p-3 bg-amber-950/50 border border-amber-500/50 rounded-xl text-xs text-amber-200 space-y-2">
            <div className="flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-amber-300">USB connected, but no MAVLink heartbeat received.</strong>
                <p className="text-[11px] text-amber-300/80 mt-0.5">
                  The serial port is open, but the Pixhawk autopilot is not responding with valid MAVLink heartbeat packets.
                </p>
              </div>
            </div>
            {/* Detailed Diagnostic Checklist Box */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 bg-slate-950/80 p-2 rounded-lg border border-amber-500/30 text-[10px]">
              <div>• USB device detected: <span className="text-emerald-400 font-bold">YES</span></div>
              <div>• USB permission: <span className="text-emerald-400 font-bold">GRANTED</span></div>
              <div>• Serial port: <span className="text-emerald-400 font-bold">OPEN</span></div>
              <div>• Serial data: <span className={diag.serialDataReceived ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>{diag.serialDataReceived ? "YES" : "NO"}</span></div>
              <div>• MAVLink heartbeat: <span className="text-rose-400 font-bold">NO</span></div>
              <div>• Baud rate: <span className="text-sky-300 font-bold">{selectedBaud}</span></div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-amber-300/70">Verify Pixhawk power, wait 5s for bootloader, or switch baud rate.</span>
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={handleConnect}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-[11px] cursor-pointer"
                >
                  Retry
                </button>
                <button
                  onClick={() => setShowDiagnostics(true)}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg text-[11px] border border-slate-700 cursor-pointer"
                >
                  Inspect
                </button>
              </div>
            </div>
          </div>
        ) : isNoSerialData ? (
          <div className="mt-3 p-3 bg-amber-950/50 border border-amber-500/50 rounded-xl flex items-center justify-between text-xs text-amber-200 gap-2">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Serial port opened, but no serial data received.</strong> USB device may require external battery power.
              </span>
            </div>
            <button
              onClick={handleConnect}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-[11px] cursor-pointer shrink-0"
            >
              Retry Connection
            </button>
          </div>
        ) : phase === 'PERMISSION_DENIED' ? (
          <div className="mt-3 p-3 bg-rose-950/50 border border-rose-500/50 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-rose-200 gap-2">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>USB permission denied. Please allow USB access and reconnect the Pixhawk.</span>
            </div>
            <button
              onClick={handleRequestPermission}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs cursor-pointer shrink-0"
            >
              Request Permission
            </button>
          </div>
        ) : phase === 'CONNECTION_LOST' ? (
          <div className="mt-3 p-3 bg-rose-950/50 border border-rose-500/50 rounded-xl flex items-center justify-between text-xs text-rose-200">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span><strong>Pixhawk connection lost.</strong> Reconnect the USB cable or OTG adapter.</span>
            </div>
            <button
              onClick={handleConnect}
              className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg text-[11px] cursor-pointer"
            >
              Scan &amp; Reconnect
            </button>
          </div>
        ) : !isUsbDetected && !isConnected ? (
          <div className="mt-3 p-2.5 bg-slate-950/60 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                <strong>No USB device detected.</strong> Connect Phone → OTG Adapter → Pixhawk USB.
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleScan}
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
        ) : isWaitingMavlink ? (
          <div className="mt-3 p-2.5 bg-amber-950/40 border border-amber-500/40 rounded-xl flex items-center space-x-2 text-xs text-amber-200">
            <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
            <span>Serial connection active. Waiting for MAVLink heartbeat from Pixhawk…</span>
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
