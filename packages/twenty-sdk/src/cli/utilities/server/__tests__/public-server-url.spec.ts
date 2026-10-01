import { describe, expect, it } from 'vitest';

import {
  isLoopbackServerUrl,
  resolveServerUrl,
} from '@/cli/utilities/server/public-server-url';

describe('resolveServerUrl', () => {
  it('prefers an explicit public URL from the environment', () => {
    expect(
      resolveServerUrl({
        port: 2020,
        publishedUrl: 'http://localhost:2020',
        env: { SERVER_URL: 'https://crm.example.com' },
      }),
    ).toBe('https://crm.example.com');
  });

  it('trims and drops a trailing slash', () => {
    expect(
      resolveServerUrl({
        port: 2020,
        env: { SERVER_URL: '  https://crm.example.com/  ' },
      }),
    ).toBe('https://crm.example.com');
  });

  it('keeps a public URL an existing container already runs with', () => {
    expect(
      resolveServerUrl({
        port: 2020,
        publishedUrl: 'https://crm.example.com',
        env: {},
      }),
    ).toBe('https://crm.example.com');
  });

  it('falls back to localhost for local development', () => {
    expect(resolveServerUrl({ port: 2020, env: {} })).toBe(
      'http://localhost:2020',
    );
    expect(
      resolveServerUrl({ port: 3000, publishedUrl: null, env: {} }),
    ).toBe('http://localhost:3000');
  });

  it('replaces a loopback URL a container was created with', () => {
    expect(
      resolveServerUrl({
        port: 2020,
        publishedUrl: 'http://localhost:2020',
        env: {},
      }),
    ).toBe('http://localhost:2020');
    expect(
      resolveServerUrl({
        port: 2020,
        publishedUrl: 'http://127.0.0.1:2020',
        env: { SERVER_URL: 'https://crm.example.com' },
      }),
    ).toBe('https://crm.example.com');
  });

  it('ignores values that are not usable URLs', () => {
    expect(
      resolveServerUrl({
        port: 2020,
        publishedUrl: 'not a url',
        env: { SERVER_URL: 'ftp://crm.example.com' },
      }),
    ).toBe('http://localhost:2020');
  });
});

describe('isLoopbackServerUrl', () => {
  it('recognises the addresses only the server machine can reach', () => {
    expect(isLoopbackServerUrl('http://localhost:2020')).toBe(true);
    expect(isLoopbackServerUrl('http://127.0.0.1:2020')).toBe(true);
    expect(isLoopbackServerUrl('http://[::1]:2020')).toBe(true);
  });

  it('treats public hosts and empty values as not loopback', () => {
    expect(isLoopbackServerUrl('https://crm.example.com')).toBe(false);
    expect(isLoopbackServerUrl('http://203.0.113.10:2020')).toBe(false);
    expect(isLoopbackServerUrl(null)).toBe(false);
    expect(isLoopbackServerUrl('')).toBe(false);
  });
});
