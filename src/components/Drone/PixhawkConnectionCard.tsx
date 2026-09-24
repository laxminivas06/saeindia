import React, { useState, useEffect } from 'react';
import { PixhawkConnectionState, ConnectionPhase } from '../../types/mavlink';
import { mavlinkService } from '../../services/mavlinkService';
import { transportManager } from '../../services/transports/TransportManager';
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
  Wifi,
  Globe,
  Info,
  Server,
  Cable,
  ArrowRight,
  ShieldAlert,
  Clock,
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
  const [isCheckingEsp32, setIsCheckingEsp32] = useState(false);
  const [esp32PingResult, setEsp32PingResult] = useState<{ reachable: boolean; latencyMs?: number; message?: string } | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showEsp32Guide, setShowEsp32Guide] = useState(false);
  const [showDevDetails, setShowDevDetails] = useState(false);
  const [selectedBaud, setSelectedBaud] = useState<number>(connectionState.baudRate || 57600);
  
  // Connection Mode: 'USB' | 'ESP32' | 'SIM'
  const [connectionMode, setConnectionMode] = useState<'USB' | 'ESP32' | 'SIM'>(() => {
    if (connectionState.connectionType === 'ESP32_WEBSOCKET') return 'ESP32';
    if (connectionState.connectionType === 'SIMULATED') return 'SIM';
    return 'ESP32'; // Default to ESP32 wireless mode
  });

  // ESP32 Settings
  const [esp32Host, setEsp32Host] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('esp32_host') || '192.168.4.1';
    }
    return '192.168.4.1';
  });
  const [esp32Port, setEsp32Port] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const p = localStorage.getItem('esp32_port');
      return p ? parseInt(p, 10) || 8080 : 8080;
    }
    return 8080;
  });
  const [esp32Proto, setEsp32Proto] = useState<'ws' | 'wss'>(() => {
    if (typeof window !== 'undefined') {
      const pr = localStorage.getItem('esp32_proto');
      if (pr === 'ws' || pr === 'wss') return pr;
      return window.location.protocol === 'https:' ? 'ws' : 'ws';
    }
    return 'ws';
  });

  const isHttpsOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';

  const phase: ConnectionPhase = connectionState.phase;
  const isConnected = connectionState.isConnected; // MAVLink verified
  const isUsbConnected = connectionState.isUsbConnected; // Physical or WS link open
  const isSimulated = connectionState.connectionType === 'SIMULATED';
  const isEsp32Mode = connectionMode === 'ESP32';
  const diag = connectionState.diagnostics;

  // Granular Stage Flags
  const isWebSocketOpen = isUsbConnected && connectionState.connectionType === 'ESP32_WEBSOCKET';
  const isMavlinkHeartbeatReceived = isConnected && connectionState.lastHeartbeat > 0 && (Date.now() - connectionState.lastHeartbeat < 4500);
  const isHeartbeatTimeout = phase === 'HEARTBEAT_TIMEOUT' || phase === 'NO_MAVLINK_HEARTBEAT' || (isConnected && Date.now() - connectionState.lastHeartbeat > 4500);
  const isWaitingMavlink = (phase === 'WAITING_FOR_MAVLINK' || phase === 'WAITING_FOR_HEARTBEAT' || phase === 'SERIAL_OPEN') && !isConnected;

  // Active Connection State per Mode
  const isEsp32Active = connectionState.connectionType === 'ESP32_WEBSOCKET' && (
    isUsbConnected || 
    isConnected || 
    phase === 'SERIAL_OPEN' || 
    phase === 'WAITING_FOR_MAVLINK' || 
    phase === 'WAITING_FOR_HEARTBEAT' ||
    phase === 'HEARTBEAT_RECEIVED' ||
    phase === 'PIXHAWK_CONNECTED' ||
    phase === 'TELEMETRY_ACTIVE' ||
    phase === 'MAVLINK_CONNECTED'
  );

  const isUsbActive = connectionState.connectionType === 'USB_SERIAL' && (
    isUsbConnected || isConnected || phase === 'SERIAL_OPEN'
  );

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
  const isSerialOpen = isUsbConnected || phase === 'SERIAL_OPEN' || isConnected;

  const handleScan = async () => {
    setIsScanning(true);
    try {
      await mavlinkService.scanUsbDevices();
      await mavlinkService.connectHardware(selectedBaud);
    } finally {
      setIsScanning(false);
    }
  };

  const handleConnectUsb = async () => {
    setIsConnecting(true);
    try {
      await mavlinkService.connectHardware(selectedBaud);
    } catch (e) {
      console.warn('Connect error:', e);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnectEsp32 = async () => {
    setIsConnecting(true);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('esp32_host', esp32Host.trim());
        localStorage.setItem('esp32_port', esp32Port.toString());
        localStorage.setItem('esp32_proto', esp32Proto);
        localStorage.setItem('esp32_baud', selectedBaud.toString());
      }
      await mavlinkService.connectEsp32(esp32Host.trim(), esp32Port, esp32Proto, selectedBaud);
    } catch (e) {
      console.warn('ESP32 connect error:', e);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleCheckEsp32 = async () => {
    setIsCheckingEsp32(true);
    setEsp32PingResult(null);
    try {
      const result = await mavlinkService.checkEsp32Http(esp32Host.trim());
      setEsp32PingResult(result);
    } catch (e: any) {
      setEsp32PingResult({ reachable: false, message: e.message || 'Check failed' });
    } finally {
      setIsCheckingEsp32(false);
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
    setIsConnecting(false);
    await mavlinkService.disconnect();
  };

  const handleBaudChange = (newBaud: number) => {
    setSelectedBaud(newBaud);
    if (isUsbConnected && connectionState.connectionType === 'USB_SERIAL') {
      mavlinkService.connectHardware(newBaud);
    }
  };

  // Format bytes helper
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Format last packet age
  const formatPacketAge = () => {
    if (!diag.lastPacketTimestamp || diag.lastPacketTimestamp === 0) return 'Never';
    const ageMs = Date.now() - diag.lastPacketTimestamp;
    if (ageMs < 1000) return `${ageMs}ms ago`;
    return `${(ageMs / 1000).toFixed(1)}s ago`;
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
        
        {/* Top Header & Connection Mode Selector */}
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
              {isEsp32Mode ? (
                <Wifi className="w-4 h-4 sm:w-5 sm:h-5" />
              ) : isSimulated ? (
                <Cpu className="w-4 h-4 sm:w-5 sm:h-5" />
              ) : (
                <Usb className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs sm:text-sm font-black uppercase text-white tracking-wider">
                  {isEsp32Mode ? 'ESP32-S3 WIRELESS MAVLINK' : isSimulated ? 'SITL BENCH SIMULATOR' : 'PIXHAWK USB OTG CONNECTION'}
                </span>
                
                {/* Real-time Status Badge */}
                <span className={`text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-full border ${
                  isConnected
                    ? isSimulated
                      ? 'bg-purple-950/80 text-purple-300 border-purple-500/50'
                      : connectionState.connectionType === 'ESP32_WEBSOCKET'
                      ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/60 animate-pulse'
                      : 'bg-emerald-950/90 text-emerald-300 border-emerald-500/60'
                    : isWaitingMavlink
                    ? 'bg-amber-950/80 text-amber-300 border-amber-500/50 animate-pulse'
                    : isHeartbeatTimeout
                    ? 'bg-amber-950/80 text-amber-300 border-amber-500/50'
                    : phase === 'PERMISSION_DENIED'
                    ? 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                    : isUsbConnected
                    ? 'bg-sky-950/80 text-sky-300 border-sky-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  {isConnected
                    ? isSimulated
                      ? 'SIMULATED MAVLINK ✓'
                      : connectionState.connectionType === 'ESP32_WEBSOCKET'
                      ? 'MAVLINK CONNECTED ✓'
                      : 'PIXHAWK CONNECTED ✓'
                    : isWaitingMavlink
                    ? 'WAITING HEARTBEAT ⟳'
                    : isHeartbeatTimeout
                    ? 'HEARTBEAT TIMEOUT ⚠️'
                    : isWebSocketOpen
                    ? 'WEBSOCKET OPEN (WAITING)'
                    : phase === 'PERMISSION_DENIED'
                    ? 'PERMISSION DENIED'
                    : 'DISCONNECTED'}
                </span>
              </div>
              
              <div className="text-[11px] text-slate-400 truncate max-w-[260px] sm:max-w-md">
                {connectionState.portOrAddress}
              </div>
            </div>
          </div>

          {/* Connection Method Selector Tabs */}
          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs shrink-0">
            <button
              onClick={() => {
                setConnectionMode('ESP32');
                if (connectionState.connectionType !== 'ESP32_WEBSOCKET') {
                  mavlinkService.disconnect();
                }
              }}
              className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 ${
                connectionMode === 'ESP32'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Wifi className="w-3.5 h-3.5 text-purple-200" />
              <span>ESP32-S3 Wireless</span>
            </button>
            <button
              onClick={() => {
                setConnectionMode('USB');
                if (connectionState.connectionType !== 'USB_SERIAL') {
                  mavlinkService.disconnect();
                }
              }}
              className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 ${
                connectionMode === 'USB'
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Usb className="w-3.5 h-3.5" />
              <span>USB OTG / Serial</span>
            </button>
            <button
              onClick={() => {
                setConnectionMode('SIM');
                mavlinkService.switchToSimulationMode();
              }}
              className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 ${
                isSimulated
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Simulator</span>
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SECTION 1: ESP32-S3 WIRELESS MAVLINK DECK (WHEN ESP32 MODE IS ACTIVE)     */}
        {/* ========================================================================= */}
        {connectionMode === 'ESP32' && (
          <div className="my-3 p-3.5 bg-purple-950/30 border border-purple-500/40 rounded-xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-purple-500/20">
              <div className="flex items-center space-x-2">
                <Wifi className="w-4 h-4 text-purple-400 shrink-0" />
                <span className="text-xs font-black text-purple-200 uppercase tracking-wider">
                  Pixhawk TELEM2 ➔ ESP32-S3 Wi-Fi WebSocket Bridge
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleCheckEsp32}
                  disabled={isCheckingEsp32}
                  className="text-[11px] px-2 py-0.5 bg-purple-900/60 hover:bg-purple-800 text-purple-200 rounded border border-purple-500/40 flex items-center space-x-1 cursor-pointer"
                >
                  {isCheckingEsp32 ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  <span>Check ESP32</span>
                </button>
                <button
                  onClick={() => setShowEsp32Guide(true)}
                  className="text-[11px] text-purple-300 hover:text-purple-100 flex items-center space-x-1 underline cursor-pointer"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Wiring Guide</span>
                </button>
              </div>
            </div>

            {/* Ping Feedback Banner */}
            {esp32PingResult && (
              <div className={`px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between border ${
                esp32PingResult.reachable
                  ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300'
                  : 'bg-rose-950/80 border-rose-500/60 text-rose-300'
              }`}>
                <div className="flex items-center space-x-1.5">
                  {esp32PingResult.reachable ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                  <span>{esp32PingResult.message}</span>
                </div>
                <button onClick={() => setEsp32PingResult(null)} className="text-[10px] text-slate-400 hover:text-white ml-2">✕</button>
              </div>
            )}

            {/* Input Controls Bar: Protocol, IP, Port, Baud, Connect / Disconnect */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs items-center">
              
              {/* Protocol */}
              <div className="sm:col-span-2 flex items-center space-x-1 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-700">
                <span className="text-slate-400 text-[10px] font-bold uppercase shrink-0">Proto:</span>
                <select
                  value={esp32Proto}
                  onChange={(e) => setEsp32Proto(e.target.value as 'ws' | 'wss')}
                  className="bg-transparent text-slate-100 font-mono text-xs w-full focus:outline-none cursor-pointer"
                >
                  <option value="ws" className="bg-slate-900 text-white">ws://</option>
                  <option value="wss" className="bg-slate-900 text-white">wss://</option>
                </select>
              </div>

              {/* IP Input */}
              <div className="sm:col-span-4 flex items-center space-x-1.5 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-700">
                <span className="text-slate-400 text-[10px] font-bold uppercase shrink-0">ESP32 IP:</span>
                <input
                  type="text"
                  value={esp32Host}
                  onChange={(e) => setEsp32Host(e.target.value)}
                  placeholder="192.168.4.1"
                  className="bg-transparent text-slate-100 font-mono text-xs w-full focus:outline-none"
                />
              </div>

              {/* Port Input */}
              <div className="sm:col-span-2 flex items-center space-x-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-700">
                <span className="text-slate-400 text-[10px] font-bold uppercase shrink-0">Port:</span>
                <input
                  type="number"
                  value={esp32Port}
                  onChange={(e) => setEsp32Port(parseInt(e.target.value, 10) || 8080)}
                  placeholder="8080"
                  className="bg-transparent text-slate-100 font-mono text-xs w-full focus:outline-none"
                />
              </div>

              {/* Baud Rate Dropdown */}
              <div className="sm:col-span-2 flex items-center space-x-1 bg-slate-950 px-2 py-1.5 rounded-lg border border-slate-700">
                <span className="text-slate-400 text-[10px] font-bold uppercase shrink-0">Baud:</span>
                <select
                  value={selectedBaud}
                  onChange={(e) => handleBaudChange(Number(e.target.value))}
                  className="bg-transparent text-slate-100 font-mono text-xs w-full focus:outline-none cursor-pointer"
                >
                  <option value={57600} className="bg-slate-900 text-white">57600</option>
                  <option value={115200} className="bg-slate-900 text-white">115200</option>
                  <option value={921600} className="bg-slate-900 text-white">921600</option>
                  <option value={38400} className="bg-slate-900 text-white">38400</option>
                </select>
              </div>

              {/* Action Button: Connect / Connecting / Disconnect */}
              <div className="sm:col-span-2">
                {isConnecting ? (
                  <button
                    disabled
                    className="w-full py-2 bg-purple-800 text-purple-200 rounded-lg text-xs font-black uppercase tracking-wide flex items-center justify-center space-x-1.5 opacity-80 cursor-not-allowed"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>CONNECTING...</span>
                  </button>
                ) : isEsp32Active ? (
                  <button
                    onClick={handleDisconnect}
                    className="w-full py-2 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white rounded-lg text-xs font-black uppercase tracking-wide transition flex items-center justify-center space-x-1.5 shadow-lg shadow-rose-600/30 cursor-pointer"
                  >
                    <PowerOff className="w-3.5 h-3.5" />
                    <span>DISCONNECT</span>
                  </button>
                ) : (
                  <button
                    onClick={handleConnectEsp32}
                    className="w-full py-2 bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white rounded-lg text-xs font-black uppercase tracking-wide transition flex items-center justify-center space-x-1.5 shadow-lg shadow-purple-600/30 cursor-pointer"
                  >
                    <Wifi className="w-3.5 h-3.5" />
                    <span>CONNECT</span>
                  </button>
                )}
              </div>
            </div>

            {/* Live Connection Diagnostics Matrix */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 pt-1 text-[10px]">
              
              {/* 1. ESP32 State */}
              <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">ESP32 IP</div>
                <div className="font-bold text-purple-300 truncate mt-0.5">{esp32Host}:{esp32Port}</div>
              </div>

              {/* 2. WebSocket State */}
              <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">WebSocket</div>
                <div className={`font-bold mt-0.5 ${
                  isWebSocketOpen ? 'text-emerald-400' : isConnecting ? 'text-amber-400' : 'text-slate-400'
                }`}>
                  {isWebSocketOpen ? 'CONNECTED ✓' : isConnecting ? 'CONNECTING...' : 'DISCONNECTED'}
                </div>
              </div>

              {/* 3. MAVLink State */}
              <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">MAVLink</div>
                <div className={`font-bold mt-0.5 ${
                  isConnected ? 'text-emerald-400' : isWaitingMavlink ? 'text-amber-400' : 'text-slate-400'
                }`}>
                  {isConnected ? 'CONNECTED ✓' : isWaitingMavlink ? 'WAITING ⟳' : 'DISCONNECTED'}
                </div>
              </div>

              {/* 4. Heartbeat State */}
              <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">Heartbeat</div>
                <div className={`font-bold mt-0.5 ${
                  isMavlinkHeartbeatReceived ? 'text-emerald-400' : 'text-amber-400'
                }`}>
                  {isMavlinkHeartbeatReceived 
                    ? `RECEIVED (${connectionState.heartbeatHz || 1.0} Hz)` 
                    : 'NOT RECEIVED'}
                </div>
              </div>

              {/* 5. Cumulative RX / TX Bytes Counter */}
              <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">RX / TX Cumulative</div>
                <div className="font-bold text-slate-200 mt-0.5 truncate">
                  <span className="text-emerald-400">{formatBytes(connectionState.bytesReceived)}</span>
                  <span className="text-slate-500"> / </span>
                  <span className="text-sky-400">{formatBytes(connectionState.bytesSent)}</span>
                </div>
              </div>

              {/* 6. Last Packet & Msg */}
              <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
                <div className="text-slate-400 uppercase font-bold">Last Packet</div>
                <div className="font-bold text-slate-300 truncate mt-0.5" title={diag.lastMavlinkMessageName || 'None'}>
                  {diag.lastMavlinkMessageName ? `${diag.lastMavlinkMessageName}` : formatPacketAge()}
                </div>
              </div>
            </div>

            {/* Collapsible Developer Diagnostics Bar */}
            <div className="pt-1">
              <button
                onClick={() => setShowDevDetails(!showDevDetails)}
                className="text-[11px] text-purple-300 hover:text-purple-100 flex items-center space-x-1 cursor-pointer"
              >
                {showDevDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                <span>{showDevDetails ? 'Hide Developer Diagnostics' : 'Show Developer Diagnostics (Section 28)'}</span>
              </button>

              {showDevDetails && (
                <div className="mt-2 p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-[11px] space-y-1 text-slate-300">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div><strong className="text-slate-400">Transport:</strong> ESP32 WebSocket</div>
                    <div><strong className="text-slate-400">URL:</strong> {esp32Proto}://{esp32Host}:{esp32Port}</div>
                    <div><strong className="text-slate-400">WS State:</strong> {isWebSocketOpen ? 'OPEN (ReadyState 1)' : 'CLOSED (ReadyState 3)'}</div>
                    <div><strong className="text-slate-400">SysID / CompID:</strong> {connectionState.systemId || '—'} / {connectionState.componentId || '—'}</div>
                    <div><strong className="text-slate-400">RX Exact:</strong> {connectionState.bytesReceived} bytes</div>
                    <div><strong className="text-slate-400">TX Exact:</strong> {connectionState.bytesSent} bytes</div>
                    <div><strong className="text-slate-400">Last Msg:</strong> {diag.lastMavlinkMessageName ? `${diag.lastMavlinkMessageName} (#${diag.lastMavlinkMessageId})` : '—'}</div>
                    <div><strong className="text-slate-400">Phase Message:</strong> <span className="text-purple-300">{connectionState.phaseMessage}</span></div>
                  </div>
                </div>
              )}
            </div>

            {/* HTTPS Mixed Content Alert */}
            {isHttpsOrigin && esp32Proto === 'ws' && (
              <div className="p-2.5 bg-amber-950/70 border border-amber-500/60 rounded-lg text-amber-200 text-[11px] space-y-1">
                <div className="flex items-center space-x-1.5 font-bold text-amber-300">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>HTTPS Mixed Content Notice</span>
                </div>
                <p className="text-[10px] text-amber-300/90 leading-relaxed">
                  ESP32 local WebSocket requires HTTP for this development connection. Open the local Ground Station URL (<code>http://192.168.10.213:5173</code>) or use the Android native version.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* SECTION 2: DIRECT USB OTG / SERIAL CONTROLS                               */}
        {/* ========================================================================= */}
        {connectionMode === 'USB' && (
          <>
            {/* Dedicated Responsive State Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 my-3 text-[11px]">
              
              {/* 1. USB Status */}
              <div className={`p-2.5 rounded-xl border flex flex-col justify-between ${
                isUsbDetected || isConnected
                  ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
                  : 'bg-slate-950/40 border-slate-800 text-slate-400'
              }`}>
                <span className="text-[10px] uppercase text-slate-500 font-bold">USB Host</span>
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
                      <span>Not Detected</span>
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
                    <span className="text-emerald-300 truncate" title={diag.productName || 'Pixhawk / USB Serial'}>
                      {diag.productName || 'Pixhawk / USB Serial'}
                    </span>
                  ) : (
                    <span className="text-slate-500 font-bold">—</span>
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
                    <span className="text-emerald-300">Granted ✓</span>
                  ) : isPermissionRequested ? (
                    <span className="text-amber-300">Requesting...</span>
                  ) : isPermissionDenied ? (
                    <span className="text-rose-300">Denied</span>
                  ) : (
                    <span className="text-slate-500 font-bold">—</span>
                  )}
                </div>
              </div>

              {/* 4. Serial Baud */}
              <div className={`p-2.5 rounded-xl border flex flex-col justify-between ${
                isSerialOpen || isConnected
                  ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
                  : 'bg-slate-950/40 border-slate-800 text-slate-400'
              }`}>
                <span className="text-[10px] uppercase text-slate-500 font-bold">Serial Baud</span>
                <div className="flex items-center space-x-1.5 mt-1 font-bold">
                  {isSerialOpen || isConnected ? (
                    <span className="text-emerald-300">{selectedBaud} Baud</span>
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
                    <span className="text-emerald-300">Connected ✓</span>
                  ) : isWaitingMavlink ? (
                    <span className="text-amber-300">Waiting...</span>
                  ) : (
                    <span className="text-slate-500 font-bold">—</span>
                  )}
                </div>
              </div>

              {/* 6. Heartbeat Stream */}
              <div className={`p-2.5 rounded-xl border flex flex-col justify-between ${
                isConnected
                  ? 'bg-slate-950/80 border-emerald-500/40 text-slate-200'
                  : 'bg-slate-950/40 border-slate-800 text-slate-400'
              }`}>
                <span className="text-[10px] uppercase text-slate-500 font-bold">Heartbeat</span>
                <div className="flex items-center space-x-1.5 mt-1 font-bold">
                  {isConnected ? (
                    <span className="text-emerald-300">SysID {connectionState.systemId || 1} ({connectionState.heartbeatHz || 1.0} Hz)</span>
                  ) : (
                    <span className="text-slate-500 font-bold">—</span>
                  )}
                </div>
              </div>
            </div>

            {/* Action Controls Bar for Direct USB OTG Mode */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
              <div className="flex items-center space-x-2 text-xs">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Baud:</span>
                <select
                  value={selectedBaud}
                  onChange={(e) => handleBaudChange(Number(e.target.value))}
                  className="bg-slate-950 text-slate-200 text-xs px-2.5 py-1 rounded-lg border border-slate-700 cursor-pointer"
                >
                  <option value={57600}>57600 (Default Telemetry)</option>
                  <option value={115200}>115200 (USB / High-Speed)</option>
                  <option value={921600}>921600 (Fast UART)</option>
                  <option value={38400}>38400 (Legacy)</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                {isConnecting ? (
                  <button
                    disabled
                    className="px-3.5 py-1.5 bg-emerald-800 text-emerald-200 rounded-lg text-xs font-black uppercase tracking-wide flex items-center space-x-1.5 opacity-80 cursor-not-allowed"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>CONNECTING...</span>
                  </button>
                ) : isUsbActive ? (
                  <button
                    onClick={handleDisconnect}
                    className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white rounded-lg text-xs font-black uppercase tracking-wide transition flex items-center space-x-1.5 shadow-lg shadow-rose-600/30 cursor-pointer"
                  >
                    <PowerOff className="w-3.5 h-3.5" />
                    <span>DISCONNECT</span>
                  </button>
                ) : !isUsbDetected && !isConnected ? (
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
                ) : (
                  <button
                    onClick={handleConnectUsb}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg text-xs font-black uppercase tracking-wide transition flex items-center space-x-1.5 shadow-lg shadow-emerald-600/30 cursor-pointer animate-pulse"
                  >
                    <Usb className="w-3.5 h-3.5" />
                    <span>CONNECT PIXHAWK</span>
                  </button>
                )}

                <button
                  onClick={() => setShowDiagnostics(true)}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-lg text-xs font-bold transition flex items-center space-x-1 border border-slate-700 cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Diagnostics</span>
                </button>

                {onOpenHelp && (
                  <button
                    onClick={onOpenHelp}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-lg text-xs font-bold transition flex items-center space-x-1 border border-slate-700 cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">OTG Guide</span>
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* Diagnostic Failure / Timeout Notification Panels */}
        {isHeartbeatTimeout ? (
          <div className="mt-3 p-3 bg-amber-950/50 border border-amber-500/50 rounded-xl text-xs text-amber-200 space-y-2">
            <div className="flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-amber-300">
                  {isEsp32Mode ? 'ESP32 connected, but Pixhawk MAVLink heartbeat not received.' : 'USB connected, but no MAVLink heartbeat received.'}
                </strong>
                <p className="text-[11px] text-amber-300/80 mt-0.5">
                  The transport link is active, but the Pixhawk autopilot is not returning valid MAVLink heartbeat packets. Check TELEM2 UART wiring (TX➔RX, RX➔TX, GND➔GND) and verify Pixhawk power.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-amber-300/70">Verify TELEM2 baud rate = 57600 (SERIAL2_BAUD = 57).</span>
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={isEsp32Mode ? handleConnectEsp32 : handleConnectUsb}
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
        ) : phase === 'PERMISSION_DENIED' ? (
          <div className="mt-3 p-3 bg-rose-950/50 border border-rose-500/50 rounded-xl flex items-center justify-between text-xs text-rose-200">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>USB permission denied. Please allow USB access on your phone.</span>
            </div>
            <button
              onClick={handleRequestPermission}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs cursor-pointer"
            >
              Request Permission
            </button>
          </div>
        ) : null}
      </div>

      {/* ESP32-S3 WI-FI PROVISIONING & TELEM2 WIRING GUIDE MODAL */}
      {showEsp32Guide && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 font-mono">
          <div className="bg-slate-900 border-2 border-purple-500/60 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-purple-950 rounded-xl border border-purple-500/50 text-purple-400">
                  <Wifi className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm sm:text-base text-white uppercase tracking-wider">
                    ESP32-S3 Wi-Fi Provisioning &amp; TELEM2 Wiring Guide
                  </h3>
                  <p className="text-xs text-purple-300">Transparent MAVLink Bridge Architecture</p>
                </div>
              </div>
              <button
                onClick={() => setShowEsp32Guide(false)}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* 1. Hardware Architecture & Wiring */}
            <div className="space-y-2">
              <div className="text-xs font-black uppercase text-purple-300 flex items-center space-x-1.5">
                <Cable className="w-4 h-4" />
                <span>1. Pixhawk 2.4.8 TELEM2 Pinout &amp; Wiring</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-300 space-y-2">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-bold">
                      <th className="py-1">TELEM2 Pin</th>
                      <th className="py-1">Signal</th>
                      <th className="py-1">ESP32-S3 Target Pin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-200">
                    <tr>
                      <td className="py-1 font-bold text-amber-400">Pin 1</td>
                      <td>+5V Power</td>
                      <td className="font-bold text-emerald-400">ESP32-S3 5V/VIN Input</td>
                    </tr>
                    <tr>
                      <td className="py-1 font-bold text-sky-400">Pin 2</td>
                      <td>TX (Transmit)</td>
                      <td className="font-bold text-sky-300">ESP32-S3 RX (UART Pin)</td>
                    </tr>
                    <tr>
                      <td className="py-1 font-bold text-sky-400">Pin 3</td>
                      <td>RX (Receive)</td>
                      <td className="font-bold text-sky-300">ESP32-S3 TX (UART Pin)</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-slate-500">Pin 4</td>
                      <td>CTS</td>
                      <td className="text-slate-500">NOT CONNECTED</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-slate-500">Pin 5</td>
                      <td>RTS</td>
                      <td className="text-slate-500">NOT CONNECTED</td>
                    </tr>
                    <tr>
                      <td className="py-1 font-bold text-slate-400">Pin 6</td>
                      <td>GND</td>
                      <td className="font-bold text-slate-300">ESP32-S3 GND</td>
                    </tr>
                  </tbody>
                </table>
                <div className="p-2 bg-rose-950/50 border border-rose-500/40 rounded-lg text-rose-300 text-[10px]">
                  ⚠️ <strong>SAFETY CAUTION:</strong> Do NOT connect Pixhawk 5V output to the ESP32 3.3V pin. Connect to ESP32 5V / VIN pin only.
                </div>
              </div>
            </div>

            {/* 2. Step-by-Step Wi-Fi Provisioning Workflow */}
            <div className="space-y-2">
              <div className="text-xs font-black uppercase text-purple-300 flex items-center space-x-1.5">
                <Globe className="w-4 h-4" />
                <span>2. ESP32-S3 Wi-Fi Provisioning Workflow</span>
              </div>
              <ol className="list-decimal list-inside space-y-1.5 bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-300">
                <li>Power on the ESP32-S3. It will broadcast its setup Access Point: <strong className="text-purple-300">DRONE_ESP</strong>.</li>
                <li>Connect your Phone / Laptop Wi-Fi to <strong className="text-purple-300">DRONE_ESP</strong>.</li>
                <li>Open a browser and navigate to: <strong className="text-emerald-400">http://192.168.4.1</strong>.</li>
                <li>The ESP32 page will scan nearby 2.4 GHz Wi-Fi networks. Select your network SSID and enter the password.</li>
                <li>ESP32 saves credentials, shuts down the <code className="text-purple-300">DRONE_ESP</code> AP, connects to the Wi-Fi, and starts the MAVLink WebSocket server on port <strong className="text-emerald-400">8080</strong>.</li>
                <li>Reconnect your phone to the same Wi-Fi, enter the ESP32 IP address in this app, and tap <strong className="text-purple-400">CONNECT</strong>.</li>
              </ol>
            </div>

            {/* 3. Pixhawk ArduPilot Parameter Config */}
            <div className="space-y-2">
              <div className="text-xs font-black uppercase text-purple-300 flex items-center space-x-1.5">
                <Sliders className="w-4 h-4" />
                <span>3. Pixhawk Parameters for TELEM2</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-300 space-y-1">
                <div>• <strong>SERIAL2_PROTOCOL = 2</strong> (MAVLink2)</div>
                <div>• <strong>SERIAL2_BAUD = 57</strong> (57600 baud rate)</div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowEsp32Guide(false)}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Got It, Close Guide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Connection Diagnostics Screen Modal */}
      <SerialDiagnosticsModal
        isOpen={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        connectionState={connectionState}
      />
    </>
  );
};
