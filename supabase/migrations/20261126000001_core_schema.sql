-- =====================================================================
-- Eventos360 · Etapa 1 · Esquema base (identidad, workspaces, planes,
-- suscripciones, códigos de acceso, pagos manuales y auditoría)
-- =====================================================================

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Esquema privado: funciones auxiliares NO expuestas por la API REST.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.workspace_kind as enum ('personal', 'professional', 'business');
create type public.member_role as enum ('owner', 'admin', 'manager', 'staff', 'viewer', 'collaborator');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'suspended', 'canceled');
create type public.access_code_purpose as enum ('signup', 'renewal', 'platform_admin');
create type public.access_code_status as enum ('active', 'used', 'revoked');
create type public.platform_role as enum ('owner', 'admin', 'support');
create type public.feature_value_type as enum ('boolean', 'limit');

-- ---------------------------------------------------------------------
-- Utilidad: updated_at
-- ---------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Referencias regionales (preparado para expansión fuera de Nicaragua)
-- ---------------------------------------------------------------------
create table public.currencies (
  code      char(3) primary key check (code ~ '^[A-Z]{3}$'),
  name      text not null,
  symbol    text not null,
  decimals  smallint not null default 2 check (decimals between 0 and 4),
  is_active boolean not null default true
);

create table public.countries (
  code              char(2) primary key check (code ~ '^[A-Z]{2}$'),
  name              text not null,
  default_currency  char(3) not null references public.currencies(code),
  default_timezone  text not null,
  default_locale    text not null,
  default_tax_rate  numeric(5,2) not null default 0 check (default_tax_rate between 0 and 100),
  tax_label         text not null default 'IVA',
  is_active         boolean not null default true
);

-- Ajustes globales NO sensibles (legibles por cualquiera: p. ej. WhatsApp de soporte).
create table public.platform_settings (
  key         text primary key check (key ~ '^[a-z0-9_.]+$'),
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Identidad
-- ---------------------------------------------------------------------
create table public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  username              extensions.citext not null unique
                          check (username ~ '^[a-z0-9][a-z0-9._]{2,29}$'),
  full_name             text not null check (char_length(full_name) between 2 and 120),
  phone                 text check (phone is null or char_length(phone) <= 30),
  must_change_password  boolean not null default false,
  is_disabled           boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

create table public.platform_admins (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  role       public.platform_role not null default 'admin',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Catálogo de funcionalidades, módulos y especialidades
-- ---------------------------------------------------------------------
create table public.features (
  key         text primary key check (key ~ '^[a-z0-9_.]+$'),
  name        text not null,
  description text,
  value_type  public.feature_value_type not null,
  sort        int not null default 0
);

create table public.modules (
  key              text primary key check (key ~ '^[a-z0-9_]+$'),
  name             text not null,
  description      text,
  kinds            public.workspace_kind[] not null check (cardinality(kinds) > 0),
  default_kinds    public.workspace_kind[] not null default '{}',  -- activo automáticamente en estas modalidades
  required_feature text references public.features(key),           -- el plan debe habilitarlo
  sort             int not null default 100,
  is_active        boolean not null default true,
  check (default_kinds <@ kinds)
);

create table public.specialties (
  key         text primary key check (key ~ '^[a-z0-9_]+$'),
  name        text not null,
  description text,
  icon        text,
  sort        int not null default 100,
  is_active   boolean not null default true
);

create table public.specialty_modules (
  specialty_key  text not null references public.specialties(key) on delete cascade,
  module_key     text not null references public.modules(key) on delete cascade,
  label_override text,           -- p. ej. "Decoraciones" en vez de "Catálogo"
  sort           int not null default 100,
  primary key (specialty_key, module_key)
);

-- ---------------------------------------------------------------------
-- Planes
-- ---------------------------------------------------------------------
create table public.plans (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique check (key ~ '^[a-z0-9_]+$'),
  kind          public.workspace_kind not null,
  name          text not null,
  description   text,
  price         numeric(12,2) not null check (price >= 0),
  currency_code char(3) not null references public.currencies(code),
  duration_days int not null check (duration_days between 1 and 3660),
  is_active     boolean not null default true,
  is_public     boolean not null default true,
  sort          int not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, kind)
);
create trigger plans_touch before update on public.plans
  for each row execute function private.touch_updated_at();

create table public.plan_entitlements (
  plan_id     uuid not null references public.plans(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  is_enabled  boolean not null default true,
  limit_value int check (limit_value is null or limit_value >= 0), -- null = ilimitado
  primary key (plan_id, feature_key)
);

-- ---------------------------------------------------------------------
-- Workspaces (tenant)
-- ---------------------------------------------------------------------
create table public.workspaces (
  id            uuid primary key default gen_random_uuid(),
  kind          public.workspace_kind not null,
  name          text not null check (char_length(name) between 2 and 120),
  country_code  char(2) not null default 'NI' references public.countries(code),
  currency_code char(3) not null default 'NIO' references public.currencies(code),
  timezone      text not null default 'America/Managua',
  locale        text not null default 'es-NI',
  tax_rate      numeric(5,2) not null default 15 check (tax_rate between 0 and 100),
  is_disabled   boolean not null default false,   -- bloqueo administrativo
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, kind)
);
create trigger workspaces_touch before update on public.workspaces
  for each row execute function private.touch_updated_at();

-- La modalidad de un workspace es inmutable.
create or replace function private.workspace_kind_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'La modalidad de un espacio de trabajo no puede cambiarse' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger workspaces_kind_immutable before update of kind on public.workspaces
  for each row execute function private.workspace_kind_immutable();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         public.member_role not null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);

