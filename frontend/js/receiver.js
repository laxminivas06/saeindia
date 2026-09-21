/**
 * Real-Time Receiver Dashboard & History Manager
 * Connects via WebSocket (/ws/live) for instant live push alerts with REST polling fallback.
 */

class ReceiverDashboard {
  constructor() {
    this.ws = null;
    this.wsConnected = false;
    this.reconnectTimer = null;
    this.pollTimer = null;
    this.records = [];
    this.latestRecord = null;
    this.searchQuery = '';
    
    this._initElements();
    this._initWebSocket();
    this.fetchHistory();
  }

  _initElements() {
    this.statusPill = document.getElementById('receiver-status-pill');
    this.statusText = document.getElementById('receiver-status-text');
    
    // Latest Card Elements
    this.latestBoxId = document.getElementById('latest-box-id');
    this.latestQrData = document.getElementById('latest-qr-data');
    this.latestTime = document.getElementById('latest-time');
    this.latestDevice = document.getElementById('latest-device');
    this.latestStatus = document.getElementById('latest-status');
    
    // History Table
    this.tableBody = document.getElementById('history-table-body');
    this.emptyState = document.getElementById('history-empty-state');
    this.totalScansCount = document.getElementById('total-scans-count');
    
    // Search Input
    this.searchInput = document.getElementById('receiver-search-input');
    if (this.searchInput) {
      this.searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim().toLowerCase();
        this.renderTable();
      });
    }

    // Export & Clear buttons
    const exportCsvBtn = document.getElementById('btn-export-csv');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => this.exportCSV());

    const exportJsonBtn = document.getElementById('btn-export-json');
    if (exportJsonBtn) exportJsonBtn.addEventListener('click', () => this.exportJSON());

    const clearHistoryBtn = document.getElementById('btn-clear-history');
    if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', () => this.clearHistory());
  }

  _initWebSocket() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${proto}//${host}/ws/live`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.wsConnected = true;
        this._updateConnectionUI(true);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this._handleWsMessage(payload);
        } catch (e) {
          console.warn("WS parse error", e);
        }
      };

      this.ws.onclose = () => {
        this.wsConnected = false;
        this._updateConnectionUI(false);
        this.reconnectTimer = setTimeout(() => this._initWebSocket(), 3000);
      };

      this.ws.onerror = () => {
        this.wsConnected = false;
        this._updateConnectionUI(false);
      };
    } catch (e) {
      console.warn("WebSocket init error, falling back to polling", e);
      this._updateConnectionUI(false);
    }

    // Secondary periodic fallback polling
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => this.fetchHistory(), 5000);
    }
  }

  _updateConnectionUI(online) {
    if (!this.statusPill || !this.statusText) return;
    if (online) {
      this.statusPill.className = 'status-pill online';
      this.statusText.textContent = '● Live Connected';
    } else {
      this.statusPill.className = 'status-pill offline';
      this.statusText.textContent = '○ Reconnecting...';
    }
  }

  _handleWsMessage(msg) {
    if (msg.event === 'new_scan' && msg.data) {
      this.latestRecord = msg.data;
      this.records.unshift(msg.data);
      if (this.records.length > 1000) this.records.pop();
      
      this.updateLatestCard(msg.data);
      this.renderTable();
      
      // Flash UI highlight
      const card = document.getElementById('latest-scan-card');
      if (card) {
        card.style.borderColor = 'var(--accent-cyan)';
        setTimeout(() => card.style.borderColor = 'var(--border-glow)', 1200);
      }
    } else if (msg.event === 'history_cleared') {
      this.records = [];
      this.latestRecord = null;
      this.updateLatestCard(null);
      this.renderTable();
    }
  }

  async fetchHistory() {
    try {
      const res = await fetch('/api/qr-results?limit=200');
      if (res.ok) {
        const data = await res.json();
        this.records = data.results || [];
        if (this.records.length > 0 && !this.latestRecord) {
          this.latestRecord = this.records[0];
          this.updateLatestCard(this.latestRecord);
        }
        this.renderTable();
      }
    } catch (e) {
      console.warn("Error fetching history", e);
    }
  }

  updateLatestCard(record) {
    if (!this.latestBoxId) return;

    if (!record) {
      this.latestBoxId.textContent = 'NO DATA';
      this.latestQrData.textContent = 'Awaiting incoming QR scan...';
      this.latestTime.textContent = '--:--:--';
      this.latestDevice.textContent = 'NONE';
      this.latestStatus.textContent = '○ Idle';
      return;
    }

    this.latestBoxId.textContent = record.box_id || 'UNKNOWN';
    
    // Format QR data display
    let dataStr = typeof record.qr_data === 'object' 
      ? JSON.stringify(record.qr_data) 
      : String(record.qr_data);
    this.latestQrData.textContent = dataStr;

    // Time formatting
    const time = record.timestamp || record.received_at || new Date().toISOString();
    try {
      const d = new Date(time);
      this.latestTime.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      this.latestTime.textContent = time;
    }

    this.latestDevice.textContent = record.device_id || 'PHONE001';
    this.latestStatus.innerHTML = '<span style="color:var(--accent-emerald);">✓ Received</span>';
  }

  renderTable() {
    if (!this.tableBody) return;

    const filtered = this.records.filter(r => {
      if (!this.searchQuery) return true;
      const box = String(r.box_id || '').toLowerCase();
      const qr = (typeof r.qr_data === 'object' ? JSON.stringify(r.qr_data) : String(r.qr_data || '')).toLowerCase();
      const dev = String(r.device_id || '').toLowerCase();
      return box.includes(this.searchQuery) || qr.includes(this.searchQuery) || dev.includes(this.searchQuery);
    });

    if (this.totalScansCount) {
      this.totalScansCount.textContent = `${this.records.length} Scans`;
    }

    if (filtered.length === 0) {
      this.tableBody.innerHTML = '';
      if (this.emptyState) this.emptyState.style.display = 'block';
      return;
    }

    if (this.emptyState) this.emptyState.style.display = 'none';

    this.tableBody.innerHTML = filtered.map(r => {
      const d = new Date(r.timestamp || r.received_at || Date.now());
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      const payloadDisplay = typeof r.qr_data === 'object' 
        ? JSON.stringify(r.qr_data).substring(0, 45) + '...'
        : String(r.qr_data).substring(0, 45);

      return `
        <tr>
          <td style="font-family:var(--font-mono); font-weight:600; color:var(--text-secondary);">${timeStr}</td>
          <td>
            <span style="font-family:var(--font-mono); font-weight:700; color:var(--accent-cyan);">
              ${escapeHtml(r.box_id || 'UNKNOWN')}
            </span>
          </td>
          <td style="font-family:var(--font-mono); font-size:12px; color:var(--text-primary);">
            ${escapeHtml(payloadDisplay)}
          </td>
          <td style="font-family:var(--font-mono); font-size:11px; color:var(--text-secondary);">
            ${escapeHtml(r.device_id || 'PHONE001')}
          </td>
          <td>
            <span style="font-size:11px; font-weight:700; color:var(--accent-emerald); background:rgba(0,240,144,0.1); padding:2px 8px; border-radius:12px;">
              ✓ Received
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }

  async clearHistory() {
    if (!confirm("Are you sure you want to clear all receiver scan history?")) return;
    try {
      await fetch('/api/qr-results', { method: 'DELETE' });
      this.records = [];
      this.latestRecord = null;
      this.updateLatestCard(null);
      this.renderTable();
    } catch (e) {
      alert("Failed to clear history: " + e.message);
    }
  }

  exportCSV() {
    if (this.records.length === 0) {
      alert("No detection history to export");
      return;
    }

    const headers = ["Time", "Box ID", "QR Data", "Device ID", "Status", "Timestamp"];
    const rows = this.records.map(r => [
      `"${new Date(r.timestamp || r.received_at).toLocaleTimeString()}"`,
      `"${(r.box_id || '').replace(/"/g, '""')}"`,
      `"${(typeof r.qr_data === 'object' ? JSON.stringify(r.qr_data) : String(r.qr_data)).replace(/"/g, '""')}"`,
      `"${(r.device_id || '').replace(/"/g, '""')}"`,
      `"Received"`,
      `"${r.timestamp || r.received_at}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `qr_box_scans_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  exportJSON() {
    if (this.records.length === 0) {
      alert("No detection history to export");
      return;
    }
    const jsonStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.records, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", jsonStr);
    link.setAttribute("download", `qr_box_scans_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

window.ReceiverDashboard = ReceiverDashboard;
