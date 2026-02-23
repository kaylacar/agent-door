"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
class RateLimiter {
    windows = new Map();
    cleanupInterval;
    windowMs = 60_000;
    constructor() {
        this.cleanupInterval = setInterval(() => this.cleanup(), 30_000);
    }
    checkRateLimit(key, limit) {
        const now = Date.now();
        const windowStart = now - this.windowMs;
        let entry = this.windows.get(key);
        if (!entry) {
            entry = { timestamps: [] };
            this.windows.set(key, entry);
        }
        entry.timestamps = entry.timestamps.filter(t => t > windowStart);
        if (entry.timestamps.length >= limit) {
            const oldestInWindow = entry.timestamps[0];
            return {
                allowed: false,
                remaining: 0,
                resetAt: oldestInWindow + this.windowMs,
            };
        }
        entry.timestamps.push(now);
        return {
            allowed: true,
            remaining: limit - entry.timestamps.length,
            resetAt: now + this.windowMs,
        };
    }
    cleanup() {
        const windowStart = Date.now() - this.windowMs;
        for (const [key, entry] of this.windows) {
            entry.timestamps = entry.timestamps.filter(t => t > windowStart);
            if (entry.timestamps.length === 0) {
                this.windows.delete(key);
            }
        }
    }
    destroy() {
        clearInterval(this.cleanupInterval);
        this.windows.clear();
    }
}
exports.RateLimiter = RateLimiter;
