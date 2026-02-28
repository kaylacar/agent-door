"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateExternalUrl = validateExternalUrl;
const url_1 = require("url");
const promises_1 = __importDefault(require("dns/promises"));
const net_1 = __importDefault(require("net"));
// RFC 1918 + loopback + link-local + metadata
const PRIVATE_V4_PREFIXES = [
    '10.', '127.', '0.', '169.254.', '192.168.',
    ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.`),
];
function isPrivateV4(ip) {
    return PRIVATE_V4_PREFIXES.some(p => ip.startsWith(p));
}
function isPrivateV6(ip) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::')
        return true;
    if (l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80'))
        return true;
    // v4-mapped v6
    if (l.startsWith('::ffff:'))
        return isPrivateV4(l.slice(7));
    return false;
}
function isPrivate(ip) {
    if (net_1.default.isIPv4(ip))
        return isPrivateV4(ip);
    if (net_1.default.isIPv6(ip))
        return isPrivateV6(ip);
    return false;
}
async function validateExternalUrl(rawUrl) {
    let parsed;
    try {
        parsed = new url_1.URL(rawUrl);
    }
    catch {
        throw new Error('invalid URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('only http/https allowed');
    }
    const host = parsed.hostname;
    if (net_1.default.isIP(host)) {
        if (isPrivate(host))
            throw new Error('private/internal address');
        return;
    }
    let addrs;
    try {
        addrs = await promises_1.default.lookup(host, { all: true });
    }
    catch {
        throw new Error(`can't resolve ${host}`);
    }
    for (const a of addrs) {
        if (isPrivate(a.address))
            throw new Error('resolves to private/internal address');
    }
}
//# sourceMappingURL=url-guard.js.map