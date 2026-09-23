// Prints the edge function's files as the JSON array the Supabase MCP deploy tool expects.
// Usage: node scripts/bundle-function.mjs baton > out.json
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const name = process.argv[2] ?? 'baton';
const dir = join(import.meta.dirname, '..', 'supabase', 'functions', name);
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.ts') || f.endsWith('.json'))
  .map((f) => ({ name: f, content: readFileSync(join(dir, f), 'utf8') }));
const out = process.argv[3];
const text = JSON.stringify(files);
if (out) writeFileSync(out, text);
else process.stdout.write(text);
