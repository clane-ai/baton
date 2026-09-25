# The user never sees a workflow

**Asked by the user, 25 September 2026**, by handing me two screenshots of another product and saying the
workflow has to be like this for the user. Think again.

I did, and the correction is real. It is not a visual one.

## What the two screens actually show

Read from the images, with inference marked as inference.

**The first is a work queue, and its unit is a customer, not a run.** Tabs across the top are All
Customers, Orders and All Emails, each with a count. Under them four tiles: total orders with a money
value, booked orders with a money value, pending orders with a money value, and **with issues** as a bare
count. The table's rows are customers. Each row carries the latest email that triggered work, the date,
the subject, an AI classification chip, a count of all orders, and counts split across **New** and **In
Review** — then a single **Next Action** button. In the header, an **AutoPilot** toggle.

**The second is the review screen, and its unit is a document.** Left: the evidence — the email thread as
it arrived, the sender, the time, and the attached PDF. Right: the same content as a structured business
record, field by field, with a **source** marker against fields that have one. Above it a one-line
summary in business language — master data matched, no blocking discrepancies, ready for posting — a
**97%** confidence score, a status, and separately **Sync: Pending**. A sentence saying what happens
next, in business terms, naming the downstream system. Tabs for the record, the emails and the activity
log. Two buttons: Save Draft and Approve.

## The correction

**Their interface is organised around the business object and its lifecycle. Ours is organised around the
engine's state machine.** Everything below follows from that inversion, and it is the whole of the note.

A person using that product never learns that a graph exists, never sees a node, never sees a task, and
never sees a run. They see purchase orders and sales orders in the states a purchasing clerk already has
words for. The automation is present only as a confidence score, a summary sentence, and a toggle that
decides whether they are asked at all.

We have been building the other product: definitions, runs, a board of triage lanes, a queue of tasks.
That is not wrong — it is the **builder's** product, and somebody needs it — but it is not what we would
put in front of a purchasing clerk, and until now we had only one of the two.

## What this validates, which is more than I expected

The substrate for the second screen already exists, and in both trees.

The artefacts our agents produce already carry `_provenance` per field — source, page, confidence and a
note — and a list of the documents each step read. That is exactly the source marker and the per-field
confidence in the right-hand pane. **The approver's screen in Clane already renders it**: source
documents on the left, the artefact as a business document on the right, with per-field source and
confidence, a policy tab and an activity tab. So the review screen is not a rewrite. It is closer than
the queue is.

The typed artefact kinds are the other half. A kind's schema already says what fields a document has;
that schema is the form.

## What is genuinely missing

**The landing screen shows engine states.** Five triage lanes over task states, with a count per lane.
Theirs shows business states — new, in review, with issues — and money. A clerk asks what is waiting and
what it is worth. Neither question is answerable from a lane count.

**The rail names our machinery instead of their work.** Theirs reads Sales Order, Purchase Orders,
Inbound Logistics, Invoices and Claims, and under Sales Order sit three named processes. Ours reads
Definitions, Runs, Board, Inbox, Documents, Activity, Spend. The correction is one rail entry per
deployed process, named in the customer's words, with definitions and runs moved where administration
lives.

**There is no AutoPilot**, and it is not a UI toggle. It is the decision to skip the human step when
confidence is high and the policy check is clean — a condition on a gate, evaluated against the
artefact. The interface is the easy half.

**Nothing says what happens next in business terms.** "Review and approve to post to the ERP" is derived
from the graph, and it is the only place the graph should ever surface to this person: as a sentence.

**Posting is a second axis and we do not model it.** Their record is approved *and* Sync: Pending. Ours
collapses that into one state. Approval is a decision; posting to a downstream system is an outcome that
can fail on its own and be retried on its own.

**A record-level score.** We render confidence per field. They show one number for the document. The
composition rule is a product decision — lowest field, weighted, or the extractor's own — and somebody
has to choose it rather than average by default.

