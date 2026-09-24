# Baton app: M1 design proposal

Author: clane-baton-f6 (UI and UX owner). For sign-off by the user before any build. Engine asks go to
clane-baton-ba. Written 24 September 2026 against `docs/ui-brief.md`, the two reference screenshots, and
the dashboard at commit b3292fa.

## 0. What this is for

A person who owns a business process (purchasing manager, AP lead, release manager) opens Baton to see what
is waiting for them, decide it with the evidence in front of them, and see where every run of the process
stands. Agents do the work; the person supplies judgement and takes responsibility. The app must make that
judgement fast and defensible: the source documents and the extracted result side by side, the policy
reasoning visible, the decision recorded with a reason, and every step's history one click away.

Success for M2: an approver decides a purchase order in under a minute without leaving the item screen, a
process owner finds any run's state and cost in two clicks, and an operator still has the console they
have today. Everything on screen comes from the operator API and the workspace; nothing is faked.

## 1. Information architecture

### Screens

| Screen | Route | Answers | Primary object |
|---|---|---|---|
| Inbox | `/inbox` | What needs a person now? | queue item (approval, parked step, question) |
| Item | `/inbox/[key]` | Should I approve this, and why? | one task with its documents, artefact, history |
| Runs | `/runs` | Where does every instance of the process stand? | workflow run |
| Run | `/runs/[key]` | What happened in this one, step by step? | run with steps, graph, artefacts, cost |
| Documents | `/documents` | Find a purchase order, receipt, invoice, match, review | artefact |
| Activity | `/activity` | What did the system do, when, by whom? | event |
| Spend | `/spend` | What is this costing? | run and task cost |
| Operations | `/ops/now`, `/ops/board`, `/ops/flow`, `/ops/attention` | The console the operator has today | agents, tasks |

### Navigation

A fixed left rail, as in the reference, replaces the tab strip. Two groups:

```
Baton                      ┌───────────────────────────────────────────────┐
                           │  Inbox                                    ⟳   │
Work                       │  ┌─────────┐┌─────────┐┌─────────┐┌────────┐ │
  Inbox            (3)     │  │ 3       ││ 1       ││ 0       ││ 2      │ │
  Runs                     │  │ waiting ││ parked  ││questions││running │ │
  Documents                │  │ €10,038 ││         ││         ││        │ │
  Activity                 │  └─────────┘└─────────┘└─────────┘└────────┘ │
  Spend                    │  [search…] [Process ▾] [Step ▾] [Age ▾]      │
                           │  ─────────────────────────────────────────── │
Operations                 │  ROW  ROW  ROW …                             │
  Now                      └───────────────────────────────────────────────┘
  Board
  Flow
  Attention
```

- Inbox carries a live count of items waiting for a person. It is the landing page.
- Runs, Documents, Activity, Spend are the process owner's views.
- Operations holds today's console, unchanged in behaviour, moved under real routes. Stream becomes
  Activity (renamed, widened to all events with filters). Attention stays under Operations until Inbox has
  proven it covers every needs_human case, then retires (M3 decision, not M2).
- Real routes, not hash tabs: an approval has a URL a colleague can be sent.

### How a person moves

1. Land on Inbox, see counts and the list, click a row: Item.
2. Decide. The item leaves the list; the next item is offered ("Next waiting: TSK-0947 PO-2026-121").
3. From an Item, the run key opens the Run: the step just decided, what ran before, what runs next.
4. From a Run, any step opens its Item view (read-only when nothing is to decide), any artefact opens in
   Documents.
5. Activity is reachable from everywhere as a tab on the Item and the Run, and as its own screen.

### What survives from today

| Today | Becomes |
|---|---|
| Inbox (sketch) | Inbox + Item, redesigned; API path kept |
| Runs + RunGraph | Runs + Run; graph kept, given a step list and artefacts beside it |
| Stream | Activity |
| Spend | Spend, run-grouped |
| Now, Board, Flow, Attention | Operations, as they are |
| TaskDetail (modal) | folded into Item (read-only mode) |

