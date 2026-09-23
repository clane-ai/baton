// Shapes returned by the operator API (see packages/server/.../admin.ts).

export type TaskState =
  | "draft"
  | "ready"
  | "blocked"
  | "in_progress"
  | "review"
  | "done"
  | "needs_human"
  | "cancelled";

export const TASK_STATES: TaskState[] = [
  "draft",
  "ready",
  "blocked",
  "in_progress",
  "review",
  "done",
  "needs_human",
  "cancelled",
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
  parent_task: string | null;
  waiting_on?: string | null;
  workflow_run?: string | null;
  github_issue: number | string | null;
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
  by_task: { id: string; key: string; title: string; role: string; state: TaskState; cost_usd: number; budget_usd: number | null }[];
  by_role: { role: string; cost_usd: number }[];
  by_day: { day: string; cost_usd: number }[];
};

export type Role = {
  name: string;
  description: string | null;
  default_model: string | null;
  max_concurrent: number | null;
};

export type RolesResponse = { ok: true; roles: Role[] };
