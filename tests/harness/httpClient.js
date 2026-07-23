'use strict';
/**
 * httpClient.js — a cookie-carrying HTTP client for the harness.
 *
 * Real HTTP over a real socket to the real server. The only thing this adds over bare fetch
 * is a cookie jar, because the app authenticates with a session cookie backed by Postgres
 * (server.js:279) and every authenticated figure check needs to carry it.
 *
 * Deliberately NOT a wrapper that hides failures: non-2xx responses are RETURNED with their
 * status and body, never thrown away or coerced to a default. A figure check that silently
 * read `{}` from a 500 and reported 0 would be the F31 bug wearing a test's clothes.
 */

class HarnessHttp {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.cookies = new Map();
  }

  _cookieHeader() {
    if (!this.cookies.size) return null;
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  _absorb(res) {
    const setCookie = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const raw of setCookie) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  async request(method, urlPath, body) {
    const headers = {};
    // The API is JSON-only and rejects other content types on mutations (server.js:326).
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = this._cookieHeader();
    if (cookie) headers.Cookie = cookie;

    const res = await fetch(this.baseUrl + urlPath, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    this._absorb(res);

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }

    return { status: res.status, ok: res.ok, json, text, headers: res.headers };
  }

  get(p) { return this.request('GET', p); }
  post(p, b) { return this.request('POST', p, b === undefined ? {} : b); }
  put(p, b) { return this.request('PUT', p, b === undefined ? {} : b); }
  del(p) { return this.request('DELETE', p); }
}

module.exports = { HarnessHttp };
