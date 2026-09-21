/**
 * Camera Service with Hardware & Digital Capability Controls
 * Inspects track.getCapabilities() for real hardware zoom, focusMode, torch,
 * and provides smooth software fallbacks when hardware constraints are not supported.
 */

class CameraService {
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
    this.track = null;
    
    // Hardware Capabilities
    this.capabilities = {};
    this.settings = {};
    this.supportsHardwareZoom = false;
    this.supportsTorch = false;
    this.supportsAutoFocus = false;
    
    // Current States
    this.currentZoom = 1.0;
    this.minZoom = 1.0;
    this.maxZoom = 4.0;
    this.zoomStep = 0.2;
    this.facingMode = 'environment'; // 'environment' (back) or 'user' (front)
    this.torchOn = false;
    
    // Digital Zoom Fallback factor
    this.digitalZoom = 1.0;
  }

  async startCamera(facingMode = 'environment') {
    this.stopCamera();
    this.facingMode = facingMode;

    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: this.facingMode },
        width: { ideal: 1920, min: 640 },
        height: { ideal: 1080, min: 480 }
      }
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      await this.video.play();

      this.track = this.stream.getVideoTracks()[0];
      this._inspectCapabilities();

      return { success: true };
    } catch (err) {
      console.error("Camera startup error:", err);
      return { success: false, error: err };
    }
  }

  _inspectCapabilities() {
    if (!this.track) return;

    if (typeof this.track.getCapabilities === 'function') {
      this.capabilities = this.track.getCapabilities() || {};
    } else {
      this.capabilities = {};
    }

    if (typeof this.track.getSettings === 'function') {
      this.settings = this.track.getSettings() || {};
    }

    // Check Zoom Capability
    if (this.capabilities.zoom) {
      this.supportsHardwareZoom = true;
      this.minZoom = this.capabilities.zoom.min || 1.0;
      this.maxZoom = Math.min(this.capabilities.zoom.max || 5.0, 5.0);
      this.zoomStep = this.capabilities.zoom.step || 0.1;
      this.currentZoom = this.settings.zoom || this.minZoom;
    } else {
      this.supportsHardwareZoom = false;
      this.minZoom = 1.0;
      this.maxZoom = 4.0;
      this.zoomStep = 0.2;
      this.currentZoom = 1.0;
    }

    // Check Torch
    this.supportsTorch = Boolean(this.capabilities.torch);

    // Check Focus Mode
    if (this.capabilities.focusMode) {
      this.supportsAutoFocus = this.capabilities.focusMode.includes('continuous') || 
                               this.capabilities.focusMode.includes('single-shot');
    }

    console.log("Camera Capabilities:", {
      hardwareZoom: this.supportsHardwareZoom,
      minZoom: this.minZoom,
      maxZoom: this.maxZoom,
      torch: this.supportsTorch,
      autoFocus: this.supportsAutoFocus,
      rawCapabilities: this.capabilities
    });
  }

  async setZoom(targetZoom) {
    const clamped = Math.max(this.minZoom, Math.min(targetZoom, this.maxZoom));
    this.currentZoom = Number(clamped.toFixed(2));

    if (this.supportsHardwareZoom && this.track) {
      try {
        await this.track.applyConstraints({
          advanced: [{ zoom: this.currentZoom }]
        });
      } catch (e) {
        console.warn("Hardware zoom constraint failed, using digital fallback", e);
        this.digitalZoom = this.currentZoom;
      }
    } else {
      // Digital fallback for devices/browsers lacking hardware zoom constraint (e.g. iOS Safari)
      this.digitalZoom = this.currentZoom;
    }

    return this.currentZoom;
  }

  async toggleTorch() {
    if (!this.supportsTorch || !this.track) return false;
    this.torchOn = !this.torchOn;
    try {
      await this.track.applyConstraints({
        advanced: [{ torch: this.torchOn }]
      });
      return this.torchOn;
    } catch (e) {
      console.warn("Torch toggle failed", e);
      this.torchOn = false;
      return false;
    }
  }

  async triggerFocus() {
    if (!this.track) return false;
    try {
      if (this.capabilities.focusMode && this.capabilities.focusMode.includes('continuous')) {
        await this.track.applyConstraints({
          advanced: [{ focusMode: 'continuous' }]
        });
        return true;
      } else if (this.capabilities.focusMode && this.capabilities.focusMode.includes('single-shot')) {
        await this.track.applyConstraints({
          advanced: [{ focusMode: 'single-shot' }]
        });
        return true;
      }
    } catch (e) {
      console.warn("Autofocus constraint trigger failed", e);
    }
    return false;
  }

  switchCamera() {
    const newFacing = this.facingMode === 'environment' ? 'user' : 'environment';
    return this.startCamera(newFacing);
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      this.track = null;
    }
    this.torchOn = false;
    this.digitalZoom = 1.0;
  }
}

window.CameraService = CameraService;
