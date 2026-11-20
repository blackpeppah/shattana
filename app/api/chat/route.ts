import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { transact } from '../../../db/store';
import { genders, barInterests, barReportReasons, drinks, spots, reasons } from '../../options';
import { challengeConfig, verifyJoinChallenge } from './turnstile';
import { bacolodDate } from '../../after-hours';
import { allowAttempt, connectionSubject } from '../safety';
import { barCardEligibility, barEligibility, browserCookie, browserSuspended, guestCookie, sameGuestOrigin, uuid } from './access';
import { cleanPhotoFiles, photoStorageAvailable, queuePhotoDeletion } from '../profile-photo/storage';

const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const messageId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) &&
  BigInt(value) <= BigInt('9223372036854775807');
class InputError extends Error {}
class MessageRateError extends Error {
  constructor(message: string, readonly retryAfter = 10) { super(message); }
}
class InviteConflict extends Error {}

function validMeetupDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < bacolodDate()) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const adultAge = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 18 && value <= 120;
async function handle(req: NextRequest, write: boolean) {
  try {
    const origin = req.headers.get('origin');
    if (write && !sameGuestOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
    }
    const input = write ? await req.json().catch(() => null) : {};
    if (!input || typeof input !== 'object') throw new InputError('Invalid request.');
    const challenge = challengeConfig();
    if (input.action === 'join' && challenge.required) {
      if (!challenge.secret) throw new Error('Turnstile signup keys are missing or invalid');
      if (!clean(input.nickname, 24) || input.adult !== true) throw new InputError('Choose a nickname and confirm you are 18+.');
      if (typeof input.challengeToken !== 'string' || !input.challengeToken || input.challengeToken.length > 2048 ||
        !await verifyJoinChallenge(input.challengeToken, new URL(origin!).hostname, challenge.secret, challenge.testing)) {
        throw new InputError('Complete the verification and try again.');
      }
    }
    const token = req.cookies.get(guestCookie)?.value;
    let id = uuid(token) ? token : null;
    const browserToken = req.cookies.get(browserCookie)?.value;
    const browserId = uuid(browserToken) ? browserToken : null;
    let issueBrowser: string | undefined;
    let created = false;
    let clearSession = false;
    let deniedSignup = false;
    let photoCleanupGuest: string | undefined;
    // An existing guest may need a browser cookie even before their next heartbeat.
    const canLinkBrowser = write || Boolean(id && !browserId);
    const result = await transact(canLinkBrowser, async query => {
      const [settings] = await query(`select to_regclass('guest_rate_limit') is not null as ready,
        to_regclass('public.venue') is not null as "venuesReady",
        to_regclass('guest_photo_cleanup') is not null as "photosReady",
        to_regclass('guest_suspended_browser') is not null as "browserReady"`);
      const guestControls = settings.ready === true;
      const photosReady = settings.photosReady === true && photoStorageAvailable();
      let [profile] = id ? await query(`select * from guest where id=$1
        ${guestControls ? 'and session_ended_at is null and deleted_at is null' : ''}`, [id]) : [];
      if (settings.browserReady && profile && canLinkBrowser) {
        const linked = uuid(profile.browser_id) ? profile.browser_id : browserId ?? randomUUID();
        if (!profile.browser_id) {
          await query('update guest set browser_id=$2 where id=$1', [id, linked]);
          profile.browser_id = linked;
        }
        if (!browserId) issueBrowser = linked;
      }
      const suspended = Boolean(profile?.suspended_at) || (settings.browserReady === true &&
        await browserSuspended(query, browserId, profile?.browser_id));
      const activeUsers = async () => {
        const [presence] = await query(`select count(*)::int as total from guest where seen_at > now()-interval '90 seconds'
          ${guestControls ? 'and session_ended_at is null and suspended_at is null' : ''}`);
        return Number(presence.total);
      };
      const guestless = async () => ({ profile: null, activeUsers: await activeUsers(),
        challenge: { required: challenge.required, siteKey: challenge.siteKey } });
      if (input.action === 'end-session' || input.action === 'delete-data') {
        if (!guestControls) throw new InputError('Guest session controls are unavailable on this database.');
        if (!profile) throw new InputError('This guest session is no longer available. Refresh to continue.');
        if (input.action === 'delete-data' && input.confirmation !== 'DELETE') throw new InputError('Confirm data deletion first.');
        if (profile) {
          await query('update guest set session_ended_at=now(), queued_at=null where id=$1', [id]);
          await query('update chat set closed=true, ended_at=now() where not closed and (a=$1 or b=$1)', [id]);
          if (settings.photosReady && id && uuid(profile.photo_id)) {
            await query('update guest set photo_id=null,quick_photo=false where id=$1', [id]);
            await queuePhotoDeletion(query, id, profile.photo_id);
            photoCleanupGuest = id;
          }
          if (input.action === 'delete-data') {
            await query(`update guest set nickname='Deleted guest',school='',drink='',spot='',quick_gender='',
              bar_age=null,bar_gender=null,bar_interest=null,bar_min_age=null,bar_max_age=null,bar_spot=null,
              bar_answer=null,deleted_at=now() where id=$1`, [id]);
            await query(`delete from message m where sender=$1 and not exists
              (select 1 from report r where r.chat_id=m.chat_id and r.review_status='pending')`, [id]);
            await query('delete from meetup_invite where chat_id in (select id from chat where a=$1 or b=$1)', [id]);
            await query('delete from bar_hi where sender=$1 or recipient=$1', [id]);
          }
        }
        clearSession = true;
        return { ...await guestless(), suspended };
      }
      if (suspended) {
        deniedSignup = input.action === 'join';
        return { ...await guestless(), suspended: true, guestControls: guestControls && Boolean(profile),
          ...(deniedSignup ? { error: 'This browser is suspended from joining Shattana.' } : {}) };
      }
      if (!profile && input.action === 'join') {
        const nickname = clean(input.nickname, 24);
        if (!nickname || input.adult !== true) throw new InputError('Choose a nickname and confirm you are 18+.');
        if (guestControls && !await allowAttempt(query, 'signup', connectionSubject(req), 3600, 6)) {
          throw new MessageRateError('Too many guest signups from this connection. Try again later.', 3600);
        }
        id = randomUUID();
        created = true;
        if (settings.browserReady) {
          const linked = browserId ?? randomUUID();
          [profile] = await query("insert into guest(id,nickname,school,drink,spot,browser_id) values($1,$2,'','','',$3) returning *",
            [id, nickname, linked]);
          if (!browserId) issueBrowser = linked;
        } else {
          [profile] = await query("insert into guest(id,nickname,school,drink,spot) values($1,$2,'','','') returning *", [id, nickname]);
        }
      }
      if (!profile) return guestless();
      const availableSpots = settings.venuesReady
        ? (await query<{ name: string }>('select name from public.venue order by id')).map(venue => venue.name)
        : spots;
      // A connected Supabase project can be on the previous schema while local work is in progress.
      const [matchSchema] = process.env.DATABASE_URL ? await query(`select to_regclass('meetup_invite') is not null
        and (select count(*) from pg_attribute where attrelid=to_regclass('chat') and not attisdropped
          and attname in ('a_read_through','b_read_through'))=2 as ready`) : [{ ready: true }];
      const savedMatchFeatures = matchSchema.ready === true;
      const [extraSchema] = process.env.DATABASE_URL ? await query(`select
        exists(select 1 from pg_attribute where attrelid=to_regclass('message') and not attisdropped and attname='client_nonce') as retries,
        (select count(*) from pg_attribute where attrelid=to_regclass('meetup_invite') and not attisdropped
          and attname in ('meetup_time','withdrawn_at'))=2 as meetup`) : [{ retries: true, meetup: true }];
      const retrySends = extraSchema.retries === true;
      const extendedMeetups = savedMatchFeatures && extraSchema.meetup === true;
      const meetupStatus = `case ${extendedMeetups ? "when withdrawn_at is not null then 'withdrawn'" : ''}
        when status='pending' and meetup_date < (now() at time zone 'Asia/Manila')::date then 'expired' else status end`;
      const action = input.action === 'after-hours' ? 'find' : input.action;
      const showBar = req.nextUrl.searchParams.get('bar') === '1';
      let newBarChat: unknown;
      if (write) {
        await query(`update guest set queued_at=null where id=$1 and seen_at <= now()-interval '35 seconds'`, [id]);
        await query(`update chat set closed=true, ended_at=expiry.at
          from (select c.id, least(a.seen_at,b.seen_at)+interval '90 seconds' as at from chat c
            join guest a on a.id=c.a join guest b on b.id=c.b
            where (c.a=$1 or c.b=$1) and not c.matched and not c.closed) expiry
          where chat.id=expiry.id and expiry.at <= now()`, [id]);
        await query("update guest set seen_at=now() where id=$1", [id]);
      }
      const [search] = action === 'heartbeat' ? await query('select id from guest where id=$1 and queued_at is not null', [id]) : [];
      if (action === 'find' || action === 'next' || search) {
        if (action === 'next') {
          if (!uuid(input.chatId)) throw new InputError('Choose a conversation.');
          if (guestControls && !await allowAttempt(query, 'next', String(id), 30, 5)) {
            throw new MessageRateError('Give it a moment before starting another chat.', 30);
          }
          const [previous] = await query(`select a,b,closed from chat
            where id=$2 and (a=$1 or b=$1) and not matched`, [id, input.chatId]);
          if (!previous) throw new InputError('This Quick Chat has ended.');
          if (!previous.closed) {
            await query('update chat set closed=true, ended_at=now(), ended_by_next=true where id=$1', [input.chatId]);
            const peer = previous.a === id ? previous.b : previous.a;
            await query(`update guest set queued_at=coalesce(queued_at,now()) where id=$1
              and seen_at>now()-interval '35 seconds'`, [peer]);
          }
        } else if (action === 'find') {
          const spot = input.spot === 'Acacia' && !availableSpots.includes('Acacia') ? 'Akasya' : input.spot;
          const gender = genders.includes(input.quickGender) ? input.quickGender : '';
          await query('update guest set drink=$2,spot=$3,quick_gender=$4 where id=$1',
            [id, drinks.includes(input.drink) ? input.drink : '', availableSpots.includes(spot) ? spot : '', gender]);
        }
        const [active] = await query('select id from chat where (a=$1 or b=$1) and not matched and not closed', [id]);
        if (!active) {
          // An exponential draw gives each candidate odds proportional to their wait weight.
          const [peer] = await query(`select g.id from guest g
            cross join lateral (
              select count(*) as encounters, bool_or(matched) as matched,
                max(coalesce(ended_at,created_at)) as last_chat
              from chat where least(a,b)=least($1,g.id) and greatest(a,b)=greatest($1,g.id)
            ) history
            where g.id<>$1 and g.queued_at is not null and g.seen_at > now()-interval '35 seconds'
            and not exists (select 1 from block where (actor=$1 and target=g.id) or (actor=g.id and target=$1))
            and not exists (select 1 from report where (actor=$1 and target=g.id) or (actor=g.id and target=$1))
            and not exists (select 1 from chat where (a=g.id or b=g.id) and not matched and not closed)
            and (history.encounters=0 or (not history.matched and history.last_chat <= now()-interval '2 minutes'))
            order by (history.encounters<>0),
              -ln(1-random()) / (1+greatest(0,extract(epoch from now()-g.queued_at))/30)
            limit 1`, [id]);
          if (peer) {
            await query(`insert into chat(id,a,b,a_gender,b_gender)
              select $1,a.id,b.id,a.quick_gender,b.quick_gender from guest a cross join guest b
              where a.id=$2 and b.id=$3`, [randomUUID(), id, peer.id]);
            await query('update guest set queued_at=null where id in ($1,$2)', [id, peer.id]);
          } else {
            await query('update guest set queued_at=coalesce(queued_at,now()) where id=$1', [id]);
          }
        }
      }
      if (action === 'cancel') await query('update guest set queued_at=null where id=$1', [id]);
      if (action === 'bar-profile') {
        const { age, gender, interest, minAge, maxAge } = input;
        const answer = clean(input.answer, 140);
        const favorite = clean(input.favorite, 60);
        if (!adultAge(age) || !adultAge(minAge) || !adultAge(maxAge) || minAge > maxAge ||
          !genders.includes(gender) || !barInterests.includes(interest) || !favorite || !answer) {
          throw new InputError('Complete your profile and choose a valid age range from 18 to 120.');
        }
        await query(`update guest set bar_age=$2,bar_gender=$3,bar_interest=$4,
          bar_min_age=$5,bar_max_age=$6,bar_spot=$7,bar_answer=$8 where id=$1`,
          [id, age, gender, interest, minAge, maxAge, favorite, answer]);
      }
      if (['bar-hi', 'bar-block', 'bar-report'].includes(action)) {
        const target = input.target;
        if (!uuid(target)) throw new InputError('Choose a profile.');
        const [peer] = await query(`select g.id ${barEligibility} and g.id=$2`, [id, target]);
        if (!peer) throw new InputError('This profile is no longer available.');
        if (action === 'bar-hi') {
          if (guestControls && !await allowAttempt(query, 'bar-hi', String(id), 60, 8)) {
            throw new MessageRateError('Give it a minute before sending another hi.', 60);
          }
          await query('insert into bar_hi(sender,recipient) values($1,$2) on conflict do nothing', [id, target]);
          const [mutual] = await query('select sender from bar_hi where sender=$2 and recipient=$1', [id, target]);
          if (mutual) {
            const [existing] = await query(`select id from chat where not closed
              and ((a=$1 and b=$2) or (a=$2 and b=$1)) order by created_at desc limit 1`, [id, target]);
            if (existing) {
              await query(`update chat set matched=true,a_shot=true,b_shot=true,
                bar_pending_a=true,bar_pending_b=true where id=$1`, [existing.id]);
              newBarChat = existing.id;
            } else {
              newBarChat = randomUUID();
              await query(`insert into chat(id,a,b,matched,a_shot,b_shot,bar_pending_a,bar_pending_b)
                values($1,$2,$3,true,true,true,true,true)`, [newBarChat, id, target]);
            }
          }
        } else {
          if (action === 'bar-report') {
            if (!barReportReasons.includes(input.reason)) throw new InputError('Choose a report reason.');
            await query('insert into report(actor,target,reason) values($1,$2,$3) on conflict do nothing', [id, target, input.reason]);
          }
          await query('insert into block(actor,target) values($1,$2) on conflict do nothing', [id, target]);
          await query('update chat set closed=true, ended_at=now() where not closed and ((a=$1 and b=$2) or (a=$2 and b=$1))', [id, target]);
        }
      }
      if (action === 'bar-dismiss' && uuid(input.chatId)) {
        await query(`update chat set bar_pending_a=bar_pending_a and a<>$1,
          bar_pending_b=bar_pending_b and b<>$1 where id=$2 and (a=$1 or b=$1)`, [id, input.chatId]);
      }
      if (action === 'typing' && uuid(input.chatId)) {
        await query(`update chat set a_typing_at=case when a=$1 then now() else a_typing_at end,
          b_typing_at=case when b=$1 then now() else b_typing_at end
          where id=$2 and (a=$1 or b=$1) and not closed`, [id, input.chatId]);
      }
      if (action === 'read' && savedMatchFeatures) {
        const through = input.through;
        if (!uuid(input.chatId) || !messageId(through)) throw new InputError('Invalid read position.');
        await query(`update chat c set
          a_read_through=case when c.a=$1 then greatest(c.a_read_through,m.id) else c.a_read_through end,
          b_read_through=case when c.b=$1 then greatest(c.b_read_through,m.id) else c.b_read_through end
          from message m where c.id=$2 and c.matched and not c.closed and (c.a=$1 or c.b=$1)
          and m.id=$3::bigint and m.chat_id=c.id and m.sender=case when c.a=$1 then c.b else c.a end`,
        [id, input.chatId, through]);
      }
      if (action === 'meetup-propose' || action === 'meetup-respond' || action === 'meetup-withdraw') {
        if (!savedMatchFeatures) throw new InputError('Meetup invites aren’t available on this database yet.');
        if (!uuid(input.chatId)) throw new InputError('Choose a saved conversation.');
        const [saved] = await query('select id from chat where id=$2 and (a=$1 or b=$1) and matched and not closed', [id, input.chatId]);
        if (!saved) throw new InputError('This saved conversation is unavailable.');
        const [invite] = await query(`select version, proposer, ${meetupStatus} as status, venue,
          to_char(meetup_date,'YYYY-MM-DD') as date from meetup_invite where chat_id=$1`, [saved.id]);
        if (input.version !== (invite?.version ?? null)) throw new InviteConflict('This meetup invite changed. Check the latest proposal and try again.');
        const time = input.time ?? '';
        if (time !== '' && (!extendedMeetups || typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
          throw new InputError('Choose a valid Bacolod time.');
        }
        if (action === 'meetup-withdraw') {
          if (!extendedMeetups || !invite || invite.status !== 'pending' || invite.proposer !== id) {
            throw new InputError('Only the sender can withdraw a pending invite.');
          }
          await query('update meetup_invite set version=$2, withdrawn_at=now(), updated_at=now() where chat_id=$1',
            [saved.id, randomUUID()]);
        } else if (action === 'meetup-propose') {
          if (invite?.status === 'pending') throw new InviteConflict('There’s already a pending meetup invite.');
          if (!availableSpots.includes(input.venue) || !validMeetupDate(input.date)) throw new InputError('Choose a venue and a valid date in Bacolod.');
          await query(`insert into meetup_invite(chat_id,version,proposer,venue,meetup_date,status)
            values($1,$2,$3,$4,$5,'pending')
            on conflict (chat_id) do update set version=excluded.version, proposer=excluded.proposer,
              venue=excluded.venue, meetup_date=excluded.meetup_date, status='pending', updated_at=now()`,
          [saved.id, randomUUID(), id, input.venue, input.date]);
          if (extendedMeetups) {
            await query("update meetup_invite set meetup_time=nullif($2,'')::time, withdrawn_at=null where chat_id=$1", [saved.id, time]);
          }
        } else {
          if (!invite || invite.status !== 'pending') throw new InviteConflict('This meetup invite has already been answered.');
          if (invite.proposer === id) throw new InputError('Only the recipient can respond.');
          if (input.response === 'counter') {
            const date = input.date === undefined || input.date === '' ? invite.date : input.date;
            if (!availableSpots.includes(input.venue) || input.venue === invite.venue || !validMeetupDate(date)) {
              throw new InputError('Choose a different venue and a valid date in Bacolod.');
            }
            await query(`update meetup_invite set version=$2, proposer=$3, venue=$4, meetup_date=$5,
              updated_at=now() where chat_id=$1`, [saved.id, randomUUID(), id, input.venue, date]);
            if (extendedMeetups && input.time !== undefined) {
              await query("update meetup_invite set meetup_time=nullif($2,'')::time where chat_id=$1", [saved.id, time]);
            }
          } else {
            if (input.response !== 'accept' && input.response !== 'decline') throw new InputError('Choose a response.');
            if (input.response === 'accept' && !validMeetupDate(invite.date)) throw new InputError('That date has passed. Suggest another spot and date.');
            await query('update meetup_invite set version=$2, status=$3, updated_at=now() where chat_id=$1',
              [saved.id, randomUUID(), input.response === 'accept' ? 'accepted' : 'declined']);
          }
        }
      }
      if (['send','shot','leave','unmatch','block','report','report-last'].includes(action)) {
        if (!uuid(input.chatId)) throw new InputError('Choose a conversation.');
        const reporting = action === 'report' || action === 'report-last';
        const [chat] = await query(`select * from chat where id=$2 and (a=$1 or b=$1)
          and (not closed or ($3 and ended_at>now()-interval '15 minutes'))`, [id, input.chatId, reporting]);
        if (!chat) throw new InputError('This chat has ended.');
        const peer = chat.a === id ? chat.b : chat.a;
        if (action === 'send') {
          const body = clean(input.body, 1000);
          if (!body) throw new InputError('Write a message first.');
          if (input.nonce !== undefined && !uuid(input.nonce)) throw new InputError('Invalid message identifier.');
          const [duplicate] = retrySends && input.nonce ? await query(
            'select body from message where chat_id=$1 and sender=$2 and client_nonce=$3', [chat.id, id, input.nonce]) : [];
          if (duplicate && duplicate.body !== body) throw new InputError('This message identifier already belongs to a different message.');
          if (!duplicate) {
          const [rate] = await query(`select count(*)::int as total,
            (count(*) filter (where created_at > now() - interval '10 seconds'))::int as recent
            from message where chat_id=$1 and sender=$2`, [chat.id, id]);
          if (Number(rate.total) >= 1000) throw new InputError('This chat has reached its message limit.');
          if (Number(rate.recent) >= 8) throw new MessageRateError('Give it a few seconds before sending another message.');
          if (retrySends) {
            await query('insert into message(chat_id,sender,body,client_nonce) values($1,$2,$3,$4)', [chat.id, id, body, input.nonce ?? null]);
          } else {
            await query('insert into message(chat_id,sender,body) values($1,$2,$3)', [chat.id, id, body]);
          }
          await query(`update chat set a_typing_at=case when a=$1 then null else a_typing_at end,
            b_typing_at=case when b=$1 then null else b_typing_at end where id=$2`, [id, chat.id]);
          }
        }
        if (action === 'shot') {
          await query(`update chat set a_shot=a_shot or a=$1,b_shot=b_shot or b=$1,
            matched=(a_shot or a=$1) and (b_shot or b=$1) where id=$2`, [id, chat.id]);
        }
        if (action === 'leave') {
          if (chat.matched) throw new InputError('This conversation is already saved in Matches.');
          await query('update chat set closed=true, ended_at=now() where id=$1', [chat.id]);
        }
        if (action === 'unmatch') {
          if (!chat.matched) throw new InputError('Only saved matches can be removed.');
          await query('update chat set closed=true, ended_at=now() where id=$1', [chat.id]);
        }
        if (reporting) {
          if (!reasons.includes(input.reason)) throw new InputError('Choose a report reason.');
          await query('insert into report(actor,target,chat_id,reason) values($1,$2,$3,$4) on conflict do nothing',
            [id, peer, chat.id, input.reason]);
        }
        if (action === 'block' || reporting) {
          await query('insert into block(actor,target) values($1,$2) on conflict do nothing', [id, peer]);
          await query('update chat set closed=true, ended_at=now() where not closed and ((a=$1 and b=$2) or (b=$1 and a=$2))', [id, peer]);
        }
      }

      const [current] = await query(`select nickname, drink, spot, quick_gender as "quickGender",
        bar_age as age, bar_gender as gender, bar_interest as interest, bar_min_age as "minAge",
        bar_max_age as "maxAge", bar_spot as favorite, bar_answer as answer,
        ${photosReady ? 'photo_id as "photoId", quick_photo as "quickPhoto",' : ''}
        (queued_at is not null and seen_at>now()-interval '35 seconds') as waiting from guest where id=$1`, [id]);
      const after = action === 'bar-next' ? input.target : req.nextUrl.searchParams.get('after');
      const [candidate] = showBar && current.answer ? await query(`select g.id, g.nickname,
        g.bar_spot as favorite, g.bar_answer as answer ${photosReady ? ', g.photo_id as "photoId"' : ''} ${barCardEligibility}
        and ($2::uuid is null or g.id<>$2)
        order by (g.id>$2::uuid) desc nulls last, g.id limit 1`, [id, uuid(after) ? after : null]) : [];
      const matchDetails = savedMatchFeatures ? `
        (case when c.a=$1 then c.a_read_through else c.b_read_through end)::text as "readThrough",
        c.matched and exists (select 1 from message m where m.chat_id=c.id and m.sender=g.id
          and m.id>case when c.a=$1 then c.a_read_through else c.b_read_through end) as unread,
        case when length(latest.body)>140 then left(latest.body,140)||'…' else latest.body end as preview`
        : `'0'::text as "readThrough", false as unread, null::text as preview`;
      const matchJoins = savedMatchFeatures ? `
        left join lateral (select id,body,created_at from message where chat_id=c.id order by id desc limit 1) latest on c.matched
        left join meetup_invite i on i.chat_id=c.id` : '';
      const chatOrder = savedMatchFeatures
        ? 'unread desc, greatest(c.created_at,latest.created_at,i.updated_at) desc, latest.id desc nulls last'
        : 'c.created_at desc';
      const chats = await query(`select c.id,c.matched,g.nickname,g.spot,g.drink,
        coalesce((case when c.a=$1 then c.b_typing_at else c.a_typing_at end) > now()-interval '4 seconds',false) as "peerTyping",
        case when c.a=$1 then c.b_gender else c.a_gender end as gender,
        case when c.a=$1 then c.a_shot else c.b_shot end as shot,
        case when c.a=$1 then c.bar_pending_a else c.bar_pending_b end as "barPending",
        ${photosReady ? 'case when not c.matched and g.quick_photo then g.photo_id end as "photoId",' : ''}
        ${matchDetails}
        from chat c join guest g on g.id=case when c.a=$1 then c.b else c.a end
        ${matchJoins}
        where (c.a=$1 or c.b=$1) and not c.closed
        and (c.matched or g.seen_at > now()-interval '90 seconds')
        order by ${chatOrder}`, [id]);
      const active = chats.find(chat => !chat.matched);
      const requested = newBarChat ?? (write && action !== 'report-last' ? input.chatId : req.nextUrl.searchParams.get('chat'));
      const [advanced] = uuid(requested) && !chats.some(chat => chat.id === requested)
        ? await query('select id from chat where id=$2 and (a=$1 or b=$1) and ended_by_next', [id, requested]) : [];
      const barMatch = chats.find(chat => chat.barPending);
      const requestedChat = action === 'bar-dismiss' ? undefined : chats.find(chat => chat.id === requested);
      const selected = (requestedChat?.matched ? requestedChat : undefined) ?? barMatch ?? active;
      const before = !write ? req.nextUrl.searchParams.get('before') : null;
      if (before !== null && (!messageId(before) || !requestedChat?.matched)) throw new InputError('Choose a saved conversation and message.');
      const page = selected ? await query(`select id::text, sender=$1 as mine, body
        from message where chat_id=$2 and ($3::bigint is null or id<$3::bigint)
        order by message.id desc limit 201`, [id, selected.id, before]) : [];
      const messages = page.slice(0, 200).reverse();
      const hasEarlier = Boolean(selected?.matched && page.length > 200);
      if (before !== null) return { messages, hasEarlier };
      const [invite] = savedMatchFeatures && selected?.matched ? await query(`select version, venue, ${meetupStatus} as status, proposer=$1 as mine,
        to_char(meetup_date,'YYYY-MM-DD') as date
        ${extendedMeetups ? ",to_char(meetup_time,'HH24:MI') as time" : ''}
        from meetup_invite where chat_id=$2`, [id, selected.id]) : [];
      const [lastReportable] = await query(`select recent.id from (
        select c.id from chat c where (c.a=$1 or c.b=$1) and c.closed
          and c.ended_at>now()-interval '15 minutes' order by c.ended_at desc limit 1
        ) recent where not exists (select 1 from report r where r.actor=$1 and r.chat_id=recent.id)`, [id]);
      return { profile: current, active, selected, candidate, newBarChat, advancedChat: advanced?.id, matches: chats.filter(chat => chat.matched), messages,
        invite, savedMatchFeatures, retrySends, extendedMeetups, hasEarlier, guestControls, photosReady,
        availableSpots, lastReportableChat: lastReportable?.id, activeUsers: await activeUsers() };
    });
    if (photoCleanupGuest) await cleanPhotoFiles(photoCleanupGuest);
    const response = NextResponse.json(result, { status: deniedSignup ? 403 : 200, headers: { 'Cache-Control': 'no-store' } });
    const cookieOptions = { httpOnly: true, secure: Boolean(process.env.VERCEL) || req.nextUrl.protocol === 'https:',
      sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 * 365 };
    if (created && id) response.cookies.set(guestCookie, id, cookieOptions);
    if (clearSession) response.cookies.set(guestCookie, '', { ...cookieOptions, maxAge: 0 });
    if (issueBrowser) response.cookies.set(browserCookie, issueBrowser, cookieOptions);
    return response;
  } catch (error) {
    if (error instanceof MessageRateError) {
      return NextResponse.json({ error: error.message }, { status: 429, headers: { 'Retry-After': String(error.retryAfter) } });
    }
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof InviteConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error(error instanceof Error ? error.message : 'Database error');
    return NextResponse.json({ error: 'Shattana is temporarily unavailable.' }, { status: 503 });
  }
}

export const GET = (req: NextRequest) => handle(req, false);
export const POST = (req: NextRequest) => handle(req, true);
