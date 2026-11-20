-- The month's AI spend, summed in the database. Summing in the app needs every row, and the Data
-- API silently returns at most `max_rows` (1000) rows per request, so a busy month undercounted and
-- the spend cap stopped refusing. Runs as the caller, so row-level security still applies.
create function public.month_spend(period_start timestamptz, period_end timestamptz)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0)
  from (
    select cost_usd from public.messages
    where owner_id = auth.uid() and created_at >= period_start and created_at < period_end
    union all
    select cost_usd from public.usage_events
    where owner_id = auth.uid() and created_at >= period_start and created_at < period_end
  ) as spend;
$$;

revoke execute on function public.month_spend(timestamptz, timestamptz) from public, anon;
grant execute on function public.month_spend(timestamptz, timestamptz) to authenticated;
