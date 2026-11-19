create table if not exists guest (
  id uuid primary key,
  nickname text not null,
  school text not null,
  drink text not null,
  spot text not null,
  queued_at timestamptz
);
alter table guest add column if not exists seen_at timestamptz not null default now();
alter table guest add column if not exists quick_gender text not null default '';
update guest set spot='Akasya' where spot='Acacia';
alter table guest add column if not exists bar_age smallint check (bar_age >= 18);
alter table guest add column if not exists bar_gender text;
alter table guest add column if not exists bar_interest text;
alter table guest add column if not exists bar_min_age smallint check (bar_min_age >= 18);
alter table guest add column if not exists bar_max_age smallint check (bar_max_age >= bar_min_age);
alter table guest add column if not exists bar_spot text;
alter table guest add column if not exists bar_answer text;
create index if not exists guest_queue on guest(queued_at) where queued_at is not null;
create table if not exists chat (
  id uuid primary key,
  a uuid not null references guest,
  b uuid not null references guest,
  a_shot boolean not null default false,
  b_shot boolean not null default false,
  matched boolean not null default false,
  closed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists chat_a on chat(a);
create index if not exists chat_b on chat(b);
alter table chat add column if not exists bar_pending_a boolean not null default false;
alter table chat add column if not exists bar_pending_b boolean not null default false;
alter table chat add column if not exists ended_at timestamptz;
alter table chat add column if not exists ended_by_next boolean not null default false;
alter table chat add column if not exists a_gender text not null default '';
alter table chat add column if not exists b_gender text not null default '';
create index if not exists chat_pair_history on chat (least(a,b), greatest(a,b));
create unique index if not exists chat_matched_pair on chat (least(a,b), greatest(a,b)) where matched;
create table if not exists bar_hi (
  sender uuid references guest,
  recipient uuid references guest,
  primary key(sender,recipient),
  check (sender <> recipient)
);
create table if not exists message (
  id bigint generated always as identity primary key,
  chat_id uuid not null references chat,
  sender uuid not null references guest,
  body text not null
);
alter table message add column if not exists created_at timestamptz;
alter table message alter column created_at set default now();
create index if not exists message_chat on message(chat_id,id);
create table if not exists block (
  actor uuid references guest,
  target uuid references guest,
  primary key(actor,target)
);
create table if not exists report (
  id bigint generated always as identity primary key,
  actor uuid not null references guest,
  target uuid not null references guest,
  chat_id uuid not null references chat,
  reason text not null,
  created_at timestamptz not null default now(),
  unique(actor,chat_id)
);
alter table report alter column chat_id drop not null;
create unique index if not exists report_profile_pair on report(actor,target) where chat_id is null;
alter table guest enable row level security;
alter table chat enable row level security;
alter table message enable row level security;
alter table block enable row level security;
alter table report enable row level security;
alter table bar_hi enable row level security;
