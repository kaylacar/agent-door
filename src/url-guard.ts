import { URL } from 'url';
import dns from 'dns/promises';
import net from 'net';

/**
 * Blocks SSRF by resolving a URL's hostname and rejecting private/internal IPs.
 * Must be called before every server-side fetch of a user-supplied URL.
 */

const BLOCKED_RANGES = [
  // IPv4 private & special
  { prefix: '10.', family: 4 },
  { prefix: '172.16.', family: 4 }, { prefix: '172.17.', family: 4 },
  { prefix: '172.18.', family: 4 }, { prefix: '172.19.', family: 4 },
  { prefix: '172.20.', family: 4 }, { prefix: '172.21.', family: 4 },
  { prefix: '172.22.', family: 4 }, { prefix: '172.23.', family: 4 },
  { prefix: '172.24.', family: 4 }, { prefix: '172.25.', family: 4 },
  { prefix: '172.26.', family: 4 }, { prefix: '172.27.', family: 4 },
  { prefix: '172.28.', family: 4 }, { prefix: '172.29.', family: 4 },
  { prefix: '172.30.', family: 4 }, { prefix: '172.31.', family: 4 },
  { prefix: '192.168.', family: 4 },
  { prefix: '127.', family: 4 },
  { prefix: '169.254.', family: 4 }, // link-local / cloud metadata
  { prefix: '0.', family: 4 },
];

function isPrivateIPv4(ip: string): boolean {
  return BLOCKED_RANGES.some(r => ip.startsWith(r.prefix));
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80') ||
    lower === '::' ||
    lower.startsWith('::ffff:127.') ||
    lower.startsWith('::ffff:10.') ||
    lower.startsWith('::ffff:192.168.') ||
    lower.startsWith('::ffff:169.254.');
}

function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return false;
}

export async function validateExternalUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http and https URLs are allowed');
  }

  const hostname = parsed.hostname;

  // Block raw IPs directly
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error('URLs pointing to private/internal addresses are not allowed');
    }
    return;
  }

  // Resolve hostname and check all resulting IPs
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve hostname: ${hostname}`);
  }

  for (const addr of addresses) {
    if (isPrivateIP(addr.address)) {
      throw new Error('URLs pointing to private/internal addresses are not allowed');
    }
  }
}
