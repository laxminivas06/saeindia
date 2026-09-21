/**
 * React Component: Test QR Workbench
 */

const { useState, useEffect, useRef } = React;

function QRWorkbench() {
  const [format, setFormat] = useState('json');
  const [targetId, setTargetId] = useState('TARGET001');
  const [missionTag, setMissionTag] = useState('MISSION_ALPHA');
  const [customText, setCustomText] = useState('');
  const qrContainerRef = useRef(null);

  const generateQRCode = () => {
    if (!qrContainerRef.current) return;
    qrContainerRef.current.innerHTML = '';

    let text = '';
    if (format === 'json') {
      text = JSON.stringify({
        box_id: targetId,
        mission_id: missionTag,
        timestamp: new Date().toISOString()
      }, null, 2);
    } else if (format === 'kv') {
      text = `BOX_ID=${targetId}\nMISSION_ID=${missionTag}\nSTATUS=VERIFIED`;
    } else if (format === 'plain') {
      text = targetId;
    } else {
      text = customText || targetId;
    }

    if (typeof QRCode !== 'undefined') {
      new QRCode(qrContainerRef.current, {
        text,
        width: 220,
        height: 220,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  };

  useEffect(() => {
    generateQRCode();
  }, [format, targetId, missionTag, customText]);

  return (
    <section className="scrollable-page">
      <div className="page-container">
        <div className="section-header">
          <div className="section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h3v3H7zM14 7h3v3h-3zM7 14h3v3H7z"/></svg>
            Test QR Code Workbench
          </div>
          <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => window.print()}>Print</button>
        </div>

        <div className="qr-preview-box">
          <div className="box-marker-label">TEST TARGET: {targetId}</div>
          <div ref={qrContainerRef} />
          <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: '#555', textAlign: 'center' }}>
            HIGH-CONTRAST BENCHMARK TARGET
          </div>
        </div>

        <div className="generator-card">
          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-title">Payload Format</span>
              <span className="setting-desc">Select payload format</span>
            </div>
            <div className="setting-control">
              <select value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="json">JSON Structure</option>
                <option value="kv">Key-Value Multi-line</option>
                <option value="plain">Plain Text</option>
                <option value="custom">Custom String</option>
              </select>
            </div>
          </div>

          {format !== 'custom' ? (
            <>
              <div className="setting-item">
                <div className="setting-info">
                  <span className="setting-title">Target ID</span>
                </div>
                <div className="setting-control">
                  <input type="text" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
                </div>
              </div>
              <div className="setting-item">
                <div className="setting-info">
                  <span className="setting-title">Mission / Tag</span>
                </div>
                <div className="setting-control">
                  <input type="text" value={missionTag} onChange={(e) => setMissionTag(e.target.value)} />
                </div>
              </div>
            </>
          ) : (
            <input 
              type="text" 
              className="search-input" 
              placeholder="Enter custom QR string or JSON..." 
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
            />
          )}

          <button className="btn-primary" onClick={generateQRCode} style={{ marginTop: '8px' }}>
            Regenerate QR Target
          </button>
        </div>
      </div>
    </section>
  );
}

window.QRWorkbench = QRWorkbench;
