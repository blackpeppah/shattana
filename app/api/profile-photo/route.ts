import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { transact, type Query } from '../../../db/store';
import { photoMaxBytes, photoSide, photoTargetBytes } from '../../photo-options';
import { barCardEligibility, browserCookie, browserSuspended, guestCookie, sameGuestOrigin, uuid } from '../chat/access';
import { allowAttempt } from '../safety';
import { cleanPhotoFiles, localPhotoStorage, photoStorageAvailable, queuePhotoDeletion, readLocalPhoto,
  signedLocalPhotoURL, signedPhotoURL, storePhoto } from './storage';

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (data: object, status = 200) => NextResponse.json(data, { status, headers });
const missing = () => reply({ error: 'Photo unavailable.' }, 404);
const changed = () => reply({ error: 'Your photo changed. Reopen the editor and try again.' }, 409);
const unavailable = () => reply({ error: 'Photo storage is temporarily unavailable.' }, 503);
const photoGuest = `id=$1 and session_ended_at is null and deleted_at is null and suspended_at is null`;
const photoGuestFields = `photo_id, quick_photo, to_jsonb(guest)->>'browser_id' as browser_id,
  to_regclass('guest_suspended_browser') is not null as browser_ready`;

async function viewerPhoto(query: Query, viewer: string, browser: string | undefined, scope: string, target: string, revision: string) {
  const [guest] = await query(`select ${photoGuestFields} from guest where ${photoGuest}`, [viewer]);
  if (!guest || (guest.browser_ready && await browserSuspended(query, browser, guest.browser_id))) return;
  if (scope === 'own') return guest.photo_id === revision ? viewer : undefined;
  if (scope === 'bar') {
    const [peer] = await query<{ id: string }>(`select g.id ${barCardEligibility} and g.id=$2 and g.photo_id=$3`,
      [viewer, target, revision]);
    return peer?.id;
  }
  const [peer] = await query<{ id: string }>(`select g.id from chat c join guest g on g.id=case when c.a=$1 then c.b else c.a end
    where c.id=$2 and (c.a=$1 or c.b=$1) and not c.closed and not c.matched
    and g.suspended_at is null and g.session_ended_at is null and g.deleted_at is null
    and g.seen_at>now()-interval '90 seconds' and g.quick_photo and g.photo_id=$3
    and not exists (select 1 from block where (actor=$1 and target=g.id) or (actor=g.id and target=$1))`,
  [viewer, target, revision]);
  return peer?.id;
}

export async function GET(req: NextRequest) {
  const viewer = req.cookies.get(guestCookie)?.value;
  const browser = req.cookies.get(browserCookie)?.value;
  const params = new URLSearchParams(req.nextUrl.searchParams);
  const scope = params.get('scope');
  const revision = params.get('revision');
  const target = params.get('target') ?? '';
  if (!photoStorageAvailable() || !uuid(viewer) || !uuid(revision) ||
    !(scope === 'own' || ((scope === 'bar' || scope === 'quick') && uuid(target)))) return missing();

  const authorizedPhoto = () => transact(false, query => viewerPhoto(query, viewer, browser, scope, target, revision));
  try {
    const owner = await authorizedPhoto();
    if (!owner) return missing();
    if (params.has('token')) {
      if (!localPhotoStorage()) return missing();
      const bytes = await readLocalPhoto(viewer, owner, revision, params);
      return bytes ? new NextResponse(bytes, { headers: { ...headers, 'Content-Type': 'image/webp' } }) : missing();
    }
    if (localPhotoStorage()) return reply({ url: signedLocalPhotoURL(viewer, params) });
    const url = await signedPhotoURL(owner, revision);
    return await authorizedPhoto() === owner ? reply({ url }) : missing();
  } catch {
    return missing();
  }
}

async function cappedBody(req: NextRequest) {
  if (Number(req.headers.get('content-length')) > photoMaxBytes) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const buffer = Buffer.alloc(photoMaxBytes);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return buffer.subarray(0, length);
      if (length + value.byteLength > photoMaxBytes) {
        await reader.cancel();
        return null;
      }
      buffer.set(value, length);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}

async function normalizePhoto(bytes: Buffer, format: 'webp' | 'jpeg') {
  const image = sharp(bytes, { limitInputPixels: photoSide * photoSide, failOn: 'error' });
  const info = await image.metadata();
  if (info.format !== format || info.width !== photoSide || info.height !== photoSide || (info.pages ?? 1) > 1) return;
  // Sharp strips metadata by default, including EXIF and XMP.
  for (const quality of [85, 72, 58, 44]) {
    const output = await image.clone().webp({ quality }).toBuffer();
    if (output.length <= photoTargetBytes || (quality === 44 && output.length <= photoMaxBytes)) return new Uint8Array(output);
  }
}