-- Roles válidos según modalidad.
create or replace function private.check_member_role()
returns trigger language plpgsql set search_path = '' as $$
declare v_kind public.workspace_kind;
begin
  select kind into v_kind from public.workspaces where id = new.workspace_id;
  if v_kind = 'personal' and new.role not in ('owner', 'collaborator') then
    raise exception 'Rol % no permitido en Eventos360 Personal', new.role using errcode = 'check_violation';
  end if;
  if v_kind <> 'personal' and new.role = 'collaborator' then
    raise exception 'Rol collaborator solo existe en Eventos360 Personal' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger workspace_members_role_check before insert or update on public.workspace_members
  for each row execute function private.check_member_role();

-- Especialidades: solo para workspaces Business (FK compuesta con kind).
create table public.workspace_specialties (
  workspace_id   uuid not null,
  workspace_kind public.workspace_kind not null default 'business' check (workspace_kind = 'business'),
  specialty_key  text not null references public.specialties(key),
  is_primary     boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (workspace_id, specialty_key),
  foreign key (workspace_id, workspace_kind) references public.workspaces(id, kind) on delete cascade
);
create unique index workspace_specialties_one_primary
  on public.workspace_specialties(workspace_id) where is_primary;

-- Activación/desactivación manual de módulos por workspace.
create table public.workspace_modules (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  module_key   text not null references public.modules(key) on delete cascade,
  is_enabled   boolean not null,
  primary key (workspace_id, module_key)
);

-- ---------------------------------------------------------------------
-- Suscripciones (cobro manual)
-- ---------------------------------------------------------------------
create table public.manual_payments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  payer_name   text not null check (char_length(payer_name) between 2 and 120),
  payer_phone  text,
  amount       numeric(12,2) not null check (amount > 0),
  currency_code char(3) not null references public.currencies(code),
  method       text not null check (method in ('transferencia', 'deposito', 'efectivo', 'tarjeta', 'billetera', 'otro')),
  bank         text,
  reference    text,
  paid_at      date not null default current_date,
  notes        text,
  recorded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index manual_payments_ws_idx on public.manual_payments(workspace_id);

