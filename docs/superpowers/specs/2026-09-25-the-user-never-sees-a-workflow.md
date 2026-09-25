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

## The header mapping is the membership test, not a tolerance problem

The UX owner flagged that the canonical header assumes a counterparty and that most of our kinds have
none. I counted rather than judged, across all nineteen schemas.

**Five kinds map a counterparty or an amount: delivery note, invoice, invoice match, payment, purchase
order.** All five are the procure-to-pay family. The other fourteen — api contract, build, config, db
schema, design spec, goods receipt, handoff, migration, pr, review, service contract, task spec, test
report, user story — map neither.

(One correction to my own check while running it: the first pattern matched `summary` as an amount,
because "summary" contains "sum". Four kinds were counted as carrying money that carry a sentence. The
figures above are from the corrected pattern.)

That result dissolves the question rather than answering it. **Most of the fourteen were never going to
appear in a clerk's queue.** A build, a pull request, a test report, a user story and a design spec are
engineering artefacts belonging to the builder's views. Asking what the business queue does when a test
report has no customer is asking the wrong thing: a test report is not a business document.

So the rule is: **a kind that maps the canonical header is a business document and appears in the queue;
a kind that does not is not, and does not.** The mapping is the membership test. That is better than
tolerating absence, because tolerating absence puts a build row in a purchasing clerk's inbox with four
empty columns and calls it a feature.

**The case that decides the design is the goods receipt.** It is unambiguously a business document, and
it maps a number and a date but neither a counterparty nor an amount — a warehouse counts what arrived,
it does not know the vendor or the price. It cannot be excluded and it cannot be shown with two empty
columns. It carries the purchase order's number, so the resolution is that **a kind may inherit header
fields from the document it references**: the goods receipt's counterparty is the counterparty of its
purchase order. That is one more thing a kind declares, and it is the mechanism that makes a single queue
over a document family work at all.

**The consequence for scope.** There is no single queue over all artefacts, and there was never going to
be one. There is a queue per document family, over the kinds that share a header. Procure-to-pay is the
first family and it has five kinds, which is enough to prove the mechanism without pretending the
fourteen engineering kinds belong to it.

## What a person's edit does to provenance

From the same reading, and it costs nothing. If a human edit is a new artefact authored by that person,
the provenance of an edited field is a person rather than a model, and the screen should say so where it
currently shows source and confidence. The trail then reads in one direction: this field came from page
three of the PDF at 94%, that one was typed by a named person at 10:42. Nobody has to explain what a
person's confidence means, which is a better answer than the source caption in the screenshot and falls
out of the append log for free.

## What our review screen actually is

Sharper than "read-only", and worth keeping in these words. The artefact document component has no inputs
or change handlers at all, but the item screen has ten between it and the decision bar — and every one is
about the **decision** rather than the **content**: the tab switcher, a reload, and the reason, budget and
deadline fields.

So the screen is fully editable in one dimension and completely fixed in the other. A person can refuse
the work and say why, set a budget and set a deadline, and cannot correct a wrong value. If a vendor name
is misread they must reject the artefact and send the work back rather than fix two characters and
approve. **Ours is built to adjudicate the agent's work; theirs is built to finish it.**

That also makes the first version smaller than it looks. The decision surface, the reason capture and the
approve and reject paths exist and work. What is missing is an editable projection of the artefact and a
way to commit an edited version — not a new screen.

## The fourth silent success: an edit the walker throws away

Found by the gateway owner in code shipped yesterday, before anything was built on it.

When a Clane workflow pauses at a human step, the bridge sends the previous step's output as the review
text, and the walker later resumes from the same frozen copy in its checkpoint. Today that is
*accidentally* correct: the person sees exactly what the walker will deliver, because both come from one
snapshot.

An editable review pane breaks it. The edit becomes a new artefact, the person approves the corrected
version, and the walker resumes from the checkpoint and delivers **the original**. The run completes,
reports success, and the audit trail records that a named person approved it. The correction is silently
discarded, and the only way anyone finds out is by comparing what went out against what they typed.

So the rule that an approval references the artefact rather than the task has a second half: **the resume
must take the approved artefact, not the checkpoint's copy.** A frozen snapshot is the right thing to
show and the wrong thing to act on, once the thing being shown can change.

