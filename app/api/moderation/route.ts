import { NextRequest } from 'next/server';
import { transact } from '../../../db/store';
import { moderationDenied, moderationReply as respond, reportId, setGuestSuspension } from './access';

const statuses = ['pending', 'reviewed', 'dismissed'];
const pageSize = 25;

async function handle(req: NextRequest, write: boolean) {
  const denied = moderationDenied(req, write);
  if (denied) return denied;
  try {
    const input = write ? await req.json().catch(() => null) : null;
    const status = req.nextUrl.searchParams.get('status') ?? 'pending';
    const selected = req.nextUrl.searchParams.get('case');
    const requestedPage = Number(req.nextUrl.searchParams.get('page') ?? 1);
    if (!statuses.includes(status) || (selected !== null && !reportId(selected)) ||
      !Number.isSafeInteger(requestedPage) || requestedPage < 1) return respond({ error: 'Invalid report filter.' }, 400);
    if (write && (!reportId(input?.id) || !statuses.includes(input?.status) || typeof input.suspend !== 'boolean')) {
      return respond({ error: 'Choose a report and review action.' }, 400);
    }
    if (write && input.suspend && (status !== 'pending' || input.status !== status)) {
      return respond({ error: 'Open a pending report before suspending a guest.' }, 400);
    }
    return await transact(write, async query => {
      const [settings] = await query("select to_regclass('guest_rate_limit') is not null as ready");
      if (!settings.ready) return respond({ error: 'Apply the moderation migration first.' }, 503);
      if (write) {
        const [report] = await query('select target,review_status from report where id=$1 for update', [input.id]);
        if (!report) return respond({ error: 'Report unavailable.' }, 404);
        if (report.review_status !== status) return respond({ error: 'This report has changed. Refresh the queue to see its current status.' }, 409);
        if (input.suspend && !await setGuestSuspension(query, report.target, true)) {
          return respond({ error: 'This guest session has already ended.' }, 409);
        }
        if (input.status !== status) {
          await query(`update report set review_status=$2, reviewed_at=case when $2='pending' then null else now() end
            where id=$1`, [input.id, input.status]);
        }
      }
      const results = await query<{ status: string; count: number }>(`select review_status as status, count(*)::int as count
        from report group by review_status`);
      const counts = Object.fromEntries(statuses.map(key => [key, results.find(row => row.status === key)?.count ?? 0]));
      const pages = Math.max(1, Math.ceil(counts[status] / pageSize));
      const page = Math.min(requestedPage, pages);
      const reports = await query(`select r.id::text, r.reason, r.created_at as "createdAt", r.reviewed_at as "reviewedAt",
        r.chat_id is not null as "hasConversation", g.nickname, g.suspended_at is not null as suspended,
        (g.session_ended_at is not null or g.deleted_at is not null) as "sessionEnded"
        from report r join guest g on g.id=r.target where r.review_status=$1
        order by (r.reason='Underage user') desc, r.created_at desc, r.id desc limit $2 offset $3`,
      [status, pageSize, (page - 1) * pageSize]);
      const showEvidence = selected && reports.some(report => report.id === selected);
      if (selected && !showEvidence && !write) {
        return respond({ error: 'This report has moved. Refresh the queue to find it.' }, 409);
      }
      const evidence = showEvidence ? await query(`select * from (
        select m.id::text, m.sender=r.target as "reportedGuest", m.body from report r join message m on m.chat_id=r.chat_id
        join chat c on c.id=r.chat_id where r.id=$1 and r.created_at>now()-interval '90 days'
        and (not c.closed or coalesce(c.ended_at,c.created_at)>now()-interval '90 days')
        and (m.created_at is null or m.created_at<=r.created_at) order by m.id desc limit 20
      ) recent order by id::bigint`, [selected]) : [];
      return respond({ reports, evidence, counts, page, pages });
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Moderation error');
    return respond({ error: 'Moderation is temporarily unavailable.' }, 503);
  }
}

export const GET = (req: NextRequest) => handle(req, false);
export const POST = (req: NextRequest) => handle(req, true);
