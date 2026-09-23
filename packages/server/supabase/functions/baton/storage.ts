// Supabase Storage access for artefact blobs. The bucket is private; agents get
// short-lived signed URLs from artifact_get (prd.md 14).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "artifacts";
const PREFIX = `storage://${BUCKET}/`;

function headers(extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${KEY}`, apikey: KEY, ...extra };
}

export async function uploadArtifact(path: string, body: string, contentType: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: headers({ "content-type": contentType, "x-upsert": "true" }),
    body,
  });
  if (!r.ok) throw new Error(`storage upload failed: ${r.status} ${await r.text()}`);
  return PREFIX + path;
}

export async function signArtifact(uri: string, expiresIn = 600): Promise<string | null> {
  if (!uri.startsWith(PREFIX)) return null;
  const path = uri.slice(PREFIX.length);
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ expiresIn }),
  });
  if (!r.ok) return null;
  const { signedURL } = await r.json();
  return `${SUPABASE_URL}/storage/v1${signedURL}`;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
