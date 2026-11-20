const assert = require('node:assert/strict');
const { randomBytes, randomUUID, scryptSync } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test, before, after } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const tempRoot = path.resolve(os.tmpdir());
const fixtures = { a: randomUUID(), b: randomUUID(), chat: randomUUID(), photoOwner: randomUUID(), photoViewer: randomUUID() };
const moderatorUsername = 'test-admin';
const moderatorPassword = randomUUID();
const moderatorSecret = randomUUID();
let directory, server, base;
let serverOutput = '';

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

before(async () => {
  directory = await fs.mkdtemp(path.join(tempRoot, 'shattana-test-'));
  for (const name of ['.next', 'node_modules']) {
    await fs.symlink(path.join(root, name), path.join(directory, name), 'junction');
  }
  await fs.cp(path.join(root, 'db'), path.join(directory, 'db'), { recursive: true });
  const db = new PGlite(path.join(directory, '.shattana-db'));
  try {
    await db.exec(await fs.readFile(path.join(root, 'db/schema.sql'), 'utf8'));
    await db.query("insert into guest(id,nickname,school,drink,spot) values($1,'History A','','',''),($2,'History B','','','')", [fixtures.a, fixtures.b]);
    await db.query("insert into guest(id,nickname,school,drink,spot) values($1,'Photo Owner','','',''),($2,'Photo Viewer','','','')",
      [fixtures.photoOwner, fixtures.photoViewer]);
    await db.query('insert into chat(id,a,b,matched) values($1,$2,$3,true)', [fixtures.chat, fixtures.a, fixtures.b]);
    await db.query("insert into message(chat_id,sender,body) select $1,$2,'Message '||n from generate_series(1,205) n",
      [fixtures.chat, fixtures.b]);
    await db.query(`insert into meetup_invite(chat_id,version,proposer,venue,meetup_date,status)
      values($1,$2,$3,'Akasya',(now() at time zone 'Asia/Manila')::date-1,'pending')`,
    [fixtures.chat, randomUUID(), fixtures.b]);
  } finally {
    await db.close();
  }
  const env = { ...process.env };
  for (const key of ['DATABASE_URL', 'DATABASE_CA_CERT', 'VERCEL', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']) delete env[key];
  const salt = randomBytes(16);
  env.MODERATION_USERNAME = moderatorUsername;
  env.MODERATION_PASSWORD_HASH = salt.toString('hex') + ':' + scryptSync(moderatorPassword, salt, 64).toString('hex');
  env.MODERATION_SESSION_SECRET = moderatorSecret;
  const port = await availablePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start',
    '--hostname', '127.0.0.1', '--port', String(port)], { cwd: directory, env, windowsHide: true });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverOutput += chunk; });
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(base, { signal: AbortSignal.timeout(1000) }).catch(() => undefined);
    if (response?.ok) return;
    if (server.exitCode !== null) break;
    await delay(200);
  }
  assert.fail(`Local test server did not start.\n${serverOutput}`);
});

after(async () => {
  if (server && server.exitCode === null) {
    const closed = new Promise(resolve => server.once('close', resolve));
    server.kill();
    await closed;
  }
  if (!directory || path.dirname(directory) !== tempRoot || !path.basename(directory).startsWith('shattana-test-')) return;
  for (const name of ['.next', 'node_modules']) {
    const link = path.join(directory, name);
    if ((await fs.lstat(link).catch(() => null))?.isSymbolicLink()) await fs.unlink(link);
  }
  await fs.rm(directory, { recursive: true, force: true });
});

async function chat(session, action, fields = {}, expected = 200) {
  const params = new URLSearchParams();
  if (fields.bar) params.set('bar', '1');
  if (!action && fields.chatId) params.set('chat', fields.chatId);
  if (!action && fields.before) params.set('before', fields.before);
  const response = await fetch(base + '/api/chat?' + params, {
    method: action ? 'POST' : 'GET',
    headers: { origin: base, 'content-type': 'application/json', ...(session.cookie ? { cookie: session.cookie } : {}) },
    body: action ? JSON.stringify({ action, ...fields }) : undefined,
  });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length) {
    const cookies = new Map((session.cookie ?? '').split('; ').filter(Boolean).map(cookie => [cookie.split('=')[0], cookie]));
    for (const header of setCookies) {
      const [cookie] = header.split(';');
      const key = cookie.split('=')[0];
      if (cookie.endsWith('=')) cookies.delete(key);
      else cookies.set(key, cookie);
    }
    session.cookie = [...cookies.values()].join('; ');
  }
  return data;
}

