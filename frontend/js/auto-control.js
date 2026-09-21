/**
 * Auto-Focus & Auto-Zoom Control Engine for Direct QR Code Acquisition
 * Dynamically locks onto QR codes from longer distances, steps zoom up to enlarge the code,
 * triggers autofocus for optical sharpness, and provides real-time distance & visibility guidance.
 */

class AutoControlEngine {
  constructor(cameraService) {
    this.camera = cameraService;

    // Configurable Auto-Zoom parameters
    this.minZoom = 1.0;
    this.maxZoom = 4.0;
    this.zoomStep = 0.3;
    this.zoomIntervalMs = 500;
    
    // Internal state tracking
    this.lastZoomAdjustTime = 0;
    this.lastFocusTriggerTime = 0;
    this.focusCooldownMs = 1500;
    
    // Auto-scan enablement
    this.autoScanEnabled = true;
    
    // Current optical state
    this.currentState = 'SEARCHING_QR';
    this.stateLabel = 'Searching for QR code...';
    this.stateSubtext = 'Point camera toward QR code';
    
    // Clarity verification counter
    this.stableFramesRequired = 3;
    this.consecutiveClearFrames = 0;
  }

  updateConfig(config = {}) {
    if (config.minZoom !== undefined) this.minZoom = Number(config.minZoom);
    if (config.maxZoom !== undefined) this.maxZoom = Number(config.maxZoom);
    if (config.zoomStep !== undefined) this.zoomStep = Number(config.zoomStep);
    if (config.zoomIntervalMs !== undefined) this.zoomIntervalMs = Number(config.zoomIntervalMs);
    if (config.autoScanEnabled !== undefined) this.autoScanEnabled = Boolean(config.autoScanEnabled);
  }

  /**
   * Evaluates the current frame detection and applies direct auto-zoom / auto-focus logic
   * Returns: { triggerScan: boolean, state: string, label: string, subtext: string }
   */
  async evaluate(visionResult) {
    const now = Date.now();
    const { qr, metrics } = visionResult;

    // 1. State: No QR Code in View
    if (!qr || !qr.found) {
      this.currentState = 'SEARCHING_QR';
      this.stateLabel = 'Searching for QR code...';
      this.stateSubtext = 'Scanning camera view for QR target';
      this.consecutiveClearFrames = 0;
      
      // Gradually reset zoom back to baseline if nothing is seen
      if (this.camera.currentZoom > 1.2 && now - this.lastZoomAdjustTime > 1800) {
        await this.camera.setZoom(1.0);
        this.lastZoomAdjustTime = now;
      }
      return { triggerScan: false, state: this.currentState, label: this.stateLabel, subtext: this.stateSubtext };
    }

    // 2. State: QR Code Locked from a Distance (Far / Medium) -> Auto Zoom
    if (metrics.isFar) {
      this.currentState = 'QR_LOCKED_FAR';
      this.stateLabel = `QR Locked (Distance: ${metrics.distanceLabel})`;
      this.stateSubtext = 'Auto-zooming to enlarge QR target...';
      this.consecutiveClearFrames = 0;

      // Incrementally step zoom up
      if (now - this.lastZoomAdjustTime > this.zoomIntervalMs) {
        const nextZoom = Math.min(this.camera.currentZoom + this.zoomStep, this.maxZoom);
        if (nextZoom > this.camera.currentZoom) {
          await this.camera.setZoom(nextZoom);
          if (window.soundEngine) window.soundEngine.playZoomTick();
          this.lastZoomAdjustTime = now;
        }
      }
      return { triggerScan: false, state: this.currentState, label: this.stateLabel, subtext: this.stateSubtext };
    }

    // 3. State: Centering Guidance
    if (!metrics.isCentered) {
      this.currentState = 'ALIGN_QR';
      this.stateLabel = 'QR Code Detected';
      this.stateSubtext = 'Keep QR centered in scanner reticle';
    }

    // 4. State: Sharpness / Optical Focus Check
    if (!metrics.isSharp) {
      this.currentState = 'FOCUSING';
      this.stateLabel = 'Adjusting Optical Focus...';
      this.stateSubtext = 'Hold camera steady, improving clarity';
      this.consecutiveClearFrames = 0;

      if (now - this.lastFocusTriggerTime > this.focusCooldownMs) {
        await this.camera.triggerFocus();
        if (window.soundEngine) window.soundEngine.playFocusLock();
        this.lastFocusTriggerTime = now;
      }
      return { triggerScan: false, state: this.currentState, label: this.stateLabel, subtext: this.stateSubtext };
    }

    // 5. State: Positional Stability Check
    if (!metrics.isStable) {
      this.currentState = 'STABILIZING';
      this.stateLabel = 'Stabilizing Lock...';
      this.stateSubtext = 'Hold camera steady for capture';
      this.consecutiveClearFrames = 0;
      return { triggerScan: false, state: this.currentState, label: this.stateLabel, subtext: this.stateSubtext };
    }

    // 6. State: QR Clearly Visible & Readable -> Auto Trigger Capture
    this.consecutiveClearFrames++;
    if (this.consecutiveClearFrames >= this.stableFramesRequired) {
      this.currentState = 'QR_CLEAR_READABLE';
      this.stateLabel = 'QR CODE CLEAR & READABLE ✓';
      this.stateSubtext = 'Automatically decoding and capturing...';

      return {
        triggerScan: this.autoScanEnabled,
        state: this.currentState,
        label: this.stateLabel,
        subtext: this.stateSubtext,
        payload: qr.rawValue
      };
    }

    this.currentState = 'VERIFYING';
    this.stateLabel = 'Verifying QR Readability...';
    this.stateSubtext = `Readability Index: ${metrics.readabilityPercent}%`;
    return { triggerScan: false, state: this.currentState, label: this.stateLabel, subtext: this.stateSubtext };
  }

  reset() {
    this.consecutiveClearFrames = 0;
    this.currentState = 'SEARCHING_QR';
  }
}

window.AutoControlEngine = AutoControlEngine;