This is the fourth defect in three days whose failure mode is a success report. It joins inputs arriving
empty and producing a zero-amount payment that satisfied its schema; resolution reading the wrong invoice
once a workflow produced two; and an idempotency guarantee described wrongly in a way that would have
told somebody they were protected from a double payment. None of the four raises an error. All four were
caught by stating a property precisely enough to test it.

## Absence, and the trap in the demo's numbers

Every canonical header field is nullable, with no defaults, and **specifically never zero for a missing
amount**. Sorting places absent values last explicitly. Grouping by counterparty needs a real "none"
group rather than dropping those rows, because a filtered queue that quietly loses documents is a queue
whose counts stop adding up.

Which is one explanation — offered as a trap to avoid, not as a diagnosis of the other product — of
counts that reconcile beside money that does not. That is what you get when rows with no amount are
dropped from the money aggregate while still being counted, or when an absent amount is summed as zero.
Whatever the tiles come to mean, ours has to decide explicitly whether a document with no amount is
excluded from the total or contributes nothing, and **say which on the screen**. The two produce the same
number and mean different things.

And the stronger version of withholding the tiles: nobody specifies them as "value per state" until the
user has said what the money is. An aggregate nobody can define is the thing on a screen people trust
most and check least.

## Two rules for the head projection

The projection must use the completion gate's selection rule **verbatim** rather than a variant of it,
with a test asserting that the head the projection holds and the row the gate would select are the same
row. If those ever disagree, the screen shows one document while the gate validates another, which is
worse than either being wrong alone.

The ordering is made total — creation time, then identifier — so two writes in the same millisecond
cannot flip the head depending on which one a planner reaches first.

The guard needs no change for human edits, for a reason worth stating rather than assuming: an edit is a
new artefact with a later creation time, so it is the newest and the guard admits it. The guard only ever
rejects a write that would move the head *backwards*, which a genuine edit never does. What it protects
against is a replay of an older row, which is a different thing.

## Four rules that make inheritance and membership safe

Settled with the gateway owner, and all four correct something I had written loosely.

**Inheritance is a reference resolved on read, never a value copied on write.** If a goods receipt's
projection stored a copy of its purchase order's counterparty, then editing that purchase order — which
an editable review pane makes routine — leaves the receipt showing the old vendor. Nothing errors, the
row looks complete, and the queue is confidently wrong about who the goods came from. The structural
reason is the stronger one: the projection is already a derived view of an append log, so a copied
inherited value would be a derived value *of a derived value*, and the second level is where staleness
hides and nobody looks. The projection stores the link and resolves through it, which costs a join from a
narrow indexed table to itself.

**The link is the structural one, not the document number.** I had written that the goods receipt carries
the purchase order's *number*, so inherit through that. Wrong: a document number is a business string a
reviewer can now edit, it can repeat across years, and it is exactly the kind of key that matches the
wrong row once rather than never. The engine already records the reliable relationship — a task's
`consumes` names the kind **and** the producing task, which is the same link a worker's inputs resolve
through. The number stays what it is: something to display and search, not something to join on.

**Verified, because the rule depends on it.** The compiler pins every consumed kind to its upstream task
(`{ kind, from_task: d.id }`), so the structural link is present on every step of a compiled workflow —
confirmed on the procure-to-pay plan, where each step's consumption is pinned rather than left open. But
`from_task` is nullable in the schema and the readiness predicate tolerates its absence, matching on kind
alone. So a task created by another route can carry an unpinned consumption, and inheriting through one
of those would resolve by kind across the whole run — which is precisely the defect that would have read
the wrong invoice once a workflow produced two. **Inheritance requires a pinned link and refuses when
there is none**, rather than falling back to kind.

**A column comes from the family's declared header, never from the data.** Structural absence and genuine
absence must not look alike, and the clean way to keep them apart is that they have different sources. A
field no kind in the family maps is simply not a column, rather than a column of blanks. A null in a row
whose kind *does* map the field is genuine absence and belongs in the "none" group. If a screen ever
decides its columns by inspecting the rows, the two collapse the first day every document happens to lack
a value.

