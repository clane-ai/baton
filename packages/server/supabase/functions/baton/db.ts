// Postgres access for the Baton edge function.
// Uses the connection Supabase injects into every edge function. The function
// itself runs as the service; per-agent visibility is applied by switching to
// the baton_agent role inside a transaction (see asAgent).
import postgres from "npm:postgres@3.4.5";

const direct = Deno.env.get("SUPABASE_DB_URL");
if (!direct) throw new Error("SUPABASE_DB_URL is not set");

// Edge function instances come and go, so they must not hold direct Postgres
// connections: the shared project would run out of slots. Go through the
// Supavisor pooler in transaction mode instead. The pooler host is derived from
// the direct URL (db.<ref>.supabase.co -> <region pooler>, user postgres.<ref>).
function poolerUrl(directUrl: string): string {
  const u = new URL(directUrl);
  const ref = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1];
  if (!ref) return directUrl;
  const region = Deno.env.get("SUPABASE_REGION") ?? "eu-west-1";
  u.hostname = `aws-0-${region}.pooler.supabase.com`;
  u.port = "6543";
  u.username = `${u.username}.${ref}`;
  return u.toString();
}

export const sql = postgres(poolerUrl(direct), {
  prepare: false,          // required in transaction mode
  max: 2,
  idle_timeout: 5,
  max_lifetime: 60 * 5,
  connect_timeout: 10,
});

export type Sql = typeof sql;

/** Run `fn` inside a transaction as the RLS-bound baton_agent role for one agent. */
export async function asAgent<T>(agentId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return await sql.begin(async (tx) => {
    await tx`select set_config('baton.agent_id', ${agentId}, true)`;
    await tx.unsafe("set local role baton_agent");
    return await fn(tx);
  });
}

/** Run `fn` inside a transaction as the service, with the actor recorded for event logging. */
export async function asService<T>(actor: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return await sql.begin(async (tx) => {
    await tx`select set_config('baton.actor', ${actor}, true)`;
    return await fn(tx);
  });
}
