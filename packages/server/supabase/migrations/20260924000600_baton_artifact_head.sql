-- The queue projection: one row per task and kind, holding the head, and a posting ledger beside it.
--
-- Two problems, one table each.
--
-- A queue screen needs the current document for each step without scanning an append log per row, and
-- it must agree with the completion gate about WHICH document that is. The gate's ordering is now total
-- (creation time descending, then id descending), and this projection uses exactly that ordering, so
-- the two cannot disagree. That invariant is the point of the table and is what the accompanying
-- fixture asserts by comparing this table against the gate's own query rather than against itself.
--
-- And posting to a downstream system needs to be independently queryable from approving, so that a
-- failed post can never make a document look unapproved, and so that "approved but not posted" is an
-- indexed filter rather than a report.

-- Tolerant casts. A trigger must not fail the step because one field was the wrong shape.
create or replace function baton.as_date(s text) returns date
language plpgsql immutable as $$
begin
  return (s)::date;
exception when others then
  return null;
end $$;

create or replace function baton.as_numeric(s text) returns numeric
language plpgsql immutable as $$
begin
  return (s)::numeric;
exception when others then
  return null;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The canonical header, extracted per kind.
--
-- Every field nullable and never defaulted. A missing amount is NULL, not zero: zero is a number
-- somebody can act on and absence is not. The same rule the screens already follow.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function baton.artifact_header(p_kind text, c jsonb)
returns table (counterparty text, document_number text, document_date date, amount numeric,
               currency text, unreadable text[])
language sql immutable as $$
  with raw as (
    select
      case p_kind
        when 'purchase_order' then coalesce(c->'vendor'->>'name', c->>'vendor')
        when 'invoice'        then coalesce(c->'vendor'->>'name', c->>'vendor')
        when 'delivery_note'  then coalesce(c->'vendor'->>'name', c->>'vendor')
        when 'payment'        then coalesce(c->'beneficiary'->>'name', c->>'vendor')
        else null
      end as counterparty,
      case p_kind
        when 'purchase_order' then c->>'po_number'
        when 'invoice'        then c->>'invoice_number'
        when 'delivery_note'  then c->>'delivery_note_number'
        when 'goods_receipt'  then c->>'grn_number'
        when 'invoice_match'  then c->>'invoice_number'
        when 'payment'        then c->>'payment_ref'
        else null
      end as document_number,
      case
        when p_kind = 'invoice'        then c->>'issued_at'
        when p_kind = 'delivery_note'  then c->>'shipped_at'
        when p_kind = 'goods_receipt'  then c->>'received_at'
        when p_kind = 'payment'        then c->>'scheduled_for'
        when p_kind = 'purchase_order' then c->>'needed_by'
        else null
      end as date_text,
      case
        when p_kind in ('purchase_order', 'invoice') then c->>'total'
        when p_kind = 'invoice_match'                then c->>'amount_payable'
        when p_kind = 'payment'                      then c->>'amount'
        else null
      end as amount_text,
      case p_kind when 'goods_receipt' then null when 'review' then null else c->>'currency' end as currency
  )
  select r.counterparty, r.document_number,
         baton.as_date(r.date_text), baton.as_numeric(r.amount_text), r.currency,
         -- PRESENT AND UNREADABLE is not the same fact as ABSENT, and they have different remedies:
         -- one is a document that legitimately has no date, the other is a document somebody must fix.
         -- Collapsing them makes the second invisible: a date-ordered queue sorts it to the bottom, a
         -- date-filtered queue drops it entirely, and the only way anyone finds out is by noticing an
         -- order that never got done. A clerk cannot chase what they cannot see.
         (select coalesce(array_agg(f order by f), '{}'::text[]) from (
            select 'document_date'::text as f
             where r.date_text is not null and btrim(r.date_text) <> '' and baton.as_date(r.date_text) is null
            union all
            select 'amount'::text
             where r.amount_text is not null and btrim(r.amount_text) <> '' and baton.as_numeric(r.amount_text) is null
          ) u)
    from raw r;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The head.
