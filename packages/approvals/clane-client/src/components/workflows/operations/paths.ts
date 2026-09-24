// Every link inside the Workflow operational screens goes through here. Paths
// are relative to the section's router basename (SECTION_MOUNT), so where the
// section sits under /app/build/workflows is decided in one place.

/**
 * Mount of the operational screens below the app base. Nested under the
 * existing workflows path and matched before its `<id>` segment (ruling
 * 2026-09-24). The final segment is the gateway agent's call; change it here
 * and nowhere else.
 */
export const SECTION_MOUNT = '/app/build/workflows/operations';

const seg = (s: string): string => encodeURIComponent(s);

export const paths = {
  approvals: (): string => '/',
  item: (key: string): string => `/items/${seg(key)}`,
  runs: (): string => '/runs',
  run: (key: string): string => `/runs/${seg(key)}`,
  documents: (): string => '/documents',
  activity: (): string => '/activity',
  spend: (): string => '/spend',
};
