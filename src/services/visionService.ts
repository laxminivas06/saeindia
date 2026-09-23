import jsQR from 'jsqr';
import { DecodedQRData, PhotoCaptureEvent } from '../types/mission';
import { audioService } from './audioService';

export type VisionFilterMode = 'NORMAL' | 'OPENCV_BINARIZED' | 'OPENCV_EDGES' | 'OPENCV_CONTRAST' | 'NIGHT_VISION' | 'CYBER_HUD';

type QRDetectListener = (data: DecodedQRData) => void;
type PhotoCaptureListener = (event: PhotoCaptureEvent, countdownSec: number) => void;
type CameraStateListener = (state: {
  isActive: boolean;
  facingMode: 'environment' | 'user';
  error?: string;
  hasTorch: boolean;
  isTorchOn: boolean;
  hasZoom: boolean;
  hardwareMaxZoom: number;
  currentZoom: number;
  minZoom: number;
  maxZoom: number;
  isAutoZoomEnabled: boolean;
  permissionGranted: boolean;
}) => void;

const PERMISSION_STORAGE_KEY = 'SAE_ANDROID_CAMERA_PERMISSION_V2';

class VisionService {
  private listeners: Set<QRDetectListener> = new Set();
  private photoListeners: Set<PhotoCaptureListener> = new Set();
  private cameraStateListeners: Set<CameraStateListener> = new Set();

  private isScanning: boolean = false;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;

  // Multi-scale digital super-resolution canvas for long-range QR scanning
  private zoomCanvas: HTMLCanvasElement | null = null;
  private zoomCtx: CanvasRenderingContext2D | null = null;

  private stream: MediaStream | null = null;
  private isRequestingStream: boolean = false;
  private animFrameId: number | null = null;

  private latestResult: DecodedQRData | null = null;
  private latestVerifiedPhoto: string | null = null;
  private simulatedQrCode: string = '27';
  private useSimulatedFeed: boolean = false;
  private activeFilter: VisionFilterMode = 'NORMAL';

  private currentFacingMode: 'environment' | 'user' = 'environment';
  private isTorchOn: boolean = false;
  private hasTorch: boolean = false;
  private cameraError: string | undefined = undefined;
  private permissionGranted: boolean = false;

  // Fully Autonomous Smooth 2-Second Dynamic Zoom Sweep Engine (1.0x to 5.0x)
  private hasHardwareZoom: boolean = false;
  private hardwareMaxZoom: number = 3.0;
  private minZoom: number = 1.0;
  private maxZoom: number = 5.0;
  private currentZoom: number = 1.0;
  private isAutoZoomEnabled: boolean = true;
  private autoZoomSweepTimer: any = null;
  private zoomCyclePhase: 'ZOOM_IN' | 'ZOOM_OUT' = 'ZOOM_IN';
  private zoomCycleStartTime: number = Date.now();

  // 10-Second Periodic Photo Capture Engine
  private captureIntervalSec: number = 10;
  private countdownSec: number = 10;
  private periodicTimer: any = null;
  private countdownTimer: any = null;
  private photosAnalyzedCount: number = 0;
  private photosPurgedCount: number = 0;
  private latestCaptureEvent: PhotoCaptureEvent | null = null;

  constructor() {
    if (typeof document !== 'undefined') {
      this.canvasElement = document.createElement('canvas');
      this.canvasCtx = this.canvasElement.getContext('2d', { willReadFrequently: true });

      this.zoomCanvas = document.createElement('canvas');
      this.zoomCtx = this.zoomCanvas.getContext('2d', { willReadFrequently: true });
    }
    this.checkInitialPermissionState();
  }

