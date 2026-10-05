-- Unsent — run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Creates the table, the atomic counters, and a public bucket for the audio.

-- 1) Table ------------------------------------------------------------------
create table if not exists public.stories (
  id          uuid primary key default gen_random_uuid(),
  handle      text        not null,
  mood        text        not null default 'unspoken',
  title       text,
  cw          boolean     not null default false,
  audio_path  text        not null,
  duration    real        not null default 0,
  feels       integer     not null default 0,
  flags       integer     not null default 0,
  hidden      boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists stories_created_idx on public.stories (created_at desc);

-- The server talks to the DB with the service-role key, which bypasses RLS.
-- We still enable RLS so nothing is readable with the public anon key.
alter table public.stories enable row level security;

-- 2) Atomic counters --------------------------------------------------------
create or replace function public.increment_feels(story_id uuid, delta int)
returns integer
language plpgsql
as $$
declare new_val integer;
begin
  update public.stories
     set feels = greatest(0, feels + delta)
   where id = story_id
  returning feels into new_val;
  return new_val;
end;
$$;

create or replace function public.flag_story(story_id uuid, hide_at int)
returns void
language plpgsql
as $$
begin
  update public.stories
     set flags  = flags + 1,
         hidden = (flags + 1) >= hide_at
   where id = story_id;
end;
$$;

-- 3) Public storage bucket for the (already-disguised) audio -----------------
insert into storage.buckets (id, name, public)
values ('voices', 'voices', true)
on conflict (id) do nothing;

-- Anyone may read a clip (needed so <audio> can play it); only the service
-- role (the server) uploads, so no public write policy is added.
create policy "public read voices"
  on storage.objects for select
  using (bucket_id = 'voices');
