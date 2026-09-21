/**
 * Ultra-Fast High-Resolution Full-Screen QR Vision & Reader Engine
 * Immediately detects and decodes QR codes from any distance across the full camera feed.
 */

class FullScreenVisionEngine {
  constructor() {
    this.hasNativeBarcodeDetector = 'BarcodeDetector' in window;
    this.nativeDetector = null;
    if (this.hasNativeBarcodeDetector) {
      try {
        this.nativeDetector = new BarcodeDetector({ formats: ['qr_code'] });
      } catch (e) {
        this.hasNativeBarcodeDetector = false;
      }
    }

    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * High-speed, high-resolution full-frame detection
   */
  async processFrame(videoElement) {
    if (!videoElement || videoElement.readyState < 2) {
      return { status: 'NO_FRAME' };
    }

    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;
    if (!vw || !vh) return { status: 'NO_FRAME' };

    // Use full native resolution (e.g. 1280x720 or 960x540) to catch far-away small QR codes
    const targetW = Math.min(1280, vw);
    const targetH = Math.round((vh / vw) * targetW);
    
    if (this.offscreenCanvas.width !== targetW || this.offscreenCanvas.height !== targetH) {
      this.offscreenCanvas.width = targetW;
      this.offscreenCanvas.height = targetH;
    }

    const ctx = this.offscreenCtx;
    ctx.drawImage(videoElement, 0, 0, targetW, targetH);
    const imageData = ctx.getImageData(0, 0, targetW, targetH);

    // Immediate direct detection & decode
    const qrResult = await this._detectQRCode(imageData, targetW, targetH, videoElement);

    return {
      frameWidth: targetW,
      frameHeight: targetH,
      qr: qrResult
    };
  }

  /**
   * Captures a high-resolution snapshot image data URL for instant display
   */
  captureHighResFrame(videoElement) {
    if (!videoElement || videoElement.readyState < 2) return null;
    const vw = videoElement.videoWidth || 1280;
    const vh = videoElement.videoHeight || 720;
    
    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = vw;
    snapCanvas.height = vh;
    const ctx = snapCanvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, vw, vh);
    
    return snapCanvas.toDataURL('image/jpeg', 0.85);
  }

  async _detectQRCode(imageData, width, height, videoElement) {
    // 1. Ultra-fast hardware-accelerated BarcodeDetector directly from video/canvas
    if (this.nativeDetector) {
      try {
        const barcodes = await this.nativeDetector.detect(this.offscreenCanvas);
        if (barcodes && barcodes.length > 0) {
          const code = barcodes[0];
          const bounds = code.boundingBox || {};
          const cornerPoints = code.cornerPoints || [
            { x: bounds.x, y: bounds.y },
            { x: bounds.x + bounds.width, y: bounds.y },
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
            { x: bounds.x, y: bounds.y + bounds.height }
          ];

          return {
            found: true,
            rawValue: code.rawValue || '',
            corners: cornerPoints,
            bounds: {
              x: bounds.x || cornerPoints[0].x,
              y: bounds.y || cornerPoints[0].y,
              width: bounds.width || (cornerPoints[1].x - cornerPoints[0].x),
              height: bounds.height || (cornerPoints[2].y - cornerPoints[1].y)
            },
            engine: 'native'
          };
        }
      } catch (e) {}
    }

    // 2. High-performance jsQR fallback (full frame)
    if (typeof jsQR === 'function') {
      try {
        const code = jsQR(imageData.data, width, height, {
          inversionAttempts: "dontInvert"
        });

        if (code && code.data) {
          const loc = code.location;
          const minX = Math.min(loc.topLeftCorner.x, loc.bottomLeftCorner.x);
          const maxX = Math.max(loc.topRightCorner.x, loc.bottomRightCorner.x);
          const minY = Math.min(loc.topLeftCorner.y, loc.topRightCorner.y);
          const maxY = Math.max(loc.bottomLeftCorner.y, loc.bottomRightCorner.y);

          return {
            found: true,
            rawValue: code.data || '',
            corners: [
              loc.topLeftCorner,
              loc.topRightCorner,
              loc.bottomRightCorner,
              loc.bottomLeftCorner
            ],
            bounds: {
              x: minX,
              y: minY,
              width: maxX - minX,
              height: maxY - minY
            },
            engine: 'jsQR'
          };
        }
      } catch (e) {}
    }

    return { found: false, rawValue: null, bounds: null, corners: null };
  }
}

window.FullScreenVisionEngine = FullScreenVisionEngine;
