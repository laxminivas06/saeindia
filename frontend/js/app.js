/**
 * Main Application Coordinator
 * Handles optical loop, direct QR overlay rendering, tab navigation,
 * real-time distance & visibility guidance, and autonomous scan dispatch.
 */

class Application {
  constructor() {
    this.video = document.getElementById('camera-video');
    this.overlayCanvas = document.getElementById('overlay-canvas');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    
    // Services
    this.camera = new CameraService(this.video);
    this.vision = new VisionEngine();
    this.autoControl = new AutoControlEngine(this.camera);
    this.receiver = null;
    this.generator = null;

    // Loop & State
    this.isRunning = false;
    this.lastFrameTime = 0;
    this.targetFps = 30;
    this.frameInterval = 1000 / this.targetFps;
    this.activeTab = 'scanner';

    // Settings
    this.settings = {
      apiUrl: '/api/qr-result',
      deviceId: 'PHONE001',
      duplicateLockTime: 5,
      minZoom: 1.0,
      maxZoom: 4.0,
      zoomStep: 0.3,
      soundEnabled: true,
      autoScan: true
    };

    this._loadSettings();
    this._initUI();
  }

  _loadSettings() {
    try {
      const stored = localStorage.getItem('qr_box_scanner_settings');
      if (stored) {
        this.settings = { ...this.settings, ...JSON.parse(stored) };
      } else {
        const randomId = 'FIELD-PHONE-' + Math.floor(100 + Math.random() * 900);
        this.settings.deviceId = randomId;
      }
    } catch (e) {}

    // Apply to sub-services
    window.duplicateLock.setLockTimeSeconds(this.settings.duplicateLockTime);
    window.soundEngine.enabled = this.settings.soundEnabled;
    this.autoControl.updateConfig({
      minZoom: this.settings.minZoom,
      maxZoom: this.settings.maxZoom,
      zoomStep: this.settings.zoomStep,
      autoScanEnabled: this.settings.autoScan
    });
  }

  _saveSettings() {
    try {
      localStorage.setItem('qr_box_scanner_settings', JSON.stringify(this.settings));
    } catch (e) {}
    this._loadSettings();
    this.showToast('Settings saved successfully');
  }

