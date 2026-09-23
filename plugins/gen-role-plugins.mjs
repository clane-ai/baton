// Generates plugins/baton-role-<role>/ from packages/cli/roles/<role>.md.
// The role file is the single source; the plugin copy adds the baton-protocol skill line.
// Usage: node plugins/gen-role-plugins.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rolesDir = join(here, '..', 'packages', 'cli', 'roles');
const coreVersion = JSON.parse(readFileSync(join(here, 'baton-core', '.claude-plugin', 'plugin.json'), 'utf8')).version;
const major = coreVersion.split('.')[0];

for (const file of readdirSync(rolesDir).filter((f) => f.endsWith('.md'))) {
  const role = file.replace(/\.md$/, '');
  const src = readFileSync(join(rolesDir, file), 'utf8');
  const withSkill = src.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, (m, fm, end) => (/^skills:/m.test(fm) ? m : `${fm}\nskills: baton-protocol${end}`));
  const dir = join(here, `baton-role-${role}`);
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  mkdirSync(join(dir, 'agents'), { recursive: true });
  const desc = (src.match(/^description:\s*(.*)$/m) ?? [, `Baton ${role} role`])[1];
  const manifestPath = join(dir, '.claude-plugin', 'plugin.json');
  let version = '0.1.0';
  try { version = JSON.parse(readFileSync(manifestPath, 'utf8')).version ?? version; } catch { /* first generation */ }
  writeFileSync(manifestPath, JSON.stringify({
    name: `baton-role-${role}`,
    displayName: `Baton role: ${role}`,
    version,
    description: `${desc} Enabling this plugin runs the session as the Baton ${role} agent.`,
    author: { name: 'Clane AI' },
    keywords: ['baton', 'role', role],
    dependencies: [{ name: 'baton-core', version: `^${major === '0' ? coreVersion : major + '.0.0'}` }],
  }, null, 2) + '\n');
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ agent: role }, null, 2) + '\n');
  writeFileSync(join(dir, 'agents', `${role}.md`), withSkill);
  writeFileSync(join(dir, 'README.md'), `# baton-role-${role}\n\nEnabling this plugin makes this machine's Claude Code the Baton **${role}** agent: its \`settings.json\` activates the \`${role}\` agent as the main thread, with that agent's tools, model and instructions. It depends on \`baton-core\` for the MCP server, the gates and the protocol skill.\n\nInstall: \`/plugin install baton-role-${role}@clane-ai\`. Regenerated from \`packages/cli/roles/${role}.md\` by \`node plugins/gen-role-plugins.mjs\`; edit the role there.\n`);
  console.log(`wrote plugins/baton-role-${role}`);
}