## 2. The item screen

The screen an approver lives on. It follows the reference's shape: sources left, result right, decision
at the bottom, history as a tab.

```
┌ ← Inbox   TSK-0947   ● waiting for you   run p2p-121   Next: supplier ERP sends the PO once approved ┐
│ Purchase order PO-2026-121 · Nordlicht Computing GmbH · 5,520.00 EUR · raised by buyer 4 min ago     │
├──────────────────────────────────┬───────────────────────────────────────────────────────────────────┤
│ Sources                          │ Purchase order   Policy   Activity                                │
│ [Email 1] [Requisition PDF]      │ ┌───────────────────────────────────────────────────────────────┐ │
│ [Text]                           │ │ Ready to approve: manager level, vendor approved, catalogue   │ │
│                                  │ │ prices, 5,520.00 EUR of your 10,000 authority.                │ │
│ ┌──────────────────────────────┐ │ └───────────────────────────────────────────────────────────────┘ │
│ │ From: Maeve Doyle            │ │ Order                                                             │
│ │ Subject: Requisition         │ │  PO number       PO-2026-121      Requisition   PR-2026-101       │
│ │ PR-2026-101 for Engineering  │ │  Vendor          Nordlicht Computing GmbH (V-1001)   source ●     │
│ │                              │ │  Cost centre     CC-410           Needed by     2026-10-09        │
│ │ Hi purchasing, please raise  │ │  Deliver to      Goods-in, Unit 4, Northwest Business Park       │
│ │ a PO for the attached …      │ │ Lines                                                             │
│ │                              │ │  #  SKU      Item                     Qty   Unit     Total        │
│ │ 📎 PR-2026-101.pdf           │ │  1  NL-LT14  Nordlicht Pro 14 laptop   4  1,200.00  4,800.00     │
│ └──────────────────────────────┘ │  2  NL-DOCK  USB-C docking station     4    180.00    720.00     │
│                                  │                                     Total        5,520.00 EUR     │
│                                  │ Policy check                                                      │
│                                  │  Approval required · manager · vendor approved · within budget    │
│                                  │  "Total 5,520.00 EUR falls in the 2,000.01-10,000 band …"          │
├──────────────────────────────────┴───────────────────────────────────────────────────────────────────┤
│ Reason (required to reject) [______________________________________]   [Save draft] [Reject] [Approve]│
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Header

Key, state, run, and the one line that tells the approver what happens next (derived from the run's
step graph: the step that depends on this one, or the gateway outcomes). A summary line built from the
artefact: document number, counterparty, amount, who produced it and when.

### Left: sources

Every document the step's inputs point at, as tabs: emails (headers and text, attachments listed),
PDFs (inline viewer), text extracts and count sheets. Open in a new tab, download. The active source is
remembered per item. When the engine adds provenance, clicking a field on the right highlights its
source tab and, for text, scrolls to the span.

### Right: the artefact as a business document

One renderer per artefact kind (purchase order, goods receipt, invoice, delivery note, three-way match,
payment, review, handoff; generic key/value for the rest). Fields are shown as labelled read-only
values in the reference's two-column form rhythm, lines as a table with totals. Each field has a place
for a source marker and a confidence figure, rendered as soon as the artefact carries `_provenance`;
until then the marker is absent, not faked.

Above the document, a summary card: what the policy check concluded and whether anything blocks
approval (vendor not approved, level above authority, price differences noted). It is built from the
artefact's own `policy_check`, in plain words, and colours only when something is wrong.

Tabs on the right: the artefact; Policy (the full policy notes and the step's spec, for the sceptical
approver); Activity (this task's events and claims, plus the upstream steps' key events, newest first,
with the agent name and cost per session).

### Decision area

Fixed to the bottom of the right column. Reason field; Reject needs a reason; Approve does not, but
records one if given. Save draft keeps the reason locally (browser) so a half-written rejection
survives a refresh; the draft is marked as such and never sent. After a decision the area shows what
happened ("Approved. Supplier ERP step is ready.") and offers the next waiting item.

For a parked step the area becomes Retry: attempts and budget so far, optional new budget and deadline,
reason. For a question from an agent it becomes Answer: the question in full, a reply field. For a
decided or finished task it shows who decided, when, and the reason.

## 3. Visual direction (revised 24 September 2026 after sign-off)

The user chose a monday.com-style theme: the product language, not the brand assets. No logo, names or
icons are copied.

**Feel.** A clean white workspace on a light grey canvas, rounded corners (8 px on panels, 6 px on
controls, pills fully rounded), generous whitespace, subtle shadows instead of rules to separate
surfaces, and colour used as information: status pills and column chips in a saturated palette.

**Type.** Figtree for everything on screen (geometric, friendly, variable weight, via `next/font`,
self-hosted). IBM Plex Mono stays for keys, document numbers and money columns so tables align.
Base 14 px, 1.5 line height; headings 16 and 20 px semibold; row height 40 px.

**Colour.** Canvas `#f6f7fb`, surface `#ffffff`, border `#e6e9ef`, ink `#323338`, secondary ink
`#676879`. Primary action and active nav: purple-blue `#6161ff`, hover `#5151d5`, soft `#eeeeff`.
Status palette: done green `#00c875`, working orange `#fdab3d`, stuck red `#e2445c`, waiting purple
`#a25ddc`, info blue `#579bfc`, neutral grey `#c4c4c4`, each with a pale tint for chips. Task states map
to it once, in one place: done → green, in_progress/review → orange, needs_human → purple, failed →
red, blocked → orange tint, ready/draft → blue tint, cancelled → grey.

