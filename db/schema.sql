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
alter table chat add column if not exists a_typing_at timestamptz;
alter table chat add column if not exists b_typing_at timestamptz;
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
alter table chat add column if not exists a_read_through bigint;
alter table chat add column if not exists b_read_through bigint;
update chat c set
  a_read_through=coalesce(a_read_through, (select max(m.id) from message m where m.chat_id=c.id and m.sender=c.b and c.matched), 0),
  b_read_through=coalesce(b_read_through, (select max(m.id) from message m where m.chat_id=c.id and m.sender=c.a and c.matched), 0)
where a_read_through is null or b_read_through is null;
alter table chat alter column a_read_through set default 0, alter column a_read_through set not null;
alter table chat alter column b_read_through set default 0, alter column b_read_through set not null;
create table if not exists meetup_invite (
  chat_id uuid primary key references chat,
  version uuid not null,
  proposer uuid not null references guest,
  venue text not null,
  meetup_date date not null,
  status text not null check (status in ('pending','accepted','declined')),
  updated_at timestamptz not null default now()
);
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
alter table meetup_invite enable row level security;

alter table guest add column if not exists session_ended_at timestamptz;
alter table guest add column if not exists suspended_at timestamptz;
alter table guest add column if not exists deleted_at timestamptz;
alter table report add column if not exists review_status text not null default 'pending'
  check (review_status in ('pending','reviewed','dismissed'));
alter table report add column if not exists reviewed_at timestamptz;
create table if not exists guest_rate_limit (
  scope text not null,
  subject text not null,
  bucket bigint not null,
  hits integer not null default 1,
  expires_at timestamptz not null,
  primary key(scope,subject,bucket)
);
alter table guest_rate_limit enable row level security;

alter table message add column if not exists client_nonce uuid;
create unique index if not exists message_retry_key on message(chat_id,sender,client_nonce) where client_nonce is not null;
alter table meetup_invite add column if not exists meetup_time time;
alter table meetup_invite add column if not exists withdrawn_at timestamptz;

-- Seed the original venues only when the table is first created.
do $$
begin
  if to_regclass('public.venue') is null then
    create table public.venue (
      id integer generated always as identity primary key,
      name text not null check (char_length(btrim(name)) between 1 and 60)
    );
    create unique index venue_name_unique on public.venue (lower(name));
    insert into public.venue(name) values
      ('Petals'), ('Akasya'), ('La Jefa'), ('Lunar'), ('Club K'), ('D Cloud'), ('Ninabs'), ('Aces');
  end if;
end $$;
alter table public.venue enable row level security;

-- Optional profile photos. Image files live outside Postgres.
alter table guest add column if not exists photo_id uuid;
alter table guest add column if not exists quick_photo boolean not null default false;
create table if not exists guest_photo_cleanup (
  guest_id uuid not null references guest(id),
  photo_id uuid not null,
  delete_after timestamptz not null default now(),
  primary key (guest_id, photo_id)
);
alter table guest_photo_cleanup enable row level security;
create index if not exists guest_photo_cleanup_due on guest_photo_cleanup (delete_after);

-- Keep browser suspension separate from the cookie that grants access to a guest session.
alter table guest add column if not exists browser_id uuid;
create index if not exists guest_suspended_browser on guest(browser_id) where suspended_at is not null;

-- Retain immutable photo revisions for pending reports and recently displayed cards.
alter table report add column if not exists photo_id uuid;
alter table guest_photo_cleanup add column if not exists deleting boolean not null default false;
create index if not exists report_pending_photo on report(target,photo_id,created_at)
  where review_status='pending' and photo_id is not null;
create index if not exists report_pending_chat on report(chat_id,created_at)
  where review_status='pending' and chat_id is not null;
create table if not exists guest_photo_view (
  viewer uuid not null references guest(id),
  owner uuid not null references guest(id),
  photo_id uuid not null,
  expires_at timestamptz not null,
  primary key (viewer,owner,photo_id)
);
alter table guest_photo_view enable row level security;
create index if not exists guest_photo_view_retention on guest_photo_view(owner,photo_id,expires_at);

create or replace function public.shattana_pending_chat_evidence(conversation uuid, content_at timestamptz, closed_at timestamptz)
returns boolean language sql stable set search_path = pg_catalog, public as $$
  select closed_at > now()-interval '90 days' and exists (
    select 1 from public.report r where r.chat_id=conversation and r.review_status='pending'
    and r.created_at>now()-interval '90 days' and (content_at is null or content_at<=r.created_at)
  );
$$;
revoke execute on function public.shattana_pending_chat_evidence(uuid,timestamptz,timestamptz) from public;

-- Keep reply IDs after the original body is deleted by guest deletion or retention.
alter table message add column if not exists reply_to bigint;
alter table meetup_invite add column if not exists canceled_at timestamptz;

-- Record each participant's own Next tap so a retry can't restart a canceled search.
alter table chat add column if not exists a_pressed_next boolean not null default false;
alter table chat add column if not exists b_pressed_next boolean not null default false;
