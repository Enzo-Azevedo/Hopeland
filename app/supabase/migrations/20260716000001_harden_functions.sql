-- Pin search_path on heartbeat_tick (linter 0011) and stop API callers from
-- executing the legacy rls_auto_enable helper (linters 0028/0029).
create or replace function public.heartbeat_tick()
returns table (played_seconds int, died boolean)
language sql
security invoker
set search_path = ''
as $$
  update public.characters
     set played_seconds = characters.played_seconds + 60,
         last_tick_at = now(),
         died_at = case
           when characters.played_seconds + 60 >= 1022400 then now()
           else characters.died_at
         end
   where user_id = auth.uid()
     and died_at is null
     and (last_tick_at is null or last_tick_at <= now() - interval '55 seconds')
  returning characters.played_seconds, (characters.died_at is not null) as died;
$$;

revoke execute on function public.rls_auto_enable() from anon, authenticated;
-- Functions default to EXECUTE for PUBLIC; the per-role revoke alone is
-- insufficient (applied remotely as migration revoke_rls_auto_enable_public).
revoke execute on function public.rls_auto_enable() from public;