--
-- Inheritance stores a POINTER and never a value. A goods receipt has no vendor of its own; it takes
-- one from the purchase order it was booked against. Copying that name at projection time produces a
-- receipt that goes on naming last week's vendor after the order is corrected, with nothing reporting a
-- problem. The pointer is immutable — a task's pinned consumption does not change — so copying the
-- pointer is safe where copying the value is not. The value is resolved on read, in the view below.
--
-- A pointer requires a PINNED consumption. Where the task consumed a kind without naming the producing
-- task, there is no pointer and the field stays absent, because matching on kind would pick one of two
-- purchase orders by luck. That is the same rule as resolving a worker's inputs, reached independently.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists baton.artifact_head (
  task_id             uuid not null references baton.tasks(id) on delete cascade,
  kind                baton.artifact_kind not null,
  artifact_id         uuid not null references baton.artifacts(id) on delete cascade,
  created_at          timestamptz not null,
  counterparty        text,
  document_number     text,
  document_date       date,
  amount              numeric,
  currency            text,
  -- Header fields that were PRESENT in the artefact and could not be read. Empty means every field
  -- present was readable; it never means "no fields". Absent and unreadable stay distinguishable.
  unreadable          text[] not null default '{}',
  inherits_from_task  uuid references baton.tasks(id) on delete set null,
  inherits_from_kind  baton.artifact_kind,
  projected_at        timestamptz not null default now(),
  primary key (task_id, kind)
);
alter table baton.artifact_head enable row level security;
grant select, insert, update, delete on baton.artifact_head to service_role;

comment on table baton.artifact_head is
  'One row per task and kind: the current artefact, chosen by the same total ordering the completion gate uses, with its canonical header. Maintained by trigger so no write path can bypass it.';

-- Which kinds carry a counterparty of their own, and which must inherit one.
create or replace function baton.header_source_kinds() returns baton.artifact_kind[]
language sql immutable as $$ select array['purchase_order', 'invoice', 'delivery_note']::baton.artifact_kind[] $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Maintained by trigger, not by application code.
--
-- Artefacts arrive through submit, through artifact_put, and through direct inserts by the operator
-- face. A projection any one of those can bypass is a projection that silently disagrees with the log,
-- which is the failure shape that has cost us most this week. A trigger cannot be bypassed.
--
-- The head only ever moves forward. The guard compares the pair (creation time, id) rather than the
-- timestamp alone, so a replayed or late-arriving older row cannot regress it, an artefact written in
-- the same millisecond with a greater id does win, and an older timestamp with a greater id does not:
-- the timestamp dominates and the id only breaks ties. A genuine edit is strictly newer and therefore
-- always wins, because a guard that rejected anything resembling a duplicate would silently discard a
-- reviewer's correction.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function baton.project_artifact_head() returns trigger
language plpgsql security definer set search_path = baton, pg_temp as $$
declare h record; ptr_task uuid; ptr_kind baton.artifact_kind;
begin
  select * into h from baton.artifact_header(new.kind::text, coalesce(new.content, '{}'::jsonb));

  -- Resolve the inheritance pointer once, and only from a PINNED consumption.
  if not (new.kind = any(baton.header_source_kinds())) then
    select (x->>'from_task')::uuid, (x->>'kind')::baton.artifact_kind
      into ptr_task, ptr_kind
      from baton.tasks t, jsonb_array_elements(t.consumes) x
     where t.id = new.task_id
       and x->>'from_task' is not null
       and (x->>'kind')::baton.artifact_kind = any(baton.header_source_kinds())
     order by array_position(baton.header_source_kinds(), (x->>'kind')::baton.artifact_kind)
     limit 1;
  end if;

  insert into baton.artifact_head as head
    (task_id, kind, artifact_id, created_at, counterparty, document_number, document_date, amount, currency,
     unreadable, inherits_from_task, inherits_from_kind)
  values (new.task_id, new.kind, new.id, new.created_at,
          h.counterparty, h.document_number, h.document_date, h.amount, h.currency,
          coalesce(h.unreadable, '{}'::text[]), ptr_task, ptr_kind)
  on conflict (task_id, kind) do update
     set artifact_id        = excluded.artifact_id,
         created_at         = excluded.created_at,
         counterparty       = excluded.counterparty,
         document_number    = excluded.document_number,
         document_date      = excluded.document_date,
         amount             = excluded.amount,
         currency           = excluded.currency,
         unreadable         = excluded.unreadable,
         inherits_from_task = excluded.inherits_from_task,
         inherits_from_kind = excluded.inherits_from_kind,
         projected_at       = now()
   where (excluded.created_at, excluded.artifact_id) > (head.created_at, head.artifact_id);
  return null;
end $$;

drop trigger if exists artifacts_project_head on baton.artifacts;
create trigger artifacts_project_head after insert on baton.artifacts
  for each row execute function baton.project_artifact_head();

-- Backfill, using the same ordering, so the table agrees with the gate from the moment it exists.
insert into baton.artifact_head (task_id, kind, artifact_id, created_at, counterparty, document_number,
                                document_date, amount, currency, unreadable, inherits_from_task, inherits_from_kind)