**Shape.** Board-like rows: each queue group (Approvals, Parked, Questions) has a coloured left stripe
and a group header with a count; rows are 40 px, hover lifts to the surface tint; column chips
(policy flags, states) are filled pills with white text. The left rail has an icon per entry, the
active entry is filled with the soft accent. Stat tiles are white with a soft shadow, the number in
the accent when it needs attention. The item screen keeps the sources-left, document-right layout;
the decision bar is a white surface with a shadow above it and the primary button in the accent.

**Density.** Slightly more open than the first proposal: 16 queue rows visible at 1440 px, the whole
purchase order and its email visible at 1080 px tall. Minimum width 1200 px; below that the item
screen stacks. No phone layout in M2.

**Motion.** None on load. A decided row leaves the queue with a short fade and the next item slides in.

**Component library: decision, unchanged.** No external UI library. `lucide-react` for icons and the
two families via `next/font`. PDFs in the browser's viewer in an iframe.

## 4. What the engine must add

Numbered so we can refer to them. Each is the smallest thing the design needs.

1. **`GET /admin/inbox`**: one row per item waiting for a person (operator tasks in needs_human, parked
   tasks in needs_human or failed, unanswered questions to a human), each with a server-built summary:
   `{key, kind: approval|parked|question, workflow_run, workflow_name, step_label, role, waiting_since,
   deadline, summary: {document_number, counterparty, amount, currency, flags: [vendor_not_approved,
   above_authority, price_difference, short_delivery, ...]}, next_step_label}`. Why: the queue needs
   amount, counterparty and flags per row without one task-detail call per row, and the summary logic
   (which artefact field is the counterparty for a goods receipt) belongs with the schemas, not the UI.
   Also totals for the stat tiles (count and amount per kind).
2. **`GET /admin/events?workflow_run=`** (new filter) and `?task_in=` (several keys). Why: the Run
   activity tab and the Item activity tab (upstream steps) need one call, not one per step.
3. **`GET /admin/tasks?q=&state=a,b&offset=&limit=`** with a `total` in the response. Why: the Documents
   and Runs screens need search and paging; today `state` takes one value and there is no count.
4. **`GET /admin/workflow-runs/:key`** to include, per step, `next: [{key, label, when}]` from the
   compiled graph and gateway outcome labels from the manifest. Why: the "Next:" line on the item
   header and the branch labels on the run graph; the UI can compute it from the manifest today, but
   the engine already has the graph and the mapping should not be duplicated.
