/**
 * Offline Scan Queue & Sync Service
 */

class OfflineQueueManager {
  constructor(storageKey = 'react_qr_scanner_queue') {
    this.storageKey = storageKey;
    this.queue = this._load();
    this.isSyncing = false;
    this._init();
  }

  _load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  _save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.queue));
    } catch (e) {}
  }

  _init() {
    window.addEventListener('online', () => {
      this.syncPending();
    });
  }

  enqueue(payload) {
    const item = {
      id: `QUEUE-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      queued_at: new Date().toISOString(),
      payload
    };
    this.queue.push(item);
    this._save();
    return item;
  }

  async syncPending(apiUrl = '/api/qr-result') {
    if (this.isSyncing || this.queue.length === 0 || !navigator.onLine) return;
    this.isSyncing = true;
    const remaining = [];

    for (const item of this.queue) {
      try {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        remaining.push(item);
      }
    }

    this.queue = remaining;
    this._save();
    this.isSyncing = false;
  }
}

window.offlineQueue = new OfflineQueueManager();
