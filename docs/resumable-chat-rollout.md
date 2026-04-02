# Resumable Chat Rollout

Resumable chat is now the default execution path.

## Runtime Tuning

- Optional tuning:
  - `RESUMABLE_CHAT_MAX_SLICES` (default `6`)
  - `RESUMABLE_CHAT_SLICE_STEP_LIMIT` (default `1`)

## Phase Plan

1. Internal-only: validate in preview/internal environments.
2. Limited rollout: enable in production for a subset of users/environments.
3. Full rollout: enable broadly once KPIs are stable.

## KPI Queries

Success and failure rates:

```sql
select
  status,
  count(*) as jobs
from public.uk_chat_jobs
where created_at >= now() - interval '24 hours'
group by status;
```

Median and p95 slices per completed job:

```sql
select
  percentile_cont(0.5) within group (order by completed_slices) as p50_slices,
  percentile_cont(0.95) within group (order by completed_slices) as p95_slices
from public.uk_chat_jobs
where status = 'completed'
  and created_at >= now() - interval '24 hours';
```

Timeout/loop pressure proxy (jobs that hit configured max slices):

```sql
select
  count(*) as hit_max_slices
from public.uk_chat_jobs
where status = 'completed'
  and completed_slices >= max_slices
  and created_at >= now() - interval '24 hours';
```

Failure details:

```sql
select
  coalesce(nullif(last_error, ''), 'unknown') as error,
  count(*) as jobs
from public.uk_chat_jobs
where status = 'failed'
  and created_at >= now() - interval '24 hours'
group by 1
order by jobs desc
limit 20;
```
