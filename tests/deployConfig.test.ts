import { describe, expect, it } from 'vitest';
import headersText from '../public/_headers?raw';
import indexHtml from '../index.html?raw';
import faviconSvg from '../public/favicon.svg?raw';

/** Parses a Cloudflare Pages _headers file into path -> header map. */
function parseHeaders(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      rules.set(line.trim(), current);
    } else if (current) {
      const idx = line.indexOf(':');
      current.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim());
    }
  }
  return rules;
}

describe('public/_headers', () => {
  const rules = parseHeaders(headersText);

  it('serves hashed assets as immutable', () => {
    const cc = rules.get('/assets/*')?.get('cache-control') ?? '';
    expect(cc).toContain('immutable');
    expect(cc).toContain('max-age=31536000');
  });

  it('revalidates the entry page', () => {
    expect(rules.get('/')?.get('cache-control')).toBe('no-cache');
    expect(rules.get('/index.html')?.get('cache-control')).toBe('no-cache');
  });

  it('sets a CSP without unsafe-eval and with script-src self', () => {
    const csp = rules.get('/*')?.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('sets basic security headers', () => {
    const all = rules.get('/*');
    expect(all?.get('x-content-type-options')).toBe('nosniff');
    expect(all?.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});

describe('index.html', () => {
  it('references the favicon, which exists in public/', () => {
    expect(indexHtml).toContain('href="/favicon.svg"');
    expect(faviconSvg).toContain('<svg');
  });
});
