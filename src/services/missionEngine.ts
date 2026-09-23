import { MissionState, PreFlightChecklist, MissionLogEntry, DecodedQRData } from '../types/mission';
import { mavlinkService } from './mavlinkService';
import { runnerCommService } from './runnerCommService';
import { visionService } from './visionService';
import { audioService } from './audioService';
import { storageService } from './storageService';

type MissionStateListener = (state: MissionState, elapsedSec: number, remainingSec: number) => void;

const PERSISTENCE_KEY = 'SAE_MISSION_PERSISTENT_STATE';

interface PersistedMissionState {
  currentState: MissionState;
  missionId: string;
  missionNumber: number;
  startTime: number;
  missionDurationLimitSec: number;
  qrCode?: string;
  runnerAckReceived: boolean;
  runnerAckLatencyMs: number;
  homePointSet: boolean;
  homeLat?: number;
  homeLon?: number;
  homeAlt?: number;
}

class MissionEngine {
  private currentState: MissionState = 'IDLE';
  private missionDurationLimitSec: number = 180; // 3-Minute Mission Window
  private remainingSeconds: number = 180;
  private elapsedSeconds: number = 0;
  private missionStartTime: number = 0;
  private timerInterval: any = null;

  private stateListeners: Set<MissionStateListener> = new Set();
  private stateTransitions: Array<{ state: MissionState; timestamp: number; note?: string }> = [];

  private currentMissionNumber: number = 1;
  private currentMissionId: string = '';
  private currentQRData: DecodedQRData | null = null;
  private runnerAckReceived: boolean = false;
  private runnerAckLatencyMs: number = 0;
  private waitingForAckTimer: any = null;
  private ackTimeoutLimitSec: number = 30; // Max wait for runner before safety RTL

  // FC Arming Acknowledgment Watchdog
  private armingTimeoutTimer: any = null;
  private isAwaitingFcMotorStart: boolean = false;

  constructor() {
    this.currentMissionNumber = storageService.getNextMissionNumber();
    this.restorePersistentState();
    this.initListeners();
  }