create table public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null unique,
  workspace_kind       public.workspace_kind not null,
  plan_id              uuid not null,
  status               public.subscription_status not null,
  current_period_start timestamptz not null,
  current_period_end   timestamptz not null,
  suspended_at         timestamptz,
  canceled_at          timestamptz,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (current_period_end > current_period_start),
  -- El plan debe ser de la misma modalidad que el workspace.
  foreign key (workspace_id, workspace_kind) references public.workspaces(id, kind) on delete cascade,
  foreign key (plan_id, workspace_kind) references public.plans(id, kind)
);
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function private.touch_updated_at();
create index subscriptions_status_end_idx on public.subscriptions(status, current_period_end);

create table public.subscription_history (
  id             bigint generated always as identity primary key,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  plan_id        uuid references public.plans(id),
  action         text not null check (action in ('created', 'renewed', 'extended', 'plan_changed', 'status_changed')),
  status         public.subscription_status,
  period_end     timestamptz,
  days_added     int,
  access_code_id uuid,
  payment_id     uuid references public.manual_payments(id) on delete set null,
  actor_id       uuid references public.profiles(id) on delete set null,
  notes          text,
  created_at     timestamptz not null default now()
);
create index subscription_history_ws_idx on public.subscription_history(workspace_id, created_at desc);

-- ---------------------------------------------------------------------
-- Códigos de acceso (se guarda solo el hash SHA-256, nunca el código)
-- ---------------------------------------------------------------------
create table public.access_codes (
  id                  uuid primary key default gen_random_uuid(),
  code_hash           text not null unique,
  code_hint           text not null,                 -- últimos 4 caracteres, para identificarlo
  purpose             public.access_code_purpose not null,
  kind                public.workspace_kind,
  plan_id             uuid,
  duration_days       int check (duration_days is null or duration_days between 1 and 3660),
  specialty_keys      text[] not null default '{}',
  target_workspace_id uuid references public.workspaces(id) on delete cascade,
  payment_id          uuid references public.manual_payments(id) on delete set null,
  label               text,                          -- nombre del cliente / nota interna
  max_uses            int not null default 1 check (max_uses between 1 and 1000),
  use_count           int not null default 0 check (use_count >= 0),
  expires_at          timestamptz not null,
  status              public.access_code_status not null default 'active',
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  revoked_at          timestamptz,
  check (use_count <= max_uses),
  check (
    (purpose = 'platform_admin' and kind is null and plan_id is null)
    or (purpose in ('signup', 'renewal') and kind is not null and plan_id is not null)
  ),
  check (target_workspace_id is null or purpose = 'renewal'),
  foreign key (plan_id, kind) references public.plans(id, kind)
);
create index access_codes_created_idx on public.access_codes(created_at desc);

create table public.access_code_redemptions (
  id             bigint generated always as identity primary key,
  access_code_id uuid not null references public.access_codes(id) on delete cascade,
  user_id        uuid references public.profiles(id) on delete set null,
  workspace_id   uuid references public.workspaces(id) on delete set null,
  redeemed_at    timestamptz not null default now()
);

-- Intentos de canje (limitación de fuerza bruta).
create table public.code_attempts (
  id         bigint generated always as identity primary key,
  actor      text not null,          -- ip:<x> o user:<uuid>
  succeeded  boolean not null,
  created_at timestamptz not null default now()
);
create index code_attempts_actor_idx on public.code_attempts(actor, created_at desc);

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces(id) on delete set null,
  actor_id     uuid references public.profiles(id) on delete set null,
  action       text not null,
  entity       text not null,
  entity_id    text,
  details      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index audit_logs_ws_idx on public.audit_logs(workspace_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

create or replace function private.audit(
  p_action text, p_entity text, p_entity_id text,
  p_workspace_id uuid default null, p_details jsonb default '{}'
) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs(workspace_id, actor_id, action, entity, entity_id, details)
  values (p_workspace_id, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'));
$$;
