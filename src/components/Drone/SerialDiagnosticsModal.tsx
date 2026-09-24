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
  const [selectedBaud, setSelectedBaud] = useState<number>(connectionState.baudRate || 57600);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isActionInProgress, setIsActionInProgress] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'troubleshooting' | 'logs'>('overview');

  if (!isOpen) return null;

  const diag = connectionState.diagnostics;
  const phase = connectionState.phase;
  const isConnected = connectionState.isConnected;
  const isUsbConnected = connectionState.isUsbConnected;
  const isUsbDetected = phase !== 'DISCONNECTED' && phase !== 'USB_NOT_DETECTED' && phase !== 'IOS_UNSUPPORTED';
  const hasPermission = diag.hasPermission !== false && phase !== 'PERMISSION_DENIED' && phase !== 'USB_PERMISSION_REQUIRED' && phase !== 'REQUESTING_PERMISSION';

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
                <span>USB DIAGNOSTICS &amp; OTG CONNECTION</span>
              </h2>
              <p className="text-[10px] sm:text-[11px] text-slate-400">
                Android USB Host enumeration, interface descriptors &amp; MAVLink parser state
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
            Status &amp; Overview
          </button>
          <button
            onClick={() => setActiveTab('troubleshooting')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
              activeTab === 'troubleshooting'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            OTG &amp; Power Troubleshooting
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
              {/* Comprehensive USB Diagnostics Table (Section 12 Requirements) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
                
                {/* 1. Android USB Host */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Android USB Host</div>
                  <div className="font-bold flex items-center space-x-1 mt-1">
                    {diag.isUsbHostSupported !== false ? (
                      <span className="text-emerald-400">Supported ✓</span>
                    ) : (
                      <span className="text-rose-400">Unsupported</span>
                    )}
                  </div>
                </div>

                {/* 2. OTG Device Count */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">OTG Device Count</div>
                  <div className="font-bold text-sky-300 mt-1">
                    {diag.connectedDeviceCount ?? (isUsbDetected ? 1 : 0)} connected
                  </div>
                </div>

                {/* 3. Device Name */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Device Name</div>
                  <div className="font-bold text-slate-200 truncate mt-1" title={diag.productName || 'None'}>
                    {diag.productName || (isUsbDetected ? 'Pixhawk / USB Serial' : 'None')}
                  </div>
                </div>

                {/* 4. Vendor ID */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Vendor ID (VID)</div>
                  <div className="font-bold text-emerald-400 mt-1">
                    {formatHex(diag.vendorId)}
                  </div>
                </div>

                {/* 5. Product ID */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Product ID (PID)</div>
                  <div className="font-bold text-emerald-400 mt-1">
                    {formatHex(diag.productId)}
                  </div>
                </div>

                {/* 6. Interface Count */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Interface Count</div>
                  <div className="font-bold text-slate-200 mt-1">
                    {diag.interfaceCount ?? (isUsbDetected ? 2 : 0)} interfaces
                  </div>
                </div>

                {/* 7. Interface Type */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Interface Type</div>
                  <div className="font-bold text-sky-400 mt-1 truncate" title={diag.interfaceType || 'CDC ACM'}>
                    {diag.interfaceType || (isUsbDetected ? 'USB CDC ACM' : 'Standby')}
                  </div>
                </div>

                {/* 8. Permission Status */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Permission Status</div>
                  <div className="font-bold mt-1">
                    {phase === 'PERMISSION_DENIED' ? (
                      <span className="text-rose-400">Denied</span>
                    ) : phase === 'USB_PERMISSION_REQUIRED' || phase === 'REQUESTING_PERMISSION' ? (
                      <span className="text-amber-400">Requesting...</span>
                    ) : hasPermission && isUsbDetected ? (
                      <span className="text-emerald-400">Granted ✓</span>
                    ) : (
                      <span className="text-slate-400">Pending</span>
                    )}
                  </div>
                </div>

                {/* 9. Serial Driver */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Serial Driver</div>
                  <div className="font-bold text-purple-300 mt-1">
                    {diag.driverType || 'NATIVE_ANDROID_USB'}
                  </div>
                </div>

                {/* 10. Selected Baud Rate */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Selected Baud Rate</div>
                  <div className="font-bold text-sky-300 mt-1">
                    {connectionState.baudRate} baud
                  </div>
                </div>

                {/* 11. Serial Connection Status */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Serial Connection</div>
                  <div className="font-bold mt-1">
                    {isUsbConnected ? (
                      <span className="text-emerald-400">Open ✓ ({connectionState.bytesReceived} bytes rx)</span>
                    ) : (
                      <span className="text-slate-400">Closed</span>
                    )}
                  </div>
                </div>

                {/* 12. MAVLink Status */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">MAVLink Status</div>
                  <div className="font-bold mt-1 truncate">
                    {isConnected ? (
                      <span className="text-emerald-400">Connected ({diag.totalPacketsReceived} pkts)</span>
                    ) : (
                      <span className="text-slate-400">Standby</span>
                    )}
                  </div>
                </div>

                {/* 13. Last Heartbeat */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Last Heartbeat</div>
                  <div className="font-bold mt-1">
                    {lastHeartbeatAge !== null ? (
                      <span className={lastHeartbeatAge < 3 ? 'text-emerald-400' : 'text-amber-400'}>
                        {lastHeartbeatAge}s ago ({connectionState.heartbeatHz || 1.0} Hz)
                      </span>
                    ) : (
                      <span className="text-slate-500">None</span>
                    )}
                  </div>
                </div>

                {/* 14. System ID & Component ID */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">System ID / Comp ID</div>
                  <div className="font-bold text-emerald-400 mt-1">
                    Sys: {connectionState.systemId ?? 1} | Comp: {connectionState.componentId ?? 1}
                  </div>
                </div>

                {/* 15. Endpoints */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 col-span-2">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">USB Bulk Endpoints</div>
                  <div className="font-bold text-slate-300 mt-1 text-[11px]">
                    IN: EP {diag.endpointIn || 1} ({diag.endpointIn || 64}B max) | OUT: EP {diag.endpointOut || 2} ({diag.endpointOut || 64}B max)
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
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 max-h-32 overflow-y-auto text-[11px] space-y-1 font-mono">
                  {connectionState.statusHistory.length === 0 ? (
                    <div className="text-slate-600 italic">No console messages received yet. Connect Pixhawk to stream console log.</div>
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
              {/* Power Condition Card */}
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <div className="font-bold text-amber-400 uppercase flex items-center space-x-2">
                  <Zap className="w-4 h-4" />
                  <span>Pixhawk Power Condition &amp; Host Limitation</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  <strong>Notice:</strong> Pixhawk flight controllers with GPS, telemetry modules, and servos can draw more current than a smartphone USB-OTG port supplies (max ~500mA). If the flight controller reboots or disconnects when plugged into the phone:
                </p>
                <div className="p-2.5 bg-amber-950/40 border border-amber-500/30 rounded-lg text-amber-200 text-[11px]">
                  <strong>Recommended:</strong> Power the Pixhawk via its dedicated LiPo Power Module / PDB while connecting the USB cable to the phone solely for MAVLink serial data transfer.
                </div>
              </div>

              {/* Step-by-Step 7-Point Diagnostic Checklist (Requirement 14) */}
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5">
                <div className="font-bold text-sky-400 uppercase flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>USB Cable &amp; OTG Diagnostic Checklist</span>
                </div>
                <p className="text-[11px] text-slate-400">If zero USB devices are detected by Android, verify the following 7 points:</p>
                <ol className="space-y-1.5 text-[11px] text-slate-200 list-decimal list-inside">
                  <li><strong>Verify phone supports USB OTG/USB Host:</strong> Ensure OTG support is active in Android system settings.</li>
                  <li><strong>Verify the OTG adapter supports data transfer:</strong> Some cheap OTG adapters are charge-only or missing the ID pin bridge.</li>
                  <li><strong>Verify the USB cable is a 4-wire data cable:</strong> Charge-only cables will not transmit serial packets.</li>
                  <li><strong>Verify the Pixhawk is powered:</strong> Pixhawk main status LED should cycle and tones should sound.</li>
                  <li><strong>Verify the correct Pixhawk USB port is being used:</strong> Use the primary micro-USB port on the side of the Pixhawk chassis.</li>
                  <li><strong>Disconnect and reconnect the OTG adapter:</strong> Android OS re-enumerates the USB host tree upon re-insertion.</li>
                  <li><strong>Retry USB device scan:</strong> Click "Scan USB Devices" below.</li>
                </ol>
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

        {/* Modal Action Buttons Footer */}
        <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
          {/* Baud Rate Override */}
          <div className="flex items-center space-x-2">
            <span className="text-[11px] text-slate-400 font-bold uppercase">Baud Rate:</span>
            <select
              value={selectedBaud}
              onChange={(e) => setSelectedBaud(Number(e.target.value))}
              className="bg-slate-950 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 cursor-pointer"
            >
              <option value={57600}>57600 (Default TELEM1 / SiK Radio)</option>
              <option value={115200}>115200 (Pixhawk USB / UART)</option>
              <option value={921600}>921600 (High-Speed Companion)</option>
              <option value={38400}>38400 (Legacy Telemetry)</option>
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
              <span>Scan USB</span>
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