async function pair(nicknameA, nicknameB) {
  const a = {}, b = {};
  await chat(a, 'join', { nickname: nicknameA, adult: true });
  await chat(b, 'join', { nickname: nicknameB, adult: true });
  assert.equal((await chat(a, 'find')).profile.waiting, true);
  const { id } = (await chat(b, 'find')).active;
  assert.equal((await chat(a)).active.id, id);
  return { a, b, id };
}

test('two guests match, retry safely, and keep newer messages unread', async () => {
  const { a, b, id } = await pair('Kai', 'Sol');
  await chat(a, 'shot', { chatId: id });
  assert.equal((await chat(b)).selected.shot, false);
  await chat(b, 'shot', { chatId: id });
  assert.equal((await chat(a, undefined, { chatId: id })).selected.matched, true);
  const nonce = randomUUID();
  const fields = { chatId: id, nonce, body: 'A message with a safe retry' };
  const first = (await chat(b, 'send', fields)).messages.at(-1).id;
  assert.equal((await chat(b, 'send', fields)).messages.length, 1);
  const second = (await chat(b, 'send', { chatId: id, body: 'Newer message' })).messages.at(-1).id;
  await chat(a, 'read', { chatId: id, through: first });
  const restored = await chat({ cookie: a.cookie }, undefined, { chatId: id });
  assert.equal(restored.selected.unread, true);
  assert.equal(restored.selected.readThrough, first);
  await chat(a, 'read', { chatId: id, through: second });
  assert.equal((await chat(a)).matches[0].unread, false);
  assert.equal((await chat(b)).matches[0].unread, false);

  const date = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
  const proposed = (await chat(a, 'meetup-propose', { chatId: id, venue: 'Akasya', date, time: '18:30', version: null })).invite;
  assert.equal((await chat(b, undefined, { chatId: id })).invite.time, '18:30');
  await chat(b, 'meetup-withdraw', { chatId: id, version: proposed.version }, 400);
  const counter = (await chat(b, 'meetup-respond', {
    chatId: id, version: proposed.version, response: 'counter', venue: 'Aces',
  })).invite;
  await chat(a, 'meetup-respond', { chatId: id, version: proposed.version, response: 'accept' }, 409);
  const accepted = (await chat(a, 'meetup-respond', { chatId: id, version: counter.version, response: 'accept' })).invite;
  assert.equal(accepted.status, 'accepted');
  const replacement = (await chat(a, 'meetup-propose', { chatId: id, version: accepted.version, venue: 'Akasya', date })).invite;
  assert.equal((await chat(a, 'meetup-withdraw', { chatId: id, version: replacement.version })).invite.status, 'withdrawn');
});

test('a guest can report the closed chat after Next', async () => {
  const { a, b, id } = await pair('Luz', 'Ira');
  await chat(a, 'next', { chatId: id });
  assert.equal((await chat(b)).lastReportableChat, id);
  await chat(b, 'report-last', { chatId: id, reason: 'Harassment' });
  await chat(a, 'cancel');
  await chat(b, 'cancel');
  assert.equal((await chat(b)).lastReportableChat, undefined);
});

test('saved history paginates without overlap', async () => {
  const a = { cookie: 'shattana_guest=' + fixtures.a };
  const latest = await chat(a, undefined, { chatId: fixtures.chat });
  assert.equal(latest.messages.length, 200);
  assert.equal(latest.hasEarlier, true);
  const earlier = await chat(a, undefined, { chatId: fixtures.chat, before: latest.messages[0].id });
  assert.deepEqual(earlier.messages.map(message => message.body), ['Message 1', 'Message 2', 'Message 3', 'Message 4', 'Message 5']);
  assert.equal(earlier.hasEarlier, false);
  assert.equal(latest.invite.status, 'expired');
  await chat(a, 'meetup-respond', { chatId: fixtures.chat, version: latest.invite.version, response: 'accept' }, 409);
  await chat({ cookie: 'shattana_guest=' + fixtures.b }, undefined, { chatId: randomUUID(), before: latest.messages[0].id }, 400);
});

