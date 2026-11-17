create table if not exists guest (
  id uuid primary key,
  nickname text not null,
  school text not null,
  drink text not null,
  spot text not null,
  queued_at timestamptz
);
alter table guest add column if not exists seen_at timestamptz not null default now();
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
create table if not exists message (
  id bigint generated always as identity primary key,
  chat_id uuid not null references chat,
  sender uuid not null references guest,
  body text not null
);
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
alter table guest enable row level security;
alter table chat enable row level security;
alter table message enable row level security;
alter table block enable row level security;
alter table report enable row level security;