  _initUI() {
    // 1. Tab Navigation
    const tabBtns = document.querySelectorAll('.nav-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        this.switchTab(tab);
      });
    });

    // 2. Camera Controls (HUD)
    const torchBtn = document.getElementById('btn-torch');
    if (torchBtn) {
      torchBtn.addEventListener('click', async () => {
        const on = await this.camera.toggleTorch();
        torchBtn.classList.toggle('active', on);
      });
    }

    const switchCamBtn = document.getElementById('btn-switch-cam');
    if (switchCamBtn) {
      switchCamBtn.addEventListener('click', async () => {
        await this.camera.switchCamera();
        this._updateZoomTelemetry();
      });
    }

    const soundToggleBtn = document.getElementById('btn-sound-toggle');
    if (soundToggleBtn) {
      soundToggleBtn.addEventListener('click', () => {
        this.settings.soundEnabled = !this.settings.soundEnabled;
        window.soundEngine.enabled = this.settings.soundEnabled;
        soundToggleBtn.classList.toggle('active', this.settings.soundEnabled);
        this.showToast(this.settings.soundEnabled ? 'Audio cues enabled' : 'Audio cues muted');
      });
    }

    // Permission button
    const reqPermBtn = document.getElementById('btn-request-permission');
    if (reqPermBtn) {
      reqPermBtn.addEventListener('click', () => this.startScanning());
    }

    // Drawer close
    const closeDrawerBtn = document.getElementById('btn-close-drawer');
    const drawerHandle = document.getElementById('drawer-handle');
    if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', () => this.closeDrawer());
    if (drawerHandle) drawerHandle.addEventListener('click', () => this.closeDrawer());

    // Settings inputs binding
    this._bindSettingsForm();

    // Start Receiver and Generator
    this.receiver = new ReceiverDashboard();
    this.generator = new TestGenerator();

    // Start Camera on load
    this.startScanning();
  }

  _bindSettingsForm() {
    const apiInput = document.getElementById('setting-api-url');
    const deviceInput = document.getElementById('setting-device-id');
    const lockTimeInput = document.getElementById('setting-lock-time');
    const lockTimeVal = document.getElementById('lock-time-val');
    const maxZoomInput = document.getElementById('setting-max-zoom');
    const autoScanSwitch = document.getElementById('setting-auto-scan');
    const soundSwitch = document.getElementById('setting-sound');

    if (apiInput) apiInput.value = this.settings.apiUrl;
    if (deviceInput) deviceInput.value = this.settings.deviceId;
    if (lockTimeInput) {
      lockTimeInput.value = this.settings.duplicateLockTime;
      if (lockTimeVal) lockTimeVal.textContent = `${this.settings.duplicateLockTime}s`;
      lockTimeInput.addEventListener('input', (e) => {
        if (lockTimeVal) lockTimeVal.textContent = `${e.target.value}s`;
      });
    }
    if (maxZoomInput) maxZoomInput.value = this.settings.maxZoom;
    if (autoScanSwitch) autoScanSwitch.checked = this.settings.autoScan;
    if (soundSwitch) soundSwitch.checked = this.settings.soundEnabled;

    const saveBtn = document.getElementById('btn-save-settings');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (apiInput) this.settings.apiUrl = apiInput.value.trim() || '/api/qr-result';
        if (deviceInput) this.settings.deviceId = deviceInput.value.trim() || 'PHONE001';
        if (lockTimeInput) this.settings.duplicateLockTime = Number(lockTimeInput.value);
        if (maxZoomInput) this.settings.maxZoom = Number(maxZoomInput.value);
        if (autoScanSwitch) this.settings.autoScan = autoScanSwitch.checked;
        if (soundSwitch) this.settings.soundEnabled = soundSwitch.checked;

        this._saveSettings();
      });
    }
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll('.nav-tab-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
    });
    document.querySelectorAll('.view-panel').forEach(p => {
      p.classList.toggle('active', p.id === `view-${tabName}`);
    });

    if (tabName === 'receiver' && this.receiver) {
      this.receiver.fetchHistory();
    }
  }

  async startScanning() {
    const permOverlay = document.getElementById('permission-overlay');
    const res = await this.camera.startCamera();

    if (res.success) {
      if (permOverlay) permOverlay.style.display = 'none';
      this.isRunning = true;
      this._updateZoomTelemetry();
      requestAnimationFrame((t) => this._processLoop(t));
    } else {
      if (permOverlay) permOverlay.style.display = 'flex';
      const msg = document.getElementById('perm-error-msg');
      if (msg) msg.textContent = "Camera access denied or unavailable. Please enable permissions in browser settings.";
    }
  }

  /**
   * Main Optical Frame Loop
   */
  async _processLoop(timestamp) {
    if (!this.isRunning) return;

    const elapsed = timestamp - this.lastFrameTime;
    if (elapsed > this.frameInterval) {
      this.lastFrameTime = timestamp - (elapsed % this.frameInterval);

      if (this.activeTab === 'scanner') {
        // 1. Direct QR Vision Frame Processing
        const visionResult = await this.vision.processFrame(this.video, this.camera.digitalZoom);
        
        // 2. Render Canvas Lock Overlay
        this._renderOverlay(visionResult);

        // 3. Auto-Control & Clarity State Machine
        if (visionResult.status !== 'NO_FRAME') {
          const control = await this.autoControl.evaluate(visionResult);
          this._updateGuidanceUI(control, visionResult.metrics);
          this._updateMetricsUI(visionResult.metrics);

          // 4. Trigger Autonomous Scan when QR is clear and readable
          if (control.triggerScan && visionResult.qr && visionResult.qr.rawValue) {
            this._handleAutoScanSuccess(visionResult.qr.rawValue, visionResult.metrics);
          }
        }
      }
    }

    requestAnimationFrame((t) => this._processLoop(t));
  }

  /**
   * Real-time HUD Canvas Overlay Renderer for Direct QR Target
   */
  _renderOverlay(result) {
    const canvas = this.overlayCanvas;
    const ctx = this.overlayCtx;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.clearRect(0, 0, width, height);

    if (!result || result.status === 'NO_FRAME') return;

    const scaleX = width / result.frameWidth;
    const scaleY = height / result.frameHeight;

    // Render QR Code Bounding Polygon & Corner Target Pins (Emerald / Cyan)
    if (result.qr && result.qr.found && result.qr.corners) {
      const corners = result.qr.corners;
      ctx.save();
      
      // Dynamic glowing border
      ctx.strokeStyle = '#00f090';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00f090';
      ctx.shadowBlur = 15;

      ctx.beginPath();
      ctx.moveTo(corners[0].x * scaleX, corners[0].y * scaleY);
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i].x * scaleX, corners[i].y * scaleY);
      }
      ctx.closePath();
      ctx.stroke();

      // Draw center target crosshair on the QR code
      if (result.metrics && result.metrics.center) {
        const cx = result.metrics.center.x * scaleX;
        const cy = result.metrics.center.y * scaleY;
        ctx.strokeStyle = '#00f2fe';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
        ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
        ctx.stroke();
      }

      // Corner target pins
      corners.forEach((c) => {
        ctx.fillStyle = '#00f2fe';
        ctx.beginPath();
        ctx.arc(c.x * scaleX, c.y * scaleY, 5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Target Label
      const minX = Math.min(...corners.map(c => c.x * scaleX));
      const minY = Math.min(...corners.map(c => c.y * scaleY));
      ctx.fillStyle = 'rgba(0, 240, 144, 0.9)';
      ctx.fillRect(minX, minY - 22, 90, 18);
      ctx.fillStyle = '#061018';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText('QR LOCKED', minX + 6, minY - 9);

      ctx.restore();
    }
  }

  _updateGuidanceUI(control, metrics) {
    const badge = document.getElementById('hud-guidance-badge');
    const label = document.getElementById('hud-guidance-label');
    const subtext = document.getElementById('hud-guidance-subtext');
    const reticle = document.getElementById('hud-reticle');

    if (label) label.textContent = control.label;
    if (subtext) subtext.textContent = control.subtext;

    if (badge && reticle) {
      badge.classList.remove('success');
      reticle.className = 'hud-reticle-container';

      if (control.state === 'QR_CLEAR_READABLE') {
        badge.classList.add('success');
        reticle.classList.add('state-locked');
      } else if (control.state.startsWith('QR')) {
        reticle.classList.add('state-qr-detected');
      }
    }
  }

  _updateMetricsUI(metrics) {
    const distanceEl = document.getElementById('telemetry-distance');
    const sharpnessEl = document.getElementById('telemetry-sharpness');
    const readabilityEl = document.getElementById('telemetry-readability');

    if (distanceEl) {
      distanceEl.textContent = metrics ? metrics.distanceLabel : '--';
      if (metrics && metrics.distanceLabel === 'FAR') {
        distanceEl.style.color = 'var(--accent-amber)';
      } else if (metrics && metrics.distanceLabel === 'OPTIMAL') {
        distanceEl.style.color = 'var(--accent-emerald)';
      } else {
        distanceEl.style.color = 'var(--accent-cyan)';
      }
    }

    if (sharpnessEl) {
      sharpnessEl.textContent = metrics ? `${metrics.sharpnessScore}` : '--';
    }

    if (readabilityEl) {
      readabilityEl.textContent = metrics ? `${metrics.readabilityPercent}%` : '--%';
      if (metrics && metrics.readabilityPercent >= 75) {
        readabilityEl.style.color = 'var(--accent-emerald)';
      } else {
        readabilityEl.style.color = 'var(--accent-cyan)';
      }
    }

    this._updateZoomTelemetry();
  }

  _updateZoomTelemetry() {
    const zoomEl = document.getElementById('telemetry-zoom');
    if (zoomEl) {
      zoomEl.textContent = `${this.camera.currentZoom.toFixed(1)}x`;
    }
  }

  /**
   * Autonomous Scan Trigger Handler
   */
  async _handleAutoScanSuccess(rawPayload, metrics) {
    if (window.duplicateLock.isLocked(rawPayload)) {
      return;
    }

    window.duplicateLock.lock(rawPayload);
    window.soundEngine.playSuccess();

    const parsed = PayloadParser.parse(rawPayload);

    const submissionData = {
      box_id: parsed.box_id || 'QR-TARGET',
      qr_data: parsed.data,
      device_id: this.settings.deviceId,
      timestamp: new Date().toISOString(),
      metrics: {
        distance: metrics ? metrics.distanceLabel : null,
        sharpness: metrics ? metrics.sharpnessScore : null,
        readability: metrics ? metrics.readabilityPercent : null,
        size_ratio: metrics ? metrics.relativeSize : null,
        zoom_level: this.camera.currentZoom
      },
      raw_payload: rawPayload
    };

    this.openResultDrawer(parsed, submissionData);
    this._dispatchPayload(submissionData);
  }

  async _dispatchPayload(submissionData) {
    const statusTag = document.getElementById('result-dispatch-status');
    if (statusTag) {
      statusTag.textContent = 'Sending data...';
      statusTag.style.color = 'var(--accent-amber)';
    }

    try {
      const res = await fetch(this.settings.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submissionData)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      if (statusTag) {
        statusTag.textContent = '✓ Sent to Receiver';
        statusTag.style.color = 'var(--accent-emerald)';
      }
      this.showToast(`Scanned: ${submissionData.box_id} ✓`);
    } catch (err) {
      console.warn("Direct transmission failed, enqueuing offline", err);
      window.offlineQueue.enqueue(submissionData);
      if (statusTag) {
        statusTag.textContent = 'Saved Offline (Will auto-retry)';
        statusTag.style.color = 'var(--accent-cyan)';
      }
      this.showToast(`Saved to offline queue`);
    }
  }

  openResultDrawer(parsed, submissionData) {
    const drawer = document.getElementById('result-drawer');
    const boxIdEl = document.getElementById('drawer-box-id');
    const missionIdEl = document.getElementById('drawer-mission-id');
    const typeEl = document.getElementById('drawer-type');
    const payloadEl = document.getElementById('drawer-payload');

    if (boxIdEl) boxIdEl.textContent = parsed.box_id || 'QR-TARGET';
    if (missionIdEl) missionIdEl.textContent = parsed.mission_id || 'N/A';
    if (typeEl) typeEl.textContent = parsed.type.toUpperCase();
    if (payloadEl) {
      payloadEl.textContent = typeof parsed.data === 'object' 
        ? JSON.stringify(parsed.data, null, 2) 
        : String(parsed.raw);
    }

    if (drawer) drawer.classList.add('open');
  }

  closeDrawer() {
    const drawer = document.getElementById('result-drawer');
    if (drawer) drawer.classList.remove('open');
  }

  showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new Application();
});
