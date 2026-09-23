import React, { useState } from 'react';
import { PixhawkConnectionState } from '../../types/mavlink';
import { mavlinkService } from '../../services/mavlinkService';
import {
  X,
  Sliders,
  Cpu,
  Usb,
  Radio,
  Activity,
  Terminal,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  ShieldCheck,
  Zap
} from 'lucide-react';

interface SerialDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionState: PixhawkConnectionState;
}

export const SerialDiagnosticsModal: React.FC<SerialDiagnosticsModalProps> = ({
  isOpen,
  onClose,
  connectionState
}) => {
  const [selectedBaud, setSelectedBaud] = useState<number>(connectionState.baudRate || 115200);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);

  if (!isOpen) return null;

  const diag = connectionState.diagnostics;
  const isConnected = connectionState.isConnected;
  const lastHeartbeatAge = connectionState.lastHeartbeat
    ? Math.max(0, Math.round((Date.now() - connectionState.lastHeartbeat) / 1000))
    : null;

  const handleApplyBaudAndReconnect = async () => {
    setIsReconnecting(true);
    try {
      await mavlinkService.connectHardware(selectedBaud);
    } catch (e) {
      console.warn('Diagnostics reconnect error:', e);
    } finally {
      setIsReconnecting(false);
    }
  };

  const formatHex = (val?: number) => {
    if (val === undefined || val === null) return 'N/A';
    return '0x' + val.toString(16).toUpperCase().padStart(4, '0');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 font-mono select-none overflow-y-auto">
      <div className="bg-slate-900 border-2 border-slate-700 rounded-2xl max-w-3xl w-full p-4 sm:p-6 space-y-4 text-slate-200 shadow-2xl relative my-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-sky-950/80 border border-sky-500/50 rounded-xl text-sky-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black uppercase text-white tracking-wider">
                USB OTG & SERIAL DIAGNOSTICS
              </h2>
              <p className="text-[11px] text-slate-400">
                Low-level Android USB Host, endpoint descriptors & MAVLink stream monitor
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 1. USB Hardware & Endpoint Descriptors */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-sky-400 uppercase flex items-center space-x-1.5">
            <Usb className="w-4 h-4" />
            <span>USB Hardware Descriptors & Host Driver</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">Product / Model</div>
              <div className="font-bold text-slate-200 truncate mt-0.5" title={diag.productName}>
                {diag.productName || 'Pixhawk 2.4.8'}
              </div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">Vendor ID / Product ID</div>
              <div className="font-bold text-emerald-400 mt-0.5">
                {formatHex(diag.vendorId)} : {formatHex(diag.productId)}
              </div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">Driver Backend</div>
              <div className="font-bold text-purple-400 mt-0.5 truncate">
                {diag.driverType}
              </div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">USB Endpoints (In / Out)</div>
              <div className="font-bold text-sky-400 mt-0.5">
                EP {diag.endpointIn ?? 1} (IN) / EP {diag.endpointOut ?? 2} (OUT)
              </div>
            </div>
          </div>
        </div>

        {/* 2. Connection State Machine & Data Flow */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-emerald-400 uppercase flex items-center space-x-1.5">
            <Activity className="w-4 h-4" />
            <span>Connection State Machine & Packet Stats</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">Current Phase</div>
              <div className="font-bold text-amber-300 mt-0.5 truncate">
                {connectionState.phase}
              </div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">Heartbeat Rate</div>
              <div className="font-bold text-emerald-400 mt-0.5">
                {connectionState.heartbeatHz || (isConnected ? 1.0 : 0)} Hz
                {lastHeartbeatAge !== null && ` (${lastHeartbeatAge}s ago)`}
              </div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">Total Packets Parsed</div>
              <div className="font-bold text-slate-200 mt-0.5">
                {diag.totalPacketsReceived.toLocaleString()} frames
              </div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">Total Traffic (RX / TX)</div>
              <div className="font-bold text-sky-400 mt-0.5">
                {(connectionState.bytesReceived / 1024).toFixed(1)} KB / {(connectionState.bytesSent / 1024).toFixed(1)} KB
              </div>
            </div>
          </div>
        </div>

        {/* 3. MAVLink System & Autopilot Details */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-purple-400 uppercase flex items-center space-x-1.5">
            <Cpu className="w-4 h-4" />
            <span>Flight Controller Identity</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">Autopilot Firmware</div>
              <div className="font-bold text-slate-200 truncate mt-0.5">
                {connectionState.autopilotType || 'ArduCopter / PX4'}
              </div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">Vehicle Type</div>
              <div className="font-bold text-slate-200 mt-0.5">
                {diag.vehicleType || 'QUADROTOR'}
              </div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">System ID / Comp ID</div>
              <div className="font-bold text-emerald-400 mt-0.5">
                Sys {connectionState.systemId || 1} / Comp {connectionState.componentId || 1}
              </div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">EKF Status</div>
              <div className="font-bold text-emerald-400 mt-0.5">
                {connectionState.ekfHealthy ? 'HEALTHY ✓' : 'UNHEALTHY ⚠️'}
              </div>
            </div>
          </div>
        </div>

        {/* 4. Live Message Stream from Pixhawk */}
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-slate-300 uppercase flex items-center space-x-1.5">
            <Terminal className="w-4 h-4 text-sky-400" />
            <span>Live Pixhawk STATUSTEXT Console ({connectionState.statusHistory.length} events)</span>
          </div>
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 max-h-36 overflow-y-auto text-[11px] space-y-1">
            {connectionState.statusHistory.length === 0 ? (
              <div className="text-slate-600 italic">No status messages received yet. Connect Pixhawk to stream.</div>
            ) : (
              connectionState.statusHistory.map((msg) => (
                <div key={msg.id} className="flex items-start space-x-2 leading-tight">
                  <span className={msg.severityLevel <= 3 ? 'text-rose-400 font-bold' : msg.severityLevel === 4 ? 'text-amber-400' : 'text-sky-400'}>
                    [{new Date(msg.timestamp).toLocaleTimeString()}]
                  </span>
                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                    msg.severityLevel <= 3 ? 'bg-rose-950 text-rose-300' : msg.severityLevel === 4 ? 'bg-amber-950 text-amber-300' : 'bg-slate-900 text-slate-300'
                  }`}>
                    {msg.severity}
                  </span>
                  <span className="text-slate-200">
                    {msg.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 5. Advanced Serial Baud Override & Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400 font-bold uppercase">Baud Rate Override:</span>
            <select
              value={selectedBaud}
              onChange={(e) => setSelectedBaud(Number(e.target.value))}
              className="bg-slate-950 text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-slate-700 cursor-pointer"
            >
              <option value={115200}>115200 bps (Direct USB OTG / UART)</option>
              <option value={57600}>57600 bps (TELEM1 / 3DR SiK Radio)</option>
              <option value={921600}>921600 bps (High-Speed Companion)</option>
              <option value={38400}>38400 bps (Legacy Radio)</option>
              <option value={9600}>9600 bps (GPS / Debug)</option>
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleApplyBaudAndReconnect}
              disabled={isReconnecting}
              className="px-3.5 py-2 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer shadow-lg shadow-sky-600/30"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
              <span>{isReconnecting ? 'Applying...' : 'Apply & Re-Sync'}</span>
            </button>

            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
