/**
 * Robust Mobile Camera Service with Secure Context & Auto-Redirect
 */

class CameraService {
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
    this.track = null;
    
    this.capabilities = {};
    this.settings = {};
    this.supportsHardwareZoom = false;
    this.supportsTorch = false;
    this.supportsAutoFocus = false;
    
    this.currentZoom = 1.0;
    this.minZoom = 1.0;
    this.maxZoom = 4.0;
    this.zoomStep = 0.25;
    this.facingMode = 'environment';
    this.torchOn = false;
    this.digitalZoom = 1.0;
  }

  isSecure() {
    return window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  }

  async startCamera(facingMode = 'environment') {
    this.stopCamera();
    this.facingMode = facingMode;

    if (!this.video) return { success: false, error: "Video element not found" };

    this.video.setAttribute('autoplay', '');
    this.video.setAttribute('muted', '');
    this.video.setAttribute('playsinline', 'true');
    this.video.playsInline = true;
    this.video.muted = true;

    // Check if insecure HTTP on a network IP
    if (!this.isSecure()) {
      const httpsUrl = `https://${window.location.hostname}:8443${window.location.pathname}${window.location.search}`;
      return { 
        success: false, 
        isHttpError: true,
        httpsUrl: httpsUrl,
        error: "Mobile browsers strictly require HTTPS to access the camera. Tap below to switch to Secure HTTPS."
      };
    }

    // Modern and legacy navigator getUserMedia resolvers
    const getMedia = (constraints) => {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        return navigator.mediaDevices.getUserMedia(constraints);
      }
      const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
      if (legacy) {
        return new Promise((resolve, reject) => legacy.call(navigator, constraints, resolve, reject));
      }
      return Promise.reject(new Error("Camera API not available on this browser"));
    };

    const constraintTiers = [
      {
        audio: false,
        video: {
          facingMode: { ideal: this.facingMode },
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 }
        }
      },
      {
        audio: false,
        video: {
          facingMode: { ideal: this.facingMode }
        }
      },
      {
        audio: false,
        video: {
          facingMode: this.facingMode
        }
      },
      {
        audio: false,
        video: true
      }
    ];

    let stream = null;
    let lastError = null;

    for (const constraints of constraintTiers) {
      try {
        stream = await getMedia(constraints);
        if (stream) break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!stream) {
      console.error("Camera access failed on all tiers:", lastError);
      return { 
        success: false, 
        error: lastError ? (lastError.message || lastError.name || "Camera permission denied") : "Camera failed to start"
      };
    }

    try {
      this.stream = stream;
      this.video.srcObject = stream;
      
      const playPromise = this.video.play();
      if (playPromise !== undefined) {
        await playPromise;
      }

      this.track = stream.getVideoTracks()[0];
      this._inspectCapabilities();

      return { success: true };
    } catch (err) {
      console.error("Video play error:", err);
      // Tap-to-play fallback for mobile browser policies
      const onUserInteraction = async () => {
        try {
          await this.video.play();
        } catch (e) {}
        window.removeEventListener('touchstart', onUserInteraction);
        window.removeEventListener('click', onUserInteraction);
      };
      window.addEventListener('touchstart', onUserInteraction);
      window.addEventListener('click', onUserInteraction);

      return { success: true };
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
      this.zoomStep = 0.25;
      this.currentZoom = 1.0;
    }

    this.supportsTorch = Boolean(this.capabilities.torch);

    if (this.capabilities.focusMode) {
      this.supportsAutoFocus = this.capabilities.focusMode.includes('continuous') || 
                               this.capabilities.focusMode.includes('single-shot');
    }
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
        this.digitalZoom = this.currentZoom;
      }
    } else {
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
    } catch (e) {}
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
