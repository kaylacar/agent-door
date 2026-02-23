export interface SiteConfig {
    name: string;
    url: string;
    description?: string;
    contact?: string;
}
/** Framework-agnostic request passed to capability handlers */
export interface AgentRequest {
    method: string;
    path: string;
    query: Record<string, string>;
    body: Record<string, any>;
    params: Record<string, string>;
    headers: Record<string, string>;
    ip?: string;
}
export interface CapabilityDefinition {
    name: string;
    description: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    params?: Record<string, {
        type: string;
        required?: boolean;
        description?: string;
        default?: any;
        enum?: any[];
    }>;
    requiresSession?: boolean;
    humanHandoff?: boolean;
    handler: (req: AgentRequest, session?: SessionData | null) => Promise<any>;
}
/** Suggested step sequence for a common agent task */
export interface FlowDefinition {
    name: string;
    description: string;
    steps: string[];
}
export interface AgentDoorConfig {
    site: SiteConfig;
    capabilities: (CapabilityDefinition | CapabilityDefinition[])[];
    flows?: FlowDefinition[];
    rateLimit?: number;
    sessionTtl?: number;
    audit?: boolean;
    basePath?: string;
}
export interface SessionData {
    sessionToken: string;
    siteId: string;
    capabilities: string[];
    cartItems: CartItem[];
    expiresAt: Date;
    createdAt: Date;
}
export interface AgentResponse<T = any> {
    ok: boolean;
    data?: T;
    error?: string;
}
export interface CartItem {
    itemId: string;
    name?: string;
    quantity: number;
    price?: number;
    metadata?: Record<string, any>;
}
/** OpenAPI 3.x subset used by AgentDoor.fromOpenAPI() */
export interface OpenAPISpec {
    info?: {
        title?: string;
        description?: string;
    };
    servers?: {
        url: string;
    }[];
    paths: Record<string, Record<string, {
        operationId?: string;
        summary?: string;
        parameters?: Array<{
            name: string;
            in: 'query' | 'path' | 'header' | 'cookie';
            required?: boolean;
            description?: string;
            schema?: {
                type?: string;
                enum?: any[];
                default?: any;
            };
        }>;
        requestBody?: {
            content?: {
                'application/json'?: {
                    schema?: {
                        properties?: Record<string, {
                            type?: string;
                            description?: string;
                        }>;
                        required?: string[];
                    };
                };
            };
        };
    }>>;
}
