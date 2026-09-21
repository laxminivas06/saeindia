/**
 * React Component: Instant 2-Second Auto-Capture & Read QR Scanner
 * Detects QR codes automatically from any distance across the entire screen,
 * captures the image frame immediately, reads the data, and displays the result within 2 seconds.
 */

const { useState, useEffect, useRef, useCallback } = React;

function Scanner({ onScanSuccess, onOpenReceiver, onOpenSettings }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraServiceRef = useRef(null);
  const visionEngineRef = useRef(null);

  // Optical & Capture States
  const [scanState, setScanState] = useState('MONITORING'); // 'MONITORING', 'CAPTURED'
  const [statusMessage, setStatusMessage] = useState('Camera active • Monitoring for QR...');
  const [permissionError, setPermissionError] = useState(null);
  const [httpsRedirectUrl, setHttpsRedirectUrl] = useState(null);
  const [torchActive, setTorchActive] = useState(false);

  // Result popup data
  const [capturedSnapshot, setCapturedSnapshot] = useState(null);
  const [decodedPayload, setDecodedPayload] = useState(null);
  const [dispatchStatus, setDispatchStatus] = useState('Processing...');
  const [shutterFlash, setShutterFlash] = useState(false);

  const isRunningRef = useRef(true);
  const isProcessingRef = useRef(false);

  const startCameraStream = async () => {
    setPermissionError(null);
    setHttpsRedirectUrl(null);
    const video = videoRef.current;
    if (!video) return;

    if (!cameraServiceRef.current) {
      cameraServiceRef.current = new CameraService(video);
      visionEngineRef.current = new FullScreenVisionEngine();
    }

    const res = await cameraServiceRef.current.startCamera();
    if (res.success) {
      setPermissionError(null);
      isRunningRef.current = true;
      setScanState('MONITORING');
      setStatusMessage('Camera active • Monitoring for QR...');
      requestAnimationFrame(processFrameLoop);
    } else {
      if (res.isHttpError) {
        setHttpsRedirectUrl(res.httpsUrl);
      }
      setPermissionError(res.error || "Please allow camera access.");
    }
  };

  useEffect(() => {
    startCameraStream();

    return () => {
      isRunningRef.current = false;
      if (cameraServiceRef.current) {
        cameraServiceRef.current.stopCamera();
      }
    };
  }, []);

  // Continuous Frame Processing Loop
  const processFrameLoop = useCallback(async () => {
    if (!isRunningRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const camera = cameraServiceRef.current;
    const vision = visionEngineRef.current;

    if (video && canvas && camera && vision && !isProcessingRef.current && scanState === 'MONITORING') {
      // 1. Process high-res frame across 100% of visible camera area
      const visionResult = await vision.processFrame(video);
      
      // 2. Render tracking polygon if QR is in frame
      renderTrackingOverlay(canvas, visionResult);

      const qr = visionResult.qr;

      // 3. The instant a QR code is spotted anywhere in the view -> Auto Capture & Read (< 2s)
      if (qr && qr.found && qr.rawValue) {
        if (!window.duplicateLock.isLocked(qr.rawValue)) {
          instantCaptureAndRead(qr.rawValue);
          return;
        }
      }
    }

    if (scanState === 'MONITORING') {
      requestAnimationFrame(processFrameLoop);
    }
  }, [scanState]);

  // Instant Capture & Read Workflow (< 2s total execution)
  const instantCaptureAndRead = async (rawPayload) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    // 1. Trigger instantaneous shutter flash and audio chime
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 180);
    if (window.soundEngine) window.soundEngine.playSuccess();

    // 2. Capture high-resolution photo/frame snapshot from the video
    const snapshot = visionEngineRef.current.captureHighResFrame(videoRef.current);
    setCapturedSnapshot(snapshot);

    // 3. Lock duplicate to prevent re-scan spamming
    window.duplicateLock.lock(rawPayload);

    // 4. Decode & parse payload immediately
    const parsed = window.PayloadParser.parse(rawPayload);
    setDecodedPayload(parsed);
    setScanState('CAPTURED');
    setStatusMessage('QR Captured & Read ✓');
    setDispatchStatus('Dispatched to Receiver ✓');

    const submissionData = {
      box_id: parsed.id || 'QR-TARGET',
      qr_data: parsed.data,
      device_id: 'PHONE001',
      timestamp: new Date().toISOString(),
      raw_payload: rawPayload
    };

    // 5. Asynchronous dispatch to backend
    fetch('/api/qr-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submissionData)
    }).catch(() => {
      window.offlineQueue.enqueue(submissionData);
    });

    if (onScanSuccess) onScanSuccess(submissionData);
  };

  // Resume camera monitoring for the next QR code
  const resumeScanning = () => {
    setScanState('MONITORING');
    setStatusMessage('Camera active • Monitoring for QR...');
    setCapturedSnapshot(null);
    setDecodedPayload(null);
    isProcessingRef.current = false;
    requestAnimationFrame(processFrameLoop);
  };

  // Tracking outline over the QR code
  const renderTrackingOverlay = (canvas, result) => {
    const ctx = canvas.getContext('2d');
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

    if (result.qr && result.qr.found && result.qr.corners) {
      const corners = result.qr.corners;
      ctx.save();

      ctx.strokeStyle = '#00f090';
      ctx.lineWidth = 3.5;
      ctx.shadowColor = '#00f090';
      ctx.shadowBlur = 16;

      ctx.beginPath();
      ctx.moveTo(corners[0].x * scaleX, corners[0].y * scaleY);
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i].x * scaleX, corners[i].y * scaleY);
      }
      ctx.closePath();
      ctx.stroke();

      corners.forEach((c) => {
        ctx.fillStyle = '#00f2fe';
        ctx.beginPath();
        ctx.arc(c.x * scaleX, c.y * scaleY, 5, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();
    }
  };

  const handleToggleTorch = async () => {
    if (cameraServiceRef.current) {
      const state = await cameraServiceRef.current.toggleTorch();
      setTorchActive(state);
    }
  };

  const handleSwitchCamera = async () => {
    if (cameraServiceRef.current) {
      await cameraServiceRef.current.switchCamera();
    }
  };

  return (
    <div className="pure-camera-container" onClick={() => {
      if (videoRef.current && videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      }
    }}>
      {/* 100% Full-Screen Edge-to-Edge Camera */}
      <video ref={videoRef} className="pure-camera-video" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="pure-camera-canvas" />

      {/* Shutter Flash Animation */}
      {shutterFlash && <div className="camera-shutter-flash" />}

      {/* Floating Real-Time Status Notification Pill */}
      <div className="event-status-pill">
        <span className={`event-dot ${scanState === 'CAPTURED' ? 'success' : ''}`} />
        <span>{statusMessage}</span>
      </div>

      {/* Floating Top Controls */}
      <div className="floating-top-bar" style={{ top: 'max(65px, env(safe-area-inset-top))' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {onOpenReceiver && (
            <button className="floating-icon-btn" onClick={onOpenReceiver} title="Receiver Dashboard">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </button>
          )}
          {onOpenSettings && (
            <button className="floating-icon-btn" onClick={onOpenSettings} title="Test QR Workbench">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h3v3H7zM14 7h3v3h-3zM7 14h3v3H7z"/></svg>
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button className={`floating-icon-btn ${torchActive ? 'active' : ''}`} onClick={handleToggleTorch} title="Flash">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </button>
          <button className="floating-icon-btn" onClick={handleSwitchCamera} title="Switch Camera">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
          </button>
        </div>
      </div>

      {/* Permission Fallback Modal */}
      {permissionError && (
        <div className="permission-modal-card">
          <div style={{ color: 'var(--accent-cyan)' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </div>
          <h3 style={{ fontSize: '16px', color: '#fff' }}>Enable Camera</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
            {permissionError}
          </p>
          {httpsRedirectUrl ? (
            <a 
              href={httpsRedirectUrl} 
              className="permission-btn" 
              style={{ textDecoration: 'none', display: 'inline-block', textAlign: 'center' }}
            >
              Open via HTTPS (Port 8443)
            </a>
          ) : (
            <button className="permission-btn" onClick={startCameraStream}>
              Grant Camera Permission
            </button>
          )}
        </div>
      )}

      {/* Instant Result Popup (< 2s) */}
      {scanState === 'CAPTURED' && decodedPayload && (
        <div className="decoded-popup-overlay" onClick={resumeScanning}>
          <div className="decoded-popup-card" onClick={(e) => e.stopPropagation()}>
            <div className="popup-header">
              <div className="popup-tag">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                <span>CAPTURED & READ ✓</span>
              </div>
              <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--accent-emerald)' }}>
                {dispatchStatus}
              </span>
            </div>

            {/* Captured Image Frame Snapshot */}
            {capturedSnapshot && (
              <div className="captured-snapshot-preview">
                <img src={capturedSnapshot} alt="Captured Photo Frame" />
                <span className="snapshot-label">CAPTURED PHOTO FRAME</span>
              </div>
            )}

            <div className="popup-meta-row">
              <span>Target ID: <strong className="popup-meta-val" style={{ color: 'var(--accent-cyan)' }}>{decodedPayload.id || 'QR-TARGET'}</strong></span>
              <span>Format: <strong className="popup-meta-val">{decodedPayload.type.toUpperCase()}</strong></span>
            </div>

            <div className="popup-value-box">
              {typeof decodedPayload.data === 'object'
                ? JSON.stringify(decodedPayload.data, null, 2)
                : String(decodedPayload.raw)}
            </div>

            <button className="popup-close-btn" onClick={resumeScanning}>
              Scan Next QR Code
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

window.Scanner = Scanner;
