// Copy for the Workflow section's operational screens (approvals, runs,
// documents, activity, spend). Merged into the platform catalogue by
// src/i18n/catalog.js (see PATCHES.md). Keys use the `workflow.` prefix, which
// nothing else in the catalogue uses; the unrelated run-approvals feature keeps
// its own keys. English only for now; other languages fall back to English.
export const WORKFLOW = {
  en: {
    // States
    'workflow.state.loading': 'Loading',
    'workflow.state.error.title': "Couldn't load this",
    'workflow.state.error.retry': 'Try again',
    'workflow.state.unconfigured.title': 'Workflow is not connected on this server',
    'workflow.state.unconfigured.body':
      'An administrator needs to connect the workflow engine before approvals and runs can show here.',
  },
};
