create table if not exists public.beason_monitor_learners (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  hwid text unique,
  display_name text,
  first_name text,
  last_name text,
  status text not null default 'active',
  deactivation_reason text,
  attempt_count integer not null default 0,
  best_score integer not null default 0,
  latest_score integer not null default 0,
  recent_attempts jsonb not null default '[]'::jsonb,
  license_validated boolean not null default false,
  license_blocked boolean not null default false,
  app_version text,
  last_seen_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists beason_monitor_learners_status_idx
  on public.beason_monitor_learners (status);

create index if not exists beason_monitor_learners_last_seen_idx
  on public.beason_monitor_learners (last_seen_at desc);

create or replace function public.beason_monitor_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists beason_monitor_learners_set_updated_at on public.beason_monitor_learners;

create trigger beason_monitor_learners_set_updated_at
before update on public.beason_monitor_learners
for each row
execute function public.beason_monitor_set_updated_at();
