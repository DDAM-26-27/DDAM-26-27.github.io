-- DDAM Exam Booking — initial schema.
-- All access goes through the server (Cloudflare Pages Functions / Node) using a direct
-- Postgres connection. Row-level security is enabled on every table with NO policies, so the
-- public Supabase REST API (anon / authenticated roles) cannot read or write anything.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------- courses
create table courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null check (char_length(name) between 2 and 200),
  academic_year text not null check (char_length(academic_year) between 4 and 20),
  description text not null default '' check (char_length(description) <= 5000),
  institution text not null default '' check (char_length(institution) <= 200),
  timezone text not null default 'Europe/Rome',
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  public_schedule_mode text not null default 'names' check (public_schedule_mode in ('names', 'anonymous', 'hidden')),
  privacy_text text not null default '' check (char_length(privacy_text) <= 20000),
  notify_threshold_minutes int not null default 30 check (notify_threshold_minutes between 0 and 600),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index courses_single_active on courses (is_active) where is_active;

-- ---------------------------------------------------------------- scheduling configuration
create table scheduling_configs (
  course_id uuid primary key references courses (id) on delete cascade,
  presentation_minutes int not null default 20 check (presentation_minutes between 1 and 240),
  questions_per_student_minutes int not null default 10 check (questions_per_student_minutes between 0 and 120),
  break_minutes int not null default 10 check (break_minutes between 0 and 120),
  min_group_size int not null default 1 check (min_group_size >= 1),
  max_group_size int not null default 5 check (max_group_size <= 20),
  updated_at timestamptz not null default now(),
  check (max_group_size >= min_group_size)
);

-- ---------------------------------------------------------------- examination sessions
create table exam_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  exam_date date not null,
  start_time time not null,
  end_time time not null,
  timezone text not null default 'Europe/Rome',
  title text check (title is null or char_length(title) <= 200),
  location text check (location is null or char_length(location) <= 200),
  registration_status text not null default 'draft' check (registration_status in ('draft', 'open', 'closed')),
  schedule_status text not null default 'tentative' check (schedule_status in ('tentative', 'finalized')),
  schedule_version int not null default 0,
  schedule_updated_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (course_id, exam_date)
);
create index exam_sessions_course_date on exam_sessions (course_id, exam_date);

-- ---------------------------------------------------------------- availability intervals
create table availability_intervals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references exam_sessions (id) on delete cascade,
  kind text not null check (kind in ('window', 'blocked')),
  block_type text check (block_type in ('lunch', 'lecture', 'meeting', 'personal', 'other')),
  start_time time not null,
  end_time time not null,
  label text check (label is null or char_length(label) <= 100),
  description text check (description is null or char_length(description) <= 500),
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  check ((kind = 'window') = (block_type is null)),
  -- Intervals of the same kind may not overlap within a session.
  exclude using gist (
    session_id with =,
    kind with =,
    int4range((extract(epoch from start_time) / 60)::int, (extract(epoch from end_time) / 60)::int) with &&
  )
);
create index availability_intervals_session on availability_intervals (session_id);

-- ---------------------------------------------------------------- bookings
create sequence booking_priority_seq;

create table bookings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  session_id uuid not null references exam_sessions (id) on delete restrict,
  booking_sequence int generated always as identity unique,
  -- Scheduling priority (FIFO). Equals the order of submission; reassigned when moved to another day.
  priority bigint not null default nextval('booking_priority_seq'),
  group_name text not null check (char_length(group_name) between 2 and 100),
  group_size int not null check (group_size between 1 and 20),
  representative_email text not null check (char_length(representative_email) between 3 and 254),
  notes text not null default '' check (char_length(notes) <= 1000),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  duration_minutes int not null check (duration_minutes > 0),
  assigned_start timestamptz,
  assigned_end timestamptz,
  schedule_version int not null default 0,
  manual_position int,
  -- Time communicated when the schedule was finalized (null if never finalized).
  confirmed_start timestamptz,
  confirmed_end timestamptz,
  -- Last time communicated to the representative by email (for change thresholds).
  notified_start timestamptz,
  notified_session_id uuid,
  capacity_override boolean not null default false,
  created_by text not null default 'student' check (created_by in ('student', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check ((assigned_start is null) = (assigned_end is null)),
  check (assigned_end is null or assigned_end > assigned_start)
);
create index bookings_session_status on bookings (session_id, status);
-- Prevent obvious duplicates: the same group name twice in a course.
create unique index bookings_unique_group_name on bookings (course_id, lower(group_name)) where status = 'active';

create table group_members (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  position int not null check (position >= 1),
  name text not null check (char_length(name) between 2 and 120),
  unique (booking_id, position)
);

create table booking_credentials (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
create index booking_credentials_booking on booking_credentials (booking_id);

-- ---------------------------------------------------------------- auditability
create table schedule_revisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references exam_sessions (id) on delete cascade,
  version int not null,
  actor text not null,
  reason text not null,
  schedule_status text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (session_id, version)
);

create table audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_created on audit_log (created_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings (id) on delete set null,
  kind text not null,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null check (status in ('sent', 'logged', 'failed')),
  provider text not null,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);
create index notifications_created on notifications (created_at desc);

-- ---------------------------------------------------------------- security helpers
create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

-- Administrators (Supabase Auth mode): users whose email is listed here may use the dashboard.
create table admin_users (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

-- Row-level security: deny everything to the public API roles.
alter table courses enable row level security;
alter table scheduling_configs enable row level security;
alter table exam_sessions enable row level security;
alter table availability_intervals enable row level security;
alter table bookings enable row level security;
alter table group_members enable row level security;
alter table booking_credentials enable row level security;
alter table schedule_revisions enable row level security;
alter table audit_log enable row level security;
alter table notifications enable row level security;
alter table rate_limits enable row level security;
alter table admin_users enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
  end if;
end $$;
