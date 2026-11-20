import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { transact } from '../../../db/store';
import { cleanPhotoFiles } from '../profile-photo/storage';

export async function POST(req: NextRequest) {
  const secret = process.env.RETENTION_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: 'Retention job is unavailable.' }, { status: 404 });
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(req.headers.get('authorization') ?? '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    await transact(true, query => query('select public.shattana_prune_retention()'));
    const photosRemoved = await cleanPhotoFiles(undefined, 1000);
    if (photosRemoved === null) return NextResponse.json({ error: 'Storage cleanup remains queued.' }, { status: 503 });
    return NextResponse.json({ photosRemoved }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Retention job failed.' }, { status: 503 });
  }
}