select d.task_id, d.kind, d.id, d.created_at, hh.counterparty, hh.document_number, hh.document_date,
       hh.amount, hh.currency, coalesce(hh.unreadable, '{}'::text[]),
       case when d.kind = any(baton.header_source_kinds()) then null else p.from_task end,
       case when d.kind = any(baton.header_source_kinds()) then null else p.from_kind end
  from (select distinct on (task_id, kind) * from baton.artifacts order by task_id, kind, created_at desc, id desc) d
  cross join lateral baton.artifact_header(d.kind::text, coalesce(d.content, '{}'::jsonb)) hh
  left join lateral (
        select (x->>'from_task')::uuid as from_task, (x->>'kind')::baton.artifact_kind as from_kind
          from baton.tasks t, jsonb_array_elements(t.consumes) x
         where t.id = d.task_id and x->>'from_task' is not null
           and (x->>'kind')::baton.artifact_kind = any(baton.header_source_kinds())
         order by array_position(baton.header_source_kinds(), (x->>'kind')::baton.artifact_kind)
         limit 1) p on true
on conflict (task_id, kind) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- The read. Inherited values are resolved here, by following the pointer to the
-- referenced head, so a corrected purchase order changes every receipt that points at it without any
-- of them being rewritten.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view baton.artifact_head_resolved as
  select h.task_id, h.kind, h.artifact_id, h.created_at, h.document_number, h.document_date,
         coalesce(h.counterparty, src.counterparty) as counterparty,
         coalesce(h.amount, src.amount)             as amount,
         coalesce(h.currency, src.currency)         as currency,
         h.counterparty is null and src.counterparty is not null as counterparty_inherited,
         h.unreadable,
         -- What is DERIVED from a row must carry that row's problems, not only its values. A goods
         -- receipt has no amount of its own, so its own mark list is correctly empty; if the purchase
         -- order it points at held an unreadable amount, the receipt resolves to that null and would
         -- otherwise look identical to a receipt whose order genuinely has no amount. The mark has to
         -- travel with the value, or the invisibility we just closed reappears one indirection away.
         --
         -- Only fields actually taken from the source are reported: a mark on a field we did not
         -- inherit is the source's problem and not ours to show here.
         array(
           select f from unnest(coalesce(src.unreadable, '{}'::text[])) f
            where (f = 'amount'   and h.amount is null)
               or (f = 'currency' and h.currency is null)
         ) as inherited_unreadable,
         cardinality(h.unreadable) > 0
           or exists (
                select 1 from unnest(coalesce(src.unreadable, '{}'::text[])) f
                 where (f = 'amount' and h.amount is null) or (f = 'currency' and h.currency is null)
              ) as has_unreadable,
         h.inherits_from_task, h.inherits_from_kind,
         t.key as task_key, t.role, t.state, t.workflow_run
    from baton.artifact_head h
    join baton.tasks t on t.id = h.task_id
    left join baton.artifact_head src
           on src.task_id = h.inherits_from_task and src.kind = h.inherits_from_kind;
grant select on baton.artifact_head_resolved to service_role;

create index if not exists artifact_head_run_idx on baton.artifact_head (task_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- The posting ledger. Shaped on the webhook deliveries, but its own table: that one is keyed to an
-- event, this is keyed to a document. One row per artefact and destination.
--
-- It exists so that approval and posting are independently queryable. A failed post must never make a
-- document look unapproved, and "approved but not posted" has to be an indexed filter rather than a
-- report somebody runs.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists baton.artifact_postings (
  id              bigserial primary key,
  artifact_id     uuid not null references baton.artifacts(id) on delete cascade,
  destination     text not null,
  outcome         text not null default 'pending',
  attempts        int  not null default 0,
  last_error      text,
  external_ref    text,
  idempotency_key text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  posted_at       timestamptz,
  unique (artifact_id, destination),
  constraint artifact_postings_outcome_known
    check (outcome in ('pending', 'posted', 'failed', 'skipped'))
);
alter table baton.artifact_postings enable row level security;
grant select, insert, update on baton.artifact_postings to service_role;

comment on column baton.artifact_postings.idempotency_key is
  'The key given to the downstream system, so a retry is recognised THERE. It dedupes that call and nothing else: it does not prevent this row being attempted twice, which is what attempts records.';

create trigger artifact_postings_touch_updated_at before update on baton.artifact_postings
  for each row execute function baton.touch_updated_at();

-- The morning list: approved and not yet posted. An index rather than a report.
create index if not exists artifact_postings_outstanding_idx
  on baton.artifact_postings (destination, outcome) where outcome <> 'posted';

-- Documents whose header could not be read are a findable population rather than rows missing from
-- every filtered view. This is the "with issues" count a queue screen already shows, so it is the
-- contents of that tile rather than a diagnostic nobody asked for.
create index if not exists artifact_head_unreadable_idx
  on baton.artifact_head (task_id) where cardinality(unreadable) > 0;
