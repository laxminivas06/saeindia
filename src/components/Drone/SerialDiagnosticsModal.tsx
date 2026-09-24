import React, { useState } from 'react';
import { PixhawkConnectionState } from '../../types/mavlink';
import { mavlinkService } from '../../services/mavlinkService';
import {
  Usb,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Cpu,
  RefreshCw,
  PowerOff,
  Sliders,
  HelpCircle,
  Radio,
  RotateCcw,
  Terminal,
  Search,
  KeyRound,
  X,
  Zap,
  Wifi,
  Globe,
  Server
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
  const [activeTab, setActiveTab] = useState<'overview' | 'esp32' | 'troubleshooting' | 'logs'>('overview');

  if (!isOpen) return null;

  const diag = connectionState.diagnostics;
  const phase = connectionState.phase;
  const isConnected = connectionState.isConnected;
  const isUsbConnected = connectionState.isUsbConnected;
  const isEsp32 = connectionState.connectionType === 'ESP32_WEBSOCKET';

  const isUsbDetected =
    phase !== 'DISCONNECTED' &&
    phase !== 'USB_NOT_DETECTED' &&
    phase !== 'IOS_UNSUPPORTED';

  const hasPermission = diag.hasPermission !== false;

  const lastHeartbeatAge = connectionState.lastHeartbeat > 0
    ? Math.floor((Date.now() - connectionState.lastHeartbeat) / 1000)
    : null;

  const handleScanDevices = async () => {
    setIsScanning(true);
    try {
      await mavlinkService.scanUsbDevices();
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
      if (isEsp32) {
        await mavlinkService.connectEsp32();
      } else {
        await mavlinkService.connectHardware(selectedBaud);
      }
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
                <span>CONNECTION DIAGNOSTICS &amp; MAVLINK STREAM</span>
              </h2>
              <p className="text-[10px] sm:text-[11px] text-slate-400">
                Live link metrics, packet counters, raw buffer diagnostics &amp; developer logs
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

        {/* Navigation Tabs */}
        <div className="flex items-center space-x-1 border-b border-slate-800 pb-2 text-xs shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            Overview &amp; Hardware
          </button>
          <button
            onClick={() => setActiveTab('esp32')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1 whitespace-nowrap ${
              activeTab === 'esp32'
                ? 'bg-purple-600 text-white'
                : 'bg-slate-800 text-purple-300 hover:text-white'
            }`}
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>ESP32-S3 Wireless</span>
          </button>
          <button
            onClick={() => setActiveTab('troubleshooting')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'troubleshooting'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            OTG &amp; Power Checklist
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 whitespace-nowrap ${
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
          
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
                
                {/* 1. Connection Channel */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Channel Type</div>
                  <div className="font-bold text-sky-300 mt-1">
                    {connectionState.connectionType}
                  </div>
                </div>

                {/* 2. Link State */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Link State</div>
                  <div className="font-bold mt-1">
                    {isUsbConnected ? (
                      <span className="text-emerald-400">OPEN ({connectionState.bytesReceived} B rx)</span>
                    ) : (
                      <span className="text-slate-400">CLOSED</span>
                    )}
                  </div>
                </div>

                {/* 3. MAVLink State */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">MAVLink State</div>
                  <div className="font-bold mt-1">
                    {isConnected ? (
                      <span className="text-emerald-400">CONNECTED ({diag.totalPacketsReceived} pkts)</span>
                    ) : (
                      <span className="text-amber-400">{phase}</span>
                    )}
                  </div>
                </div>

                {/* 4. Heartbeat Status */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Heartbeat</div>
                  <div className="font-bold mt-1">
                    {lastHeartbeatAge !== null ? (
                      <span className={lastHeartbeatAge < 4 ? 'text-emerald-400' : 'text-amber-400'}>
                        {lastHeartbeatAge}s ago ({connectionState.heartbeatHz || 1.0} Hz)
                      </span>
                    ) : (
                      <span className="text-slate-500">None</span>
                    )}
                  </div>
                </div>

                {/* 5. System ID / Comp ID */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">SysID / CompID</div>
                  <div className="font-bold text-emerald-400 mt-1">
                    Sys: {connectionState.systemId ?? 1} | Comp: {connectionState.componentId ?? 1}
                  </div>
                </div>

                {/* 6. Autopilot Type */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Autopilot</div>
                  <div className="font-bold text-purple-300 mt-1 truncate">
                    {connectionState.autopilotType || 'ArduPilot'}
                  </div>
                </div>

                {/* 7. Last MAVLink Message */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 col-span-2">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Last MAVLink Message</div>
                  <div className="font-bold text-sky-300 mt-1 truncate">
                    {diag.lastMavlinkMessageName ? `${diag.lastMavlinkMessageName} (msg ${diag.lastMavlinkMessageId})` : 'Waiting for packets...'}
                  </div>
                </div>
              </div>

              {/* Console Log Messages */}
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

          {/* TAB 2: ESP32-S3 WIRELESS MATRIX */}
          {activeTab === 'esp32' && (
            <div className="space-y-3 text-xs">
              <div className="p-3.5 bg-purple-950/30 border border-purple-500/40 rounded-xl space-y-3">
                <div className="font-bold text-purple-300 uppercase flex items-center space-x-2">
                  <Wifi className="w-4 h-4" />
                  <span>ESP32-S3 Wireless MAVLink Bridge Parameters</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Active Address</span>
                    <div className="font-mono text-purple-300 font-bold mt-0.5">{connectionState.portOrAddress}</div>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">UART Baud Rate</span>
                    <div className="font-mono text-emerald-400 font-bold mt-0.5">{connectionState.baudRate} baud</div>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">RX Byte Counter</span>
                    <div className="font-mono text-sky-400 font-bold mt-0.5">{connectionState.bytesReceived} bytes</div>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">TX Byte Counter</span>
                    <div className="font-mono text-sky-400 font-bold mt-0.5">{connectionState.bytesSent} bytes</div>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Total Packets</span>
                    <div className="font-mono text-emerald-400 font-bold mt-0.5">{diag.totalPacketsReceived}</div>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Heartbeats</span>
                    <div className="font-mono text-emerald-400 font-bold mt-0.5">{diag.heartbeatsCount}</div>
                  </div>
                </div>

                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-slate-300 space-y-1">
                  <div className="font-bold text-slate-200">How Data Flows End-to-End:</div>
                  <div>1. Pixhawk transmits telemetry at 57600 baud via TELEM2 port.</div>
                  <div>2. ESP32-S3 receives UART frames on RX pin and forwards binary frames to WebSocket clients on port 8080.</div>
                  <div>3. Browser decodes MAVLink packets and displays real telemetry without simulation.</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TROUBLESHOOTING */}
          {activeTab === 'troubleshooting' && (
            <div className="space-y-3 text-xs">
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <div className="font-bold text-amber-400 uppercase flex items-center space-x-2">
                  <Zap className="w-4 h-4" />
                  <span>Pixhawk Power Condition &amp; Host Limitation</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Pixhawk flight controllers with GPS and servos require adequate power. Ensure Pixhawk is powered by its LiPo battery module when connecting to ESP32 or phone USB.
                </p>
              </div>

              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5">
                <div className="font-bold text-sky-400 uppercase flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Hardware Connection Checklist</span>
                </div>
                <ol className="space-y-1.5 text-[11px] text-slate-200 list-decimal list-inside">
                  <li><strong>Check TELEM2 wiring:</strong> TX➔RX, RX➔TX, GND➔GND, 5V➔5V.</li>
                  <li><strong>Verify Baud Rate:</strong> Ensure Pixhawk parameter <code>SERIAL2_BAUD = 57</code> (57600 baud).</li>
                  <li><strong>Verify Protocol:</strong> Ensure Pixhawk parameter <code>SERIAL2_PROTOCOL = 2</code> (MAVLink2).</li>
                  <li><strong>Verify Wi-Fi Network:</strong> Phone must be connected to the same Wi-Fi network as the ESP32.</li>
                </ol>
              </div>
            </div>
          )}

          {/* TAB 4: LIVE LOGS */}
          {activeTab === 'logs' && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-300 uppercase flex items-center justify-between">
                <span>Real-Time Driver &amp; Parser Logs</span>
                <span className="text-[10px] text-slate-500">Auto-scrolling</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 max-h-64 overflow-y-auto space-y-1 text-[11px] font-mono">
                {connectionState.diagnosticsLogs.length === 0 ? (
                  <div className="text-slate-600 italic">No diagnostic events logged yet.</div>
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
          <div className="flex items-center space-x-2">
            <span className="text-[11px] text-slate-400 font-bold uppercase">Baud Rate:</span>
            <select
              value={selectedBaud}
              onChange={(e) => setSelectedBaud(Number(e.target.value))}
              className="bg-slate-950 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 cursor-pointer"
            >
              <option value={57600}>57600 (Default TELEM2 / SiK Radio)</option>
              <option value={115200}>115200 (Pixhawk USB / UART)</option>
              <option value={921600}>921600 (High-Speed Companion)</option>
              <option value={38400}>38400 (Legacy Telemetry)</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {!isConnected ? (
              <button
                onClick={handleConnect}
                disabled={isActionInProgress}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase transition flex items-center space-x-1.5 shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                <Wifi className="w-3.5 h-3.5" />
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