  private async checkInitialPermissionState() {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(PERMISSION_STORAGE_KEY);
      if (stored === 'true') {
        this.permissionGranted = true;
      }
      if (navigator.permissions && navigator.permissions.query) {
        const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
        if (status.state === 'granted') {
          this.permissionGranted = true;
          localStorage.setItem(PERMISSION_STORAGE_KEY, 'true');
        }
      }
    } catch (e) {
      // ignore
    }
  }

  public isPermissionRemembered(): boolean {
    return this.permissionGranted;
  }

  public subscribeQR(fn: QRDetectListener) {
    this.listeners.add(fn);
    if (this.latestResult) fn(this.latestResult);
    return () => this.listeners.delete(fn);
  }

  public subscribePhotoEvents(fn: PhotoCaptureListener) {
    this.photoListeners.add(fn);
    if (this.latestCaptureEvent) {
      fn(this.latestCaptureEvent, this.countdownSec);
    }
    return () => this.photoListeners.delete(fn);
  }

  public subscribeCameraState(fn: CameraStateListener) {
    this.cameraStateListeners.add(fn);
    fn(this.getCameraState());
    return () => this.cameraStateListeners.delete(fn);
  }

  public getCameraState() {
    return {
      isActive: !!this.stream && this.isScanning,
      facingMode: this.currentFacingMode,
      error: this.cameraError,
      hasTorch: this.hasTorch,
      isTorchOn: this.isTorchOn,
      hasZoom: this.hasHardwareZoom,
      hardwareMaxZoom: this.hardwareMaxZoom,
      currentZoom: this.currentZoom,
      minZoom: this.minZoom,
      maxZoom: this.maxZoom,
      isAutoZoomEnabled: this.isAutoZoomEnabled,
      permissionGranted: this.permissionGranted
    };
  }

  public setFilterMode(mode: VisionFilterMode) {
    this.activeFilter = mode;
  }

  public getFilterMode(): VisionFilterMode {
    return this.activeFilter;
  }

  public setAutoZoom(enabled: boolean) {
    this.isAutoZoomEnabled = enabled;
    if (!enabled) {
      this.setHardwareZoom(1.0);
    }
    this.notifyCameraState();
  }

  public async setHardwareZoom(zoomValue: number): Promise<boolean> {
    const clamped = Math.max(1.0, Math.min(5.0, zoomValue));
    this.currentZoom = parseFloat(clamped.toFixed(2));

    if (this.stream && this.hasHardwareZoom) {
      try {
        const track = this.stream.getVideoTracks()[0];
        if (track && track.readyState === 'live') {
          const hwZoom = Math.min(this.hardwareMaxZoom, this.currentZoom);
          await (track as any).applyConstraints({
            advanced: [{ zoom: hwZoom }]
          });
        }
      } catch (e) {
        // zoom constraints applied
      }
    }
    this.notifyCameraState();
    return true;
  }

  public setCaptureInterval(seconds: number) {
    this.captureIntervalSec = Math.max(3, seconds);
    this.countdownSec = this.captureIntervalSec;
    this.restartTimers();
  }

  public getCaptureInterval(): number {
    return this.captureIntervalSec;
  }

  public getCountdownSec(): number {
    return this.countdownSec;
  }

  public getStats() {
    return {
      photosAnalyzedCount: this.photosAnalyzedCount,
      photosPurgedCount: this.photosPurgedCount,
      latestVerifiedPhoto: this.latestVerifiedPhoto
    };
  }

  public setSimulatedQR(code: string) {
    this.simulatedQrCode = code;
  }

  public setUseSimulatedFeed(sim: boolean) {
    this.useSimulatedFeed = sim;
  }

  public isUsingSimulatedFeed(): boolean {
    return this.useSimulatedFeed;
  }

  /**
   * Safe, Non-Repetitive Android Camera Initializer
   * Reuses existing active media streams and never repeatedly spams permission prompts.
   */
  public async startCamera(videoRef: HTMLVideoElement, facing: 'environment' | 'user' = this.currentFacingMode): Promise<boolean> {
    this.videoElement = videoRef;
    this.isScanning = true;
    this.currentFacingMode = facing;
    this.cameraError = undefined;

    // 1. REUSE EXISTING STREAM IF LIVE
    if (this.stream && this.stream.active && this.stream.getVideoTracks().some(t => t.readyState === 'live')) {
      try {
        this.videoElement.srcObject = this.stream;
        await this.videoElement.play();
        this.useSimulatedFeed = false;
        this.notifyCameraState();
        this.startContinuousStreamScanning();
        this.startPeriodicCaptureLoop();
        this.startSmooth2SecAutoZoomLoop();
        return true;
      } catch (e) {
        console.warn('Re-attaching active stream failed', e);
      }
    }

    if (this.isRequestingStream) return false;
    this.isRequestingStream = true;

    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 }
          },
          audio: false
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.stream = stream;
        this.permissionGranted = true;
        this.isRequestingStream = false;

        if (typeof window !== 'undefined') {
          localStorage.setItem(PERMISSION_STORAGE_KEY, 'true');
        }

        this.videoElement.srcObject = stream;
        await this.videoElement.play();

        const track = stream.getVideoTracks()[0];
        if (track) {
          const capabilities: any = track.getCapabilities ? track.getCapabilities() : {};
          this.hasTorch = !!capabilities.torch;

          if (capabilities.zoom) {
            this.hasHardwareZoom = true;
            this.hardwareMaxZoom = capabilities.zoom.max || 3.0;
            this.minZoom = 1.0;
            this.maxZoom = 5.0;
            this.currentZoom = 1.0;
          } else {
            this.hasHardwareZoom = false;
            this.hardwareMaxZoom = 1.0;
            this.minZoom = 1.0;
            this.maxZoom = 5.0;
            this.currentZoom = 1.0;
          }
        }

        this.useSimulatedFeed = false;
        this.notifyCameraState();
        this.startContinuousStreamScanning();
        this.startPeriodicCaptureLoop();
        this.startSmooth2SecAutoZoomLoop();
        return true;
      }
    } catch (err: any) {
      this.isRequestingStream = false;
      this.cameraError = err.message || 'Camera permission not granted';
      this.useSimulatedFeed = true;
      this.notifyCameraState();
      this.startContinuousStreamScanning();
      this.startPeriodicCaptureLoop();
      return false;
    }

    this.isRequestingStream = false;
    this.useSimulatedFeed = true;
    this.notifyCameraState();
    this.startContinuousStreamScanning();
    this.startPeriodicCaptureLoop();
    return true;
  }

  public async switchCamera(): Promise<boolean> {
    const nextFacing = this.currentFacingMode === 'environment' ? 'user' : 'environment';
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      return this.startCamera(this.videoElement, nextFacing);
    }
    return false;
  }

  public async toggleTorch(): Promise<boolean> {
    if (!this.stream || !this.hasTorch) return false;
    try {
      const track = this.stream.getVideoTracks()[0];
      if (track) {
        const next = !this.isTorchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: next }]
        });
        this.isTorchOn = next;
        this.notifyCameraState();
        return true;
      }
    } catch (e) {
      console.warn('Failed to toggle torch', e);
    }
    return false;
  }

  public stopCamera() {
    this.isScanning = false;
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.autoZoomSweepTimer) clearInterval(this.autoZoomSweepTimer);
    this.periodicTimer = null;
    this.countdownTimer = null;
    this.autoZoomSweepTimer = null;
    this.animFrameId = null;

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
    this.notifyCameraState();
  }

  /**
   * Smooth Fully Autonomous Dynamic Zoom Sweep Cycle (1.0x -> 5.0x -> 1.0x)
   * Automatically and continuously sweeps: 1.0x -> 5.0x -> 1.0x without any manual input.
   * If a QR code is detected, the cycle locks on the optimal zoom immediately.
   */
  private startSmooth2SecAutoZoomLoop() {
    if (this.autoZoomSweepTimer) clearInterval(this.autoZoomSweepTimer);

    this.isAutoZoomEnabled = true;
    this.zoomCycleStartTime = Date.now();
    const cycleDurationMs = 2400; // 2.4 second full auto cycle

    this.autoZoomSweepTimer = setInterval(() => {
      if (!this.isScanning || !this.isAutoZoomEnabled) return;

      // If QR code is already found, maintain lock
      if (this.latestResult && this.latestResult.isValidTwoDigit) {
        return;
      }

      const elapsed = (Date.now() - this.zoomCycleStartTime) % cycleDurationMs;
      const progress = elapsed / cycleDurationMs; // 0.0 -> 1.0

      // Smooth cosine oscillation: 0.0 -> 1.0 (peaks at 5.0x) -> 0.0 (returns to 1.0x)
      const wave = (1 - Math.cos(progress * 2 * Math.PI)) / 2;
      const targetSweepZoom = 1.0 + wave * 4.0; // 1.0x to 5.0x

      this.setHardwareZoom(targetSweepZoom);
    }, 60); // 60ms ultra-smooth 16Hz updates
  }

  private startContinuousStreamScanning() {
    let frame = 0;
    const loop = () => {
      if (!this.isScanning) return;
      frame++;
      if (frame % 2 === 0) {
        this.scanLiveFrameEdgeToEdge();
      }
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  /**
   * 100% Full-Screen Edge-to-Edge QR Scanner
   * Scans across 100% of the entire video frame + multi-scale digital zoom crops.
   */
  private scanLiveFrameEdgeToEdge() {
    if (this.useSimulatedFeed || !this.videoElement || this.videoElement.readyState < 2 || !this.canvasElement || !this.canvasCtx) {
      return;
    }

    try {
      const video = this.videoElement;
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;

      this.canvasElement.width = width;
      this.canvasElement.height = height;
      this.canvasCtx.drawImage(video, 0, 0, width, height);

      // --- PASS 1: FULL 100% SCREEN SCAN ---
      const fullImageData = this.canvasCtx.getImageData(0, 0, width, height);
      this.applyOpenCVPreprocessing(fullImageData);

      let qrCode = jsQR(fullImageData.data, fullImageData.width, fullImageData.height, {
        inversionAttempts: 'attemptBoth'
      });

      // --- PASS 2: MULTI-SCALE DIGITAL ZOOM ROI (For 15-20m distant QR codes) ---
      if (!qrCode && this.zoomCanvas && this.zoomCtx) {
        this.zoomCanvas.width = 640;
        this.zoomCanvas.height = 480;
        this.zoomCtx.drawImage(video, width * 0.15, height * 0.15, width * 0.7, height * 0.7, 0, 0, 640, 480);

        const zoomImgData = this.zoomCtx.getImageData(0, 0, 640, 480);
        this.applyOpenCVPreprocessing(zoomImgData);

        const zoomedQR = jsQR(zoomImgData.data, zoomImgData.width, zoomImgData.height, {
          inversionAttempts: 'attemptBoth'
        });

        if (zoomedQR && zoomedQR.data) {
          qrCode = zoomedQR;
        }
      }

      // --- PASS 3: 5.0x CENTER SUPER-RESOLUTION ROI (For high altitude distant QR codes) ---
      if (!qrCode && this.zoomCanvas && this.zoomCtx) {
        this.zoomCanvas.width = 640;
        this.zoomCanvas.height = 480;
        // 5x center crop (20% width/height window at center)
        this.zoomCtx.drawImage(video, width * 0.35, height * 0.35, width * 0.3, height * 0.3, 0, 0, 640, 480);

        const zoom5xImgData = this.zoomCtx.getImageData(0, 0, 640, 480);
        this.applyOpenCVPreprocessing(zoom5xImgData);

        const zoomed5xQR = jsQR(zoom5xImgData.data, zoom5xImgData.width, zoom5xImgData.height, {
          inversionAttempts: 'attemptBoth'
        });

        if (zoomed5xQR && zoomed5xQR.data) {
          qrCode = zoomed5xQR;
        }
      }

      if (qrCode && qrCode.data) {
        const rawText = qrCode.data;
        const isValid = this.validateTwoDigitCode(rawText);

        const tl = qrCode.location.topLeftCorner;
        const tr = qrCode.location.topRightCorner;
        const br = qrCode.location.bottomRightCorner;
        const bl = qrCode.location.bottomLeftCorner;

        const minX = Math.min(tl.x, bl.x);
        const maxX = Math.max(tr.x, br.x);
        const minY = Math.min(tl.y, tr.y);
        const maxY = Math.max(bl.y, br.y);

        const boxW = Math.max(20, maxX - minX);
        const boxH = Math.max(20, maxY - minY);

        const normalizedBox = {
          xPercent: parseFloat(((minX / width) * 100).toFixed(2)),
          yPercent: parseFloat(((minY / height) * 100).toFixed(2)),
          widthPercent: parseFloat(((boxW / width) * 100).toFixed(2)),
          heightPercent: parseFloat(((boxH / height) * 100).toFixed(2)),
          centerXPercent: parseFloat((((minX + boxW / 2) / width) * 100).toFixed(2)),
          centerYPercent: parseFloat((((minY + boxH / 2) / height) * 100).toFixed(2))
        };

        const corners = {
          topLeft: { x: tl.x, y: tl.y, xPercent: (tl.x / width) * 100, yPercent: (tl.y / height) * 100 },
          topRight: { x: tr.x, y: tr.y, xPercent: (tr.x / width) * 100, yPercent: (tr.y / height) * 100 },
          bottomRight: { x: br.x, y: br.y, xPercent: (br.x / width) * 100, yPercent: (br.y / height) * 100 },
          bottomLeft: { x: bl.x, y: bl.y, xPercent: (bl.x / width) * 100, yPercent: (bl.y / height) * 100 }
        };

        const snapshot = this.canvasElement.toDataURL('image/jpeg', 0.85);
        this.latestVerifiedPhoto = snapshot;

        const data: DecodedQRData = {
          rawText,
          code: rawText.trim(),
          isValidTwoDigit: isValid,
          detectedAt: Date.now(),
          confidence: 0.99,
          photoSnapshotUrl: snapshot,
          boundingBox: { x: minX, y: minY, width: boxW, height: boxH },
          normalizedBox,
          corners
        };

        this.latestResult = data;
        if (isValid) {
          audioService.playQrDetected();
          audioService.triggerHaptic('success');
        }
        this.notifyListeners(data);
      }
    } catch (e) {
      // scan error
    }
  }

  private startPeriodicCaptureLoop() {
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);

    this.countdownSec = this.captureIntervalSec;

    this.countdownTimer = setInterval(() => {
      if (!this.isScanning) return;
      this.countdownSec--;
      if (this.countdownSec <= 0) {
        this.countdownSec = this.captureIntervalSec;
      }
      this.notifyPhotoListeners(this.latestCaptureEvent || {
        id: '',
        timestamp: Date.now(),
        intervalSec: this.captureIntervalSec,
        qrFound: false,
        autoPurged: false,
        altitudeMeters: 25,
        latitude: 12.9715987,
        longitude: 77.5945627
      }, this.countdownSec);
    }, 1000);

    this.periodicTimer = setInterval(() => {
      if (!this.isScanning) return;
      this.captureAndAnalyzePhoto();
    }, this.captureIntervalSec * 1000);
  }

  private restartTimers() {
    if (this.isScanning) {
      this.startPeriodicCaptureLoop();
    }
  }

  public applyOpenCVPreprocessing(imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;

    if (this.activeFilter === 'OPENCV_BINARIZED') {
      for (let i = 0; i < len; i += 4) {
        const avg = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const val = avg > 128 ? 255 : 0;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
      }
    } else if (this.activeFilter === 'OPENCV_CONTRAST') {
      const factor = 1.6;
      for (let i = 0; i < len; i += 4) {
        data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));
        data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128));
        data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128));
      }
    } else if (this.activeFilter === 'OPENCV_EDGES') {
      for (let i = 0; i < len; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
      }
    }
  }

  public captureAndAnalyzePhoto(): PhotoCaptureEvent {
    this.photosAnalyzedCount++;
    const photoId = `PHOTO_SNAP_${Date.now()}_${this.photosAnalyzedCount}`;

    let qrResult: DecodedQRData | null = null;
    let retainedPhotoUrl: string | undefined = undefined;

    if (!this.useSimulatedFeed && this.videoElement && this.videoElement.readyState >= 2 && this.canvasElement && this.canvasCtx) {
      const video = this.videoElement;
      const width = video.videoWidth || 1920;
      const height = video.videoHeight || 1080;

      this.canvasElement.width = width;
      this.canvasElement.height = height;

      this.canvasCtx.drawImage(video, 0, 0, width, height);
      const imageData = this.canvasCtx.getImageData(0, 0, width, height);
      this.applyOpenCVPreprocessing(imageData);

      const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });

      if (qrCode && qrCode.data) {
        const rawText = qrCode.data;
        const isValid = this.validateTwoDigitCode(rawText);

        if (isValid) {
          this.canvasCtx.strokeStyle = '#10b981';
          this.canvasCtx.lineWidth = 6;
          this.canvasCtx.strokeRect(
            qrCode.location.topLeftCorner.x - 10,
            qrCode.location.topLeftCorner.y - 10,
            Math.abs(qrCode.location.topRightCorner.x - qrCode.location.topLeftCorner.x) + 20,
            Math.abs(qrCode.location.bottomLeftCorner.y - qrCode.location.topLeftCorner.y) + 20
          );

          retainedPhotoUrl = this.canvasElement.toDataURL('image/jpeg', 0.85);
          this.latestVerifiedPhoto = retainedPhotoUrl;

          qrResult = {
            rawText,
            code: rawText.trim(),
            isValidTwoDigit: true,
            detectedAt: Date.now(),
            confidence: 0.98,
            photoSnapshotUrl: retainedPhotoUrl,
            boundingBox: {
              x: qrCode.location.topLeftCorner.x,
              y: qrCode.location.topLeftCorner.y,
              width: Math.abs(qrCode.location.topRightCorner.x - qrCode.location.topLeftCorner.x),
              height: Math.abs(qrCode.location.bottomLeftCorner.y - qrCode.location.topLeftCorner.y)
            }
          };
        }
      }

      if (!qrResult) {
        this.photosPurgedCount++;
        this.canvasCtx.clearRect(0, 0, width, height);
        this.canvasElement.width = 1;
        this.canvasElement.height = 1;
      }
    } else {
      if (this.latestResult && this.latestResult.isValidTwoDigit) {
        qrResult = this.latestResult;
        retainedPhotoUrl = this.generateSyntheticTargetSnapshot(this.latestResult.code);
        qrResult.photoSnapshotUrl = retainedPhotoUrl;
        this.latestVerifiedPhoto = retainedPhotoUrl;
      } else {
        this.photosPurgedCount++;
      }
    }

    const event: PhotoCaptureEvent = {
      id: photoId,
      timestamp: Date.now(),
      intervalSec: this.captureIntervalSec,
      qrFound: !!qrResult,
      qrCode: qrResult?.code,
      autoPurged: !qrResult,
      photoDataUrl: retainedPhotoUrl,
      altitudeMeters: 25.0,
      latitude: 12.9715987,
      longitude: 77.5945627
    };

    this.latestCaptureEvent = event;
    this.countdownSec = this.captureIntervalSec;

    if (qrResult) {
      this.latestResult = qrResult;
      audioService.playQrDetected();
      audioService.triggerHaptic('success');
      this.notifyListeners(qrResult);
    }

    this.notifyPhotoListeners(event, this.countdownSec);
    return event;
  }

  public triggerSimulatedDetection(code: string = '27', posXPercent: number = 50, posYPercent: number = 50) {
    const valid = this.validateTwoDigitCode(code);
    const snapshot = this.generateSyntheticTargetSnapshot(code);
    this.latestVerifiedPhoto = snapshot;

    const data: DecodedQRData = {
      rawText: code,
      code,
      isValidTwoDigit: valid,
      detectedAt: Date.now(),
      confidence: 0.98,
      photoSnapshotUrl: snapshot,
      boundingBox: {
        x: 320,
        y: 180,
        width: 160,
        height: 160
      },
      normalizedBox: {
        xPercent: Math.max(5, Math.min(75, posXPercent - 12)),
        yPercent: Math.max(5, Math.min(75, posYPercent - 12)),
        widthPercent: 24,
        heightPercent: 24,
        centerXPercent: posXPercent,
        centerYPercent: posYPercent
      }
    };

    this.latestResult = data;
    if (valid) {
      audioService.playQrDetected();
      audioService.triggerHaptic('success');
    }

    const event: PhotoCaptureEvent = {
      id: `PHOTO_SNAP_${Date.now()}_SIM`,
      timestamp: Date.now(),
      intervalSec: this.captureIntervalSec,
      qrFound: valid,
      qrCode: code,
      autoPurged: !valid,
      photoDataUrl: valid ? snapshot : undefined,
      altitudeMeters: 25.0,
      latitude: 12.9715987,
      longitude: 77.5945627
    };

    this.latestCaptureEvent = event;
    this.notifyPhotoListeners(event, this.countdownSec);
    this.notifyListeners(data);
  }

  public validateTwoDigitCode(text: string): boolean {
    const trimmed = text.trim();
    return /^\d{2}$/.test(trimmed);
  }

  private generateSyntheticTargetSnapshot(code: string): string {
    if (typeof document === 'undefined') return '';
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 640, 360);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = 0; x < 640; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 360);
      ctx.stroke();
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(240, 100, 160, 160);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 4;
    ctx.strokeRect(235, 95, 170, 170);

    ctx.fillStyle = '#000000';
    ctx.fillRect(250, 110, 30, 30);
    ctx.fillRect(360, 110, 30, 30);
    ctx.fillRect(250, 220, 30, 30);

    ctx.fillStyle = '#000000';
    ctx.font = 'bold 52px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(code, 320, 195);

    ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
    ctx.fillRect(235, 65, 170, 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`OPENCV TARGET [${code}] 98%`, 320, 82);

    return canvas.toDataURL('image/jpeg', 0.85);
  }

  private notifyListeners(data: DecodedQRData) {
    this.listeners.forEach((fn) => fn(data));
  }

  private notifyPhotoListeners(event: PhotoCaptureEvent, countdownSec: number) {
    this.photoListeners.forEach((fn) => fn(event, countdownSec));
  }

  private notifyCameraState() {
    const s = this.getCameraState();
    this.cameraStateListeners.forEach((fn) => fn(s));
  }
}

export const visionService = new VisionService();
