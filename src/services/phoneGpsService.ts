/**
 * SAE INDIA — Ground Station Phone GPS Service
 *
 * Implements continuous, reliable Geolocation tracking for mobile & desktop browsers.
 * Supports:
 * - Continuous location watching via HTML5 Geolocation API
 * - Real-time Latitude, Longitude, Accuracy, Altitude, Heading & Timestamp
 * - Compass heading enhancement via DeviceOrientation API
 * - Ground Station Reference Location & Mission Planning anchor
 * - Optional throttled transmission to ESP32 / MAVLink bridge (Safety-isolated)
 * - Automatic startup with graceful permission handling
 */

import { LatLngPoint } from '../types/mission';
import { usbHostService } from './usbHostService';
import { eventLogService } from './eventLogService';

export type PhoneGpsStatus =
  | 'CONNECTED'
  | 'WAITING_FOR_LOCATION'
  | 'PERMISSION_DENIED'
  | 'UNSUPPORTED'
  | 'DISABLED';

export interface PhoneGpsState {
  enabled: boolean;
  status: PhoneGpsStatus;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null; // meters
  altitude: number | null; // meters MSL
  altitudeAccuracy: number | null;
  heading: number | null; // 0-360 degrees
  speed: number | null; // m/s
  timestamp: number | null;
  lastUpdateTime: string | null;
  useAsReference: boolean;
  transmitToEsp32: boolean;
  isTransmitting: boolean;
  error: string | null;
}

type PhoneGpsListener = (state: PhoneGpsState) => void;
type CenterMapListener = (coords: { lat: number; lng: number }) => void;

class PhoneGpsService {
  private state: PhoneGpsState = {
    enabled: true,
    status: 'WAITING_FOR_LOCATION',
    latitude: null,
    longitude: null,
    accuracy: null,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    timestamp: null,
    lastUpdateTime: null,
    useAsReference: true,
    transmitToEsp32: false,
    isTransmitting: false,
    error: null,
  };

  private watchId: number | null = null;
  private listeners: Set<PhoneGpsListener> = new Set();
  private centerMapListeners: Set<CenterMapListener> = new Set();
  private orientationListenerAttached: boolean = false;
  private transmitTimer: any = null;
  private lastTransmitTime: number = 0;

  constructor() {
    this.loadPersistedPreferences();
    if (typeof window !== 'undefined') {
      // Auto-start continuous watching if enabled (Requirement 8)
      if (this.state.enabled) {
        this.startWatching();
      }
      this.initOrientationListener();
    }
  }

  private loadPersistedPreferences() {
    if (typeof window === 'undefined') return;
    try {
      const savedRef = localStorage.getItem('SAE_PHONE_GPS_USE_REF');
      if (savedRef !== null) {
        this.state.useAsReference = savedRef === 'true';
      }
      const savedEnabled = localStorage.getItem('SAE_PHONE_GPS_ENABLED');
      if (savedEnabled !== null) {
        this.state.enabled = savedEnabled === 'true';
      }
      const savedTransmit = localStorage.getItem('SAE_PHONE_GPS_TRANSMIT');
      if (savedTransmit !== null) {
        this.state.transmitToEsp32 = savedTransmit === 'true';
      }
    } catch (e) {
      // ignore
    }
  }

