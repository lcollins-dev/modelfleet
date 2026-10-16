import { describe, expect, it } from 'vitest';

import { getServerSocketUrl, isDialable } from '@/server/server-url';

describe('isDialable', () => {
  it('accepts every scheme the socket can use', () => {
    for (const url of ['http://server:3000', 'https://fleet.example.com', 'ws://server', 'wss://server']) {
      expect(isDialable(url)).toBe(true);
    }
  });

  it('rejects a scheme the socket cannot use', () => {
    expect(isDialable('ftp://server:3000')).toBe(false);
  });

  it('rejects an address that is not a URL', () => {
    expect(isDialable('not a url')).toBe(false);
  });

  it('rejects a blank address', () => {
    expect(isDialable('')).toBe(false);
  });
});

describe('getServerSocketUrl', () => {
  it('reads an http address as a plain socket', () => {
    expect(getServerSocketUrl('http://server:3000')).toBe('ws://server:3000/agent');
  });

  it('reads an https address as a secured socket', () => {
    expect(getServerSocketUrl('https://fleet.example.com')).toBe('wss://fleet.example.com/agent');
  });

  it('accepts an address already given as a socket', () => {
    expect(getServerSocketUrl('wss://fleet.example.com')).toBe('wss://fleet.example.com/agent');
  });

  it('replaces whatever path, query and fragment the address carried', () => {
    expect(getServerSocketUrl('http://server:3000/api/v1?token=x#top')).toBe('ws://server:3000/agent');
  });
});