## The consequence for storage, which is where this gets expensive

A queue screen filters, sorts and **sums** over business fields: this customer, that date range, the
total of the orders. Our artefacts are jsonb keyed by task and kind, with an index on kind and on task.
Listing every purchase order for one customer, newest first, with a sum of their totals, is a scan. The
screenshot's four tiles are four aggregates over a filtered set, computed on every page load.

So the kind registry has one more job than the two it already had. A kind already defines validation, and
I argued yesterday that it defines the form. It must also declare **which fields are header fields** —
the ones a queue shows as columns, filters on, sorts by and totals. Those are the fields worth projecting
out of the jsonb and indexing. Declare them once, and the schema yields the form, the queue columns and
the indexes together, which is the only version of this that stays consistent as kinds change.

That is an addition to yesterday's storage note, not a contradiction of it: rows move as they are, the
kind column becomes a reference, blobs are addressed by identifier, every row carries a tenant, and
artefacts stay an append log. Header projections sit on top of all of that.

## What I am not claiming

I have not used the other product, only read two screenshots of it. I do not know what its queue does
when a document has no customer, what its AutoPilot does when confidence is high and the policy check
fails, or whether its 97% means anything a statistician would defend. Those are the three questions to
ask before copying any of it, and the third one decides whether a score belongs on the screen at all.

---

## Corrected the same day, after a second reading of the images

The UX owner read both images independently and corrected me on four counts. I have checked each against
the images myself. The central inversion stands; four of my supporting claims do not, and one of the
corrections is larger than anything in the original note.

**The rail has two axes, not one.** I wrote that the correction was one entry per deployed process. Their
rail is Dashboard; a **Command Center** with six children — Open Actions, Emails, X Way Match, DocPilot,
Inbox IQ, Shared Memory; then Sales Order with three named processes under it; then Outbound Logistics,
Collections, Purchase Orders, Inbound Logistics, Invoices and Claims; and an **IT Control Panel**. So
they kept a cross-cutting operational group and an administration area *alongside* the process list. Our
Board, Inbox, Documents and Activity are not the wrong idea. They are at the wrong level, under the wrong
names. Processes in the customer's words **plus** a command centre; definitions and runs still move to
administration.

**Their record pane is an editable form, and this is the biggest gap in the note.** Order number and date
are input boxes. Customer name is a dropdown with a **+ Create** button beside it, so master data can be
created without leaving the review. Bill-to is editable, there is a "ship to different address"
checkbox, both dates have pickers, and the footer is **Save Draft / Approve**. The person *corrects the
record and then approves it*.

Ours renders. Checked in the source rather than assumed: the artefact document component contains no
input, select, textarea, change handler or editable region at all, and the item header offers a status
chip and the task key. So our reviewer can say the agent was right or wrong; theirs can make it right and
commit it. That is a different product, and it is a larger change than the queue.

It also has an engine consequence that happens to fit what we already have. A human edit is a **new
artefact authored by the person**, and the artefact table is an append log, so the corrected version
supersedes the agent's without destroying it, and the approval references the edited one. The provenance
of a field a person typed is that person. The **+ Create** path is different in kind: it writes to a
system of record outside the workflow, which is a connector action, not an artefact.

**They do not show per-field confidence.** Fields carry a SOURCE caption and an information icon —
customer name, ship-to and delivery date have one; order number and bill-to do not — and no percentage
appears against any field. The only score is the record-level 97%, shown twice. My claim that their
screen validates our per-field confidence was wrong: they show per-field **source**, and we may already
show more than they do. This also answers my own third question in the negative. A 97% cannot be an
average of per-field scores that are nowhere on that screen, so nothing in the image says what it
composes from, and a record-level badge should not go on our screen until somebody can say what it means.

**"Next Action" is a column header, not a button.** The control in each row reads **View SOs** and
navigates to that customer's orders; there is a separate overflow menu. Nothing in the row approves or
rejects. Building a one-click next action would be copying a label rather than a behaviour.

