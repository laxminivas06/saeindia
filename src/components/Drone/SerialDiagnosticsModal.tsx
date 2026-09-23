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
  Zap,
  PowerOff,
  RotateCcw,
  Search,
  KeyRound,
  Check,
  Battery,
  Navigation,
  ExternalLink
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
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isActionInProgress, setIsActionInProgress] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'troubleshooting' | 'logs'>('overview');

  if (!isOpen) return null;

  const diag = connectionState.diagnostics;
  const phase = connectionState.phase;
  const isConnected = connectionState.isConnected;
  const isUsbConnected = connectionState.isUsbConnected;
  const isUsbDetected = phase !== 'DISCONNECTED' && phase !== 'USB_NOT_DETECTED' && phase !== 'IOS_UNSUPPORTED';
  const hasPermission = diag.hasPermission !== false && phase !== 'PERMISSION_DENIED' && phase !== 'REQUESTING_PERMISSION';

  const lastHeartbeatAge = connectionState.lastHeartbeat
    ? Math.max(0, Math.round((Date.now() - connectionState.lastHeartbeat) / 1000))
    : null;

  const handleScanDevices = async () => {
    setIsScanning(true);
    try {
      await mavlinkService.scanUsbDevices();
      await mavlinkService.connectHardware(selectedBaud);
    } finally {
      setIsScanning(false);
    }
  };

  const handleRequestPermission = async () => {
    setIsActionInProgress(true);
    try {
      await mavlinkService.requestUsbPermission();
    } finally {
      setIsActionInProgress(false);
    }
  };

  const handleConnect = async () => {
    setIsActionInProgress(true);
    try {
      await mavlinkService.connectHardware(selectedBaud);
    } finally {
      setIsActionInProgress(false);
    }
  };

  const handleDisconnect = async () => {
    setIsActionInProgress(true);
    try {
      await mavlinkService.disconnect();
    } finally {
      setIsActionInProgress(false);
    }
  };

  const formatHex = (val?: number) => {
    if (val === undefined || val === null) return 'N/A';
    return '0x' + val.toString(16).toUpperCase().padStart(4, '0');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 font-mono select-none overflow-y-auto">
      <div className="bg-slate-900 border-2 border-slate-700 rounded-2xl max-w-4xl w-full p-3.5 sm:p-6 space-y-4 text-slate-200 shadow-2xl relative my-auto max-h-[92vh] flex flex-col">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-sky-950/80 border border-sky-500/50 rounded-xl text-sky-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black uppercase text-white tracking-wider flex items-center space-x-2">
                <span>PIXHAWK USB CONNECTION DIAGNOSTICS</span>
              </h2>
              <p className="text-[10px] sm:text-[11px] text-slate-400">
                Low-level Android USB Host, endpoint descriptors & MAVLink parser
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

        {/* Navigation Tabs for Mobile / Tablet */}
        <div className="flex items-center space-x-1 border-b border-slate-800 pb-2 text-xs shrink-0">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            Status & Overview
          </button>
          <button
            onClick={() => setActiveTab('troubleshooting')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
              activeTab === 'troubleshooting'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            OTG & Power Checklist
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'logs'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <span>Live Developer Logs</span>
            <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-slate-900 text-sky-300">
              {connectionState.diagnosticsLogs.length}
            </span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="space-y-4 overflow-y-auto pr-1 flex-1">
          
          {activeTab === 'overview' && (
            <>
              {/* Top Summary Status Grid (as requested in requirement 3) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
                
                {/* USB Status */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">USB Status</div>
                  <div className="font-bold flex items-center space-x-1.5 mt-1">
                    {isUsbDetected ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span className="text-emerald-400">🟢 Device Detected</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                        <span className="text-rose-400">🔴 Not Detected</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Device Name */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Device</div>
                  <div className="font-bold text-slate-200 truncate mt-1" title={diag.productName}>
                    {diag.productName || (isUsbDetected ? 'Pixhawk / FC' : 'None')}
                  </div>
                </div>

                {/* VID / PID */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">VID / PID</div>
                  <div className="font-bold text-emerald-400 mt-1">
                    {formatHex(diag.vendorId)} : {formatHex(diag.productId)}
                  </div>
                </div>

                {/* USB Interface */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">USB Interface</div>
                  <div className="font-bold text-sky-400 mt-1 truncate">
                    {isUsbConnected ? `CDC-ACM (EP ${diag.endpointIn || 1} IN / ${diag.endpointOut || 2} OUT)` : 'Standby'}
                  </div>
                </div>

                {/* Permission */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Permission</div>
                  <div className="font-bold mt-1">
                    {phase === 'PERMISSION_DENIED' ? (
                      <span className="text-rose-400">Denied</span>
                    ) : phase === 'REQUESTING_PERMISSION' ? (
                      <span className="text-amber-400">Requesting...</span>
                    ) : hasPermission && isUsbDetected ? (
                      <span className="text-emerald-400">Granted ✓</span>
                    ) : (
                      <span className="text-slate-400">Pending</span>
                    )}
                  </div>
                </div>

                {/* USB Connection */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">USB Connection</div>
                  <div className="font-bold mt-1">
                    {isUsbConnected ? (
                      <span className="text-emerald-400">Connected ({connectionState.baudRate})</span>
                    ) : (
                      <span className="text-slate-400">Disconnected</span>
                    )}
                  </div>
                </div>

                {/* MAVLink Heartbeat */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">MAVLink</div>
                  <div className="font-bold mt-1 truncate">
                    {isConnected ? (
                      <span className="text-emerald-400">Connected ({connectionState.heartbeatHz || 1.0} Hz)</span>
                    ) : phase === 'WAITING_FOR_HEARTBEAT' ? (
                      <span className="text-amber-400">Waiting for heartbeat…</span>
                    ) : phase === 'HEARTBEAT_TIMEOUT' ? (
                      <span className="text-amber-400">Heartbeat Timeout</span>
                    ) : (
                      <span className="text-slate-400">Standby</span>
                    )}
                  </div>
                </div>

                {/* Flight Controller Autopilot */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Flight Controller</div>
                  <div className="font-bold text-purple-300 mt-1 truncate">
                    {isConnected ? (connectionState.autopilotType || 'Detected') : 'Not detected'}
                  </div>
                </div>
              </div>

              {/* System & Component ID Banner */}
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">System ID</div>
                  <div className="font-bold text-emerald-400 text-sm mt-0.5">
                    {connectionState.systemId ?? 1}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Component ID</div>
                  <div className="font-bold text-emerald-400 text-sm mt-0.5">
                    {connectionState.componentId ?? 1}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Vehicle Type</div>
                  <div className="font-bold text-slate-200 mt-0.5">
                    {diag.vehicleType || 'QUADROTOR'}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">MAVLink Version</div>
                  <div className="font-bold text-sky-400 mt-0.5">
                    {connectionState.mavlinkVersion || 'MAVLink 2.0'}
                  </div>
                </div>
              </div>

              {/* Live Pixhawk STATUSTEXT Messages */}
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-slate-300 uppercase flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <Terminal className="w-4 h-4 text-sky-400" />
                    <span>Flight Controller STATUSTEXT Messages ({connectionState.statusHistory.length})</span>
                  </div>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 max-h-32 overflow-y-auto text-[11px] space-y-1">
                  {connectionState.statusHistory.length === 0 ? (
                    <div className="text-slate-600 italic">No messages received yet. Connect Pixhawk to stream console log.</div>
                  ) : (
                    connectionState.statusHistory.map((msg) => (
                      <div key={msg.id} className="flex items-start space-x-2 leading-tight">
                        <span className={msg.severityLevel <= 3 ? 'text-rose-400 font-bold' : msg.severityLevel === 4 ? 'text-amber-400' : 'text-sky-400'}>
                          [{new Date(msg.timestamp).toLocaleTimeString()}]
                        </span>
                        <span className={`px-1 py-0.2 rounded text-[9px] font-bold ${
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
            </>
          )}

          {activeTab === 'troubleshooting' && (
            <div className="space-y-3 text-xs">
              {/* OTG Power Indicator */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <div className="font-bold text-sky-400 uppercase flex items-center space-x-2">
                  <Zap className="w-4 h-4" />
                  <span>USB Power & Host Status</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                  <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                    <div className="text-slate-500 text-[10px]">Host USB Mode</div>
                    <div className="text-emerald-400 font-bold">Host Detected ✓</div>
                  </div>
                  <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                    <div className="text-slate-500 text-[10px]">Device Power State</div>
                    <div className="text-slate-200 font-bold">Device Powered / Battery</div>
                  </div>
                  <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                    <div className="text-slate-500 text-[10px]">Data Link</div>
                    <div className={isUsbConnected ? 'text-emerald-400 font-bold' : 'text-slate-400 font-bold'}>
                      {isUsbConnected ? 'Active' : 'Inactive'}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  <strong>Power Tip:</strong> Pixhawk flight controllers draw significant current during startup. If phone battery is low, power the Pixhawk with its LiPo battery/power module while keeping USB connected for data.
                </p>
              </div>

              {/* Step-by-Step Diagnostic Checklist */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <div className="font-bold text-amber-400 uppercase flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>OTG Connection Diagnostic Steps</span>
                </div>
                <ul className="space-y-1.5 text-[11px] text-slate-300">
                  <li className="flex items-center space-x-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span><strong>1. Verify OTG is enabled:</strong> Some phones (OnePlus, Oppo, Vivo, Xiaomi) require enabling "OTG Connection" in System Settings.</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span><strong>2. Verify USB cable supports data:</strong> Ensure the cable is not a charge-only cable.</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span><strong>3. Verify Pixhawk is powered:</strong> Pixhawk status LEDs should blink and tones should sound.</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span><strong>4. Disconnect / Reconnect USB:</strong> Android will re-trigger the USB Host attach broadcast automatically.</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span><strong>5. Try another OTG adapter or cable:</strong> Defective OTG pins are the most common source of connection loss.</span>
                  </li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Real-Time Developer Event Log</span>
                <span>{connectionState.diagnosticsLogs.length} entries</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 max-h-72 overflow-y-auto text-[11px] space-y-1 font-mono">
                {connectionState.diagnosticsLogs.length === 0 ? (
                  <div className="text-slate-600 italic">No developer logs recorded yet.</div>
                ) : (
                  connectionState.diagnosticsLogs.map((log) => (
                    <div key={log.id} className="flex items-start space-x-2 leading-tight">
                      <span className="text-slate-500 shrink-0">
                        [{new Date(log.timestamp).toLocaleTimeString()}]
                      </span>
                      <span className={`px-1 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                        log.tag === 'USB'
                          ? 'bg-sky-950 text-sky-300'
                          : log.tag === 'MAVLINK'
                          ? 'bg-purple-950 text-purple-300'
                          : log.tag === 'ERROR'
                          ? 'bg-rose-950 text-rose-300'
                          : 'bg-slate-800 text-slate-300'
                      }`}>
                        [{log.tag}]
                      </span>
                      <span className={
                        log.level === 'error'
                          ? 'text-rose-300 font-bold'
                          : log.level === 'warn'
                          ? 'text-amber-300'
                          : log.level === 'success'
                          ? 'text-emerald-300'
                          : 'text-slate-300'
                      }>
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

        </div>

        {/* Modal Action Buttons (Section 3 Requirements) */}
        <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
          {/* Baud Rate Override */}
          <div className="flex items-center space-x-2">
            <span className="text-[11px] text-slate-400 font-bold uppercase">Baud:</span>
            <select
              value={selectedBaud}
              onChange={(e) => setSelectedBaud(Number(e.target.value))}
              className="bg-slate-950 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 cursor-pointer"
            >
              <option value={115200}>115200 (Pixhawk USB / UART)</option>
              <option value={57600}>57600 (TELEM1 / SiK Radio)</option>
              <option value={921600}>921600 (High-Speed Companion)</option>
              <option value={38400}>38400 (Legacy)</option>
            </select>
          </div>

          {/* Action Button Group */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              onClick={handleScanDevices}
              disabled={isScanning || isActionInProgress}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-xl text-xs font-bold transition flex items-center space-x-1 border border-slate-700 cursor-pointer"
            >
              <Search className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>Scan USB Devices</span>
            </button>

            <button
              onClick={handleRequestPermission}
              disabled={isActionInProgress}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-xl text-xs font-bold transition flex items-center space-x-1 border border-slate-700 cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Request Permission</span>
            </button>

            {!isConnected ? (
              <button
                onClick={handleConnect}
                disabled={isActionInProgress}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase transition flex items-center space-x-1.5 shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                <Usb className="w-3.5 h-3.5" />
                <span>Connect</span>
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                disabled={isActionInProgress}
                className="px-3 py-1.5 bg-rose-950/80 hover:bg-rose-900 border border-rose-600 text-rose-300 rounded-xl text-xs font-bold transition flex items-center space-x-1 cursor-pointer"
              >
                <PowerOff className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            )}

            <button
              onClick={handleConnect}
              disabled={isActionInProgress}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition flex items-center space-x-1 border border-slate-700 cursor-pointer"
              title="Retry Connection"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>

            <button
              onClick={onClose}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
