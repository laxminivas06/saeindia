/**
 * Smart Auto-Zoom & Dynamic Framing Controller
 * Automatically tracks QR position across the entire full-screen view,
 * adjusts zoom smoothly in both directions (zooms in when far, zooms out when too close),
 * maintains focus on the target, and avoids jitter using EMA smoothing and deadband filters.
 */

class SmartAutoZoomFraming {
  constructor(cameraService) {
    this.camera = cameraService;

    // Configurable parameters
    this.minZoom = 1.0;
    this.maxZoom = 4.0;
    
    // Optimal target QR size (percentage of frame width)
    this.targetQrRatioMin = 0.24; // 24% of screen width
    this.targetQrRatioMax = 0.52; // 52% of screen width
    this.optimalQrRatio = 0.36;   // 36% ideal target size
    
    // Smooth EMA filter state
    this.smoothedZoom = 1.0;
    this.zoomLerpAlpha = 0.15; // Smooth interpolation rate
    this.lastAdjustmentTime = 0;
    this.adjustIntervalMs = 200;
    
    // Focus controller
    this.lastFocusTriggerTime = 0;
    this.focusCooldownMs = 1400;
    
    // Framing & Position tracking
    this.currentCenter = { x: 0.5, y: 0.5 };
    this.smoothedCenter = { x: 0.5, y: 0.5 };
    this.centerLerpAlpha = 0.25;

    // Optical state
    this.consecutiveClearFrames = 0;
    this.requiredClearFrames = 3;
    this.isTracking = false;
  }

  updateConfig(config = {}) {
    if (config.minZoom !== undefined) this.minZoom = Number(config.minZoom);
    if (config.maxZoom !== undefined) this.maxZoom = Number(config.maxZoom);
  }

  /**
   * Evaluates current vision frame, updates dynamic framing & smooth zoom
   * Returns: { triggerScan, statusText, zoom, center, isTracking, isOptimal }
   */
  async evaluate(visionResult) {
    const now = Date.now();
    const { qr, metrics, frameWidth, frameHeight } = visionResult;

    // If no QR is detected
    if (!qr || !qr.found || !metrics) {
      this.isTracking = false;
      this.consecutiveClearFrames = 0;

      // Smoothly return zoom to 1.0x baseline when idle
      if (this.camera.currentZoom > 1.05 && now - this.lastAdjustmentTime > 1500) {
        const nextZoom = Math.max(1.0, this.camera.currentZoom - 0.2);
        await this.camera.setZoom(nextZoom);
        this.smoothedZoom = nextZoom;
        this.lastAdjustmentTime = now;
      }

      return {
        triggerScan: false,
        statusText: 'Scanning entire screen...',
        zoom: this.camera.currentZoom,
        isTracking: false,
        isOptimal: false
      };
    }

    this.isTracking = true;

    // 1. Calculate QR relative size
    const bounds = qr.bounds;
    const qrWidthRatio = bounds.width / frameWidth;
    const normalizedCenterX = (bounds.x + bounds.width / 2) / frameWidth;
    const normalizedCenterY = (bounds.y + bounds.height / 2) / frameHeight;

    // Smooth position tracking
    this.smoothedCenter.x += (normalizedCenterX - this.smoothedCenter.x) * this.centerLerpAlpha;
    this.smoothedCenter.y += (normalizedCenterY - this.smoothedCenter.y) * this.centerLerpAlpha;

    // 2. Dynamic Bi-directional Zoom Calculation
    let desiredZoom = this.camera.currentZoom;
    let statusText = 'Target Locked';

    if (qrWidthRatio < this.targetQrRatioMin) {
      // QR is too small / far away -> Zoom IN proportionally
      const scaleNeeded = this.optimalQrRatio / Math.max(0.08, qrWidthRatio);
      desiredZoom = Math.min(this.maxZoom, this.camera.currentZoom * Math.min(1.4, scaleNeeded));
      statusText = 'QR Far • Auto-Zooming In...';
    } else if (qrWidthRatio > this.targetQrRatioMax) {
      // QR is too large / close -> Zoom OUT proportionally
      const scaleNeeded = this.optimalQrRatio / qrWidthRatio;
      desiredZoom = Math.max(this.minZoom, this.camera.currentZoom * Math.max(0.7, scaleNeeded));
      statusText = 'QR Close • Adjusting Zoom Out...';
    } else {
      // In optimal deadband range -> Stable framing
      statusText = 'Framing Optimal • Verifying Clarity';
    }

    // Apply smooth zoom adjustment if outside deadband
    if (Math.abs(desiredZoom - this.camera.currentZoom) > 0.08 && now - this.lastAdjustmentTime > this.adjustIntervalMs) {
      const smoothed = this.camera.currentZoom + (desiredZoom - this.camera.currentZoom) * this.zoomLerpAlpha;
      const appliedZoom = await this.camera.setZoom(smoothed);
      this.smoothedZoom = appliedZoom;
      this.lastAdjustmentTime = now;
    }

    // 3. Trigger Camera Autofocus toward QR region if sharpness is low
    if (!metrics.isSharp && now - this.lastFocusTriggerTime > this.focusCooldownMs) {
      await this.camera.triggerFocus();
      window.soundEngine.playFocusLock();
      this.lastFocusTriggerTime = now;
      statusText = 'Focusing on QR Target...';
    }

    // 4. Check if optical requirements are fully met for autonomous capture
    const isOptimalSize = qrWidthRatio >= this.targetQrRatioMin && qrWidthRatio <= this.targetQrRatioMax + 0.15;
    const isReadyForCapture = metrics.isSharp && metrics.isStable && isOptimalSize;

    if (isReadyForCapture) {
      this.consecutiveClearFrames++;
      if (this.consecutiveClearFrames >= this.requiredClearFrames) {
        return {
          triggerScan: true,
          statusText: 'QR Clear & Readable ✓',
          zoom: this.camera.currentZoom,
          center: this.smoothedCenter,
          isTracking: true,
          isOptimal: true,
          payload: qr.rawValue
        };
      }
    } else {
      this.consecutiveClearFrames = 0;
    }

    return {
      triggerScan: false,
      statusText,
      zoom: this.camera.currentZoom,
      center: this.smoothedCenter,
      isTracking: true,
      isOptimal: isOptimalSize
    };
  }

  reset() {
    this.isTracking = false;
    this.consecutiveClearFrames = 0;
    this.smoothedZoom = 1.0;
  }
}

window.SmartAutoZoomFraming = SmartAutoZoomFraming;
