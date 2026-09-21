/**
 * React Component: Real-time Receiver Dashboard
 */

const { useState, useEffect, useRef } = React;

function ReceiverDashboard({ showToast }) {
  const [records, setRecords] = useState([]);
  const [latestRecord, setLatestRecord] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef(null);

  // Fetch initial history
  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/qr-results?limit=200');
      if (res.ok) {
        const data = await res.json();
        setRecords(data.results || []);
        if (data.results && data.results.length > 0) {
          setLatestRecord(data.results[0]);
        }
      }
    } catch (e) {}
  };

  // WebSocket live updates
  useEffect(() => {
    fetchHistory();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/live`;

    let reconnectTimer;
    function connectWs() {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => setWsConnected(true);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.event === 'new_scan' && msg.data) {
              setLatestRecord(msg.data);
              setRecords(prev => [msg.data, ...prev.slice(0, 500)]);
            } else if (msg.event === 'history_cleared') {
              setRecords([]);
              setLatestRecord(null);
            }
          } catch (e) {}
        };
        ws.onclose = () => {
          setWsConnected(false);
          reconnectTimer = setTimeout(connectWs, 3000);
        };
        ws.onerror = () => setWsConnected(false);
      } catch (e) {
        reconnectTimer = setTimeout(connectWs, 3000);
      }
    }

    connectWs();

    const pollInterval = setInterval(fetchHistory, 6000);

    return () => {
      clearInterval(pollInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const handleClearHistory = async () => {
    if (!confirm("Are you sure you want to clear all receiver scan history?")) return;
    try {
      await fetch('/api/qr-results', { method: 'DELETE' });
      setRecords([]);
      setLatestRecord(null);
      showToast("History cleared");
    } catch (e) {
      alert("Failed to clear history");
    }
  };

  const handleExportCSV = () => {
    if (records.length === 0) return alert("No scans to export");
    const headers = ["Time", "Target ID", "QR Data", "Device", "Status"];
    const rows = records.map(r => [
      `"${new Date(r.timestamp || r.received_at).toLocaleTimeString()}"`,
      `"${(r.box_id || '').replace(/"/g, '""')}"`,
      `"${(typeof r.qr_data === 'object' ? JSON.stringify(r.qr_data) : String(r.qr_data)).replace(/"/g, '""')}"`,
      `"${(r.device_id || '').replace(/"/g, '""')}"`,
      `"Received"`
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `qr_scans_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filtered = records.filter(r => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const id = String(r.box_id || '').toLowerCase();
    const data = (typeof r.qr_data === 'object' ? JSON.stringify(r.qr_data) : String(r.qr_data || '')).toLowerCase();
    const dev = String(r.device_id || '').toLowerCase();
    return id.includes(q) || data.includes(q) || dev.includes(q);
  });

  return (
    <section className="scrollable-page">
      <div className="page-container">
        
        <div className="section-header">
          <div className="section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            QR SCAN RECEIVER
          </div>
          <div className={`status-pill ${wsConnected ? 'online' : 'offline'}`}>
            <span>{wsConnected ? '● Live Connected' : '○ Reconnecting...'}</span>
          </div>
        </div>

        {/* Latest Scan Hero Card */}
        <div className="latest-card">
          <div className="latest-card-header">
            <span className="latest-badge">LATEST CAPTURE</span>
            <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--accent-emerald)' }}>✓ Received</span>
          </div>

          <div className="latest-grid">
            <div className="data-box">
              <label>Target ID</label>
              <div className="value" style={{ color: 'var(--accent-cyan)', fontSize: '18px' }}>
                {latestRecord ? (latestRecord.box_id || 'UNKNOWN') : 'Awaiting scan...'}
              </div>
            </div>
            <div className="data-box">
              <label>Detected At</label>
              <div className="value">
                {latestRecord ? new Date(latestRecord.timestamp || latestRecord.received_at).toLocaleTimeString() : '--:--:--'}
              </div>
            </div>
            <div className="data-box">
              <label>Device ID</label>
              <div className="value">{latestRecord ? latestRecord.device_id : '--'}</div>
            </div>
            <div className="data-box full">
              <label>Payload Content</label>
              <div className="value" style={{ fontSize: '13px', color: '#a5f3fc' }}>
                {latestRecord ? (typeof latestRecord.qr_data === 'object' ? JSON.stringify(latestRecord.qr_data) : String(latestRecord.qr_data)) : 'No scans received yet.'}
              </div>
            </div>
          </div>
        </div>

        {/* History Table */}
        <div className="table-card">
          <div className="table-toolbar">
            <div style={{ fontWeight: '700', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Detection History</span>
              <span className="status-pill online">{records.length} Scans</span>
            </div>
            <input 
              type="text" 
              className="search-input" 
              placeholder="Search Target, Data, Device..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={handleExportCSV}>Export CSV</button>
              <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', color: 'var(--accent-rose)' }} onClick={handleClearHistory}>Clear</button>
            </div>
          </div>

          <div className="table-scroll">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Identifier</th>
                  <th>QR Data</th>
                  <th>Device</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id || Math.random()}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: '600', color: 'var(--text-secondary)' }}>
                      {new Date(r.timestamp || r.received_at).toLocaleTimeString()}
                    </td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', color: 'var(--accent-cyan)' }}>
                        {r.box_id || 'UNKNOWN'}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                      {typeof r.qr_data === 'object' ? JSON.stringify(r.qr_data).substring(0, 40) + '...' : String(r.qr_data).substring(0, 40)}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {r.device_id || 'PHONE001'}
                    </td>
                    <td>
                      <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--accent-emerald)', background: 'rgba(0,240,144,0.1)', padding: '2px 8px', borderRadius: '12px' }}>
                        ✓ Received
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="empty-state">
                No scans recorded. Point the camera anywhere on the screen at a QR code!
              </div>
            )}
          </div>
        </div>

      </div>
    </section>
  );
}

window.ReceiverDashboard = ReceiverDashboard;