async function update(req: NextRequest) {
  if (!sameGuestOrigin(req)) return reply({ error: 'Invalid request origin.' }, 403);
  if (!photoStorageAvailable()) return unavailable();
  const viewer = req.cookies.get(guestCookie)?.value;
  const browser = req.cookies.get(browserCookie)?.value;
  if (!uuid(viewer)) return reply({ error: 'Join as a guest to manage your photo.' }, 401);
  const previous = req.nextUrl.searchParams.get('previous');
  const sharing = req.nextUrl.searchParams.get('quick');
  if ((previous !== null && !uuid(previous)) || (req.method === 'PATCH' && (!previous || !['0', '1'].includes(sharing ?? '')))) {
    return reply({ error: 'Choose a valid photo setting.' }, 400);
  }

  let reserved: string | undefined;
  let cleanup = false;
  const availableGuest = async (query: Query) => {
    const [guest] = await query<{ photo_id: string | null; quick_photo: boolean; browser_id: string | null; browser_ready: boolean }>(
      `select ${photoGuestFields} from guest where ${photoGuest}`, [viewer]);
    return guest && !(guest.browser_ready && await browserSuspended(query, browser, guest.browser_id)) ? guest : undefined;
  };
  try {
    if (req.method !== 'POST') {
      const result = await transact(true, async query => {
        const guest = await availableGuest(query);
        if (!guest) return reply({ error: 'This guest session is unavailable.' }, 401);
        if (guest.photo_id !== previous) return changed();
        if (req.method === 'PATCH') {
          await query('update guest set quick_photo=$2 where id=$1', [viewer, sharing === '1']);
          return reply({ photoId: guest.photo_id, quickPhoto: sharing === '1' });
        }
        await query('update guest set photo_id=null,quick_photo=false where id=$1', [viewer]);
        if (guest.photo_id) await queuePhotoDeletion(query, viewer, guest.photo_id);
        return reply({ photoId: null, quickPhoto: false });
      });
      if (result.ok && req.method === 'DELETE') await cleanPhotoFiles(viewer);
      return result;
    }

    const denial = await transact(true, async query => {
      const guest = await availableGuest(query);
      if (!guest) return reply({ error: 'This guest session is unavailable.' }, 401);
      if (guest.photo_id !== previous) return changed();
      if (!await allowAttempt(query, 'photo-upload', viewer, 60, 10)) {
        return NextResponse.json({ error: 'Too many photo uploads. Try again in a minute.' },
          { status: 429, headers: { ...headers, 'Retry-After': '60' } });
      }
    });
    if (denial) return denial;
    const bytes = await cappedBody(req);
    if (!bytes) return reply({ error: 'Photos must be 150 KB or smaller.' }, 413);
    const contentType = req.headers.get('content-type');
    const format = contentType === 'image/webp' ? 'webp' : contentType === 'image/jpeg' ? 'jpeg' : undefined;
    const photo = format ? await normalizePhoto(bytes, format).catch(() => undefined) : undefined;
    if (!photo) return reply({ error: 'Choose a valid 512 × 512 WebP or JPEG crop.' }, 400);

    reserved = randomUUID();
    cleanup = true;
    const next = reserved;
    await transact(true, query => queuePhotoDeletion(query, viewer, next, true));
    await storePhoto(viewer, next, photo);
    const result = await transact(true, async query => {
      if (!await availableGuest(query)) return changed();
      const [guest] = await query(`update guest set photo_id=$3 where ${photoGuest}
        and photo_id is not distinct from $2::uuid returning quick_photo`, [viewer, previous, next]);
      if (!guest) return changed();
      await query('delete from guest_photo_cleanup where guest_id=$1 and photo_id=$2', [viewer, next]);
      if (previous) await queuePhotoDeletion(query, viewer, previous);
      return reply({ photoId: next, quickPhoto: guest.quick_photo });
    });
    if (result.ok) reserved = undefined;
    return result;
  } catch {
    return unavailable();
  } finally {
    if (reserved) {
      // A successful publish removes the reservation in the same transaction.
      await transact(true, async query => {
        await query('update guest_photo_cleanup set delete_after=now() where guest_id=$1 and photo_id=$2', [viewer, reserved]);
      }).catch(() => {});
    }
    if (cleanup) await cleanPhotoFiles(viewer);
  }
}

export const POST = update;
export const PATCH = update;
export const DELETE = update;
