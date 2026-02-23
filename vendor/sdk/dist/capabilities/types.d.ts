import type { AgentRequest, SessionData } from '../types';
export interface CapabilityHandler {
    (req: AgentRequest, session?: SessionData | null): Promise<any>;
}
export type RegisteredCapability = {
    name: string;
    description: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    params?: Record<string, {
        type: string;
        required?: boolean;
        description?: string;
    }>;
    requiresSession?: boolean;
    humanHandoff?: boolean;
    handler: CapabilityHandler;
};
