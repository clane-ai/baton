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
