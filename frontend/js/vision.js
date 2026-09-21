/**
 * Computer Vision Engine for Direct Long-Distance QR Code Detection & Optical Metrics
 * Focuses purely on direct QR code acquisition, distance estimation, sharpness evaluation,
 * and visibility/readability confidence scoring.
 */

class VisionEngine {
  constructor() {
    this.hasNativeBarcodeDetector = 'BarcodeDetector' in window;
    this.nativeDetector = null;
    if (this.hasNativeBarcodeDetector) {
      try {
        this.nativeDetector = new BarcodeDetector({ formats: ['qr_code'] });
      } catch (e) {
        console.warn("Native BarcodeDetector initialization failed, using jsQR fallback", e);
        this.hasNativeBarcodeDetector = false;
      }
    }

    // Offscreen canvas for frame pixel processing
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
    
    // Position history for stability calculation
    this.positionHistory = [];
    this.historyLength = 5;
  }

  /**
   * Main vision pipeline execution on a single video frame
   */
  async processFrame(videoElement, digitalZoom = 1.0) {
    if (!videoElement || videoElement.readyState < 2) {
      return { status: 'NO_FRAME' };
    }

    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;
    if (!vw || !vh) return { status: 'NO_FRAME' };

    // Processing canvas resolution
    const targetW = 640;
    const targetH = Math.round((vh / vw) * targetW);
    
    if (this.offscreenCanvas.width !== targetW || this.offscreenCanvas.height !== targetH) {
      this.offscreenCanvas.width = targetW;
      this.offscreenCanvas.height = targetH;
    }

    const ctx = this.offscreenCtx;

    // Apply digital zoom crop if digitalZoom > 1.0
    if (digitalZoom > 1.0) {
      const cropW = vw / digitalZoom;
      const cropH = vh / digitalZoom;
      const cropX = (vw - cropW) / 2;
      const cropY = (vh - cropH) / 2;
      ctx.drawImage(videoElement, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
    } else {
      ctx.drawImage(videoElement, 0, 0, targetW, targetH);
    }

    const imageData = ctx.getImageData(0, 0, targetW, targetH);

    // 1. Detect QR Code Directly
    const qrResult = await this._detectQRCode(imageData, targetW, targetH);

    // 2. Compute Metrics (Distance, Sharpness, Stability, Readability)
    let metrics = null;
    if (qrResult && qrResult.found) {
      metrics = this._computeMetrics(qrResult, imageData, targetW, targetH);
    } else {
      if (this.positionHistory.length > 0) {
        this.positionHistory.shift();
      }
    }

    return {
      frameWidth: targetW,
      frameHeight: targetH,
      qr: qrResult,
      metrics: metrics
    };
  }

  /**
   * Direct QR Code Detection using native BarcodeDetector or jsQR fallback
   */
  async _detectQRCode(imageData, width, height) {
    // 1. Try native BarcodeDetector if available
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
      } catch (e) {
        // Fallback to jsQR
      }
    }

    // 2. Fallback to jsQR
    if (typeof jsQR === 'function') {
      try {
        const code = jsQR(imageData.data, width, height, {
          inversionAttempts: "dontInvert"
        });

        if (code) {
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
      } catch (e) {
        console.warn("jsQR processing error", e);
      }
    }

    return { found: false, rawValue: null, bounds: null, corners: null };
  }

