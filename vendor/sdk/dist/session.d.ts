import { SessionData, CapabilityDefinition } from './types';
export declare class SessionManager {
    private sessions;
    private cleanupInterval;
    private ttl;
    constructor(ttlSeconds?: number, capabilities?: CapabilityDefinition[]);
    private capabilityNames;
    createSession(siteId: string): {
        sessionToken: string;
        expiresAt: Date;
        capabilities: string[];
    };
    validateSession(token: string): SessionData | null;
    getSession(token: string): SessionData | null;
    endSession(token: string): void;
    private cleanup;
    destroy(): void;
}
