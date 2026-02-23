import type { Request, Response, NextFunction } from 'express';
import { AgentDoorConfig, OpenAPISpec } from './types';
export declare class AgentDoor {
    private config;
    private basePath;
    private capabilities;
    private sessionManager;
    private rateLimiter;
    private auditManager;
    private rateLimit;
    private agentsTxt;
    private agentsJson;
    private agentsJsonPath;
    private routes;
    constructor(config: AgentDoorConfig);
    /**
     * Create an AgentDoor that proxies requests to an existing API described by
     * an OpenAPI 3.x spec. The site owner provides no handler code — capabilities
     * are inferred from the spec and calls are forwarded to baseUrl.
     */
    static fromOpenAPI(spec: OpenAPISpec, baseUrl: string, overrides?: Partial<AgentDoorConfig>): AgentDoor;
    middleware(): (req: Request, res: Response, next: NextFunction) => void;
    handler(): (request: globalThis.Request) => Promise<globalThis.Response>;
    private dispatch;
    private buildRoutes;
    private injectHtmlLink;
    private checkRate;
    destroy(): void;
}
