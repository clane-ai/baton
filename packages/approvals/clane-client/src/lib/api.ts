// STAGING STUB — not copied to the platform. Mirrors the contract of clane-client/src/lib/api.ts
// (authenticated fetch wrapper: bearer from the auth store, one refresh on 401, base from lib/base).
// Specs replace `api` with vi.mock('../../lib/api'); outside specs every call rejects with 404.

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, _init: { method: string; body?: string | FormData }): Promise<T> {
  throw new ApiError(404, { ok: false, error: { code: "NOT_FOUND", message: `stub: no handler for ${path}` } });
}

export async function refreshToken(): Promise<string | null> {
  return null;
}

/** Bearer for raw fetches (document streams). The platform's auth store holds the real one. */
export function authHeaders(): Record<string, string> {
  return {};
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