**The demo numbers do not reconcile, so do not reverse-engineer storage from them.** 95 total orders at
EUR 778k, 48 booked at EUR 753k, 47 pending at EUR 761k, 4 with issues. The counts add up; the money does
not, since 753 plus 761 is 1,514 against a total of 778. The tab strip says 98 orders against a tile of
95, and two unrelated filters both read 64. So the tiles are not "value per business state", or theirs
are inconsistent. **What the money on that tile is meant to mean is a question for the user**, and it
should be answered before anything is built to serve it.

**Details I missed, each of which changes a screen.** A country and legal-entity scope selector in the
header. A manual **+ New SO** path beside the AI one, so a person can start the object by hand. Emails
and attachments as separately counted tabs rather than one evidence pane. A provenance line on the record
itself, naming the customer and the order request it came from. Two separate "next" statements — one in
the page header naming the downstream system, one in the summary card naming only the immediate action —
both distinct from the summary sentence. And **AutoPilot sits in the queue header, not the global
chrome**, which is independent evidence that it is scoped per process, consistent with reading it as a
gate condition.

## Decisions taken with the gateway owner

**Storage: a projection table holding one row per tenant, task and kind — the current head.** The queue's
hard problem is not finding rows by customer, it is *the newest artefact per task and kind*, then
filtered, sorted and summed. An expression index still walks the append log and discards superseded rows
on every query; generated columns on a shared table give a sparse wide table and DDL per kind, and
neither touches newest-per-group. A projection keyed that way *is* newest-per-group, precomputed, and the
tiles then aggregate a narrow table. **Verified rather than assumed: newest-per-(task, kind) is already
the engine's own rule** — the completion gate selects the latest row per kind by creation time — so the
projection encodes a rule that exists rather than inventing one. The append log stays the record of what
happened; the projection is derived, rebuildable and never the source of truth, which is what keeps an
audit trail from depending on a cache and turns a change of header mapping into a rebuild rather than a
migration.

**The header is canonical, not per-kind, and this corrects the original note.** I wrote that a kind
declares which of its fields are header fields. Better: there is one shared header — counterparty,
document number, document date, amount, currency, the two axes and the keys — and a kind declares which
of *its* fields map into it. The reason is in the screenshot: their queue is one queue over several
document types with the same columns, which is only possible if the header is a shared vocabulary.
Per-kind columns would make a single queue impossible. A kind-specific extra stays in jsonb, indexed only
when a kind proves it needs one. **The open edge:** not every kind has all of those. A rework handoff has
no counterparty and no amount; a goods receipt has no amount. The header must tolerate absence and the
queue must stay sensible for a kind that maps two fields out of five.

**Posting is a delivery ledger, not a state.** One record per artefact and destination with its own
attempts, last error and outcome — the same shape as the outbound webhook deliveries the engine already
keeps. Then approval and posting are two independently queryable facts: a failed post can never make a
document look unapproved, retrying a post never touches the approval, and **"approved but not posted"
becomes a filter**, which is the population somebody chases every morning.

**An automatic approval must be distinguishable from a person's.** The decision event names the policy as
the decider rather than a user, and carries the condition that passed, the confidence it saw and the
policy result. Without that an auto-approval is indistinguishable from a human one in the audit trail,
which is the same silent-success class that produced three bugs in two days. It is also a header field,
because the first request after anyone stops trusting it will be to see everything it decided alone.

**When confidence is high and the policy check fails, policy dominates.** Confidence is a claim about
extraction quality; policy is a claim about what is permitted. A perfectly extracted transaction that
breaks policy is precisely the case a person must see, and a design letting confidence override it has
inverted the two.

**Told to the UX owner early:** filtering, sorting and totalling on the canonical header is cheap.
Filtering on an arbitrary field a kind has not mapped, and free-text search across artefact content, are
not. If either appears in a design, it is raised before it is drawn.