  /**
   * Evaluates Distance, Sharpness, Positional Stability, and Composite Readability
   */
  _computeMetrics(qrResult, imageData, frameW, frameH) {
    const bounds = qrResult.bounds;
    const qrW = Math.max(10, bounds.width);
    const qrH = Math.max(10, bounds.height);
    
    // 1. Relative Size (% of frame width)
    const relativeSize = (qrW / frameW) * 100;

    // 2. Distance Estimation based on bounding box ratio
    let distanceLabel = 'OPTIMAL';
    let isFar = false;
    let isTooClose = false;

    if (relativeSize < 16) {
      distanceLabel = 'FAR';
      isFar = true;
    } else if (relativeSize < 26) {
      distanceLabel = 'MEDIUM';
      isFar = true;
    } else if (relativeSize > 75) {
      distanceLabel = 'TOO CLOSE';
      isTooClose = true;
    } else {
      distanceLabel = 'OPTIMAL';
    }

    // 3. Center Offset
    const centerX = bounds.x + qrW / 2;
    const centerY = bounds.y + qrH / 2;
    const offsetX = Math.abs(centerX - (frameW / 2)) / (frameW / 2);
    const offsetY = Math.abs(centerY - (frameH / 2)) / (frameH / 2);
    const isCentered = offsetX < 0.40 && offsetY < 0.40;

    // 4. Sharpness Estimation (Laplacian Variance on QR region)
    const sharpnessScore = this._computeSharpness(imageData, bounds, frameW, frameH);
    const isSharp = sharpnessScore >= 38;

    // 5. Positional Stability Tracker
    this.positionHistory.push({ x: centerX, y: centerY });
    if (this.positionHistory.length > this.historyLength) {
      this.positionHistory.shift();
    }

    let isStable = false;
    let jitter = 0;
    if (this.positionHistory.length >= 3) {
      let totalDist = 0;
      for (let i = 1; i < this.positionHistory.length; i++) {
        const dx = this.positionHistory[i].x - this.positionHistory[i - 1].x;
        const dy = this.positionHistory[i].y - this.positionHistory[i - 1].y;
        totalDist += Math.sqrt(dx * dx + dy * dy);
      }
      jitter = totalDist / (this.positionHistory.length - 1);
      isStable = jitter < 15;
    }

    // 6. Overall Readability Score (0 - 100%)
    const sizeScore = Math.min(100, Math.max(0, (relativeSize / 30) * 100));
    const sharpNorm = Math.min(100, Math.max(0, (sharpnessScore / 50) * 100));
    const stabilityScore = isStable ? 100 : Math.max(20, 100 - (jitter * 4));
    
    const readabilityPercent = Math.round(
      (sizeScore * 0.35) + (sharpNorm * 0.40) + (stabilityScore * 0.25)
    );

    const isReadable = readabilityPercent >= 75 && isSharp && !isFar && isStable;

    return {
      relativeSize: Number(relativeSize.toFixed(1)),
      distanceLabel,
      isFar,
      isTooClose,
      isCentered,
      sharpnessScore: Number(sharpnessScore.toFixed(1)),
      isSharp,
      jitter: Number(jitter.toFixed(1)),
      isStable,
      readabilityPercent: Math.min(100, readabilityPercent),
      isReadable,
      center: { x: centerX, y: centerY }
    };
  }

  /**
   * Laplacian variance approximation on QR bounding box
   */
  _computeSharpness(imageData, bounds, frameW, frameH) {
    const data = imageData.data;
    const x0 = Math.max(1, Math.floor(bounds.x));
    const y0 = Math.max(1, Math.floor(bounds.y));
    const x1 = Math.min(frameW - 2, Math.floor(bounds.x + bounds.width));
    const y1 = Math.min(frameH - 2, Math.floor(bounds.y + bounds.height));

    if (x1 <= x0 || y1 <= y0) return 0;

    let sum = 0;
    let sumSq = 0;
    let count = 0;
    const step = 3;

    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const idx = (y * frameW + x) * 4;
        const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

        const leftIdx = (y * frameW + (x - 1)) * 4;
        const rightIdx = (y * frameW + (x + 1)) * 4;
        const upIdx = ((y - 1) * frameW + x) * 4;
        const downIdx = ((y + 1) * frameW + x) * 4;

        const lumL = 0.299 * data[leftIdx] + 0.587 * data[leftIdx + 1] + 0.114 * data[leftIdx + 2];
        const lumR = 0.299 * data[rightIdx] + 0.587 * data[rightIdx + 1] + 0.114 * data[rightIdx + 2];
        const lumU = 0.299 * data[upIdx] + 0.587 * data[upIdx + 1] + 0.114 * data[upIdx + 2];
        const lumD = 0.299 * data[downIdx] + 0.587 * data[downIdx + 1] + 0.114 * data[downIdx + 2];

        const laplacian = Math.abs(4 * lum - lumL - lumR - lumU - lumD);
        sum += laplacian;
        sumSq += laplacian * laplacian;
        count++;
      }
    }

    if (count === 0) return 0;
    const mean = sum / count;
    const variance = (sumSq / count) - (mean * mean);
    return Math.max(0, variance);
  }
}

window.VisionEngine = VisionEngine;
