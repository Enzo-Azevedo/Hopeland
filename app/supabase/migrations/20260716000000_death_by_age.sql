-- Death by old age: the same throttled tick marks died_at when total
-- playtime crosses 284h (1022400s). RETURNING evaluates post-update values.
drop function if exists public.heartbeat_tick();

create or replace function public.heartbeat_tick()
returns table (played_seconds int, died boolean)
language sql
security invoker
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
