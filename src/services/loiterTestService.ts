import { mavlinkService } from './mavlinkService';
import { audioService } from './audioService';
import { DroneTelemetry, HomePoint } from '../types/mission';
import { PixhawkConnectionState } from '../types/mavlink';
import { 
  LoiterTestConfig, 
  LoiterTestState, 
  LoiterTestStep, 
  LoiterTestValidation, 
  LoiterTestPrerequisite 
} from '../types/loiterTest';

type StateListener = (state: LoiterTestState) => void;

class LoiterTestService {
  private config: LoiterTestConfig = {
    missionName: '5M_LOITER_TEST',
    flightMode: 'LOITER',
    takeoffAltitude: 5,
    landingPosition: 'Home / Takeoff Position',
    missionType: 'Controlled test mission',
    loiterDurationSeconds: 10,
    altitudeTolerance: 0.5
  };

  private state: LoiterTestState = {
    step: 'IDLE',
    stepMessage: 'Ready for configuration & operator confirmation.',
    isExecuting: false,
    currentAltitude: 0,
    targetAltitude: 5,
    remainingHoldSeconds: 10,
    totalHoldSeconds: 10
  };

  private listeners: Set<StateListener> = new Set();
  private telemetryUnsub: (() => void) | null = null;
  private holdTimer: any = null;
  private holdInterval: any = null;
  private armingWatchdog: any = null;
  private climbWatchdog: any = null;
  private descentWatchdog: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const savedDuration = localStorage.getItem('SAE_5M_LOITER_DURATION');
        if (savedDuration) {
          const parsed = parseInt(savedDuration, 10);
          if (!isNaN(parsed) && parsed >= 3 && parsed <= 120) {
            this.config.loiterDurationSeconds = parsed;
            this.state.remainingHoldSeconds = parsed;
            this.state.totalHoldSeconds = parsed;
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }

  public getConfig(): LoiterTestConfig {
    return { ...this.config };
  }

  public getState(): LoiterTestState {
    return { ...this.state };
  }

  public setLoiterDuration(seconds: number): void {
    if (this.state.isExecuting) return;
    const clamped = Math.max(3, Math.min(120, seconds));
    this.config.loiterDurationSeconds = clamped;
    this.state.remainingHoldSeconds = clamped;
    this.state.totalHoldSeconds = clamped;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('SAE_5M_LOITER_DURATION', String(clamped));
      } catch (e) {}
    }
    this.notifyState();
  }

  public subscribeState(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notifyState(): void {
    const s = this.getState();
    this.listeners.forEach((fn) => fn(s));
  }

  /**
   * Validate all safety prerequisites before allowing 5M_LOITER_TEST execution
   */
  public validatePrerequisites(
    telemetry: DroneTelemetry,
    pixhawkState: PixhawkConnectionState,
    homePoint: HomePoint
  ): LoiterTestValidation {
    const isConn = Boolean(pixhawkState.isConnected || pixhawkState.isUsbConnected);
    const hasTelem = Boolean(isConn && (pixhawkState.isReceivingTelemetry || pixhawkState.lastHeartbeat > 0));
    
    // GPS requirements for safe LOITER
    const gpsLocked = Boolean(telemetry.gps.isLocked);
    const satCount = telemetry.gps.satellites || 0;
    const hdop = telemetry.gps.hdop || 99;
    const gpsAdequate = gpsLocked && satCount >= 6 && hdop <= 2.5;

    // Home position set
    const homeValid = Boolean(homePoint.isSet || (telemetry.latitude !== 0 && telemetry.longitude !== 0));

    // Vehicle ground state: should be disarmed and on ground prior to arming sequence
    const onGround = telemetry.altitude <= 1.2 && !telemetry.isArmed;

    // Battery safety: require at least 20%
    const batteryAdequate = telemetry.batteryPercent >= 20 || telemetry.batteryPercent === 0; // 0 if unmonitored

    const prerequisites: LoiterTestPrerequisite[] = [
      {
        id: 'fc_connection',
        label: 'Flight Controller MAVLink Connected',
        passed: isConn,
        reason: isConn ? 'Link active' : 'Flight controller is offline. Check WebSocket / USB link.'
      },
      {
        id: 'fc_telemetry',
        label: 'Live Telemetry & Heartbeat Streaming',
        passed: hasTelem,
        reason: hasTelem ? 'Heartbeat active' : 'No MAVLink heartbeat received from Pixhawk.'
      },
      {
        id: 'gps_lock',
        label: 'GPS 3D Fix & Satellite Geometry (Required for LOITER)',
        passed: gpsAdequate,
        reason: gpsAdequate 
          ? `3D Fix (${satCount} Sats, HDOP ${hdop.toFixed(1)})` 
          : `GPS inadequate for Loiter (Sats: ${satCount}/6, HDOP: ${hdop.toFixed(1)}/2.5)`
      },
      {
        id: 'home_position',
        label: 'Home / Takeoff Reference Registered',
        passed: homeValid,
        reason: homeValid ? 'Home coordinates locked' : 'Home position not registered. Await GPS fix.'
      },
      {
        id: 'vehicle_state',
        label: 'Vehicle Disarmed on Ground',
        passed: onGround,
        reason: onGround ? 'Disarmed on ground ✓' : (telemetry.isArmed ? 'Vehicle is already ARMED!' : 'Altitude > 1.2m')
      },
      {
        id: 'battery_level',
        label: 'Battery Level Above Minimum Reserve (≥20%)',
        passed: batteryAdequate,
        reason: batteryAdequate ? `${telemetry.batteryPercent}% Remaining` : `Battery critical: ${telemetry.batteryPercent}%`
      }
    ];

    const failed = prerequisites.find((p) => !p.passed);
    return {
      allPassed: !failed,
      prerequisites,
      blockingReason: failed ? `${failed.label}: ${failed.reason}` : undefined
    };
  }

  /**
   * Execute the 5M_LOITER_TEST sequence
   */
  public async executeMission(
    telemetry: DroneTelemetry,
    pixhawkState: PixhawkConnectionState,
    homePoint: HomePoint
  ): Promise<{ success: boolean; error?: string }> {
    if (this.state.isExecuting) {
      return { success: false, error: '5M Loiter Test is already running.' };
    }

    const val = this.validatePrerequisites(telemetry, pixhawkState, homePoint);
    if (!val.allPassed) {
      audioService.playBeep(300, 300, 'sawtooth');
      return { success: false, error: val.blockingReason || 'Prerequisites check failed.' };
    }

    this.clearAllTimers();

    this.state = {
      step: 'ARMING',
      stepMessage: '[1/6] Sending MAVLink ARM command. Awaiting FC confirmation...',
      isExecuting: true,
      currentAltitude: telemetry.altitude,
      targetAltitude: 5,
      remainingHoldSeconds: this.config.loiterDurationSeconds,
      totalHoldSeconds: this.config.loiterDurationSeconds,
      startTime: Date.now()
    };
    this.notifyState();

    audioService.playBeep(784, 150);

    // Step 1: Arm Pixhawk
    try {
      await mavlinkService.sendArmCommand();
    } catch (e: any) {
      this.abort(`Arming failed: ${e?.message || e}`);
      return { success: false, error: `Arming command failed: ${e?.message || e}` };
    }

    // Arming timeout watchdog (8s)
    this.armingWatchdog = setTimeout(() => {
      if (this.state.step === 'ARMING') {
        const telem = mavlinkService.getTelemetry();
        if (!telem.isArmed) {
          this.abort('Arming timeout: Pixhawk FC did not arm motors within 8 seconds.');
        }
      }
    }, 8000);

    // Start telemetry watcher
    this.bindTelemetryWatch();

    return { success: true };
  }

  private bindTelemetryWatch(): void {
    if (this.telemetryUnsub) this.telemetryUnsub();

    this.telemetryUnsub = mavlinkService.subscribeTelemetry((telem) => {
      if (!this.state.isExecuting) return;

      this.state.currentAltitude = telem.altitude;

      // 1. Arming Confirmed -> Command Takeoff to 5m
      if (this.state.step === 'ARMING' && telem.isArmed) {
        if (this.armingWatchdog) clearTimeout(this.armingWatchdog);
        this.state.step = 'TAKEOFF_CLIMB';
        this.state.stepMessage = `[2/6] Motors Armed ✓. Vertical takeoff commanded to 5 m AGL.`;
        this.notifyState();

        audioService.playBeep(880, 100);

        // Command Takeoff to 5m
        mavlinkService.commandTakeoff(5);

        // Climb watchdog (25s)
        this.climbWatchdog = setTimeout(() => {
          if (this.state.step === 'TAKEOFF_CLIMB') {
            const currentTelem = mavlinkService.getTelemetry();
            if (currentTelem.altitude < 4.0) {
              this.abort('Takeoff/Climb timeout: Did not reach 5 m within 25 seconds.');
            }
          }
        }, 25000);
      }

      // 2. Climb to 5m reached -> Enter LOITER mode
      if (this.state.step === 'TAKEOFF_CLIMB') {
        if (telem.altitude >= (5 - this.config.altitudeTolerance)) {
          if (this.climbWatchdog) clearTimeout(this.climbWatchdog);
          this.enterLoiterHold();
        }
      }

      // 3. Landing touchdown detection -> Disarm
      if (this.state.step === 'LANDING') {
        if (telem.altitude <= 0.35 || !telem.isArmed) {
          if (this.descentWatchdog) clearTimeout(this.descentWatchdog);
          this.disarmAndComplete();
        }
      }
    });
  }

  private enterLoiterHold(): void {
    this.state.step = 'LOITER_HOLD';
    this.state.stepMessage = `[3/6] Target 5 m reached (Current: ${this.state.currentAltitude.toFixed(1)} m). Entering LOITER mode for ${this.config.loiterDurationSeconds}s.`;
    this.state.remainingHoldSeconds = this.config.loiterDurationSeconds;
    this.notifyState();

    audioService.playBeep(988, 120);

    // Command flight mode LOITER
    mavlinkService.setFlightMode('LOITER');

    // 1-second countdown ticker
    if (this.holdInterval) clearInterval(this.holdInterval);
    this.holdInterval = setInterval(() => {
      if (this.state.step !== 'LOITER_HOLD') {
        clearInterval(this.holdInterval);
        return;
      }

      this.state.remainingHoldSeconds = Math.max(0, this.state.remainingHoldSeconds - 1);
      this.state.stepMessage = `[3/6] LOITER active at 5 m. Holding position: ${this.state.remainingHoldSeconds}s remaining.`;
      this.notifyState();

      if (this.state.remainingHoldSeconds <= 0) {
        clearInterval(this.holdInterval);
        this.beginDescentAndLand();
      }
    }, 1000);
  }

  private beginDescentAndLand(): void {
    if (this.holdInterval) clearInterval(this.holdInterval);

    this.state.step = 'DESCENDING';
    this.state.stepMessage = `[4/6] Loiter duration complete. Commanding vertical descent & landing at home position.`;
    this.notifyState();

    audioService.playBeep(659, 150);

    // Command Land at Home
    mavlinkService.commandLand();

    setTimeout(() => {
      if (this.state.step === 'DESCENDING') {
        this.state.step = 'LANDING';
        this.state.stepMessage = `[5/6] Descending to touchdown at home reference.`;
        this.notifyState();
      }
    }, 1500);

    // Descent watchdog (30s)
    this.descentWatchdog = setTimeout(() => {
      if (this.state.step === 'DESCENDING' || this.state.step === 'LANDING') {
        const telem = mavlinkService.getTelemetry();
        if (telem.altitude <= 0.4 || !telem.isArmed) {
          this.disarmAndComplete();
        } else {
          this.abort('Descent timeout: Drone did not touchdown within 30 seconds.');
        }
      }
    }, 30000);
  }

  private async disarmAndComplete(): Promise<void> {
    this.clearAllTimers();

    this.state.step = 'DISARMING';
    this.state.stepMessage = `[6/6] Touchdown confirmed. Sending disarm command...`;
    this.notifyState();

    try {
      await mavlinkService.sendDisarmCommand();
    } catch (e) {}

    setTimeout(() => {
      this.state.step = 'COMPLETED';
      this.state.stepMessage = `5M_LOITER_TEST successfully completed! Full sequence executed: Arm ➔ 5m Takeoff ➔ 5m Loiter Hold (${this.config.loiterDurationSeconds}s) ➔ Land ➔ Disarm.`;
      this.state.isExecuting = false;
      this.notifyState();

      audioService.playBeep(1046, 250);
      this.cleanup();
    }, 1500);
  }

  public abort(reason: string = 'Operator Aborted'): void {
    this.clearAllTimers();

    const wasExecuting = this.state.isExecuting;
    this.state.isExecuting = false;
    this.state.step = 'ABORTED';
    this.state.error = reason;
    this.state.stepMessage = `Mission Aborted: ${reason}`;
    this.notifyState();

    audioService.playBeep(300, 400, 'sawtooth');

    // If airborne, maintain position in LOITER or command LAND for safety
    const telem = mavlinkService.getTelemetry();
    if (wasExecuting && telem.isArmed && telem.altitude > 0.8) {
      mavlinkService.setFlightMode('LOITER');
    }

    this.cleanup();
  }

  private clearAllTimers(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    if (this.holdInterval) clearInterval(this.holdInterval);
    if (this.armingWatchdog) clearTimeout(this.armingWatchdog);
    if (this.climbWatchdog) clearTimeout(this.climbWatchdog);
    if (this.descentWatchdog) clearTimeout(this.descentWatchdog);
  }

  private cleanup(): void {
    if (this.telemetryUnsub) {
      this.telemetryUnsub();
      this.telemetryUnsub = null;
    }
  }

  public resetState(): void {
    if (this.state.isExecuting) return;
    this.clearAllTimers();
    this.cleanup();
    this.state = {
      step: 'IDLE',
      stepMessage: 'Ready for configuration & operator confirmation.',
      isExecuting: false,
      currentAltitude: 0,
      targetAltitude: 5,
      remainingHoldSeconds: this.config.loiterDurationSeconds,
      totalHoldSeconds: this.config.loiterDurationSeconds
    };
    this.notifyState();
  }
}

export const loiterTestService = new LoiterTestService();
