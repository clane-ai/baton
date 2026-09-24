// Route names of the operator console. Plain module so server components can read it.
export const OPS_VIEWS = ["now", "board", "flow", "attention"] as const;
export type OpsViewName = (typeof OPS_VIEWS)[number];
