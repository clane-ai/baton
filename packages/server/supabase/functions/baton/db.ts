// Postgres access for the Baton edge function.
// Uses the connection Supabase injects into every edge function. The function
// itself runs as the service; per-agent visibility is applied by switching to
// the baton_agent role inside a transaction (see asAgent).
import postgres from "npm:postgres@3.4.5";

const url = Deno.env.get("SUPABASE_DB_URL");
if (!url) throw new Error("SUPABASE_DB_URL is not set");

export const sql = postgres(url, {
  prepare: false,
  max: 4,
  idle_timeout: 20,
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