**Family membership is declared, not inferred from the mapping.** My membership test made membership a
side effect: a kind that gains an amount for an unrelated reason would silently appear in a purchasing
clerk's queue, and nobody would connect the two changes. So it is two declarations — the kind says which
family it belongs to, and the header mapping says how it renders there. *Adding a field* must never mean
*and now it is in somebody's inbox*. That also gives the queue-per-family conclusion somewhere to live
instead of being inferred from whichever kinds happen to map.

## The first family does not agree with itself

The UX owner parsed all nineteen schemas independently and found that the five kinds are not the
uniform set I implied. I verified every claim field by field rather than accepting the summary. All of
them hold.

| kind | extra props | counterparty | amount | currency |
|---|---|---|---|---|
| purchase_order | closed | `requester` (string) **and** `vendor` (object) | `total` | yes |
| delivery_note | open | `vendor` (string) | — | no |
| invoice | open | `vendor` (string) | `subtotal` **and** `total` | yes |
| invoice_match | closed | — | `amount_payable` | **no** |
| payment | open | `beneficiary` (object) **and** `vendor` (string) | `amount` | yes |
| goods_receipt | closed | — | — | no |

So in the family chosen as the first queue: **two of six cannot fill the money column, two cannot fill the
counterparty column, and only three of six carry a currency at all.** The goods receipt is not the
exception I made it out to be; it is the clearest case of something affecting most of the family.

**An amount without a currency is not money.** An invoice match has `amount_payable` and no currency
field. Rendering it in a money column means inventing a currency, and the one that gets invented is
whatever the neighbouring row happens to use. The column refuses to render an amount with no currency
beside it rather than defaulting.

**The counterparty is ambiguous exactly where it exists.** A purchase order has `vendor` and `requester`
— one is the supplier, the other is your own staff member. A payment has `beneficiary`, a bank payee with
an IBAN, and also an optional `vendor` string. Choosing wrong puts an employee under a column headed with
the supplier's name, and nobody notices until a clerk does. The same ambiguity sits on the money: an
invoice carries both `subtotal` and `total`, and which one is *the* amount is a decision, not a lookup.

**The same field is a different shape in different kinds.** `vendor` is an object with id, name, approved
and email on a purchase order, and a bare string on an invoice, a delivery note and a payment. One
mapping cannot read both. So the header is a canonical *vocabulary* and the mapping into it is **per
kind** — which is what the gateway owner proposed, and this is the concrete reason it has to be.

### Four states for a cell, because two is what causes the confusion

- **Owned** — the kind declares the field and this document has a value.
- **Inherited** — the value comes from a referenced document, and it is visibly marked as borrowed with
  the source named. Two reasons, and the second is the load-bearing one: it tells the truth about where
  the row's identity comes from, and it **forecloses the edit**, because an inherited cell must not be
  typeable once the pane is editable — changing a supplier from inside a goods receipt would either lie
  or silently rewrite a different document. Inheritance also pays for its own provenance line, slotting
  in beside source and confidence with no new mechanism.
- **Not applicable** — the kind does not declare the field at all. A goods receipt has no amount because
  a warehouse counts what arrived and does not know the price. Correct, permanent, and it must never look
  like something went wrong.
- **Missing** — the kind declares the field and this document lacks a value. A data-quality problem
  somebody should act on, and filterable: "invoices with no total" is a real question, "goods receipts
  with no total" is not.

**Not applicable and missing must never share a glyph.** Today both would render as an empty cell or a
dash, and that single choice is what makes a clerk distrust a column: they cannot tell the system's
silence from the document's. The first gets a muted mark reading as *this does not apply here*; the
second gets the treatment the board already gives an unknown count, because it is the same class of
thing — a number you do not have, rather than a zero.

### Open schemas, which change the editable pane rather than the queue

`additionalProperties` is **false** on purchase order, goods receipt and invoice match, and **true** on
invoice, delivery note and payment. So half the family may legitimately carry fields the schema never
declared. An editable pane rendered strictly from the schema would silently hide real data on an invoice.
It renders declared fields as the form and undeclared ones as something visible — and probably not
editable — rather than dropping them.
