import { URL } from 'url';
import dns from 'dns/promises';
import net from 'net';

// RFC 1918 + loopback + link-local + metadata
const PRIVATE_V4_PREFIXES = [
  '10.', '127.', '0.', '169.254.', '192.168.',
  ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.`),
];

function isPrivateV4(ip: string) {
  return PRIVATE_V4_PREFIXES.some(p => ip.startsWith(p));
}

function isPrivateV6(ip: string) {
  const l = ip.toLowerCase();
  if (l === '::1' || l === '::') return true;
  if (l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80')) return true;
  // v4-mapped v6: can be dotted (::ffff:127.0.0.1) or hex (::ffff:7f00:1)
  if (l.startsWith('::ffff:')) {
    const mapped = l.slice(7);
    if (net.isIPv4(mapped)) return isPrivateV4(mapped);
    // hex form: convert two 16-bit groups to IPv4
    const parts = mapped.split(':');
    if (parts.length === 2) {
      const hi = parseInt(parts[0], 16);
      const lo = parseInt(parts[1], 16);
      if (!isNaN(hi) && !isNaN(lo)) {
        const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateV4(dotted);
      }
    }
  }
  return false;
}

function isPrivate(ip: string) {
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  if (net.isIPv6(ip)) return isPrivateV6(ip);
  return false;
}

export async function validateExternalUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('invalid URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('only http/https allowed');
  }

  // URL parser keeps brackets on IPv6 literals (e.g. "[::1]"), strip them
  const host = parsed.hostname.replace(/^\[|\]$/g, '');

  if (net.isIP(host)) {
    if (isPrivate(host)) throw new Error('private/internal address');
    return;
  }

  let addrs: { address: string; family: number }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`can't resolve ${host}`);
  }

  for (const a of addrs) {
    if (isPrivate(a.address)) throw new Error('resolves to private/internal address');
  }
}
