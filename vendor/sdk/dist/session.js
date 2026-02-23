"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const uuid_1 = require("uuid");
class SessionManager {
    sessions = new Map();
    cleanupInterval;
    ttl;
    constructor(ttlSeconds = 3600, capabilities = []) {
        this.ttl = ttlSeconds;
        this.capabilityNames = capabilities.map(c => c.name);
        this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    }
    capabilityNames;
    createSession(siteId) {
        const sessionToken = (0, uuid_1.v4)();
        const expiresAt = new Date(Date.now() + this.ttl * 1000);
        const session = {
            sessionToken,
            siteId,
            capabilities: this.capabilityNames,
            cartItems: [],
            expiresAt,
            createdAt: new Date(),
        };
        this.sessions.set(sessionToken, session);
        return { sessionToken, expiresAt, capabilities: session.capabilities };
    }
    validateSession(token) {
        const session = this.sessions.get(token);
        if (!session)
            return null;
        if (Date.now() >= session.expiresAt.getTime()) {
            this.sessions.delete(token);
            return null;
        }
        return session;
    }
    getSession(token) {
        return this.validateSession(token);
    }
    endSession(token) {
        this.sessions.delete(token);
    }
    cleanup() {
        const now = new Date();
        for (const [token, session] of this.sessions) {
            if (now > session.expiresAt) {
                this.sessions.delete(token);
            }
        }
    }
    destroy() {
        clearInterval(this.cleanupInterval);
        this.sessions.clear();
    }
}
exports.SessionManager = SessionManager;
