// STAGING STUB — not copied to the platform. Same contract as clane-client/src/lib/base.ts.

export function appBase(): string {
  if (typeof window === "undefined") return "";
  return (window as unknown as { __CLANE_BASE__?: string }).__CLANE_BASE__ || "";
}

export function withBase(path: string): string {
  if (!path.startsWith("/")) throw new Error(`withBase: path must start with '/', got ${JSON.stringify(path)}`);
  return `${appBase()}${path}`;
}
