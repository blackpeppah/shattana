import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { transact } from '../../../db/store';
import { drinks, spots, reasons } from '../../options';

const cookie = 'shattana_guest';
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
class InputError extends Error {}

async function handle(req: NextRequest, write: boolean) {
  try {
    const origin = req.headers.get('origin');
    if (write && (!origin || new URL(origin).host !== req.headers.get('host') ||
      req.headers.get('sec-fetch-site') === 'cross-site')) {
      return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
    }
    const input = write ? await req.json().catch(() => null) : {};
    if (!input || typeof input !== 'object') throw new InputError('Invalid request.');
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
      if (!profile) return { profile: null };
      const action = input.action;
      if (write) {
        await query("update guest set seen_at=now() where id=$1", [id]);
        await query(`update chat set closed=true where (a=$1 or b=$1) and not matched and not closed
          and exists (select 1 from guest where id in (chat.a,chat.b) and seen_at < now()-interval '90 seconds')`, [id]);
      }
      if (action === 'find' || action === 'next') {
        if (action === 'next') {
          await query('update chat set closed=true where (a=$1 or b=$1) and not matched and not closed', [id]);
        } else {
          await query('update guest set drink=$2,spot=$3 where id=$1',
            [id, drinks.includes(input.drink) ? input.drink : '', spots.includes(input.spot) ? input.spot : '']);
        }
        const [active] = await query('select id from chat where (a=$1 or b=$1) and not matched and not closed', [id]);
        if (!active) {
          const [peer] = await query(`select g.id from guest g where g.id<>$1
            and g.queued_at > now()-interval '35 seconds'
            and not exists (select 1 from block where (actor=$1 and target=g.id) or (actor=g.id and target=$1))
            and not exists (select 1 from chat where ((a=$1 and b=g.id) or (b=$1 and a=g.id)) and (matched or created_at > now()-interval '2 minutes'))
            order by queued_at limit 1`, [id]);
          if (peer) {
            await query('insert into chat(id,a,b) values($1,$2,$3)', [randomUUID(), id, peer.id]);
            await query('update guest set queued_at=null where id in ($1,$2)', [id, peer.id]);
          } else {
            await query('update guest set queued_at=now() where id=$1', [id]);
          }
        }
      }
      if (action === 'heartbeat') await query("update guest set queued_at=now() where id=$1 and queued_at>now()-interval '35 seconds'", [id]);
      if (action === 'cancel') await query('update guest set queued_at=null where id=$1', [id]);
      if (['send','shot','block','report'].includes(action)) {
        if (!uuid(input.chatId)) throw new InputError('Choose a conversation.');
        const [chat] = await query('select * from chat where id=$2 and (a=$1 or b=$1) and not closed', [id, input.chatId]);
        if (!chat) throw new InputError('This chat has ended.');
        const peer = chat.a === id ? chat.b : chat.a;
        if (action === 'send') {
          const body = clean(input.body, 1000);
          if (!body) throw new InputError('Write a message first.');
          const [rate] = await query("select count(*)::int as count from message where chat_id=$1 and sender=$2", [chat.id, id]);
          if (Number(rate.count) >= 1000) throw new InputError('This chat has reached its message limit.');
          await query('insert into message(chat_id,sender,body) values($1,$2,$3)', [chat.id, id, body]);
        }
        if (action === 'shot') {
          await query(`update chat set a_shot=a_shot or a=$1,b_shot=b_shot or b=$1,
            matched=(a_shot or a=$1) and (b_shot or b=$1) where id=$2`, [id, chat.id]);
        }
        if (action === 'report') {
          if (!reasons.includes(input.reason)) throw new InputError('Choose a report reason.');
          await query('insert into report(actor,target,chat_id,reason) values($1,$2,$3,$4) on conflict do nothing',
            [id, peer, chat.id, input.reason]);
        }
        if (action === 'block' || action === 'report') {
          await query('insert into block(actor,target) values($1,$2) on conflict do nothing', [id, peer]);
          await query('update chat set closed=true where (a=$1 and b=$2) or (b=$1 and a=$2)', [id, peer]);
        }
      }

      const [current] = await query("select nickname, school, drink, spot, coalesce(queued_at>now()-interval '35 seconds',false) as waiting from guest where id=$1", [id]);
      const chats = await query(`select c.id,c.matched,g.nickname,g.school,g.spot,g.drink,
        case when c.a=$1 then c.a_shot else c.b_shot end as shot
        from chat c join guest g on g.id=case when c.a=$1 then c.b else c.a end
        where (c.a=$1 or c.b=$1) and not c.closed
        and (c.matched or g.seen_at > now()-interval '90 seconds') order by c.created_at desc`, [id]);
      const active = chats.find(chat => !chat.matched);
      const requested = write ? input.chatId : req.nextUrl.searchParams.get('chat');
      const selected = chats.find(chat => chat.id === requested) ?? active;
      const messages = selected ? await query(`select * from (select id, sender=$1 as mine, body
        from message where chat_id=$2 order by id desc limit 200) recent order by id`, [id, selected.id]) : [];
      return { profile: current, active, selected, matches: chats.filter(chat => chat.matched), messages };
    });
    const response = NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    if (created && id) response.cookies.set(cookie, id, { httpOnly: true, secure: Boolean(process.env.VERCEL) || req.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
    return response;
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error(error instanceof Error ? error.message : 'Database error');
    return NextResponse.json({ error: 'Shattana is temporarily unavailable.' }, { status: 503 });
  }
}

export const GET = (req: NextRequest) => handle(req, false);
export const POST = (req: NextRequest) => handle(req, true);
