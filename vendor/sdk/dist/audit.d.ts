import type { RunArtifact } from 'rer';
export declare class AuditManager {
    private keyPair;
    private runtimes;
    private artifacts;
    private pendingHandlers;
    private ttlSeconds;
    constructor(ttlSeconds?: number);
    startSession(sessionToken: string, siteUrl: string, capabilityNames: string[]): void;
    /**
     * Execute a capability through the RER runtime so it gets logged
     * as ToolCalled + ToolReturned events in the hash chain.
     */
    callCapability(sessionToken: string, capabilityName: string, requestData: Record<string, unknown>, handler: () => Promise<any>): Promise<any>;
    endSession(sessionToken: string): RunArtifact | null;
    getArtifact(sessionToken: string): RunArtifact | null;
    getPublicKey(): Buffer;
    destroy(): void;
}
