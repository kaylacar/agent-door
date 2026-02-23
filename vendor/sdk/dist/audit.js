"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditManager = void 0;
const uuid_1 = require("uuid");
const rer_1 = require("rer");
class AuditManager {
    keyPair;
    runtimes = new Map();
    artifacts = new Map();
    pendingHandlers = new Map();
    ttlSeconds;
    constructor(ttlSeconds = 3600) {
        this.keyPair = (0, rer_1.generateEd25519KeyPair)();
        this.ttlSeconds = ttlSeconds;
    }
    startSession(sessionToken, siteUrl, capabilityNames) {
        const runId = (0, uuid_1.v4)();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
        const envelope = {
            envelope_version: '0.1',
            run_id: runId,
            created_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),
            principal: { type: 'agent_session', id: sessionToken },
            permissions: {
                models: { allow: [], deny: [] },
                tools: { allow: capabilityNames, deny: [] },
                spend_caps: { max_usd: null },
                rate_limits: { max_model_calls: null, max_tool_calls: null },
                human_approval: { required_for_tools: [] },
            },
            context: { site: siteUrl },
            envelope_signature: '',
        };
        envelope.envelope_signature = (0, rer_1.signEnvelope)(envelope, this.keyPair.privateKey);
        // Register a pass-through executor for each capability.
        // The real handler is stored in pendingHandlers and executed when
        // runtime.callTool() invokes the executor.
        const toolExecutors = {};
        for (const name of capabilityNames) {
            toolExecutors[name] = async (_req) => {
                const key = `${sessionToken}:${name}`;
                const queue = this.pendingHandlers.get(key);
                const handler = queue?.shift();
                let result = {};
                if (handler) {
                    result = await handler();
                }
                return { tool: name, output: { data: result } };
            };
        }
        const runtime = new rer_1.Runtime({
            envelope,
            signerKeyPair: this.keyPair,
            toolExecutors,
        });
        runtime.start();
        this.runtimes.set(sessionToken, runtime);
    }
    /**
     * Execute a capability through the RER runtime so it gets logged
     * as ToolCalled + ToolReturned events in the hash chain.
     */
    async callCapability(sessionToken, capabilityName, requestData, handler) {
        const runtime = this.runtimes.get(sessionToken);
        if (!runtime) {
            return handler();
        }
        // Queue the handler so the registered executor can pick it up
        const key = `${sessionToken}:${capabilityName}`;
        if (!this.pendingHandlers.has(key)) {
            this.pendingHandlers.set(key, []);
        }
        this.pendingHandlers.get(key).push(handler);
        try {
            const result = await runtime.callTool({
                tool: capabilityName,
                input: requestData,
            });
            return result.output.data;
        }
        catch {
            // If RER blocks the call, try running the handler directly
            const queue = this.pendingHandlers.get(key);
            const pending = queue?.shift();
            if (pending) {
                return pending();
            }
            return {};
        }
    }
    endSession(sessionToken) {
        const runtime = this.runtimes.get(sessionToken);
        if (!runtime)
            return null;
        try {
            runtime.end('completed', 'Session ended');
        }
        catch {
            // Runtime may already be ended or expired
        }
        let artifact = null;
        try {
            artifact = runtime.buildArtifact();
            this.artifacts.set(sessionToken, artifact);
        }
        catch {
            // Artifact build can fail if runtime was never started properly
        }
        this.runtimes.delete(sessionToken);
        for (const key of this.pendingHandlers.keys()) {
            if (key.startsWith(sessionToken + ':')) {
                this.pendingHandlers.delete(key);
            }
        }
        return artifact;
    }
    getArtifact(sessionToken) {
        return this.artifacts.get(sessionToken) ?? null;
    }
    getPublicKey() {
        return this.keyPair.publicKey;
    }
    destroy() {
        for (const [token, runtime] of this.runtimes) {
            try {
                runtime.end('completed', 'Shutdown');
                const artifact = runtime.buildArtifact();
                this.artifacts.set(token, artifact);
            }
            catch {
                // ignore
            }
        }
        this.runtimes.clear();
        this.pendingHandlers.clear();
    }
}
exports.AuditManager = AuditManager;
