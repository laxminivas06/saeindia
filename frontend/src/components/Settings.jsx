/**
 * React Component: Settings
 */

const { useState } = React;

function Settings({ settings, onUpdateSettings, showToast }) {
  const [apiUrl, setApiUrl] = useState(settings.apiUrl || '/api/qr-result');
  const [deviceId, setDeviceId] = useState(settings.deviceId || 'PHONE001');
  const [lockTime, setLockTime] = useState(settings.duplicateLockTime || 5);
  const [maxZoom, setMaxZoom] = useState(settings.maxZoom || 4.0);
  const [autoScan, setAutoScan] = useState(settings.autoScan !== false);
  const [soundEnabled, setSoundEnabled] = useState(settings.soundEnabled !== false);

  const handleSave = () => {
    onUpdateSettings({
      apiUrl,
      deviceId,
      duplicateLockTime: Number(lockTime),
      maxZoom: Number(maxZoom),
      autoScan,
      soundEnabled
    });
    showToast("Settings saved successfully");
  };

  return (
    <section className="scrollable-page">
      <div className="page-container">
        <div className="section-header">
          <div className="section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Scanner & Receiver Settings
          </div>
        </div>

        <div className="settings-group">
          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-title">Receiver API URL</span>
              <span className="setting-desc">Target endpoint for QR dispatches</span>
            </div>
            <div className="setting-control">
              <input type="text" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} style={{ width: '160px' }} />
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-title">Device ID</span>
              <span className="setting-desc">Unique identifier for this scanner</span>
            </div>
            <div className="setting-control">
              <input type="text" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} style={{ width: '160px' }} />
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-title">Duplicate Lock Cooldown</span>
              <span className="setting-desc">Ignore identical QR codes for X seconds</span>
            </div>
            <div className="setting-control" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="range" min="1" max="20" step="1" value={lockTime} onChange={(e) => setLockTime(e.target.value)} style={{ width: '100px' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent-cyan)' }}>{lockTime}s</span>
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-title">Max Auto-Zoom Boundary</span>
              <span className="setting-desc">Maximum camera zoom (1.0x - 5.0x)</span>
            </div>
            <div className="setting-control">
              <input type="number" min="1.0" max="5.0" step="0.5" value={maxZoom} onChange={(e) => setMaxZoom(e.target.value)} style={{ width: '70px' }} />
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-title">Autonomous Auto-Capture</span>
              <span className="setting-desc">Decode and capture immediately when clear</span>
            </div>
            <div className="setting-control">
              <label className="switch">
                <input type="checkbox" checked={autoScan} onChange={(e) => setAutoScan(e.target.checked)} />
                <span className="slider" />
              </label>
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-title">Sound & Haptic Feedback</span>
              <span className="setting-desc">Play focus and capture audio cues</span>
            </div>
            <div className="setting-control">
              <label className="switch">
                <input type="checkbox" checked={soundEnabled} onChange={(e) => setSoundEnabled(e.target.checked)} />
                <span className="slider" />
              </label>
            </div>
          </div>

          <button className="btn-primary" onClick={handleSave} style={{ marginTop: '8px' }}>
            Save Settings
          </button>
        </div>
      </div>
    </section>
  );
}

window.Settings = Settings;