test('admin sign-in protects the report queue and sign-out clears the browser session', async () => {
  const queue = base + '/moderation';
  const api = base + '/api/moderation';
  const session = api + '/session';
  const anonymous = await fetch(queue, { redirect: 'manual' });
  assert.equal(anonymous.status, 307);
  assert.equal(anonymous.headers.get('location'), '/admin');
  assert.equal((await fetch(api)).status, 401);

  const signIn = (username, password, origin = base) => fetch(session, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal((await signIn(moderatorUsername, moderatorPassword, 'https://example.com')).status, 403);
  assert.equal((await signIn(moderatorUsername, 'wrong password')).status, 401);
  assert.equal((await signIn('wrong user', moderatorPassword)).status, 401);
  assert.equal((await fetch(api, { headers: { Authorization: 'Bearer ' + moderatorSecret } })).status, 401);
  const authenticated = await signIn(moderatorUsername, moderatorPassword);
  assert.equal(authenticated.status, 200);
  const saved = authenticated.headers.get('set-cookie');
  assert.match(saved, /HttpOnly/i);
  assert.match(saved, /SameSite=strict/i);
  assert.ok(!saved.includes(moderatorPassword));
  const cookie = saved.split(';')[0];
  assert.equal((await fetch(queue, { headers: { cookie }, redirect: 'manual' })).status, 200);
  const reports = await fetch(api, { headers: { cookie } });
  assert.equal(reports.status, 200);
  assert.equal(reports.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(api, {
    method: 'POST', headers: { origin: 'https://example.com', cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ id: '1', status: 'reviewed', suspend: false }),
  })).status, 403);
  assert.equal((await fetch(api, { headers: { cookie: cookie + 'invalid' } })).status, 401);
  const signedOut = await fetch(session, { method: 'DELETE', headers: { cookie, origin: base } });
  assert.equal(signedOut.status, 200);
  assert.match(signedOut.headers.get('set-cookie'), /Max-Age=0/i);
});

