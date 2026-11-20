import { NextRequest } from 'next/server';
import { transact } from '../../../../db/store';
import { moderationDenied, moderationReply as reply, setGuestSuspension } from '../access';

export async function GET(req: NextRequest) {
  const denied = moderationDenied(req, false);
  if (denied) return denied;
  const view = req.nextUrl.searchParams.get('view') ?? 'overview';
  const search = (req.nextUrl.searchParams.get('search') ?? '').trim().slice(0, 60);
  try {
    return await transact(false, async query => {
      const [setup] = await query(`select to_regclass('guest_rate_limit') is not null as ready,
        to_regclass('public.venue') is not null as "venuesReady"`);
      if (!setup.ready) return reply({ error: 'Apply the moderation schema first.' }, 503);
      if (view === 'overview') {
        const [stats] = await query(`select
          (select count(*)::int from guest where session_ended_at is null and deleted_at is null
            and suspended_at is null and seen_at>now()-interval '90 seconds') as active,
          (select count(*)::int from chat where not closed and matched) as matches,
          (select count(*)::int from report where review_status='pending') as pending`);
        return reply({ stats, venuesReady: setup.venuesReady });
      }
      if (view === 'guests') {
        const guests = await query(`select id,nickname,seen_at as "lastSeen",
          case when suspended_at is not null then 'suspended' when session_ended_at is not null then 'ended'
            when seen_at>now()-interval '90 seconds' then 'active' else 'available' end as status
          from guest where (deleted_at is null or suspended_at is not null) and strpos(lower(nickname),lower($1))>0
          order by seen_at desc limit 100`, [search]);
        return reply({ guests });
      }
      if (view === 'venues') {
        const venues = setup.venuesReady ? await query('select id,name from public.venue order by id') : [];
        return reply({ venues, venuesReady: setup.venuesReady });
      }
      return reply({ error: 'Choose a dashboard section.' }, 400);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Dashboard read failed');
    return reply({ error: 'The dashboard is temporarily unavailable.' }, 503);
  }
}

export async function POST(req: NextRequest) {
  const denied = moderationDenied(req, true);
  if (denied) return denied;
  const input = await req.json().catch(() => null);
  const action = input?.action;
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const id = input?.id;
  if ((action === 'create-venue' || action === 'rename-venue') && (!name || name.length > 60)) {
    return reply({ error: 'Enter a venue name from 1 to 60 characters.' }, 400);
  }
  if ((action === 'rename-venue' || action === 'delete-venue') && (!Number.isInteger(id) || id < 1 || id > 2147483647)) {
    return reply({ error: 'Choose a venue.' }, 400);
  }
  if (action === 'set-suspension' && (typeof input.suspended !== 'boolean' || typeof id !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) {
    return reply({ error: 'Choose a guest and suspension status.' }, 400);
  }
  if (!['create-venue', 'rename-venue', 'delete-venue', 'set-suspension'].includes(action)) {
    return reply({ error: 'Choose a dashboard action.' }, 400);
  }
  try {
    return await transact(true, async query => {
      if (action === 'set-suspension') {
        const updated = await setGuestSuspension(query, id, input.suspended);
        return updated ? reply({ ok: true }) : reply({ error: 'This guest session is unavailable.' }, 404);
      }
      const [setup] = await query("select to_regclass('public.venue') is not null as ready");
      if (!setup.ready) return reply({ error: 'Apply the venue schema first.' }, 503);
      const [venue] = action === 'create-venue'
        ? await query('insert into public.venue(name) values($1) returning id,name', [name])
        : action === 'rename-venue'
          ? await query('update public.venue set name=$2 where id=$1 returning id,name', [id, name])
          : await query('delete from public.venue where id=$1 returning id,name', [id]);
      return venue ? reply({ venue }, action === 'create-venue' ? 201 : 200)
        : reply({ error: 'This venue is no longer available.' }, 404);
    });
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') return reply({ error: 'That venue name already exists.' }, 409);
    console.error(error instanceof Error ? error.message : 'Dashboard write failed');
    return reply({ error: 'The change could not be saved.' }, 503);
  }
}
