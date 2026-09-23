import React, { useState, useEffect } from 'react';
import { MissionLogEntry } from '../../types/mission';
import { storageService } from '../../services/storageService';
import { 
  History, 
  X, 
  Download, 
  Trash2, 
  CheckCircle2, 
  AlertTriangle, 
  FileText, 
  Clock, 
  QrCode, 
  Radio, 
  RotateCcw,
  Plane,
  Image as ImageIcon
} from 'lucide-react';

interface MissionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MissionHistoryModal: React.FC<MissionHistoryModalProps> = ({
  isOpen,
  onClose
}) => {
  const [logs, setLogs] = useState<MissionLogEntry[]>([]);

  useEffect(() => {
    if (isOpen) {
      setLogs(storageService.getMissionLogs());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleExportJSON = () => {
    const json = storageService.exportLogsAsJSON();
    storageService.downloadFile(json, `sae_mission_logs_${Date.now()}.json`, 'application/json');
  };

  const handleExportCSV = () => {
    const csv = storageService.exportLogsAsCSV();
    storageService.downloadFile(csv, `sae_mission_logs_${Date.now()}.csv`, 'text/csv');
  };

  const handleClear = () => {
    if (confirm('Are you sure you want to clear all mission history logs?')) {
      storageService.clearLogs();
      setLogs([]);
    }
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 font-mono">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center space-x-2.5">
            <History className="w-5 h-5 text-amber-400" />
            <h2 className="text-base sm:text-lg font-black text-white uppercase tracking-wider">
              SAE INDIA MISSION LOGS & BLACKBOX ARCHIVE
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {logs.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <History className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>No recorded mission logs yet.</p>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 hover:border-slate-700 transition"
              >
                {/* Mission Summary Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
                  <div className="flex items-center space-x-2">
                    <span className="bg-sky-950/60 border border-sky-500/40 text-sky-400 font-extrabold text-xs sm:text-sm px-2.5 py-1 rounded">
                      {log.id}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(log.startTime).toLocaleDateString()} {new Date(log.startTime).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${
                      log.completionStatus === 'SUCCESS'
                        ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-400'
                        : 'bg-rose-950/60 border-rose-500/40 text-rose-400'
                    }`}>
                      {log.completionStatus}
                    </span>
                    <span className="text-xs font-bold text-slate-300 bg-slate-800 px-2 py-0.5 rounded">
                      DURATION: {formatDuration(log.durationSeconds)}
                    </span>
                  </div>
                </div>

                {/* Mission Parameter Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                    <div className="text-[10px] text-slate-500 uppercase">QR Payload</div>
                    <div className="text-base font-black text-emerald-400">{log.qrResult || 'N/A'}</div>
                  </div>

                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                    <div className="text-[10px] text-slate-500 uppercase">Runner ACK</div>
                    <div className="text-xs font-bold text-slate-200 mt-1">
                      {log.runnerAckReceived ? `RECEIVED (${log.runnerAckLatencyMs || 120}ms)` : 'NOT RECEIVED'}
                    </div>
                  </div>

                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                    <div className="text-[10px] text-slate-500 uppercase">RTL Status</div>
                    <div className="text-xs font-bold text-sky-400 mt-1">{log.rtlStatus}</div>
                  </div>

                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                    <div className="text-[10px] text-slate-500 uppercase">Landing Status</div>
                    <div className="text-xs font-bold text-emerald-400 mt-1">{log.landingStatus}</div>
                  </div>
                </div>

                {/* Verified Target Snapshot Display if available */}
                {log.verifiedSnapshotUrl && (
                  <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center space-x-3">
                    <img
                      src={log.verifiedSnapshotUrl}
                      alt="Verified Target QR"
                      className="w-16 h-16 object-cover rounded border border-emerald-500/40"
                    />
                    <div className="text-xs space-y-0.5">
                      <div className="text-emerald-400 font-bold flex items-center space-x-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Verified QR Photo Snapshot Retained</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Code #{log.qrResult} locked airborne at ~25m AGL. Non-target frames auto-purged from storage.
                      </div>
                    </div>
                  </div>
                )}

                {/* State Transition Sequence Pills */}
                {log.stateTransitions && log.stateTransitions.length > 0 && (
                  <div className="pt-2">
                    <div className="text-[10px] text-slate-500 uppercase mb-1">State Timeline:</div>
                    <div className="flex flex-wrap gap-1">
                      {log.stateTransitions.map((t, idx) => (
                        <span
                          key={idx}
                          className="text-[9px] bg-slate-900 border border-slate-800 text-slate-400 px-1.5 py-0.5 rounded"
                        >
                          {t.state}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-800 bg-slate-950/50 flex flex-wrap items-center justify-between gap-2">
          <button
            onClick={handleClear}
            disabled={logs.length === 0}
            className="flex items-center space-x-1.5 text-xs text-rose-400 hover:text-rose-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Logs</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleExportCSV}
              disabled={logs.length === 0}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition flex items-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={handleExportJSON}
              disabled={logs.length === 0}
              className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-sky-600/30"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
