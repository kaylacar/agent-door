"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAgentsTxt = generateAgentsTxt;
function flattenCapabilities(config) {
    return config.capabilities.flat();
}
function generateAgentsTxt(config) {
    const basePath = config.basePath ?? '/.well-known';
    const capabilities = flattenCapabilities(config);
    const lines = [
        `# agents.txt - ${config.site.name}`,
        `# ${config.site.url}`,
        '',
        `Site: ${config.site.name}`,
        `URL: ${config.site.url}`,
    ];
    if (config.site.description)
        lines.push(`Description: ${config.site.description}`);
    if (config.site.contact)
        lines.push(`Contact: ${config.site.contact}`);
    lines.push('');
    lines.push(`Agents-JSON: ${config.site.url}${basePath}/agents.json`);
    lines.push('');
    lines.push('# Capabilities');
    for (const cap of capabilities) {
        lines.push(`Allow: ${cap.name}`);
    }
    if (config.flows && config.flows.length > 0) {
        lines.push('');
        lines.push('# Suggested Flows');
        for (const flow of config.flows) {
            lines.push(`Flow: ${flow.name} → ${flow.steps.join(', ')}`);
            if (flow.description)
                lines.push(`Flow-Description: ${flow.description}`);
        }
    }
    if (config.rateLimit)
        lines.push('');
    if (config.rateLimit)
        lines.push(`Rate-Limit: ${config.rateLimit}/minute`);
    if (config.sessionTtl)
        lines.push(`Session-TTL: ${config.sessionTtl}s`);
    if (config.audit) {
        lines.push(`Audit: true`);
        lines.push(`Audit-Endpoint: ${config.site.url}${basePath}/agents/api/audit/:session_id`);
    }
    lines.push('');
    return lines.join('\n');
}
