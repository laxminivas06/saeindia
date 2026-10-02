import { MissionLogEntry } from '../types/mission';

const STORAGE_KEY = 'SAE_MISSION_HISTORY_LOGS';
const MISSION_COUNTER_KEY = 'SAE_MISSION_COUNTER';

class StorageService {
  public getMissionLogs(): MissionLogEntry[] {
    if (typeof window === 'undefined') return [];
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn('Failed to parse mission logs', e);
    }
    // Return sample mission logs if empty
    return this.getSampleLogs();
  }

  public saveMissionLog(entry: MissionLogEntry) {
    if (typeof window === 'undefined') return;
    try {
      const current = this.getMissionLogs();
      const updated = [entry, ...current.filter((item) => item.id !== entry.id)];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn('Failed to save mission log', e);
    }
  }

  public clearLogs() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  public getNextMissionNumber(): number {
    if (typeof window === 'undefined') return 1;
    const logs = this.getMissionLogs();
    if (logs.length === 0) return 1;
    const maxNum = Math.max(...logs.map((l) => l.missionNumber || 0));
    return maxNum + 1;
  }

  public exportLogsAsJSON(): string {
    const logs = this.getMissionLogs();
    return JSON.stringify(logs, null, 2);
  }

  public exportLogsAsCSV(): string {
    const logs = this.getMissionLogs();
    const headers = [
      'MissionID',
      'MissionNumber',
      'Date',
      'DurationSec',
      'QRResult',
      'RunnerAck',
      'RunnerLatencyMs',
      'RTLStatus',
      'LandingStatus',
      'CompletionStatus',
      'HomeLat',
      'HomeLon'
    ];

    const rows = logs.map((log) => [
      log.id,
      log.missionNumber,
      new Date(log.startTime).toISOString(),
      log.durationSeconds,
      log.qrResult || 'N/A',
      log.runnerAckReceived ? 'TRUE' : 'FALSE',
      log.runnerAckLatencyMs || 0,
      log.rtlStatus,
      log.landingStatus,
      log.completionStatus,
      log.homePoint?.latitude || 0,
      log.homePoint?.longitude || 0
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  public downloadFile(content: string, filename: string, contentType: string) {
    if (typeof window === 'undefined') return;
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private getSampleLogs(): MissionLogEntry[] {
    return [
      {
        id: 'SAE_MSN_001',
        missionNumber: 1,
        startTime: Date.now() - 3600000 * 2,
        endTime: Date.now() - 3600000 * 2 + 161000,
        durationSeconds: 161, // 02:41
        homePoint: {
          latitude: 12.971598,
          longitude: 77.594562,
          altitude: 920.0,
          timestamp: Date.now() - 3600000 * 2,
          isSet: true
        },
        qrResult: '27',
        runnerAckReceived: true,
        runnerAckLatencyMs: 142,
        rtlStatus: 'COMPLETED',
        landingStatus: 'COMPLETED',
        completionStatus: 'SUCCESS',
        stateTransitions: [
          { state: 'IDLE', timestamp: Date.now() - 161000 },
          { state: 'HOME_SET', timestamp: Date.now() - 158000 },
          { state: 'TAKEOFF', timestamp: Date.now() - 150000 },
          { state: 'SEARCHING', timestamp: Date.now() - 130000 },
          { state: 'QR_DETECTED', timestamp: Date.now() - 85000 },
          { state: 'QR_DECODED', timestamp: Date.now() - 80000, note: 'Code 27 Validated' },
          { state: 'SEND_TO_RUNNER', timestamp: Date.now() - 78000 },
          { state: 'RUNNER_CONFIRMED', timestamp: Date.now() - 76000, note: 'Runner ACK in 142ms' },
          { state: 'RTL', timestamp: Date.now() - 74000 },
          { state: 'RETURNING_HOME', timestamp: Date.now() - 70000 },
          { state: 'LANDING', timestamp: Date.now() - 20000 },
          { state: 'MISSION_COMPLETE', timestamp: Date.now() }
        ]
      }
    ];
  }
}

export const storageService = new StorageService();
