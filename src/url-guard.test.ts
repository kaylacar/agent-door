import { describe, it, expect } from 'vitest';
import { validateExternalUrl } from './url-guard';

describe('validateExternalUrl', () => {
  it('rejects non-http protocols', async () => {
    await expect(validateExternalUrl('ftp://example.com')).rejects.toThrow('only http/https');
    await expect(validateExternalUrl('file:///etc/passwd')).rejects.toThrow('only http/https');
  });

  it('rejects garbage', async () => {
    await expect(validateExternalUrl('not a url')).rejects.toThrow('invalid URL');
    await expect(validateExternalUrl('')).rejects.toThrow('invalid URL');
  });

  it('blocks cloud metadata (169.254.x)', async () => {
    await expect(validateExternalUrl('http://169.254.169.254/latest/meta-data/'))
      .rejects.toThrow('private/internal');
  });

  it('blocks loopback', async () => {
    await expect(validateExternalUrl('http://127.0.0.1/')).rejects.toThrow('private/internal');
    await expect(validateExternalUrl('http://127.0.0.1:6379/')).rejects.toThrow('private/internal');
  });

  it('blocks RFC 1918', async () => {
    await expect(validateExternalUrl('http://10.0.0.1/')).rejects.toThrow('private/internal');
    await expect(validateExternalUrl('http://192.168.1.1/')).rejects.toThrow('private/internal');
    await expect(validateExternalUrl('http://172.16.0.1/')).rejects.toThrow('private/internal');
    await expect(validateExternalUrl('http://172.31.255.255/')).rejects.toThrow('private/internal');
  });

  it('blocks 0.0.0.0', async () => {
    await expect(validateExternalUrl('http://0.0.0.0/')).rejects.toThrow('private/internal');
  });

  it('blocks localhost hostname', async () => {
    // resolves to 127.0.0.1 which should be caught
    await expect(validateExternalUrl('http://localhost/')).rejects.toThrow();
  });

  it('blocks IPv6 loopback', async () => {
    await expect(validateExternalUrl('http://[::1]/')).rejects.toThrow('private/internal');
  });

  it('blocks IPv6 link-local', async () => {
    await expect(validateExternalUrl('http://[fe80::1]/')).rejects.toThrow('private/internal');
  });

  it('blocks IPv6 unique-local (fc/fd)', async () => {
    await expect(validateExternalUrl('http://[fc00::1]/')).rejects.toThrow('private/internal');
    await expect(validateExternalUrl('http://[fd12::1]/')).rejects.toThrow('private/internal');
  });

  it('blocks IPv4-mapped IPv6', async () => {
    await expect(validateExternalUrl('http://[::ffff:127.0.0.1]/')).rejects.toThrow('private/internal');
    await expect(validateExternalUrl('http://[::ffff:10.0.0.1]/')).rejects.toThrow('private/internal');
  });

  it('allows valid external IP URLs', async () => {
    // public IPs should pass (no DNS needed)
    await expect(validateExternalUrl('http://8.8.8.8/')).resolves.toBeUndefined();
    await expect(validateExternalUrl('https://1.1.1.1/')).resolves.toBeUndefined();
  });
});
