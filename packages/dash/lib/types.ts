// Shapes returned by the operator API (see packages/server/.../admin.ts).

export type TaskState =
  | "draft"
  | "ready"
  | "blocked"
  | "in_progress"
  | "review"
  | "done"
  | "needs_human"
  | "cancelled"
  | "failed";

export const TASK_STATES: TaskState[] = [
  "draft",
  "ready",
  "blocked",
  "in_progress",
  "review",
  "done",
  "needs_human",
  "cancelled",
  "failed",
];

export type ApiError = { code: string; message: string; retryable?: boolean };
export type Fail = { ok: false; error: ApiError };

export type AgentCurrentTask = {
  id: string;
  key: string;
  title: string;
  state: TaskState;
  lease_until: string | null;
};

export type Agent = {
  id: string;
  name: string;
  role: string;
  machine: string | null;
  status: string;
  revoked?: boolean;
  last_seen: string | null;
  current_task: AgentCurrentTask | null;
};

export type Question = {
  id: string;
  body: string;
  from: string | null;
  to_role: string | null;
  created_at: string;
};

export type LastEvent = { type: string; payload: unknown; ts: string };

export type AttentionItem = {
  id: string;
  key: string;
  title: string;
  role: string;
  state: TaskState;
  attempts: number;
  cost_usd: number | null;
  budget_usd: number | null;
  updated_at: string;
  question: Question | null;
  last_event: LastEvent | null;
};

export type StatusResponse = {
  ok: true;
  agents: Agent[];
  counts: Partial<Record<TaskState, number>>;
  attention: AttentionItem[];
};

export type Task = {
  id: string;
  key: string;
  title: string;
  spec: string | null;
  acceptance: string | null;
  role: string;
  state: TaskState;
  priority: number;
  depends_on: string[];
  consumes: { kind: string; from_task: string | null }[];
  produces: { kind: string }[];
  scope: string[];
  assignee: string | null;
  assignee_name?: string | null;
  lease_until: string | null;
  attempts: number;
  max_attempts: number;
  budget_usd: number | null;
  cost_usd: number | null;
  cost_credits?: number;
  parent_task: string | null;
  waiting_on?: string | null;
  workflow_run?: string | null;
  github_issue: number | string | null;
  deadline?: string | null;
  created_at: string;
  updated_at: string;
};

export type TasksResponse = { ok: true; tasks: Task[] };

export type TaskRef = { id: string; key: string; title: string; state: TaskState };

export type Artifact = {
  id: string;
  kind: string;
  uri: string | null;
  sha256: string | null;
  schema_version: string | null;
  meta: unknown;
  content: unknown;
  created_at: string;
};

export type Claim = {
  id: number | string;
  agent: string | null;
  claimed_at: string;
  released_at: string | null;
  outcome: string | null;
  reason: string | null;
};

export type Message = {
  id: string;
  kind: string;
  body: string;
  from_name: string | null;
  to_role: string | null;
  in_reply_to: string | null;
  created_at: string;
  answered_at: string | null;
};

export type TaskEvent = {
  id: number | string;
  ts: string;
  type: string;
  payload: unknown;
  session_id: string | null;
  agent: string | null;
};

export type TaskDetailResponse = {
  ok: true;
  task: Task;
  assignee_name: string | null;
  depends_on: TaskRef[];
  dependents: TaskRef[];
  children: TaskRef[];
  artifacts: Artifact[];
  consumed: Artifact[];
  claims: Claim[];
  messages: Message[];
  events: TaskEvent[];
  decision?: Decision | null;
  questions?: Message[];
  documents?: DocumentRef[];
};

export type StreamEvent = {
  id: number | string;
  ts: string;
  type: string;
  payload: unknown;
  session_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  agent: string | null;
  task_key: string | null;
};

export type EventsResponse = { ok: true; events: StreamEvent[] };

export type SpendResponse = {
  ok: true;
  total_usd: number;
  total_credits?: number;
  by_task: { id: string; key: string; title: string; role: string; state: TaskState; cost_usd: number; cost_credits?: number; budget_usd: number | null }[];
  by_role: { role: string; cost_usd: number; credits?: number }[];
  by_day: { day: string; cost_usd: number; credits?: number }[];
};

export type Role = {
  name: string;
  description: string | null;
  default_model: string | null;
  max_concurrent: number | null;
};

export type RolesResponse = { ok: true; roles: Role[] };

export type StepCondition = { task: string; kind: string; field: string; equals: string; outcome?: string; gateway?: string };
export type WorkflowRunStep = { id: string; key: string; title: string; role: string; state: TaskState; attempts: number; cost_usd: number; cost_credits: number; depends_on: string[]; assignee: string | null; updated_at: string; produces: { kind: string }[]; condition?: StepCondition | null };
export type WorkflowRun = { key: string; workflow_key: string | null; workflow_name: string | null; input: string | null; created_by: string; created_at: string; finished_at: string | null; status: string; counts: Record<string, number>; cost_usd: number; cost_credits: number; steps?: WorkflowRunStep[] };
export type WorkflowRunsResponse = { ok: true; runs: WorkflowRun[] };
export type WorkflowRunResponse = { ok: true; run: WorkflowRun };

// ---- engine shapes added for the app (engine owner message, 24 Sep 2026) ----

export type InboxKind = "approval" | "parked" | "question";
export type InboxSummary = {
  document: string | null;
  counterparty: string | null;
  amount: number | null;
  currency: string | null;
  flags: string[];
  notes?: string[];
  kind?: string | null;
  produced_by: string | null;
  produced_at: string | null;
};
export type InboxNext = { key: string; title: string; when: string | null };
export type InboxQuestion = { id: string; body: string; from: string | null; created_at: string };
export type InboxItem = {
  id: string;
  key: string;
  kind: InboxKind;
  state: TaskState;
  role: string;
  title: string;
  workflow_run: string | null;
  run_name: string | null;
  waiting_since: string;
  deadline: string | null;
  overdue: boolean;
  summary: InboxSummary | null;
  next: InboxNext[];
  question?: InboxQuestion | null;
  last_failure?: { type: string; ts: string; payload: unknown } | null;
  assignee?: string | null;
  attempts: number;
  max_attempts: number;
  cost_usd: number | null;
  budget_usd: number | null;
};
export type InboxTiles = { approvals: number; parked: number; questions: number; overdue: number; total?: number };
export type InboxResponse = { ok: true; tiles: InboxTiles; items: InboxItem[]; fallback?: boolean; upstream_status?: number; upstream_error?: string | null };

export type DocumentRef = { label: string; path: string; type: "pdf" | "text" | "email" | "data"; from: "artefact" | "convention"; kind: string | null };
export type DocumentsResponse = { ok: true; documents: DocumentRef[]; fallback?: boolean };

export type Decision = { verdict: "approve" | "request_changes"; by: string; at: string; reason: string | null };
export type Provenance = Record<string, { source: string; confidence?: number | null; page?: number | null; note?: string | null }>;