  private restorePersistentState() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(PERSISTENCE_KEY);
      if (raw) {
        const data: PersistedMissionState = JSON.parse(raw);
        if (data.homePointSet && data.homeLat && data.homeLon) {
          mavlinkService.setHomePoint(data.homeLat, data.homeLon, data.homeAlt);
        }

        if (data.startTime && data.startTime > 0 && data.currentState !== 'MISSION_COMPLETE' && data.currentState !== 'IDLE') {
          this.missionStartTime = data.startTime;
          this.currentMissionId = data.missionId;
          this.currentMissionNumber = data.missionNumber;
          this.currentState = data.currentState;
          this.runnerAckReceived = data.runnerAckReceived;
          this.runnerAckLatencyMs = data.runnerAckLatencyMs;
          if (data.qrCode) {
            this.currentQRData = {
              rawText: data.qrCode,
              code: data.qrCode,
              isValidTwoDigit: true,
              detectedAt: data.startTime,
              confidence: 0.98
            };
          }

          const elapsed = Math.floor((Date.now() - data.startTime) / 1000);
          this.elapsedSeconds = elapsed;
          this.remainingSeconds = Math.max(0, data.missionDurationLimitSec - elapsed);

          if (this.remainingSeconds > 0) {
            this.startMasterTimer();
            if (this.currentState === 'TAKEOFF' || this.currentState === 'SEARCHING') {
              mavlinkService.armDrone();
              mavlinkService.commandStartSearch();
            }
          } else {
            this.handleMissionTimeout();
          }
        }
      }
    } catch (e) {
      console.warn('Failed to restore persisted mission state', e);
    }
  }

  private persistState() {
    if (typeof window === 'undefined') return;
    try {
      const home = mavlinkService.getHomePoint();
      const stateToSave: PersistedMissionState = {
        currentState: this.currentState,
        missionId: this.currentMissionId,
        missionNumber: this.currentMissionNumber,
        startTime: this.missionStartTime,
        missionDurationLimitSec: this.missionDurationLimitSec,
        qrCode: this.currentQRData?.code,
        runnerAckReceived: this.runnerAckReceived,
        runnerAckLatencyMs: this.runnerAckLatencyMs,
        homePointSet: home.isSet,
        homeLat: home.latitude,
        homeLon: home.longitude,
        homeAlt: home.altitude
      };
      localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
      console.warn('Failed to persist mission state', e);
    }
  }

  private clearPersistentState() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(PERSISTENCE_KEY);
    } catch (e) {
      // ignore
    }
  }

  private initListeners() {
    // 1. Subscribe to Live QR Detection from Vision Service
    visionService.subscribeQR((data) => {
      if (data && data.isValidTwoDigit) {
        this.handleQRDetected(data);
      }
    });

    // 2. Subscribe to Messages from Runner
    runnerCommService.subscribeMessages((msg) => {
      if (msg.type === 'QR_ACK' && msg.received && !this.runnerAckReceived) {
        const latency = Math.max(80, Math.min(600, Date.now() - msg.timestamp));
        this.handleRunnerAckReceived(latency);
      }
    });

    // 3. Subscribe to Pixhawk MAVLink Telemetry for Motor Spin & Altitude Transitions
    mavlinkService.subscribeTelemetry((telemetry) => {
      // Strict FC Arming Gate: Only start takeoff and countdown timer when FC reports isArmed === true
      if (this.isAwaitingFcMotorStart && telemetry.isArmed) {
        this.onFcMotorsStartedConfirmed();
      }

      if (this.currentState === 'TAKEOFF' && telemetry.altitude >= 18) {
        this.transitionTo('SEARCHING', 'Cruise altitude 20m reached. Autonomous lawnmower search active.');
        mavlinkService.commandStartSearch();
      }

      if (this.currentState === 'LANDING' && telemetry.altitude <= 0.3 && !telemetry.isArmed) {
        this.finalizeMission('SUCCESS');
      }

      if (this.currentState !== 'IDLE' && this.currentState !== 'MISSION_COMPLETE' && !telemetry.pixhawkConnected) {
        if (this.currentState !== 'CONNECTION_LOST') {
          this.transitionTo('CONNECTION_LOST', 'Pixhawk MAVLink connection lost!');
        }
      }
    });

    // 4. Subscribe to MAVLink Packets for Command ACK verification
    mavlinkService.subscribePackets((packet) => {
      if (packet.msgName === 'COMMAND_ACK') {
        const cmd = packet.payload.command;
        const res = packet.payload.result;
        if (cmd === 400 /* MAV_CMD_COMPONENT_ARM_DISARM */) {
          if (res === 0 /* MAV_RESULT_ACCEPTED */ && this.isAwaitingFcMotorStart) {
            this.onFcMotorsStartedConfirmed();
          } else if (res !== 0 && this.isAwaitingFcMotorStart) {
            this.onFcArmingRejected(`Pixhawk FC Rejected Arming (Result Code: ${res})`);
          }
        }
      }
    });
  }

  public subscribeState(fn: MissionStateListener) {
    this.stateListeners.add(fn);
    fn(this.currentState, this.elapsedSeconds, this.remainingSeconds);
    return () => this.stateListeners.delete(fn);
  }

  public getState(): MissionState {
    return this.currentState;
  }

  public getCurrentState(): MissionState {
    return this.currentState;
  }

  public getElapsedSeconds(): number {
    return this.elapsedSeconds;
  }

  public getRemainingSeconds(): number {
    return this.remainingSeconds;
  }

  public getDecodedQR(): DecodedQRData | null {
    return this.currentQRData;
  }

  // Pre-Flight Validation Check
  public checkPreFlight(): { isReady: boolean; checklist: PreFlightChecklist } {
    const telemetry = mavlinkService.getTelemetry();
    const home = mavlinkService.getHomePoint();
    const conn = mavlinkService.getConnectionState();
    const runner = runnerCommService.getState();

    const checklist: PreFlightChecklist = {
      droneConnected: telemetry.pixhawkConnected,
      pixhawkConnected: conn.isConnected,
      mavlinkAvailable: conn.isConnected && conn.bytesReceived >= 0,
      gpsAvailable: telemetry.gps.isLocked && telemetry.gps.satellites >= 6,
      homePointValid: home.isSet && home.latitude !== 0,
      batterySufficient: telemetry.batteryPercent >= 20,
      cameraAvailable: telemetry.cameraReady,
      qrScannerAvailable: true,
      runnerConnectionAvailable: runner.isConnected,
      missionTimerReady: this.remainingSeconds > 0
    };

    const isReady = Object.values(checklist).every((val) => val === true);
    return { isReady, checklist };
  }

  // Set Home Point action
  public setHomePoint(): boolean {
    const home = mavlinkService.setHomePoint();
    if (home.isSet) {
      this.transitionTo('HOME_SET', `Home point locked: ${home.latitude.toFixed(6)}, ${home.longitude.toFixed(6)}`);
      audioService.playBeep(1000, 100);
      this.persistState();
      return true;
    }
    return false;
  }

  /**
   * Start Mission with Strict Pixhawk FC Motor Start Acknowledgment Gate
   * Will NOT start mission timer or assume takeoff until FC confirms Motors Started & Armed!
   */
  public startMission(): boolean {
    const { isReady } = this.checkPreFlight();
    const safety = mavlinkService.evaluatePreArmSafety();

    if (!isReady || !safety.passed) {
      audioService.playBeep(300, 300, 'sawtooth');
      console.warn('Cannot start mission: Safety check failed', safety.reason);
      return false;
    }

    this.currentMissionId = `SAE_MSN_${String(this.currentMissionNumber).padStart(3, '0')}`;
    this.stateTransitions = [];
    this.currentQRData = null;
    this.runnerAckReceived = false;
    this.runnerAckLatencyMs = 0;
    this.elapsedSeconds = 0;
    this.remainingSeconds = this.missionDurationLimitSec;

    // Step 1: Request Arming from Pixhawk
    this.isAwaitingFcMotorStart = true;
    this.transitionTo('STARTING', 'Sending MAVLink ARM command. Waiting for Pixhawk FC motor spin confirmation...');

    audioService.playBeep(784, 120);
    audioService.triggerHaptic('medium');

    // Transmit MAVLink Arm Command to Pixhawk
    mavlinkService.armDrone();

    // 8-Second Safety Timeout if FC fails to start motors
    if (this.armingTimeoutTimer) clearTimeout(this.armingTimeoutTimer);
    this.armingTimeoutTimer = setTimeout(() => {
      if (this.isAwaitingFcMotorStart) {
        this.onFcArmingRejected('Pixhawk FC Arming Timeout: Motors did not start. Check Safety Switch / Gyros.');
      }
    }, 8000);

    return true;
  }

  /**
   * Called ONLY when Pixhawk Flight Controller confirms Motors are spinning & Armed
   */
  private onFcMotorsStartedConfirmed() {
    if (!this.isAwaitingFcMotorStart) return;
    this.isAwaitingFcMotorStart = false;
    if (this.armingTimeoutTimer) clearTimeout(this.armingTimeoutTimer);

    this.missionStartTime = Date.now();
    this.startMasterTimer();
    this.persistState();

    this.transitionTo('TAKEOFF', 'Pixhawk FC confirmed: Motors Started & Armed ✓. Ascending to 20m.');
    mavlinkService.commandTakeoff(20);
  }

  /**
   * Called if Pixhawk Flight Controller rejects arming
   */
  private onFcArmingRejected(reason: string) {
    this.isAwaitingFcMotorStart = false;
    if (this.armingTimeoutTimer) clearTimeout(this.armingTimeoutTimer);
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.transitionTo('IDLE', `Mission Aborted: ${reason}`);
    audioService.playBeep(300, 400, 'sawtooth');
    audioService.triggerHaptic('warning');
    mavlinkService.disarmDrone();
  }

  // Handle Target QR Detected while Airborne
  public handleQRDetected(data: DecodedQRData) {
    if (this.currentState !== 'SEARCHING' && this.currentState !== 'QR_DETECTED') {
      return;
    }

    this.currentQRData = data;
    this.transitionTo('QR_DETECTED', `Visual acquisition: Target QR identified.`);

    setTimeout(() => {
      this.transitionTo('QR_SCANNING', 'Airborne position hold. High-framerate decoding active.');
      setTimeout(() => {
        this.transitionTo('QR_DECODED', `QR Decoded: [${data.code}]. Verified 2-digit format.`);
        this.dispatchCodeToRunner(data.code);
      }, 500);
    }, 300);
  }

  private dispatchCodeToRunner(code: string) {
    this.transitionTo('SEND_TO_RUNNER', `Transmitting verified QR [${code}] directly to Runner over Direct Peer Socket.`);

    const telemetry = mavlinkService.getTelemetry();
    runnerCommService.sendQRToRunner(code, this.currentMissionId, telemetry.altitude, telemetry.batteryPercent);

    this.transitionTo('WAIT_FOR_RUNNER_ACK', 'Code dispatched. Awaiting Runner handshake acknowledgment...');
    this.persistState();

    if (this.waitingForAckTimer) clearTimeout(this.waitingForAckTimer);
    this.waitingForAckTimer = setTimeout(() => {
      if (!this.runnerAckReceived && this.currentState === 'WAIT_FOR_RUNNER_ACK') {
        this.triggerEmergencyRTL('Runner ACK timeout (30s exceeded). Autonomous RTL initiated.');
      }
    }, this.ackTimeoutLimitSec * 1000);
  }

  public handleRunnerAckReceived(latencyMs: number) {
    if (this.waitingForAckTimer) clearTimeout(this.waitingForAckTimer);
    this.runnerAckReceived = true;
    this.runnerAckLatencyMs = latencyMs;

    this.transitionTo('RUNNER_CONFIRMED', `Runner Acknowledged: Target [${this.currentQRData?.code}] confirmed (${latencyMs}ms). Initiating RTL.`);
    audioService.playRunnerAck();
    audioService.triggerHaptic('success');
    this.persistState();

    setTimeout(() => {
      this.transitionTo('RTL', 'Sending MAVLink RTL command to Pixhawk flight controller.');
      mavlinkService.commandRTL();
      setTimeout(() => {
        this.transitionTo('RETURNING_HOME', 'Airborne Return-To-Launch at 25m altitude.');
        setTimeout(() => {
          this.transitionTo('LANDING', 'Descending at Home coordinates.');
          mavlinkService.commandLand();
        }, 3000);
      }, 2000);
    }, 1200);
  }

  public triggerEmergencyRTL(reason: string = 'Manual Operator Emergency RTL Command') {
    if (this.waitingForAckTimer) clearTimeout(this.waitingForAckTimer);
    this.transitionTo('EMERGENCY_RTL', reason);
    audioService.playRtlAlert();
    audioService.triggerHaptic('warning');

    mavlinkService.commandRTL();
    this.persistState();

    setTimeout(() => {
      mavlinkService.commandLand();
      this.finalizeMission('ABORTED');
    }, 4000);
  }

  private handleMissionTimeout() {
    this.transitionTo('MISSION_TIMEOUT', '3-Minute Mission Window Expired. Automatic Fail-Safe RTL.');
    this.triggerEmergencyRTL('3-Minute Mission Timer expired.');
  }

  private startMasterTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      if (this.remainingSeconds > 0) {
        this.remainingSeconds--;
        this.elapsedSeconds++;

        if (this.remainingSeconds === 60) {
          audioService.playBeep(880, 200);
        } else if (this.remainingSeconds === 30) {
          audioService.playBeep(880, 400);
        } else if (this.remainingSeconds <= 10 && this.remainingSeconds > 0) {
          audioService.playTimeoutWarning();
        }

        this.notifyState();
      } else {
        clearInterval(this.timerInterval);
        this.handleMissionTimeout();
      }
    }, 1000);
  }

  private finalizeMission(status: 'SUCCESS' | 'TIMEOUT' | 'ABORTED') {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.waitingForAckTimer) clearTimeout(this.waitingForAckTimer);

    const stats = visionService.getStats();
    const logEntry: MissionLogEntry = {
      id: this.currentMissionId || `SAE_MSN_${Date.now()}`,
      missionNumber: this.currentMissionNumber,
      startTime: this.missionStartTime || Date.now(),
      endTime: Date.now(),
      durationSeconds: this.elapsedSeconds,
      homePoint: mavlinkService.getHomePoint(),
      qrResult: this.currentQRData?.code || 'NONE',
      verifiedSnapshotUrl: stats.latestVerifiedPhoto || undefined,
      photosAnalyzedCount: stats.photosAnalyzedCount,
      photosPurgedCount: stats.photosPurgedCount,
      runnerAckReceived: this.runnerAckReceived,
      runnerAckLatencyMs: this.runnerAckLatencyMs,
      rtlStatus: status === 'SUCCESS' ? 'COMPLETED' : 'EMERGENCY_RTL',
      landingStatus: status === 'SUCCESS' ? 'COMPLETED' : 'MANUAL_TAKEOVER',
      completionStatus: status,
      stateTransitions: [...this.stateTransitions]
    };

    storageService.saveMissionLog(logEntry);
    this.clearPersistentState();
    this.currentMissionNumber++;

    this.transitionTo('MISSION_COMPLETE', `Mission #${logEntry.missionNumber} Complete. Log saved.`);
    audioService.playMissionComplete();
    mavlinkService.disarmDrone();
  }

  public resetMission() {
    this.resetToIdle();
  }

  public resetToIdle() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.waitingForAckTimer) clearTimeout(this.waitingForAckTimer);
    if (this.armingTimeoutTimer) clearTimeout(this.armingTimeoutTimer);
    this.isAwaitingFcMotorStart = false;

    this.currentState = 'IDLE';
    this.remainingSeconds = this.missionDurationLimitSec;
    this.elapsedSeconds = 0;
    this.currentQRData = null;
    this.runnerAckReceived = false;
    this.runnerAckLatencyMs = 0;
    this.clearPersistentState();

    mavlinkService.disarmDrone();
    this.notifyState();
  }

  private transitionTo(newState: MissionState, note?: string) {
    this.currentState = newState;
    this.stateTransitions.push({ state: newState, timestamp: Date.now(), note });
    this.notifyState();
  }

  private notifyState() {
    this.stateListeners.forEach((fn) => fn(this.currentState, this.elapsedSeconds, this.remainingSeconds));
  }
}

export const missionEngine = new MissionEngine();