  private savePreferences() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('SAE_PHONE_GPS_USE_REF', String(this.state.useAsReference));
      localStorage.setItem('SAE_PHONE_GPS_ENABLED', String(this.state.enabled));
      localStorage.setItem('SAE_PHONE_GPS_TRANSMIT', String(this.state.transmitToEsp32));
    } catch (e) {
      // ignore
    }
  }

  /**
   * Device Orientation listener for phone heading when stationary
   */
  private initOrientationListener() {
    if (this.orientationListenerAttached || typeof window === 'undefined') return;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      // If geolocation coords already provided a valid heading (> 0 while moving), prioritize it
      if (this.state.speed && this.state.speed > 0.5 && this.state.heading !== null) {
        return;
      }

      let compassHeading: number | null = null;
      // iOS webkitCompassHeading
      if ('webkitCompassHeading' in event && typeof (event as any).webkitCompassHeading === 'number') {
        compassHeading = (event as any).webkitCompassHeading;
      } else if (event.alpha !== null && typeof event.alpha === 'number') {
        // Android fallback (alpha represents rotation around z axis)
        compassHeading = (360 - event.alpha) % 360;
      }

      if (compassHeading !== null && !isNaN(compassHeading)) {
        this.state.heading = Math.round(compassHeading * 10) / 10;
        this.notify();
      }
    };

    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation, true);
      this.orientationListenerAttached = true;
    }
  }

  /**
   * Start continuous location watching (Requirement 2 & 8)
   */
  public startWatching(): void {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      this.updateState({
        status: 'UNSUPPORTED',
        error: 'Browser Geolocation is not supported on this device.',
      });
      return;
    }

    if (this.watchId !== null) {
      return; // Already watching
    }

    this.updateState({
      enabled: true,
      status: 'WAITING_FOR_LOCATION',
      error: null,
    });
    this.savePreferences();

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 2000,
    };

    try {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this.handlePositionUpdate(pos),
        (err) => this.handlePositionError(err),
        options
      );
    } catch (e: any) {
      this.updateState({
        status: 'PERMISSION_DENIED',
        error: e?.message || 'Failed to start geolocation tracking',
      });
    }

    // Only initiate transmission if explicitly enabled by user (Requirement 6)
    if (this.state.transmitToEsp32) {
      this.startTransmitLoop();
    }
  }

  /**
   * Stop continuous location watching
   */
  public stopWatching(): void {
    if (this.watchId !== null && typeof window !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    this.stopTransmitLoop();
    this.updateState({
      enabled: false,
      status: 'DISABLED',
      error: null,
    });
    this.savePreferences();
  }

  /**
   * Toggle Phone GPS enable / disable
   */
  public toggle(): void {
    if (this.state.enabled) {
      this.stopWatching();
    } else {
      this.startWatching();
    }
  }

  private handlePositionUpdate(pos: GeolocationPosition): void {
    const coords = pos.coords;
    const now = new Date();
    const formattedTime = now.toLocaleTimeString([], { hour12: false });

    // Use GPS heading if available and moving, otherwise preserve device orientation heading
    let heading = this.state.heading;
    if (coords.heading !== null && !isNaN(coords.heading)) {
      heading = coords.heading;
    }

    this.updateState({
      status: 'CONNECTED',
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: Math.round(coords.accuracy * 10) / 10,
      altitude: coords.altitude !== null ? Math.round(coords.altitude * 10) / 10 : null,
      altitudeAccuracy: coords.altitudeAccuracy !== null ? Math.round(coords.altitudeAccuracy * 10) / 10 : null,
      heading: heading !== null ? Math.round(heading * 10) / 10 : null,
      speed: coords.speed !== null && !isNaN(coords.speed) ? Math.round(coords.speed * 10) / 10 : null,
      timestamp: pos.timestamp,
      lastUpdateTime: formattedTime,
      error: null,
    });

    // Check optional transmission to ESP32
    if (this.state.transmitToEsp32) {
      this.maybeTransmitPhoneGps();
    }
  }

  private handlePositionError(err: GeolocationPositionError): void {
    let status: PhoneGpsStatus = 'WAITING_FOR_LOCATION';
    let errorMsg = 'Waiting for GPS fix...';

    switch (err.code) {
      case err.PERMISSION_DENIED:
        status = 'PERMISSION_DENIED';
        errorMsg = 'Location permission denied by browser / device settings.';
        break;
      case err.POSITION_UNAVAILABLE:
        status = 'WAITING_FOR_LOCATION';
        errorMsg = 'Location position temporarily unavailable. Waiting...';
        break;
      case err.TIMEOUT:
        status = 'WAITING_FOR_LOCATION';
        errorMsg = 'Location request timed out. Retrying automatically...';
        break;
      default:
        status = 'WAITING_FOR_LOCATION';
        errorMsg = err.message || 'GPS signal search in progress...';
    }

    this.updateState({
      status,
      error: errorMsg,
    });
  }

  /**
   * Set whether Phone GPS serves as Reference Location for Ground Station & Mission Planning
   */
  public setUseAsReference(value: boolean): void {
    this.updateState({ useAsReference: value });
    this.savePreferences();
    eventLogService.addEvent(`Phone GPS reference mode: ${value ? 'ACTIVE' : 'INACTIVE'}`, 'info');
  }

  /**
   * Set whether Phone GPS is transmitted to ESP32 / MAVLink (Requirement 5 & 6)
   */
  public setTransmitToEsp32(value: boolean): void {
    this.updateState({ transmitToEsp32: value });
    this.savePreferences();
    if (value) {
      this.startTransmitLoop();
      eventLogService.addEvent('Phone GPS transmission to ESP32 ENABLED (isolated reference stream)', 'info');
    } else {
      this.stopTransmitLoop();
      eventLogService.addEvent('Phone GPS transmission to ESP32 DISABLED', 'info');
    }
  }

  private startTransmitLoop(): void {
    if (this.transmitTimer || !this.state.transmitToEsp32) return;
    this.transmitTimer = setInterval(() => {
      this.maybeTransmitPhoneGps();
    }, 1000); // 1 Hz transmission rate
  }

  private stopTransmitLoop(): void {
    if (this.transmitTimer) {
      clearInterval(this.transmitTimer);
      this.transmitTimer = null;
    }
    this.updateState({ isTransmitting: false });
  }

  /**
   * Transmit Phone GPS to ESP32 over active transport (Requirement 5)
   */
  private async maybeTransmitPhoneGps(): Promise<void> {
    if (
      !this.state.transmitToEsp32 ||
      this.state.status !== 'CONNECTED' ||
      this.state.latitude === null ||
      this.state.longitude === null
    ) {
      return;
    }

    const now = Date.now();
    if (now - this.lastTransmitTime < 900) {
      return; // Rate limit to ~1Hz
    }
    this.lastTransmitTime = now;

    const payload = {
      type: 'PHONE_GPS',
      latitude: this.state.latitude,
      longitude: this.state.longitude,
      altitude: this.state.altitude || 0,
      accuracy: this.state.accuracy || 5,
      heading: this.state.heading ?? null,
      timestamp: this.state.timestamp || now,
    };

    try {
      // Send text frame or binary as supported by transport bridge
      const jsonStr = JSON.stringify(payload);
      const encoder = new TextEncoder();
      const bytes = encoder.encode(jsonStr);
      await usbHostService.sendBytes(bytes);
      this.updateState({ isTransmitting: true });
    } catch (e) {
      this.updateState({ isTransmitting: false });
    }
  }

  /**
   * Center map on phone coordinates (Requirement 4)
   */
  public centerMapOnPhone(): boolean {
    if (this.state.latitude !== null && this.state.longitude !== null) {
      const coords = { lat: this.state.latitude, lng: this.state.longitude };
      this.centerMapListeners.forEach((fn) => fn(coords));
      return true;
    }
    return false;
  }

  /**
   * Get current reference location (returns phone coords if useAsReference is true and connected)
   */
  public getReferenceLocation(): LatLngPoint | null {
    if (
      this.state.useAsReference &&
      this.state.status === 'CONNECTED' &&
      this.state.latitude !== null &&
      this.state.longitude !== null
    ) {
      return {
        lat: this.state.latitude,
        lng: this.state.longitude,
      };
    }
    return null;
  }

  public getState(): PhoneGpsState {
    return { ...this.state };
  }

  public subscribe(listener: PhoneGpsListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public subscribeCenterMap(listener: CenterMapListener): () => void {
    this.centerMapListeners.add(listener);
    return () => this.centerMapListeners.delete(listener);
  }

  private updateState(partial: Partial<PhoneGpsState>): void {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  private notify(): void {
    const s = this.getState();
    this.listeners.forEach((fn) => fn(s));
  }
}

export const phoneGpsService = new PhoneGpsService();
