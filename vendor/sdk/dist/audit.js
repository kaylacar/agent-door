"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditManager = void 0;
// Stubbed — agent-door gateway does not use RER audit.
// The full AuditManager requires the `rer` package which has native deps.
class AuditManager {
    keyPair = null;
    runtimes = new Map();
    artifacts = new Map();
    pendingHandlers = new Map();
    ttlSeconds;
    constructor(ttlSeconds = 3600) {
        this.ttlSeconds = ttlSeconds;
    }
    startSession() { }
    async callCapability(_sessionToken, _capabilityName, _requestData, handler) {
        return handler();
    }
    endSession() { return null; }
    getArtifact() { return null; }
    getPublicKey() { return null; }
    destroy() {
        this.runtimes.clear();
        this.pendingHandlers.clear();
    }
}
exports.AuditManager = AuditManager;
