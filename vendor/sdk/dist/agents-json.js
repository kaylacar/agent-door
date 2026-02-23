"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAgentsJson = generateAgentsJson;
function flattenCapabilities(config) {
    return config.capabilities.flat();
}
function capabilityToEndpoint(cap, basePath) {
    const base = `${basePath}/agents/api`;
    const parts = cap.name.split('.');
    if (cap.name === 'detail')
        return `${base}/detail/:id`;
    if (parts.length > 1)
        return `${base}/${parts.join('/')}`;
    return `${base}/${cap.name}`;
}
function generateAgentsJson(config) {
    const basePath = config.basePath ?? '/.well-known';
    const capabilities = flattenCapabilities(config);
    return {
        schema_version: '1.0',
        site: {
            name: config.site.name,
            url: config.site.url,
            ...(config.site.description && { description: config.site.description }),
            ...(config.site.contact && { contact: config.site.contact }),
        },
        capabilities: capabilities.map(cap => ({
            name: cap.name,
            description: cap.description,
            method: cap.method,
            endpoint: capabilityToEndpoint(cap, basePath),
            ...(cap.params && { params: cap.params }),
            ...(cap.requiresSession && { requires_session: true }),
            ...(cap.humanHandoff && { human_handoff: true }),
        })),
        session: {
            create: `${basePath}/agents/api/session`,
            delete: `${basePath}/agents/api/session`,
            ...(config.sessionTtl && { ttl_seconds: config.sessionTtl }),
        },
        ...(config.flows && config.flows.length > 0 && {
            flows: config.flows.map(f => ({
                name: f.name,
                description: f.description,
                steps: f.steps,
            })),
        }),
        ...(config.rateLimit && { rate_limit: { requests_per_minute: config.rateLimit } }),
        ...(config.audit && {
            audit: {
                enabled: true,
                endpoint: `${basePath}/agents/api/audit/:session_id`,
                description: 'Retrieve signed RER artifact for a completed session',
            },
        }),
    };
}