5. **Documents per task**: either `documents: [{label, path, type, role: source|produced}]` on the
   artefact (set by the integrations and role prompts) or `GET /admin/tasks/:key/documents` resolved
   server-side from the workspace conventions. Why: today the UI guesses paths from artefact fields
   (`documentsOf` in ArtefactView.tsx); a new workflow with different folders would show nothing.
6. **`_provenance`** on artefacts when extraction supports it: `{field_path: {source: {document,
   page?, span?}, confidence}}`. Why: the source marker and confidence beside each field, as in the
   reference. The UI renders it the day it appears; nothing is faked before.
7. **Decision record on the task**: `GET /admin/tasks/:key` to return `decision: {verdict, by, at, reason}`
   for operator tasks (from the review artefact and the approved/rejected event). Why: the decided
   state of the item screen and the Runs list without parsing events client-side.
8. **`POST /admin/answer`** to accept `task_key` as well as `message_id`, and `GET /admin/tasks/:key`
   to include unanswered questions. Why: answering from the item screen.

Not asked for: drafts (UI-local), authority enforcement, AutoPilot, escalation, editing artefact
fields (that would be an `artifact_amend` endpoint and a re-run of the gate; listed under "left out").

## 5. Left out

**M1 (this proposal)**: no code. Mock-ups of Inbox, Item and Run follow as static HTML with real data
from p2p-121 for review; they are design artefacts, not the build.

**M2 (build and UAT ready)** delivers: the rail and routes; Inbox with tiles, filters, search, grouping
by run; Item with sources, artefact renderers for the eight P2P and review kinds, policy summary,
activity tab, decisions (approve, reject, retry, answer), local drafts, next-item flow; Runs list and
Run view with the graph, step list, artefacts and cost; Documents with search by kind, number and run;
Activity with filters; Spend by run and role; Operations screens moved under `/ops` unchanged;
keyboard: `j`/`k` in lists, `a`/`r` on an item with confirmation; empty and error states with the
next action; a UAT script over p2p-101 to p2p-122.

**Not in M2, listed so it is not out by accident**: editing artefact fields before approval; server-side
drafts; approver authority and per-user identity; AutoPilot; escalation and reassignment; email or
chat notifications; per-field provenance until the engine has it (the slot is built); phone layout;
dark theme; multi-language; export to CSV or PDF; retiring Attention and TaskDetail; any change to
engine code, schemas or SQL.

## 6. Fixtures and progress

**Fixtures**: runs p2p-101 to p2p-108 (first batch), p2p-114 to p2p-116 (blind reruns), p2p-121 and
p2p-122 (this morning's, one approved by the user), plus release-1, release-2 and locale-greetings-1 to
prove the generic renderers on non-P2P kinds. Workspace: `scratchpad\p2p-run` via `BATON_WORKSPACE`.
No seeded or invented data.

**Progress**: mock-ups as static HTML under `docs/design/mockups/`, published as private artifacts with a
link for the user (I can publish them myself); build progress as a weekly status note under
`docs/status/YYYY-MM-DD.md` with what shipped, what is blocked on an engine ask, and what is next; each
screen demonstrated on the dev server against the fixtures before it is called done. Commits to
`packages/dash` and `docs` only.

## 7. Sign-off

Signed off 24 September 2026 by the user ("its fine use monday.com theme and start building"): IA,
item layout and engine asks as proposed; visual direction as revised in section 3. The engine owner
ships asks in the order 1, 5, 7, 2, 3, 4, 8, then 6.

Original questions, kept for the record:

Please answer: (a) is the information architecture right, in particular Inbox as the landing page and
the operator console under Operations; (b) is the item layout right, sources left and document right;
(c) accept the visual direction and the no-library decision; (d) which of the engine asks 1 to 8 the
engine owner can add for M2 (1, 2 and 5 are the ones the build depends on; 3, 4, 7, 8 improve it; 6 waits
for extraction). Changes requested here become the M1 revision; sign-off starts M2.
