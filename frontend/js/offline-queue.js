/**
 * Offline Scan Queue & Synchronization Service
 * Stores scans locally when offline or API is unreachable, automatically retries on reconnect.
 */

class OfflineQueueManager {
  constructor(storageKey = 'qr_box_offline_queue') {
    this.storageKey = storageKey;
    this.queue = this._load();
    this.isSyncing = false;
    this._initListeners();
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
    } catch (e) {
      console.warn("Storage full or unavailable", e);
    }
  }

  _initListeners() {
    window.addEventListener('online', () => {
      console.log("Network online, syncing pending scans...");
      this.syncPending();
    });
  }

  enqueue(scanPayload) {
    const queueItem = {
      id: `QUEUE-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      queued_at: new Date().toISOString(),
      attempts: 0,
      payload: scanPayload
    };
    this.queue.push(queueItem);
    this._save();
    return queueItem;
  }

  getPendingCount() {
    return this.queue.length;
  }

  async syncPending(apiUrl = '/api/qr-result') {
    if (this.isSyncing || this.queue.length === 0) return;
    if (!navigator.onLine) return;

    this.isSyncing = true;
    const remaining = [];

    for (const item of this.queue) {
      try {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload)
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        console.log(`Synced queued scan: ${item.id}`);
      } catch (err) {
        item.attempts += 1;
        remaining.push(item);
      }
    }

    this.queue = remaining;
    this._save();
    this.isSyncing = false;

    if (window.app && window.app.updateQueueUI) {
      window.app.updateQueueUI();
    }
  }
}

window.offlineQueue = new OfflineQueueManager();
