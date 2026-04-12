create table if not exists public.beason_admin_users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  display_name text,
  password_hash text not null,
  role text not null check (role in ('owner', 'reseller')),
  status text not null default 'active' check (status in ('active', 'paused', 'restricted')),
  managed_by uuid references public.beason_admin_users (id) on delete set null,
  last_login_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.beason_admin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.beason_admin_users (id) on delete cascade,
  token_hash text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.beason_license_keys (
  id uuid primary key default gen_random_uuid(),
  license_key text unique not null,
  target_hwid text not null,
  note text,
  status text not null default 'active',
  generated_by uuid not null references public.beason_admin_users (id) on delete cascade,
  generated_by_username text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists beason_admin_users_role_idx
  on public.beason_admin_users (role);

create index if not exists beason_admin_users_status_idx
  on public.beason_admin_users (status);

create index if not exists beason_admin_sessions_user_id_idx
  on public.beason_admin_sessions (user_id);

create index if not exists beason_admin_sessions_expires_at_idx
  on public.beason_admin_sessions (expires_at);

create index if not exists beason_license_keys_generated_by_idx
  on public.beason_license_keys (generated_by);

create index if not exists beason_license_keys_created_at_idx
  on public.beason_license_keys (created_at desc);

create or replace function public.beason_admin_users_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists beason_admin_users_updated_at on public.beason_admin_users;

create trigger beason_admin_users_updated_at
before update on public.beason_admin_users
for each row
execute function public.beason_admin_users_set_updated_at();