test('admin venue CRUD drives guest pickers and guest suspension controls access', async () => {
  const url = base + '/api/moderation/dashboard';
  const session = await fetch(base + '/api/moderation/session', {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ username: moderatorUsername, password: moderatorPassword }),
  });
  assert.equal(session.status, 200);
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const read = async (params = '') => {
    const response = await fetch(url + params, { headers: { cookie } });
    assert.equal(response.status, 200);
    return response.json();
  };
  const change = async (fields, status = 200, origin = base) => {
    const response = await fetch(url, {
      method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(fields),
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  assert.equal((await fetch(url)).status, 401);
  await change({ action: 'create-venue', name: 'Cross-origin' }, 403, 'https://example.com');
  assert.ok((await read()).stats.pending >= 1);
  assert.ok((await read('?view=venues')).venues.some(venue => venue.name === 'Akasya'));
  await change({ action: 'create-venue', name: 'akasya' }, 409);
  const { venue } = await change({ action: 'create-venue', name: 'Smoke Test Café' }, 201);
  const a = { cookie: 'shattana_guest=' + fixtures.a };
  const b = { cookie: 'shattana_guest=' + fixtures.b };
  assert.ok((await chat(a)).availableSpots.includes(venue.name));
  const { venue: renamed } = await change({ action: 'rename-venue', id: venue.id, name: 'Updated Café' });
  const saved = await chat(a, undefined, { chatId: fixtures.chat });
  assert.ok(saved.availableSpots.includes(renamed.name));
  assert.ok(!saved.availableSpots.includes(venue.name));
  const date = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
  const invite = (await chat(a, 'meetup-propose', {
    chatId: fixtures.chat, version: saved.invite.version, venue: renamed.name, date,
  })).invite;
  await change({ action: 'delete-venue', id: venue.id });
  assert.ok(!(await chat(a)).availableSpots.includes(renamed.name));
  await change({ action: 'delete-venue', id: venue.id }, 404);
  const accepted = (await chat(b, 'meetup-respond', { chatId: fixtures.chat, version: invite.version, response: 'accept' })).invite;
  assert.equal(accepted.venue, renamed.name);
  await chat(a, 'meetup-propose', { chatId: fixtures.chat, version: accepted.version, venue: renamed.name, date }, 400);

  const guest = (await read('?view=guests&search=History%20A')).guests[0];
  assert.equal(guest.id, fixtures.a);
  await change({ action: 'set-suspension', id: guest.id, suspended: true });
  assert.equal((await chat(a)).suspended, true);
  assert.equal((await chat(b)).matches.length, 0);
  await change({ action: 'set-suspension', id: guest.id, suspended: false });
  assert.equal((await chat(a)).profile.nickname, 'History A');
});

test('admin counts reflect guest activity and report review stays separate from suspension', async () => {
  const session = await fetch(base + '/api/moderation/session', {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ username: moderatorUsername, password: moderatorPassword }),
  });
  assert.equal(session.status, 200);
  const headers = { cookie: session.headers.get('set-cookie').split(';')[0], origin: base, 'content-type': 'application/json' };
  const moderation = base + '/api/moderation';
  const call = async (path, body, status = 200) => {
    const response = await fetch(moderation + path, {
      headers, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };

  const before = (await call('/dashboard')).stats.active;
  const { a, b, id } = await pair('Report Target', 'Report Sender');
  assert.equal((await call('/dashboard')).stats.active, before + 2);
  await chat(a, 'send', { chatId: id, body: 'Message from the reported guest' });
  await chat(b, 'report', { chatId: id, reason: 'Underage user' });
  const pending = await call('?status=pending');
  const [report] = pending.reports;
  assert.equal(report.reason, 'Underage user');
  assert.equal(report.nickname, 'Report Target');
  assert.equal(pending.counts.pending, 2);
  assert.deepEqual(pending.evidence, []);
  const details = await call('?status=pending&case=' + report.id);
  assert.deepEqual(details.evidence.map(({ reportedGuest, body }) => ({ reportedGuest, body })),
    [{ reportedGuest: true, body: 'Message from the reported guest' }]);

  const suspended = await call('?status=pending&case=' + report.id, { id: report.id, status: 'pending', suspend: true });
  assert.equal(suspended.reports[0].suspended, true);
  assert.equal(suspended.counts.pending, 2);
  assert.equal((await chat(a)).suspended, true);
  assert.equal((await call('/dashboard')).stats.active, before + 1);
  assert.equal((await call('/dashboard?view=guests&search=Report%20Target')).guests[0].status, 'suspended');

  const reviewed = await call('?status=pending', { id: report.id, status: 'reviewed', suspend: false });
  assert.equal(reviewed.counts.reviewed, 1);
  assert.ok((await call('?status=reviewed')).reports[0].reviewedAt);
  await call('?status=pending', { id: report.id, status: 'dismissed', suspend: false }, 409);
  await call('?status=reviewed', { id: report.id, status: 'pending', suspend: false });
  const dismissed = await call('?status=pending', { id: report.id, status: 'dismissed', suspend: false });
  assert.equal(dismissed.counts.dismissed, 1);
  assert.equal((await call('?status=dismissed')).reports[0].suspended, true);
  await chat(b, 'end-session');
  assert.equal((await call('/dashboard')).stats.active, before);
});

test('profile photos validate uploads and authorize only the owner, eligible cards and opted-in Quick Chats', async () => {
  const owner = { cookie: 'shattana_guest=' + fixtures.photoOwner };
  const viewer = { cookie: 'shattana_guest=' + fixtures.photoViewer };
  const profile = { age: 26, gender: 'Woman', interest: 'Everyone', minAge: 18, maxAge: 40, favorite: 'Petals', answer: 'A quiet drink' };
  await chat(owner, 'bar-profile', profile);
  await chat(viewer, 'bar-profile', { ...profile, minAge: 30 });
  const endpoint = base + '/api/profile-photo';
  const photo = (session, params, method = 'GET', body, mime = 'image/webp') => fetch(endpoint + '?' + new URLSearchParams(params), {
    method, headers: { origin: base, ...(session.cookie ? { cookie: session.cookie } : {}), ...(body ? { 'content-type': mime } : {}) }, body,
  });
  const file = async (width, format = 'webp') => sharp({ create: { width, height: 512, channels: 3, background: '#963254' } })
    .withExif({ IFD0: { Artist: 'Should be stripped' } }).toFormat(format).toBuffer();
  assert.equal((await photo(owner, {}, 'POST', Buffer.alloc(150_001))).status, 413);
  assert.equal((await photo(owner, {}, 'POST', await file(512, 'png'))).status, 400);
  assert.equal((await photo(owner, {}, 'POST', await file(256))).status, 400);
  const uploaded = await photo(owner, {}, 'POST', await file(512));
  assert.equal(uploaded.status, 200);
  const { photoId } = await uploaded.json();
  assert.equal((await chat(owner)).profile.quickPhoto, false);
  const card = { scope: 'bar', target: fixtures.photoOwner, revision: photoId };
  assert.equal((await photo(viewer, card)).status, 404);
  await chat(viewer, 'bar-profile', profile);
  assert.equal((await chat(viewer, undefined, { bar: true })).candidate.photoId, photoId);
  assert.equal((await photo({}, card)).status, 404);
  const { url: cardURL } = await (await photo(viewer, card)).json();
  const image = await fetch(base + cardURL, { headers: { cookie: viewer.cookie } });
  assert.equal(image.headers.get('content-type'), 'image/webp');
  const result = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
  assert.equal(result.width, 512);
  assert.equal(result.height, 512);
  assert.equal(result.exif, undefined);
  assert.equal((await fetch(base + cardURL, { headers: { cookie: owner.cookie } })).status, 404);
  const expired = new URL(cardURL, base);
  expired.searchParams.set('expires', '1');
  assert.equal((await fetch(expired, { headers: { cookie: viewer.cookie } })).status, 404);

  await chat(owner, 'find');
  const { active } = await chat(viewer, 'find');
  assert.equal(active.photoId, null);
  const quick = { scope: 'quick', target: active.id, revision: photoId };
  assert.equal((await photo(viewer, quick)).status, 404);
  assert.equal((await photo(owner, { previous: photoId, quick: '1' }, 'PATCH')).status, 200);
  assert.equal((await chat(owner)).profile.quickPhoto, true);
  assert.equal((await chat(viewer)).active.photoId, photoId);
  assert.equal((await photo({ cookie: 'shattana_guest=' + fixtures.a }, quick)).status, 404);
  const { url: quickURL } = await (await photo(viewer, quick)).json();
  assert.equal((await fetch(base + quickURL, { headers: { cookie: viewer.cookie } })).status, 200);
  await photo(owner, { previous: photoId, quick: '0' }, 'PATCH');
  assert.equal((await chat(viewer)).active.photoId, null);
  assert.equal((await photo(viewer, quick)).status, 404);
  assert.equal((await fetch(base + quickURL, { headers: { cookie: viewer.cookie } })).status, 404);
  await chat(viewer, 'leave', { chatId: active.id });

  const replacement = await photo(owner, { previous: photoId }, 'POST', await file(512, 'jpeg'), 'image/jpeg');
  assert.equal(replacement.status, 200);
  const { photoId: newId } = await replacement.json();
  assert.notEqual(newId, photoId);
  const disk = id => path.join(directory, '.shattana-photos', fixtures.photoOwner, id + '.webp');
  await assert.rejects(fs.access(disk(photoId)), { code: 'ENOENT' });
  await fs.access(disk(newId));
  assert.equal((await photo(owner, { previous: photoId }, 'DELETE')).status, 409);
  const newCard = { ...card, revision: newId };
  const { url: newCardURL } = await (await photo(viewer, newCard)).json();
  assert.equal((await fetch(base + newCardURL, { headers: { cookie: viewer.cookie } })).headers.get('content-type'), 'image/webp');
  await chat(viewer, 'bar-report', { target: fixtures.photoOwner, reason: 'Fake or stolen photo' });
  assert.equal((await chat(viewer, undefined, { bar: true })).candidate, undefined);
  assert.equal((await photo(viewer, newCard)).status, 404);
  assert.equal((await photo(owner, { previous: newId }, 'DELETE')).status, 200);
  assert.equal((await chat(owner)).profile.photoId, null);
  await assert.rejects(fs.access(disk(newId)), { code: 'ENOENT' });
});

test('a suspended browser stays blocked after data deletion until a moderator reinstates it', async () => {
  const guest = { cookie: 'shattana_guest=' + fixtures.photoOwner };
  // A guest from before the migration receives the browser cookie on their next request.
  await chat(guest);
  const browserCookie = guest.cookie.split('; ').find(cookie => cookie.startsWith('shattana_browser='));
  assert.ok(browserCookie);
  const login = await fetch(base + '/api/moderation/session', {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ username: moderatorUsername, password: moderatorPassword }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const moderate = suspended => fetch(base + '/api/moderation/dashboard', {
    method: 'POST', headers: { origin: base, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'set-suspension', id: fixtures.photoOwner, suspended }),
  });
  assert.equal((await moderate(true)).status, 200);
  assert.equal((await chat(guest)).guestControls, true);
  assert.equal((await chat(guest, 'join', { nickname: 'Another nickname', adult: true }, 403)).suspended, true);

  // Deleting data still works when suspended, even if the browser cookie was selectively removed.
  guest.cookie = 'shattana_guest=' + fixtures.photoOwner;
  assert.equal((await chat(guest, 'delete-data', { confirmation: 'DELETE' })).suspended, true);
  assert.equal(guest.cookie, browserCookie);
  const revisited = await chat(guest);
  assert.equal(revisited.suspended, true);
  assert.equal(revisited.guestControls, false);
  await chat(guest, 'join', { nickname: 'Try again', adult: true }, 403);
  assert.equal((await moderate(false)).status, 200);
  assert.equal((await chat(guest)).suspended, undefined);
  assert.equal((await chat({})).suspended, undefined);
});
