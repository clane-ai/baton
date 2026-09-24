import { createContext, useContext } from 'react';

/** What the platform shell hands the Workflow section. */
export type SectionShell = {
  /** The `workflow-ops` module is enabled: the Baton-backed screens exist. */
  opsEnabled: boolean;
  /** Go to Home (the command centre, where the inbox lives). Absent in isolation. */
  onHome?: () => void;
};

export const SectionContext = createContext<SectionShell>({ opsEnabled: true });

export function useSectionShell(): SectionShell {
  return useContext(SectionContext);
}
