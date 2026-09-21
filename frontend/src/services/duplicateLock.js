/**
 * Duplicate Lock Cooldown Manager
 */

class DuplicateLockManager {
  constructor(defaultLockTimeMs = 5000) {
    this.lockTimeMs = defaultLockTimeMs;
    this.lockedPayloads = new Map();
  }

  setLockTimeSeconds(seconds) {
    this.lockTimeMs = Math.max(1000, Number(seconds) * 1000);
  }

  isLocked(rawPayload) {
    if (!rawPayload) return false;
    const now = Date.now();
    const expiry = this.lockedPayloads.get(rawPayload);
    if (expiry && now < expiry) return true;
    if (expiry) this.lockedPayloads.delete(rawPayload);
    return false;
  }

  lock(rawPayload) {
    if (!rawPayload) return;
    this.lockedPayloads.set(rawPayload, Date.now() + this.lockTimeMs);
  }

  clear() {
    this.lockedPayloads.clear();
  }
}

window.duplicateLock = new DuplicateLockManager(5000);
