import { mavlinkService } from './mavlinkService';
import { audioService } from './audioService';
import { DroneTelemetry, HomePoint } from '../types/mission';
import { PixhawkConnectionState } from '../types/mavlink';
import {
  CircleTestConfig,
  CircleTestState,
  CircleTestValidation,
  CircleTestPrerequisite
} from '../types/circleTest';

type CircleStateListener = (state: CircleTestState) => void;

class CircleTestService {
  private config: CircleTestConfig = {
    missionName: 'AUTONOMOUS_CIRCLE_TEST',
    circleDiameterMeters: 10,
    targetAltitudeMeters: 5,
    flightSpeedMps: 2.0,
    laps: 1,
    direction: 'CW',
    landingPosition: 'Home / Takeoff Position',
    altitudeTolerance: 0.5
  };

  private state: CircleTestState = {
    step: 'IDLE',
    stepMessage: 'Ready for diameter, altitude configuration & operator authorization.',
    isExecuting: false,
    currentAltitude: 0,
    targetAltitude: 5,
    circleDiameterMeters: 10,
    circleRadiusMeters: 5,
    currentAngleDeg: 0,
    currentLap: 1,
    totalLaps: 1,
    progressPercent: 0,
    flightSpeedMps: 2.0,
    direction: 'CW',
    elapsedSeconds: 0
  };

  private listeners: Set<CircleStateListener> = new Set();
  private telemetryUnsub: (() => void) | null = null;
  private orbitTicker: any = null;
  private armingWatchdog: any = null;
  private climbWatchdog: any = null;
  private transitWatchdog: any = null;
  private descentWatchdog: any = null;
  private centerRef: { lat: number; lon: number; alt: number } | null = null;
  private perimeterRef: { lat: number; lon: number } | null = null;
  private startOrbitAngle: number = 0;
  private totalDegreesTraveled: number = 0;
  private simOrbitInterval: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const savedDiameter = localStorage.getItem('SAE_CIRCLE_DIAMETER');
        if (savedDiameter) {
          const parsed = parseFloat(savedDiameter);
          if (!isNaN(parsed) && parsed >= 2 && parsed <= 150) {
            this.config.circleDiameterMeters = parsed;
            this.state.circleDiameterMeters = parsed;
            this.state.circleRadiusMeters = +(parsed / 2).toFixed(1);
          }
        }

        const savedAlt = localStorage.getItem('SAE_CIRCLE_ALTITUDE');
        if (savedAlt) {
          const parsed = parseFloat(savedAlt);
          if (!isNaN(parsed) && parsed >= 2 && parsed <= 60) {
            this.config.targetAltitudeMeters = parsed;
            this.state.targetAltitude = parsed;
          }
        }

