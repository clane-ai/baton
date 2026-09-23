// HTTP client for the Baton service.
export class Api {
  constructor(baseUrl, token) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  async request(method, path, body, { timeoutMs = 20000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(`${this.base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await r.text();
      let json;
      try { json = text ? JSON.parse(text) : {}; } catch { json = { ok: false, error: { code: 'BAD_RESPONSE', message: text.slice(0, 200) } }; }
      return { status: r.status, body: json };
    } finally {
      clearTimeout(timer);
    }
  }

  get(path, opts) { return this.request('GET', path, undefined, opts); }
  post(path, body, opts) { return this.request('POST', path, body ?? {}, opts); }
  del(path, opts) { return this.request('DELETE', path, undefined, opts); }

  /** Call an MCP tool directly (JSON-RPC over the /mcp face). Needs an agent token. */
  async tool(name, args = {}) {
    const { status, body } = await this.request('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    if (status !== 200) return { ok: false, error: body?.error ?? { code: 'HTTP_' + status, message: 'request failed' } };
    return body?.result?.structuredContent ?? { ok: false, error: { code: 'BAD_RESPONSE', message: JSON.stringify(body).slice(0, 200) } };
  }
}

export function must(res, what = 'request') {
  if (res.status >= 400 || res.body?.ok === false) {
    const e = res.body?.error ?? {};
    throw new Error(`${what} failed (${res.status}): ${e.code ?? ''} ${e.message ?? JSON.stringify(res.body)}`.trim());
  }
  return res.body;
}
