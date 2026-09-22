-- Every minute: return expired leases to the queue, and promote tasks whose
-- preconditions have become true (prd.md sections 9.1 and 9.3).
-- cron.schedule with an existing job name replaces that job, so this is idempotent.

select cron.schedule('baton-reap',    '* * * * *', 'select baton.reap_leases()');
select cron.schedule('baton-promote', '* * * * *', 'select baton.promote_ready()');