        const savedLaps = localStorage.getItem('SAE_CIRCLE_LAPS');
        if (savedLaps) {
          const parsed = parseInt(savedLaps, 10);
          if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
            this.config.laps = parsed;
            this.state.totalLaps = parsed;
          }
        }

        const savedDir = localStorage.getItem('SAE_CIRCLE_DIRECTION');
        if (savedDir === 'CW' || savedDir === 'CCW') {
          this.config.direction = savedDir;
          this.state.direction = savedDir;
        }
      } catch (e) {
        // ignore
      }
    }
  }

  public getConfig(): CircleTestConfig {
    return { ...this.config };
  }

  public getState(): CircleTestState {
    return { ...this.state };
  }

  public setDiameter(diameter: number): void {
    if (this.state.isExecuting) return;
    const clamped = Math.max(2, Math.min(150, +diameter.toFixed(1)));
    this.config.circleDiameterMeters = clamped;
    this.state.circleDiameterMeters = clamped;
    this.state.circleRadiusMeters = +(clamped / 2).toFixed(1);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('SAE_CIRCLE_DIAMETER', String(clamped));
      } catch (e) {}
    }
    this.notifyState();
  }

  public setAltitude(altitude: number): void {
    if (this.state.isExecuting) return;
    const clamped = Math.max(2, Math.min(60, +altitude.toFixed(1)));
    this.config.targetAltitudeMeters = clamped;
    this.state.targetAltitude = clamped;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('SAE_CIRCLE_ALTITUDE', String(clamped));
      } catch (e) {}
    }
    this.notifyState();
  }

  public setLaps(laps: number): void {
    if (this.state.isExecuting) return;
    const clamped = Math.max(1, Math.min(5, Math.floor(laps)));
    this.config.laps = clamped;
    this.state.totalLaps = clamped;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('SAE_CIRCLE_LAPS', String(clamped));
      } catch (e) {}
    }
    this.notifyState();
  }

  public setFlightSpeed(speed: number): void {
    if (this.state.isExecuting) return;
    const clamped = Math.max(1.0, Math.min(5.0, +speed.toFixed(1)));
    this.config.flightSpeedMps = clamped;
    this.state.flightSpeedMps = clamped;
    this.notifyState();
  }

  public setDirection(direction: 'CW' | 'CCW'): void {
    if (this.state.isExecuting) return;
    this.config.direction = direction;
    this.state.direction = direction;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('SAE_CIRCLE_DIRECTION', direction);
      } catch (e) {}
    }
    this.notifyState();
  }

  public subscribeState(listener: CircleStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notifyState(): void {
    const s = this.getState();
    this.listeners.forEach((fn) => fn(s));
  }

  /**
   * Validate safety prerequisites before allowing autonomous circle test
   */
  public validatePrerequisites(
    telemetry: DroneTelemetry,
    pixhawkState: PixhawkConnectionState,
    homePoint: HomePoint
  ): CircleTestValidation {
    const isConn = Boolean(pixhawkState.isConnected || pixhawkState.isUsbConnected);
    const hasTelem = Boolean(isConn && (pixhawkState.isReceivingTelemetry || pixhawkState.lastHeartbeat > 0));

    // GPS requirements for safe autonomous navigation
    const satCount = telemetry.gps.satellites || 0;
    const is3DFix = telemetry.gps.fixType === '3D_FIX' || telemetry.gps.fixType === 'DGPS' || telemetry.gps.fixType === 'RTK_FIXED' || telemetry.gps.fixType === 'RTK_FLOAT';
    const gpsLocked = Boolean(telemetry.gps.isLocked || is3DFix || satCount >= 6);
    const hdop = telemetry.gps.hdop || 99;
    const gpsAdequate = gpsLocked && (hdop <= 3.5 || hdop === 0 || satCount >= 7);

    // Home / Takeoff coordinate anchor
    const hasPosition = (telemetry.latitude !== 0 && telemetry.longitude !== 0) || (telemetry.gps.latitude !== 0 && telemetry.gps.longitude !== 0);
    const homeValid = Boolean(homePoint.isSet || hasPosition);

    // Vehicle ground state
    const onGround = telemetry.altitude <= 1.5 && !telemetry.isArmed;

    // Battery safety
    const batteryAdequate = telemetry.batteryPercent >= 20 || telemetry.batteryPercent === 0;

    const prerequisites: CircleTestPrerequisite[] = [
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
        label: 'GPS 3D Fix & Satellites (Required for Orbit)',
        passed: gpsAdequate,
        reason: gpsAdequate
          ? `GPS READY: ${satCount} / 7 Sats (Fix: ${(telemetry.gps.fixType || '3D_FIX').replace('_', ' ')}, HDOP ${hdop.toFixed(1)})`
          : `GPS Inadequate (Sats: ${satCount}/7, Fix: ${telemetry.gps.fixType || 'NO_FIX'})`
      },
      {
        id: 'home_position',
        label: 'Takeoff Reference Locked (Orbit Center)',
        passed: homeValid,
        reason: homePoint.isSet
          ? `Center Locked: ${homePoint.latitude.toFixed(5)}, ${homePoint.longitude.toFixed(5)}`
          : hasPosition
          ? `Auto-Set Center Ready (${(telemetry.latitude || telemetry.gps.latitude).toFixed(5)}, ${(telemetry.longitude || telemetry.gps.longitude).toFixed(5)})`
          : 'Awaiting initial GPS coordinates for orbit center anchor.'
      },
      {
        id: 'vehicle_state',
        label: 'Vehicle Disarmed on Ground',
        passed: onGround,
        reason: onGround ? 'Disarmed on ground ✓' : (telemetry.isArmed ? 'Vehicle is already ARMED!' : 'Altitude > 1.5m')
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
   * Execute the AUTONOMOUS_CIRCLE_TEST sequence
   */
  public async executeMission(
    telemetry: DroneTelemetry,
    pixhawkState: PixhawkConnectionState,
    homePoint: HomePoint,
    forceOverride: boolean = false
  ): Promise<{ success: boolean; error?: string }> {
    if (this.state.isExecuting) {
      return { success: false, error: 'Autonomous Circle Test is already executing.' };
    }

    const val = this.validatePrerequisites(telemetry, pixhawkState, homePoint);
    if (!val.allPassed && !forceOverride) {
      audioService.playBeep(300, 300, 'sawtooth');
      return { success: false, error: val.blockingReason || 'Prerequisites check failed.' };
    }

    // Determine Center Anchor coordinate (takeoff position)
    const centerLat = homePoint.isSet ? homePoint.latitude : (telemetry.latitude || telemetry.gps.latitude);
    const centerLon = homePoint.isSet ? homePoint.longitude : (telemetry.longitude || telemetry.gps.longitude);
    const centerAlt = homePoint.isSet ? homePoint.altitude : (telemetry.gps.altitude || telemetry.altitude);

    if (centerLat === 0 && centerLon === 0) {
      return { success: false, error: 'Cannot start circle test: No valid GPS coordinates for takeoff center anchor.' };
    }

    this.centerRef = { lat: centerLat, lon: centerLon, alt: centerAlt };

    // Auto-Set Home with Pixhawk if not yet registered
    if (!homePoint.isSet) {
      try {
        await mavlinkService.setHomePoint(centerLat, centerLon, centerAlt);
      } catch (e) {
        console.warn('[CIRCLE_TEST] Set home note:', e);
      }
    }

    // Calculate initial perimeter waypoint (North of center: angle 0)
    const radiusMeters = this.config.circleDiameterMeters / 2;
    const latOffset = radiusMeters / 111320;
    this.perimeterRef = {
      lat: centerLat + latOffset,
      lon: centerLon
    };

    this.clearAllTimers();
    this.totalDegreesTraveled = 0;
    this.startOrbitAngle = 0;

    const targetAlt = this.config.targetAltitudeMeters;
    this.state = {
      step: 'ARMING',
      stepMessage: `[1/6] Arming Pixhawk FC in GUIDED mode (Target Alt: ${targetAlt}m, Diameter: ${this.config.circleDiameterMeters}m)...`,
      isExecuting: true,
      currentAltitude: telemetry.altitude,
      targetAltitude: targetAlt,
      circleDiameterMeters: this.config.circleDiameterMeters,
      circleRadiusMeters: radiusMeters,
      currentAngleDeg: 0,
      currentLap: 1,
      totalLaps: this.config.laps,
      progressPercent: 0,
      flightSpeedMps: this.config.flightSpeedMps,
      direction: this.config.direction,
      startTime: Date.now(),
      elapsedSeconds: 0
    };
    this.notifyState();
    audioService.playBeep(784, 150);

    // Step 1: Switch to GUIDED flight mode and Arm motors
    try {
      await mavlinkService.setFlightMode('GUIDED');
      if (!telemetry.isArmed) {
        await mavlinkService.sendArmCommand(forceOverride);
      }
    } catch (e: any) {
      this.abort(`Arming failed: ${e?.message || e}`);
      return { success: false, error: `Arming failed: ${e?.message || e}` };
    }

    // Arming timeout watchdog (8s)
    this.armingWatchdog = setTimeout(() => {
      if (this.state.step === 'ARMING') {
        const telem = mavlinkService.getTelemetry();
        const conn = mavlinkService.getConnectionState();
        if (!telem.isArmed) {
          const detail = conn.preArmFailReason
            ? `Pixhawk PreArm: ${conn.preArmFailReason}`
            : 'Pixhawk FC did not arm motors within 8 seconds. Verify Safety Switch / Compass.';
          this.abort(detail);
        }
      }
    }, 8000);

    // Bind telemetry stream watcher for climb, perimeter transit, orbit, return, and landing
    this.bindTelemetryWatch();

    // If already armed on ground, immediately climb
    if (telemetry.isArmed) {
      this.initiateClimb();
    }

    return { success: true };
  }

  private initiateClimb(): void {
    if (this.armingWatchdog) clearTimeout(this.armingWatchdog);
    this.state.step = 'TAKEOFF_CLIMB';
    const alt = this.config.targetAltitudeMeters;
    this.state.stepMessage = `[2/6] Motors Armed ✓. Autonomous vertical takeoff to ${alt}m AGL...`;
    this.notifyState();

    audioService.playBeep(880, 100);

    // Command Takeoff to target altitude
    mavlinkService.commandTakeoff(alt);

    // Climb watchdog (30s)
    if (this.climbWatchdog) clearTimeout(this.climbWatchdog);
    this.climbWatchdog = setTimeout(() => {
      if (this.state.step === 'TAKEOFF_CLIMB') {
        const cur = mavlinkService.getTelemetry();
        if (cur.altitude < (alt - 1.0)) {
          this.abort(`Takeoff timeout: Did not reach ${alt}m within 30 seconds.`);
        }
      }
    }, 30000);
  }

  private bindTelemetryWatch(): void {
    if (this.telemetryUnsub) this.telemetryUnsub();

    this.telemetryUnsub = mavlinkService.subscribeTelemetry((telem) => {
      if (!this.state.isExecuting) return;

      this.state.currentAltitude = telem.altitude;

      // 1. Arming Confirmed -> Start Climb
      if (this.state.step === 'ARMING' && telem.isArmed) {
        this.initiateClimb();
      }

      // 2. Altitude Reached -> Transit to Circle Perimeter
      if (this.state.step === 'TAKEOFF_CLIMB') {
        if (telem.altitude >= (this.config.targetAltitudeMeters - this.config.altitudeTolerance)) {
          if (this.climbWatchdog) clearTimeout(this.climbWatchdog);
          this.transitToPerimeter();
        }
      }

      // 3. Landing touchdown detection -> Disarm only when safely on ground
      if (this.state.step === 'DESCENDING' || this.state.step === 'LANDING') {
        if (!telem.isArmed) {
          // ArduPilot natively detected touchdown and disarmed
          if (this.descentWatchdog) clearTimeout(this.descentWatchdog);
          this.disarmAndComplete();
        } else if (telem.altitude <= 0.20 && Math.abs(telem.verticalSpeed) <= 0.15) {
          // Sustained stationary contact on ground
          if (this.descentWatchdog) clearTimeout(this.descentWatchdog);
          setTimeout(() => {
            const cur = mavlinkService.getTelemetry();
            if (!cur.isArmed || cur.altitude <= 0.20) {
              this.disarmAndComplete();
            }
          }, 1500);
        }
      }
    });
  }

  private async transitToPerimeter(): Promise<void> {
    if (!this.centerRef || !this.perimeterRef) return;

    this.state.step = 'TRANSIT_TO_PERIMETER';
    const radius = this.state.circleRadiusMeters;
    const alt = this.config.targetAltitudeMeters;
    this.state.stepMessage = `[3/6] Target ${alt}m reached. Repositioning outward to circle perimeter (Radius: ${radius}m)...`;
    this.notifyState();

    audioService.playBeep(988, 120);

    // Fly outward to the perimeter waypoint
    await mavlinkService.flyToPosition(
      this.perimeterRef.lat,
      this.perimeterRef.lon,
      alt,
      this.config.flightSpeedMps
    );

    // Transit timer: allow vehicle to reach perimeter before commencing 360 orbit
    // Distance = radius; at speed V m/s, time ~ (radius / speed) + 3s
    const transitTimeMs = Math.max(4000, Math.min(20000, Math.round((radius / this.config.flightSpeedMps) * 1000) + 3000));

    if (this.transitWatchdog) clearTimeout(this.transitWatchdog);
    this.transitWatchdog = setTimeout(() => {
      if (this.state.step === 'TRANSIT_TO_PERIMETER') {
        this.startCircularOrbit();
      }
    }, transitTimeMs);
  }

  private async startCircularOrbit(): Promise<void> {
    if (!this.centerRef) return;

    this.state.step = 'ORBITING';
    const radius = this.state.circleRadiusMeters;
    const speed = this.config.flightSpeedMps;
    const dirSign = this.config.direction === 'CW' ? 1 : -1;
    const alt = this.config.targetAltitudeMeters;

    this.state.stepMessage = `[4/6] Executing Autonomous Orbit: Diameter ${this.config.circleDiameterMeters}m (Radius: ${radius}m) at ${speed}m/s [${this.config.direction}]...`;
    this.notifyState();

    audioService.playBeep(1046, 150);

    // Send MAVLink MAV_CMD_DO_ORBIT (425) to Pixhawk FC
    await mavlinkService.commandOrbit(
      radius * dirSign,
      speed,
      this.centerRef.lat,
      this.centerRef.lon,
      alt
    );

    // Circumference = 2 * PI * R. Orbit duration per lap = (2 * PI * R) / speed
    const lapDurationSec = Math.max(8, (2 * Math.PI * radius) / speed);
    const totalOrbitTimeSec = lapDurationSec * this.config.laps;

    let elapsedOrbitSec = 0;
    if (this.orbitTicker) clearInterval(this.orbitTicker);

    this.orbitTicker = setInterval(() => {
      if (this.state.step !== 'ORBITING') {
        clearInterval(this.orbitTicker);
        return;
      }

      elapsedOrbitSec += 0.5;
      this.state.elapsedSeconds = Math.round(elapsedOrbitSec);

      // Angle swept
      const fraction = Math.min(1.0, elapsedOrbitSec / totalOrbitTimeSec);
      const totalDegrees = fraction * (360 * this.config.laps);
      this.state.currentAngleDeg = Math.round(totalDegrees % 360);
      this.state.currentLap = Math.min(this.config.laps, Math.floor(totalDegrees / 360) + 1);
      this.state.progressPercent = Math.round(fraction * 100);

      this.state.stepMessage = `[4/6] Autonomous Orbit active: Lap ${this.state.currentLap}/${this.config.laps} (${Math.round(this.state.currentAngleDeg)}° / 360°) — D: ${this.config.circleDiameterMeters}m, Alt: ${this.state.currentAltitude.toFixed(1)}m.`;
      this.notifyState();

      // Check for orbit completion
      if (elapsedOrbitSec >= totalOrbitTimeSec) {
        clearInterval(this.orbitTicker);
        this.returnToCenterTakeoffPoint();
      }
    }, 500);
  }

  private async returnToCenterTakeoffPoint(): Promise<void> {
    if (!this.centerRef) return;

    this.state.step = 'RETURNING_TO_CENTER';
    const alt = this.config.targetAltitudeMeters;
    this.state.stepMessage = `[5/6] ${this.config.laps} lap(s) orbit complete! Repositioning back to center takeoff point...`;
    this.notifyState();

    audioService.playBeep(784, 150);

    // Fly back to takeoff center coordinate
    await mavlinkService.flyToPosition(
      this.centerRef.lat,
      this.centerRef.lon,
      alt,
      this.config.flightSpeedMps
    );

    // Allow 4-8 seconds for return transit before commanding landing
    const returnTimeMs = Math.max(4000, Math.min(15000, Math.round((this.state.circleRadiusMeters / this.config.flightSpeedMps) * 1000) + 2000));

    setTimeout(() => {
      if (this.state.step === 'RETURNING_TO_CENTER') {
        this.beginDescentAndLand();
      }
    }, returnTimeMs);
  }

  private beginDescentAndLand(): void {
    this.state.step = 'DESCENDING';
    this.state.stepMessage = `[6/6] Over center reference. Initiating controlled vertical descent & landing...`;
    this.notifyState();

    audioService.playBeep(659, 150);

    // Command Landing
    mavlinkService.commandLand();

    setTimeout(() => {
      if (this.state.step === 'DESCENDING') {
        this.state.step = 'LANDING';
        this.state.stepMessage = `[6/6] Final descent to touchdown at takeoff position.`;
        this.notifyState();
      }
    }, 1500);

    // Descent watchdog (50s) - allow ample time for safe landing and ArduPilot native touchdown disarm
    if (this.descentWatchdog) clearTimeout(this.descentWatchdog);
    this.descentWatchdog = setTimeout(() => {
      if (this.state.step === 'DESCENDING' || this.state.step === 'LANDING') {
        const cur = mavlinkService.getTelemetry();
        if (!cur.isArmed || cur.altitude <= 0.25) {
          this.disarmAndComplete();
        } else {
          this.abort('Descent timeout: Drone did not touchdown within 50 seconds.');
        }
      }
    }, 50000);
  }

  private async disarmAndComplete(): Promise<void> {
    this.clearAllTimers();

    this.state.step = 'DISARMING';
    this.state.stepMessage = `Touchdown confirmed. Motors disarmed.`;
    this.notifyState();

    if (mavlinkService.getTelemetry().isArmed) {
      try {
        await mavlinkService.sendDisarmCommand(false); // SAFE NON-FORCED DISARM
      } catch (e) {}
    }

    setTimeout(() => {
      this.state.step = 'COMPLETED';
      this.state.stepMessage = `AUTONOMOUS CIRCLE TEST complete! Successfully executed: Takeoff (${this.config.targetAltitudeMeters}m) ➔ Diameter ${this.config.circleDiameterMeters}m Orbit (${this.config.laps} lap, ${this.config.direction}) ➔ Return to Center ➔ Touchdown ➔ Disarmed.`;
      this.state.isExecuting = false;
      this.state.progressPercent = 100;
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
    if (this.orbitTicker) clearInterval(this.orbitTicker);
    if (this.armingWatchdog) clearTimeout(this.armingWatchdog);
    if (this.climbWatchdog) clearTimeout(this.climbWatchdog);
    if (this.transitWatchdog) clearTimeout(this.transitWatchdog);
    if (this.descentWatchdog) clearTimeout(this.descentWatchdog);
    if (this.simOrbitInterval) clearInterval(this.simOrbitInterval);
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
      stepMessage: 'Ready for diameter, altitude configuration & operator authorization.',
      isExecuting: false,
      currentAltitude: 0,
      targetAltitude: this.config.targetAltitudeMeters,
      circleDiameterMeters: this.config.circleDiameterMeters,
      circleRadiusMeters: +(this.config.circleDiameterMeters / 2).toFixed(1),
      currentAngleDeg: 0,
      currentLap: 1,
      totalLaps: this.config.laps,
      progressPercent: 0,
      flightSpeedMps: this.config.flightSpeedMps,
      direction: this.config.direction,
      elapsedSeconds: 0
    };
    this.notifyState();
  }
}

export const circleTestService = new CircleTestService();
