// Every link inside the Workflow section goes through here. Paths are
// relative to the section's router basename (SECTION_MOUNT).

/**
 * Workflow is a top-level section of the main client (a sibling of Build,
 * Settings and Admin; ruling 2026-09-24). The main client's spaRoute owns
 * `/app/workflow/<section>/<sub>`; this section's own router owns the rest.
 */
export const SECTION_MOUNT = '/app/workflow';

const seg = (s: string): string => encodeURIComponent(s);

export const paths = {
  runs: (): string => '/runs',
  run: (key: string): string => `/runs/${seg(key)}`,
  item: (key: string): string => `/items/${seg(key)}`,
  documents: (): string => '/documents',
  activity: (): string => '/activity',
  spend: (): string => '/spend',
  definitions: (): string => '/definitions',
};
