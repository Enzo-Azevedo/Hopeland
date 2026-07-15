-- Characters: one alive row per user; dead rows are archived, never deleted.

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  gender text not null check (gender in ('f','m')),
  choices jsonb not null,
  skills jsonb not null,
  tags jsonb not null default '[]',
  passives jsonb not null default '[]',
  appearance jsonb not null,
  mood int not null default 50 check (mood between 0 and 100),
  played_seconds int not null default 0 check (played_seconds >= 0),
  last_tick_at timestamptz,
  created_at timestamptz not null default now(),
  died_at timestamptz
);

create unique index characters_one_alive_per_user
  on public.characters (user_id) where died_at is null;

alter table public.characters enable row level security;

create policy "own rows" on public.characters
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Server-throttled playtime tick: +60s at most every 55s, atomically.
-- security invoker: runs under the caller's RLS.
create or replace function public.heartbeat_tick()
returns table (played_seconds int)
language sql
security invoker
as $$
  update public.characters
     set played_seconds = characters.played_seconds + 60,
         last_tick_at = now()
   where user_id = auth.uid()
     and died_at is null
     and (last_tick_at is null or last_tick_at <= now() - interval '55 seconds')
  returning characters.played_seconds;
$$;
