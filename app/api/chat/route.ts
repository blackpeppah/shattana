import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { transact } from '../../../db/store';
import { genders, barInterests, drinks, spots, reasons } from '../../options';
import { challengeConfig, verifyJoinChallenge } from './turnstile';

const cookie = 'shattana_guest';
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
class InputError extends Error {}
class MessageRateError extends Error {}
const adultAge = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 18 && value <= 120;
const barEligibility = `
  from guest g join guest me on me.id=$1
  where g.id<>me.id and g.bar_answer is not null and me.bar_answer is not null
  and g.bar_age between me.bar_min_age and me.bar_max_age
  and me.bar_age between g.bar_min_age and g.bar_max_age
  and (me.bar_interest='Everyone' or me.bar_interest=g.bar_gender)
  and (g.bar_interest='Everyone' or g.bar_interest=me.bar_gender)
  and not exists (select 1 from block where (actor=me.id and target=g.id) or (actor=g.id and target=me.id))
  and not exists (select 1 from chat where matched and least(a,b)=least(me.id,g.id)
    and greatest(a,b)=greatest(me.id,g.id))
`;

async function handle(req: NextRequest, write: boolean) {
  try {
    const origin = req.headers.get('origin');
    if (write && (!origin || !URL.canParse(origin) || new URL(origin).host !== req.headers.get('host') ||
      req.headers.get('sec-fetch-site') === 'cross-site')) {
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
    const token = req.cookies.get(cookie)?.value;
    let id = uuid(token) ? token : null;
    let created = false;
    const result = await transact(write, async query => {
      let [profile] = id ? await query('select * from guest where id=$1', [id]) : [];
      if (!profile && input.action === 'join') {
        const nickname = clean(input.nickname, 24);
        if (!nickname || input.adult !== true) throw new InputError('Choose a nickname and confirm you are 18+.');
        id = randomUUID();
        created = true;
        [profile] = await query('insert into guest(id,nickname,school,drink,spot) values($1,$2,$3,$4,$5) returning *',
          [id, nickname, clean(input.school, 60), '', '']);
      }
      const activeUsers = async () => {
        const [presence] = await query("select count(*)::int as total from guest where seen_at > now()-interval '90 seconds'");
        return Number(presence.total);
      };
      if (!profile) return { profile: null, activeUsers: await activeUsers(), challenge: { required: challenge.required, siteKey: challenge.siteKey } };
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
          const [closed] = await query(`update chat set closed=true, ended_at=case when closed then ended_at else now() end
            where id=$2 and (a=$1 or b=$1) and not matched returning id`, [id, input.chatId]);
          if (!closed) throw new InputError('This Quick Chat has ended.');
        } else if (action === 'find') {
          const spot = input.spot === 'Acacia' ? 'Akasya' : input.spot;
          const gender = genders.includes(input.quickGender) ? input.quickGender : '';
          await query('update guest set drink=$2,spot=$3,quick_gender=$4 where id=$1',
            [id, drinks.includes(input.drink) ? input.drink : '', spots.includes(spot) ? spot : '', gender]);
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
            if (!reasons.includes(input.reason)) throw new InputError('Choose a report reason.');
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
      if (['send','shot','leave','unmatch','block','report'].includes(action)) {
        if (!uuid(input.chatId)) throw new InputError('Choose a conversation.');
        const [chat] = await query('select * from chat where id=$2 and (a=$1 or b=$1) and not closed', [id, input.chatId]);
        if (!chat) throw new InputError('This chat has ended.');
        const peer = chat.a === id ? chat.b : chat.a;
        if (action === 'send') {
          const body = clean(input.body, 1000);
          if (!body) throw new InputError('Write a message first.');
          const [rate] = await query(`select count(*)::int as total,
            (count(*) filter (where created_at > now() - interval '10 seconds'))::int as recent
            from message where chat_id=$1 and sender=$2`, [chat.id, id]);
          if (Number(rate.total) >= 1000) throw new InputError('This chat has reached its message limit.');
          if (Number(rate.recent) >= 8) throw new MessageRateError('Give it a few seconds before sending another message.');
          await query('insert into message(chat_id,sender,body) values($1,$2,$3)', [chat.id, id, body]);
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
        if (action === 'report') {
          if (!reasons.includes(input.reason)) throw new InputError('Choose a report reason.');
          await query('insert into report(actor,target,chat_id,reason) values($1,$2,$3,$4) on conflict do nothing',
            [id, peer, chat.id, input.reason]);
        }
        if (action === 'block' || action === 'report') {
          await query('insert into block(actor,target) values($1,$2) on conflict do nothing', [id, peer]);
          await query('update chat set closed=true, ended_at=now() where not closed and ((a=$1 and b=$2) or (b=$1 and a=$2))', [id, peer]);
        }
      }

      const [current] = await query(`select nickname, school, drink, spot, quick_gender as "quickGender",
        bar_age as age, bar_gender as gender, bar_interest as interest, bar_min_age as "minAge",
        bar_max_age as "maxAge", bar_spot as favorite, bar_answer as answer,
        (queued_at is not null and seen_at>now()-interval '35 seconds') as waiting from guest where id=$1`, [id]);
      const after = action === 'bar-next' ? input.target : req.nextUrl.searchParams.get('after');
      const [candidate] = showBar && current.answer ? await query(`select g.id, g.nickname,
        g.bar_spot as favorite, g.bar_answer as answer ${barEligibility}
        and ($2::uuid is null or g.id<>$2)
        and not exists (select 1 from bar_hi where sender=me.id and recipient=g.id)
        order by (g.id>$2::uuid) desc nulls last, g.id limit 1`, [id, uuid(after) ? after : null]) : [];
      const chats = await query(`select c.id,c.matched,g.nickname,g.school,g.spot,g.drink,
        case when c.a=$1 then c.b_gender else c.a_gender end as gender,
        case when c.a=$1 then c.a_shot else c.b_shot end as shot,
        case when c.a=$1 then c.bar_pending_a else c.bar_pending_b end as "barPending"
        from chat c join guest g on g.id=case when c.a=$1 then c.b else c.a end
        where (c.a=$1 or c.b=$1) and not c.closed
        and (c.matched or g.seen_at > now()-interval '90 seconds') order by c.created_at desc`, [id]);
      const active = chats.find(chat => !chat.matched);
      const requested = newBarChat ?? (write ? input.chatId : req.nextUrl.searchParams.get('chat'));
      const barMatch = chats.find(chat => chat.barPending);
      const requestedChat = action === 'bar-dismiss' ? undefined : chats.find(chat => chat.id === requested);
      const selected = (requestedChat?.matched ? requestedChat : undefined) ?? barMatch ?? active;
      const messages = selected ? await query(`select * from (select id, sender=$1 as mine, body
        from message where chat_id=$2 order by id desc limit 200) recent order by id`, [id, selected.id]) : [];
      return { profile: current, active, selected, candidate, newBarChat, matches: chats.filter(chat => chat.matched), messages, activeUsers: await activeUsers() };
    });
    const response = NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    if (created && id) response.cookies.set(cookie, id, { httpOnly: true, secure: Boolean(process.env.VERCEL) || req.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
    return response;
  } catch (error) {
    if (error instanceof MessageRateError) {
      return NextResponse.json({ error: error.message }, { status: 429, headers: { 'Retry-After': '10' } });
    }
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error(error instanceof Error ? error.message : 'Database error');
    return NextResponse.json({ error: 'Shattana is temporarily unavailable.' }, { status: 503 });
  }
}

export const GET = (req: NextRequest) => handle(req, false);
export const POST = (req: NextRequest) => handle(req, true);
