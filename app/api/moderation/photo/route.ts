import { NextRequest, NextResponse } from 'next/server';
import { transact } from '../../../../db/store';
import { readPhotoObject } from '../../profile-photo/storage';
import { moderationDenied, moderationReply, reportId } from '../access';

export async function GET(req: NextRequest) {
  const denied = moderationDenied(req, false);
  if (denied) return denied;
  const missing = () => moderationReply({ error: 'Photo evidence unavailable' }, 404);
  const report = req.nextUrl.searchParams.get('report');
  if (!reportId(report)) return missing();
  const file = () => transact(false, async query => {
    const [evidence] = await query<{ target: string; photo_id: string }>(`select r.target, r.photo_id from report r
      where r.id=$1 and r.reason='Fake or stolen photo' and r.review_status='pending' and r.photo_id is not null
      and r.created_at>now()-interval '90 days'
      and not exists (select 1 from guest_photo_cleanup q where q.guest_id=r.target and q.photo_id=r.photo_id and q.deleting)`, [report]);
    return evidence;
  });
  try {
    const evidence = await file();
    if (!evidence) return missing();
    const bytes = await readPhotoObject(evidence.target, evidence.photo_id);
    if (!await file()) return missing();
    return new NextResponse(bytes, { headers: {
      'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    return missing();
  }
}
