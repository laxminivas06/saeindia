/**
 * Duplicate Detection Prevention Manager
 * Locks recently scanned payloads for a configurable cooldown window (e.g. 5 seconds)
 * to avoid duplicate spamming while keeping the camera live.
 */

class DuplicateLockManager {
  constructor(defaultLockTimeMs = 5000) {
    this.lockTimeMs = defaultLockTimeMs;
    this.lockedPayloads = new Map(); // rawPayload -> timestampUnlocked
  }

  setLockTimeSeconds(seconds) {
    this.lockTimeMs = Math.max(1000, Number(seconds) * 1000);
  }

  isLocked(rawPayload) {
    if (!rawPayload) return false;
    const now = Date.now();
    const expiry = this.lockedPayloads.get(rawPayload);
    
    if (expiry && now < expiry) {
      return true; // Still locked
    }
    
    // Clean up expired entry
    if (expiry) {
      this.lockedPayloads.delete(rawPayload);
    }
    return false;
  }

  lock(rawPayload) {
    if (!rawPayload) return;
    const expiry = Date.now() + this.lockTimeMs;
    this.lockedPayloads.set(rawPayload, expiry);
  }

  unlock(rawPayload) {
    this.lockedPayloads.delete(rawPayload);
  }

  clear() {
    this.lockedPayloads.clear();
  }
}

window.duplicateLock = new DuplicateLockManager(5000);
