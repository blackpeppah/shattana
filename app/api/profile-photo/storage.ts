import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { transact, type Query } from '../../../db/store';

const bucket = 'profile-photos';
const signingSeconds = 90;
const localRuntime = globalThis as typeof globalThis & { shattanaPhotoKey?: Buffer };

function remoteStorage() {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  const configured = process.env.SUPABASE_URL?.trim();
  if (!configured || !key?.startsWith('sb_secret_') || !URL.canParse(configured)) return null;
  const url = new URL(configured);
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return { base: `${url.origin}/storage/v1`, key };
}

export function localPhotoStorage() {
  return !process.env.VERCEL && !process.env.DATABASE_URL;
}

export function photoStorageAvailable() {
  return localPhotoStorage() || Boolean(remoteStorage());
}

function objectPath(guest: string, photo: string) {
  return `${guest}/${photo}.webp`;
}

function localFile(guest: string, photo: string) {
  return join(process.cwd(), '.shattana-photos', objectPath(guest, photo));
}

async function storageRequest(path: string, init: RequestInit) {
  const storage = remoteStorage();
  if (!storage) throw new Error('Profile photo storage is unavailable.');
  const headers = new Headers(init.headers);
  headers.set('apikey', storage.key);
  const response = await fetch(`${storage.base}${path}`, {
    ...init, headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(4500),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    const code = details?.message === 'Bucket not found' ? 'NoSuchBucket' : details?.code;
    const safeCode = typeof code === 'string' && /^[A-Z][a-zA-Z0-9]{1,49}$/.test(code) ? ` (${code})` : '';
    throw new Error(`Supabase Storage ${init.method ?? 'GET'} returned HTTP ${response.status}${safeCode}.`);
  }
  return { response, base: storage.base };
}

export async function storePhoto(guest: string, photo: string, body: Uint8Array<ArrayBuffer>) {
  if (localPhotoStorage()) {
    const file = localFile(guest, photo);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body, { flag: 'wx' });
    return;
  }
  await storageRequest(`/object/${bucket}/${objectPath(guest, photo)}`, {
    method: 'POST', headers: { 'Content-Type': 'image/webp', 'cache-control': 'max-age=0', 'x-upsert': 'false' }, body,
  });
}

export async function signedPhotoURL(guest: string, photo: string) {
  const path = `/object/sign/${bucket}/${objectPath(guest, photo)}`;
  const { response, base } = await storageRequest(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: signingSeconds }),
  });
  const { signedURL } = await response.json();
  if (typeof signedURL !== 'string' || !signedURL.startsWith(`${path}?token=`)) throw new Error('Invalid photo URL.');
  return base + signedURL;
}

function localSignature(viewer: string, params: URLSearchParams) {
  localRuntime.shattanaPhotoKey ??= randomBytes(32);
  return createHmac('sha256', localRuntime.shattanaPhotoKey).update(`${viewer}:${params}`).digest();
}

export function signedLocalPhotoURL(viewer: string, params: URLSearchParams) {
  params.set('expires', String(Math.floor(Date.now() / 1000) + signingSeconds));
  params.set('token', localSignature(viewer, params).toString('hex'));
  return '/api/profile-photo?' + params;
}

export async function readLocalPhoto(viewer: string, guest: string, photo: string, params: URLSearchParams) {
  const token = params.get('token');
  const expires = Number(params.get('expires'));
  if (!token || !/^[0-9a-f]{64}$/.test(token) || !Number.isSafeInteger(expires) || expires <= Date.now() / 1000) return;
  params.delete('token');
  if (!timingSafeEqual(Buffer.from(token, 'hex'), localSignature(viewer, params))) return;
  return readPhotoObject(guest, photo);
}

export async function readPhotoObject(guest: string, photo: string) {
  if (localPhotoStorage()) return new Uint8Array(await readFile(localFile(guest, photo)));
  const { response } = await storageRequest(`/object/authenticated/${bucket}/${objectPath(guest, photo)}`, { method: 'GET' });
  return new Uint8Array(await response.arrayBuffer());
}

export async function queuePhotoDeletion(query: Query, guest: string, photo: string, reserve = false) {
  await query(`insert into guest_photo_cleanup(guest_id,photo_id,delete_after)
    values($1,$2,now()+case when $3 then interval '10 minutes' else interval '0 seconds' end)
    on conflict (guest_id,photo_id) do update set delete_after=excluded.delete_after`, [guest, photo, reserve]);
}

export async function cleanPhotoFiles(currentGuest?: string, limit = 12) {
  try {
    const files = await transact(true, async query => {
      const due = await query<{ guest_id: string; photo_id: string }>(`select guest_id,photo_id
        from guest_photo_cleanup q where delete_after<=now()
        and not exists (select 1 from guest g where g.id=q.guest_id and g.photo_id=q.photo_id)
        and (q.deleting or (not exists (select 1 from report r where r.target=q.guest_id and r.photo_id=q.photo_id
          and r.review_status='pending' and r.created_at>now()-interval '90 days')
        and not exists (select 1 from guest_photo_view v where v.owner=q.guest_id and v.photo_id=q.photo_id and v.expires_at>now())))
        order by (guest_id=$1) desc, delete_after limit $2`, [currentGuest ?? null, limit]);
      if (!due.length) return due;
      if (!photoStorageAvailable()) throw new Error('Photo cleanup requires Storage configuration.');
      await query(`update guest_photo_cleanup set deleting=true, delete_after=now()+interval '1 minute'
        where (guest_id,photo_id) in (select * from unnest($1::uuid[],$2::uuid[]))`,
      [due.map(file => file.guest_id), due.map(file => file.photo_id)]);
      return due;
    });
    if (!files.length) return 0;
    if (localPhotoStorage()) {
      await Promise.all(files.map(file => rm(localFile(file.guest_id, file.photo_id), { force: true })));
    } else {
      await storageRequest(`/object/${bucket}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: files.map(file => objectPath(file.guest_id, file.photo_id)) }),
      });
    }
    await transact(true, async query => {
      await query(`delete from guest_photo_cleanup where (guest_id,photo_id) in
        (select * from unnest($1::uuid[],$2::uuid[]))`, [files.map(file => file.guest_id), files.map(file => file.photo_id)]);
    });
    return files.length;
  } catch {
    console.error('Profile photo file cleanup failed. The queued objects can be retried.');
    return null;
  }
}
