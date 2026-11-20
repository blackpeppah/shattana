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
const deletion = { guest: randomUUID(), reporter: randomUUID(), other: randomUUID(), pending: randomUUID(), ordinary: randomUUID() };
const expiredPhoto = { owner: randomUUID(), viewer: randomUUID(), id: randomUUID() };
const expiry = { owner: randomUUID(), timedPeer: randomUUID(), pastPeer: randomUUID(), todayPeer: randomUUID(),
  timed: randomUUID(), past: randomUUID(), today: randomUUID() };
const disconnected = { a: randomUUID(), b: randomUUID(), chat: randomUUID() };
const leavingQuickChat = { a: randomUUID(), b: randomUUID(), chat: randomUUID() };
const simultaneousNext = { a: randomUUID(), b: randomUUID(), chat: randomUUID() };
const moderatorUsername = 'test-admin';
const moderatorPassword = randomUUID();
const moderatorSecret = randomUUID();
const retentionSecret = randomUUID();
let directory, server, base;
let serverOutput = '';
let photoReportId;

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
    await db.exec(await fs.readFile(path.join(root, 'db/retention.sql'), 'utf8'));
    await db.query("insert into guest(id,nickname,school,drink,spot) values($1,'History A','','',''),($2,'History B','','','')", [fixtures.a, fixtures.b]);
    await db.query("insert into guest(id,nickname,school,drink,spot) values($1,'Photo Owner','','',''),($2,'Photo Viewer','','','')",
      [fixtures.photoOwner, fixtures.photoViewer]);
    await db.query('insert into chat(id,a,b,matched) values($1,$2,$3,true)', [fixtures.chat, fixtures.a, fixtures.b]);
    await db.query("insert into message(chat_id,sender,body) select $1,$2,'Message '||n from generate_series(1,205) n",
      [fixtures.chat, fixtures.b]);
    const removed = (await db.query("insert into message(chat_id,sender,body) values($1,$2,'Private deleted original') returning id",
      [fixtures.chat, fixtures.a])).rows[0].id;
    await db.query("update message set reply_to=$2 where chat_id=$1 and body='Message 205'", [fixtures.chat, removed]);
    await db.query('delete from message where id=$1', [removed]);
    await db.query(`insert into meetup_invite(chat_id,version,proposer,venue,meetup_date,status)
      values($1,$2,$3,'Akasya',(now() at time zone 'Asia/Manila')::date-1,'pending')`,
    [fixtures.chat, randomUUID(), fixtures.b]);
    await db.query("insert into guest(id,nickname,school,drink,spot) select id,'Disposable','','','' from unnest($1::uuid[]) id",
      [[deletion.guest, deletion.reporter, deletion.other, expiredPhoto.owner, expiredPhoto.viewer]]);
    await db.query(`insert into chat(id,a,b,matched,closed,ended_at) values
      ($1,$2,$3,true,true,now()-interval '35 days'),($4,$2,$5,true,false,null)`,
    [deletion.pending, deletion.guest, deletion.reporter, deletion.ordinary, deletion.other]);
    await db.query(`insert into message(chat_id,sender,body,created_at) values
      ($1,$2,'Pending evidence',now()-interval '36 days'),($1,$2,'After report',now()-interval '34 days'),
      ($3,$2,'Ordinary deleted message',now()-interval '1 day')`, [deletion.pending, deletion.guest, deletion.ordinary]);
    await db.query(`insert into meetup_invite(chat_id,version,proposer,venue,meetup_date,status,updated_at) values
      ($1,$2,$3,'Petals',current_date,'pending',now()-interval '36 days'),($4,$5,$3,'Petals',current_date,'pending',now())`,
    [deletion.pending, randomUUID(), deletion.guest, deletion.ordinary, randomUUID()]);
    await db.query(`insert into report(actor,target,chat_id,reason,created_at) values($1,$2,$3,'Harassment',now()-interval '35 days')`,
      [deletion.reporter, deletion.guest, deletion.pending]);
    await db.query(`insert into report(actor,target,photo_id,reason,created_at) values
      ($1,$2,$3,'Fake or stolen photo',now()-interval '90 days')`, [expiredPhoto.viewer, expiredPhoto.owner, expiredPhoto.id]);
    await db.query('insert into guest_photo_cleanup(guest_id,photo_id) values($1,$2)', [expiredPhoto.owner, expiredPhoto.id]);
    await db.query("insert into guest(id,nickname,school,drink,spot) select id,'Expiry test','','','' from unnest($1::uuid[]) id",
      [[expiry.owner, expiry.timedPeer, expiry.pastPeer, expiry.todayPeer, disconnected.a, disconnected.b]]);
    await db.query('update guest set seen_at=now()-interval \'91 seconds\' where id=$1', [disconnected.a]);
    for (const quick of [leavingQuickChat, simultaneousNext]) {
      await db.query("insert into guest(id,nickname,school,drink,spot) values($1,'Quick A','','CLVB','Petals'),($2,'Quick B','','Beer','Lunar')",
        [quick.a, quick.b]);
      await db.query('insert into chat(id,a,b) values($1,$2,$3)', [quick.chat, quick.a, quick.b]);
    }
    await db.query('insert into chat(id,a,b,matched) values($1,$2,$3,true),($4,$2,$5,true),($6,$2,$7,true),($8,$9,$10,false)',
      [expiry.timed, expiry.owner, expiry.timedPeer, expiry.past, expiry.pastPeer, expiry.today, expiry.todayPeer,
        disconnected.chat, disconnected.a, disconnected.b]);
    await db.query(`insert into meetup_invite(chat_id,version,proposer,venue,meetup_date,meetup_time,status) values
      ($1,$2,$3,'Petals',((now() at time zone 'Asia/Manila')-interval '2 minutes')::date,
        ((now() at time zone 'Asia/Manila')-interval '2 minutes')::time,'accepted'),
      ($4,$5,$3,'Petals',(now() at time zone 'Asia/Manila')::date-1,null,'accepted'),
      ($6,$7,$3,'Petals',(now() at time zone 'Asia/Manila')::date,null,'accepted')`,
    [expiry.timed, randomUUID(), expiry.owner, expiry.past, randomUUID(), expiry.today, randomUUID()]);
    const image = path.join(directory, '.shattana-photos', expiredPhoto.owner, expiredPhoto.id + '.webp');
    await fs.mkdir(path.dirname(image), { recursive: true });
    await fs.writeFile(image, await sharp({ create: { width: 512, height: 512, channels: 3, background: 'purple' } }).webp().toBuffer());
  } finally {
    await db.close();
  }
  const env = { ...process.env };
  for (const key of ['DATABASE_URL', 'DATABASE_CA_CERT', 'VERCEL', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']) delete env[key];
  const salt = randomBytes(16);
  env.MODERATION_USERNAME = moderatorUsername;
  env.MODERATION_PASSWORD_HASH = salt.toString('hex') + ':' + scryptSync(moderatorPassword, salt, 64).toString('hex');
  env.MODERATION_SESSION_SECRET = moderatorSecret;
  env.RETENTION_SECRET = retentionSecret;
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

async function stopServer() {
  if (server && server.exitCode === null) {
    const closed = new Promise(resolve => server.once('close', resolve));
    server.kill();
    await closed;
  }
  server = undefined;
}

after(async () => {
  await stopServer();
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

async function moderatorSession() {
  const response = await fetch(base + '/api/moderation/session', {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ username: moderatorUsername, password: moderatorPassword }),
  });
  assert.equal(response.status, 200);
  return response.headers.getSetCookie()[0].split(';')[0];
}

async function suspend(cookie, id, suspended) {
  const response = await fetch(base + '/api/moderation/dashboard', {
    method: 'POST', headers: { origin: base, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'set-suspension', id, suspended }),
  });
  assert.equal(response.status, 200, await response.text());
}

const guestId = session => session.cookie.split('; ').find(cookie => cookie.startsWith('shattana_guest=')).split('=')[1];

test('daily retention removes expired photo evidence and is safe to run twice', async () => {
  const file = path.join(directory, '.shattana-photos', expiredPhoto.owner, expiredPhoto.id + '.webp');
  await fs.access(file);
  const endpoint = base + '/api/retention';
  assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
  const options = { method: 'POST', headers: { authorization: 'Bearer ' + retentionSecret } };
  const first = await fetch(endpoint, options);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).photosRemoved, 1);
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
  const second = await fetch(endpoint, options);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).photosRemoved, 0);
});

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
  assert.equal(restored.selected.unreadIncomingId, second);
  assert.equal(restored.selected.readThrough, first);
  await chat(a, 'read', { chatId: id, through: second });
  assert.equal((await chat(a)).matches[0].unread, false);
  assert.equal((await chat(b)).matches[0].unread, false);
  const foreign = (await chat({ cookie: 'shattana_guest=' + fixtures.a }, undefined, { chatId: fixtures.chat })).messages[0].id;
  await chat(a, 'send', { chatId: id, body: 'Foreign reply', replyTo: foreign }, 400);
  const reply = { chatId: id, body: 'Reply with a safe retry', replyTo: second, nonce: randomUUID() };
  const sent = (await chat(a, 'send', reply)).messages.at(-1);
  assert.deepEqual(sent.reply, { id: second, mine: false, body: 'Newer message' });
  assert.equal((await chat(a, 'send', reply)).messages.filter(message => message.body === reply.body).length, 1);
  assert.equal((await chat(a)).matches[0].unreadIncomingId, null);
  const received = await chat(b, undefined, { chatId: id });
  assert.equal(received.selected.unreadIncomingId, sent.id);
  assert.equal(received.messages.at(-1).reply.mine, true);
  await chat(a, 'send', { ...reply, replyTo: first }, 400);

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
  await chat(a, 'meetup-propose', { chatId: id, version: accepted.version, venue: 'Akasya', date }, 409);
  await chat(a, 'meetup-cancel', { chatId: id, version: accepted.version }, 409);
  const canceled = (await chat(b, 'meetup-cancel', { chatId: id, version: accepted.version, confirmation: 'CANCEL' })).invite;
  assert.equal(canceled.status, 'canceled');
  assert.equal((await chat(a, undefined, { chatId: id })).invite.status, 'canceled');
  await chat(a, 'meetup-respond', { chatId: id, version: accepted.version, response: 'accept' }, 409);
  await chat(a, 'meetup-respond', { chatId: id, version: canceled.version, response: 'accept' }, 409);
  const next = (await chat(a, 'meetup-propose', { chatId: id, version: canceled.version, venue: 'Petals', date })).invite;
  const nextAccepted = (await chat(b, 'meetup-respond', { chatId: id, version: next.version, response: 'accept' })).invite;
  const byProposer = (await chat(a, 'meetup-cancel', { chatId: id, version: nextAccepted.version, confirmation: 'CANCEL' })).invite;
  assert.equal(byProposer.status, 'canceled');
  const replacement = (await chat(a, 'meetup-propose', { chatId: id, version: byProposer.version, venue: 'Akasya', date })).invite;
  assert.equal((await chat(a, 'meetup-withdraw', { chatId: id, version: replacement.version })).invite.status, 'withdrawn');

  const admin = await moderatorSession();
  await suspend(admin, guestId(b), true);
  assert.equal((await chat(b)).suspended, true);
  const paused = await chat(a, undefined, { chatId: id });
  assert.equal(paused.matches[0].id, id);
  assert.equal(paused.selected.paused, true);
  assert.equal(paused.messages.at(-1).body, reply.body);
  assert.equal((await chat(a, 'send', { chatId: id, body: 'Blocked by the pause' }, 409)).error, 'This chat is temporarily unavailable');
  await chat(a, 'meetup-propose', { chatId: id, version: paused.invite.version, venue: 'Petals', date }, 409);
  await chat(a, 'meetup-respond', { chatId: id, version: paused.invite.version, response: 'accept' }, 409);
  await chat(a, 'meetup-withdraw', { chatId: id, version: paused.invite.version }, 409);
  await suspend(admin, guestId(b), false);
  assert.equal((await chat(b, undefined, { chatId: id })).selected.paused, false);
  await chat(b, 'send', { chatId: id, body: 'Message after reinstatement' });
  assert.equal((await chat(b, 'meetup-propose', { chatId: id, version: paused.invite.version, venue: 'Petals', date })).invite.status, 'pending');
});

test('only the guest who taps Next searches again, and the other guest can still report', async () => {
  const { a, b, id } = await pair('Luz', 'Ira');
  assert.equal((await chat(a, 'next', { chatId: id })).profile.waiting, true);
  assert.equal((await chat({ cookie: a.cookie })).profile.waiting, true);
  const refreshed = await chat({ cookie: b.cookie }, undefined, { chatId: id });
  assert.equal(refreshed.profile.waiting, false);
  assert.equal(refreshed.endedQuickChat, id);
  assert.equal((await chat(b, 'heartbeat', { chatId: id })).profile.waiting, false);
  assert.equal((await chat(b)).lastReportableChat, id);
  await chat(b, 'report-last', { chatId: id, reason: 'Harassment' });
  await chat(a, 'cancel');
  assert.equal((await chat(a, 'next', { chatId: id })).profile.waiting, false);
  assert.equal((await chat(b)).lastReportableChat, undefined);
});

test('Leave chat keeps both guests idle until the other guest searches with their saved picks', async () => {
  const a = { cookie: 'shattana_guest=' + leavingQuickChat.a };
  const b = { cookie: 'shattana_guest=' + leavingQuickChat.b };
  const { chat: id } = leavingQuickChat;
  assert.equal((await chat(a, 'leave', { chatId: id })).profile.waiting, false);
  const refreshed = await chat(b, undefined, { chatId: id });
  assert.equal(refreshed.endedQuickChat, id);
  assert.equal(refreshed.profile.waiting, false);
  assert.equal((await chat(b, 'heartbeat', { chatId: id })).profile.waiting, false);
  assert.equal((await chat(b, 'next', { chatId: id })).profile.waiting, false);
  const { drink, spot, quickGender } = refreshed.profile;
  const searched = await chat(b, 'find', { drink, spot, quickGender });
  assert.equal(searched.profile.waiting, true);
  assert.equal(searched.profile.drink, 'Beer');
  assert.equal(searched.profile.spot, 'Lunar');
  assert.equal((await chat({ cookie: a.cookie })).profile.waiting, false);
  await chat(b, 'cancel');
});

test('simultaneous Next taps record each guest’s own search and retries stay canceled', async () => {
  const a = { cookie: 'shattana_guest=' + simultaneousNext.a };
  const b = { cookie: 'shattana_guest=' + simultaneousNext.b };
  const { chat: id } = simultaneousNext;
  await Promise.all([chat(a), chat(b)]);
  const results = await Promise.all([chat(a, 'next', { chatId: id }), chat(b, 'next', { chatId: id })]);
  for (const result of results) {
    assert.equal(result.profile.waiting, true);
    assert.equal(result.active, undefined);
    assert.equal(result.endedQuickChat, id);
  }
  await chat(a, 'cancel');
  const repeated = await chat(a, 'next', { chatId: id });
  assert.equal(repeated.profile.waiting, false);
  assert.equal((await chat(b, 'heartbeat')).profile.waiting, true);
  assert.equal((await chat(a)).profile.waiting, false);
  await chat(b, 'cancel');
});

test('saved history paginates without overlap', async () => {
  const a = { cookie: 'shattana_guest=' + fixtures.a };
  const latest = await chat(a, undefined, { chatId: fixtures.chat });
  assert.equal(latest.messages.length, 200);
  assert.equal(latest.messages.at(-1).reply.body, null);
  assert.ok(latest.messages.at(-1).reply.id);
  assert.ok(!JSON.stringify(latest).includes('Private deleted original'));
  assert.equal(latest.hasEarlier, true);
  const earlier = await chat(a, undefined, { chatId: fixtures.chat, before: latest.messages[0].id });
  assert.deepEqual(earlier.messages.map(message => message.body), ['Message 1', 'Message 2', 'Message 3', 'Message 4', 'Message 5']);
  assert.equal(earlier.hasEarlier, false);
  assert.equal(latest.invite.status, 'expired');
  await chat(a, 'meetup-respond', { chatId: fixtures.chat, version: latest.invite.version, response: 'accept' }, 409);
  await chat({ cookie: 'shattana_guest=' + fixtures.b }, undefined, { chatId: randomUUID(), before: latest.messages[0].id }, 400);
});

test('meetups end at the Bacolod time or after midnight for date-only plans', async () => {
  const owner = { cookie: 'shattana_guest=' + expiry.owner };
  const today = await chat(owner, undefined, { chatId: expiry.today });
  assert.equal(today.invite.status, 'accepted');
  for (const chatId of [expiry.timed, expiry.past]) {
    const { invite } = await chat(owner, undefined, { chatId });
    assert.equal(invite.status, 'ended');
    await chat(owner, 'meetup-cancel', { chatId, version: invite.version, confirmation: 'CANCEL' }, 409);
    await chat(owner, 'meetup-respond', { chatId, version: invite.version, response: 'accept' }, 409);
    const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    assert.equal((await chat(owner, 'meetup-propose', { chatId, version: invite.version, venue: 'Akasya', date })).invite.status, 'pending');
  }
});

test('Quick Chat cannot resume after the returning guest is past the reconnect window', async () => {
  const returning = { cookie: 'shattana_guest=' + disconnected.a };
  const waiting = { cookie: 'shattana_guest=' + disconnected.b };
  const expired = await chat(returning, undefined, { chatId: disconnected.chat });
  assert.equal(expired.active, undefined);
  assert.equal(expired.endedQuickChat, disconnected.chat);
  assert.equal(expired.profile.waiting, false);
  const heartbeat = await chat(returning, 'heartbeat', { chatId: disconnected.chat });
  assert.equal(heartbeat.active, undefined);
  assert.equal(heartbeat.profile.waiting, false);
  const peer = await chat(waiting, undefined, { chatId: disconnected.chat });
  assert.equal(peer.endedQuickChat, disconnected.chat);
  assert.equal(peer.profile.waiting, false);
  await chat(waiting, 'send', { chatId: disconnected.chat, body: 'Cannot reopen' }, 400);
  assert.equal((await chat(returning, 'next', { chatId: disconnected.chat })).profile.waiting, false);
  assert.equal((await chat(returning, 'find')).profile.waiting, true);
  assert.equal((await chat(waiting, 'heartbeat', { chatId: disconnected.chat })).profile.waiting, false);
  await chat(returning, 'cancel');
});

test('Discover alerts skip the initial unread baseline and deduplicate incoming messages', async () => {
  const { trackIncomingMessages } = await import('../app/message-alerts.mjs');
  const update = (previous, id, browsing = true) => trackIncomingMessages(previous, [{ id: 'saved-chat', unreadIncomingId: id }], browsing);
  const loaded = update(undefined, '10');
  assert.equal(loaded.alert, undefined);
  const arriving = update(loaded.seen, '11');
  assert.deepEqual(arriving.alert, { chatId: 'saved-chat', messageId: '11' });
  assert.equal(update(arriving.seen, '11').alert, undefined);
  assert.equal(update(arriving.seen, null).alert, undefined);
  const reading = update(arriving.seen, '12', false);
  assert.equal(reading.alert, undefined);
  assert.equal(update(reading.seen, '12').alert, undefined);
  assert.equal(update(reading.seen, '13').alert.messageId, '13');
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
  const canceled = (await chat(a, 'meetup-cancel', { chatId: fixtures.chat, version: accepted.version, confirmation: 'CANCEL' })).invite;
  await chat(a, 'meetup-propose', { chatId: fixtures.chat, version: canceled.version, venue: renamed.name, date }, 400);

  const guest = (await read('?view=guests&search=History%20A')).guests[0];
  assert.equal(guest.id, fixtures.a);
  await change({ action: 'set-suspension', id: guest.id, suspended: true });
  assert.equal((await chat(a)).suspended, true);
  assert.equal((await chat(b, undefined, { chatId: fixtures.chat })).selected.paused, true);
  await chat(b, 'block', { chatId: fixtures.chat });
  await change({ action: 'set-suspension', id: guest.id, suspended: false });
  assert.equal((await chat(a)).profile.nickname, 'History A');
  assert.equal((await chat(b)).matches.length, 0);
  await chat(b, 'send', { chatId: fixtures.chat, body: 'Still closed' }, 400);
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

  const initialStats = (await call('/dashboard')).stats;
  const before = initialStats.active;
  const { a, b, id } = await pair('Report Target', 'Report Sender');
  assert.equal((await call('/dashboard')).stats.active, before + 2);
  await chat(a, 'send', { chatId: id, body: 'Message from the reported guest' });
  await chat(b, 'report', { chatId: id, reason: 'Underage user' });
  const pending = await call('?status=pending');
  const [report] = pending.reports;
  assert.equal(report.reason, 'Underage user');
  assert.equal(report.nickname, 'Report Target');
  assert.equal(pending.counts.pending, initialStats.pending + 1);
  assert.deepEqual(pending.evidence, []);
  const details = await call('?status=pending&case=' + report.id);
  assert.deepEqual(details.evidence.map(({ reportedGuest, body }) => ({ reportedGuest, body })),
    [{ reportedGuest: true, body: 'Message from the reported guest' }]);

  const suspended = await call('?status=pending&case=' + report.id, { id: report.id, status: 'pending', suspend: true });
  assert.equal(suspended.reports[0].suspended, true);
  assert.equal(suspended.counts.pending, initialStats.pending + 1);
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
  const file = async (width, format = 'webp', background = '#963254') => sharp({ create: { width, height: 512, channels: 3, background } })
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
  const originalBytes = Buffer.from(await image.arrayBuffer());
  const result = await sharp(originalBytes).metadata();
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
  const admin = await moderatorSession();
  await suspend(admin, fixtures.photoOwner, true);
  const whileSuspended = await chat(viewer, undefined, { bar: true });
  assert.equal(whileSuspended.active, undefined);
  assert.equal(whileSuspended.candidate, undefined);
  assert.equal((await photo(viewer, card)).status, 404);
  await chat(viewer, 'send', { chatId: active.id, body: 'Quick Chat closed' }, 400);
  await suspend(admin, fixtures.photoOwner, false);
  assert.equal((await chat(viewer)).active, undefined);

  const replacement = await photo(owner, { previous: photoId }, 'POST', await file(512, 'jpeg', '#663da3'), 'image/jpeg');
  assert.equal(replacement.status, 200);
  const { photoId: newId } = await replacement.json();
  assert.notEqual(newId, photoId);
  const disk = id => path.join(directory, '.shattana-photos', fixtures.photoOwner, id + '.webp');
  await fs.access(disk(photoId));
  await fs.access(disk(newId));
  assert.equal((await photo(owner, { previous: photoId }, 'DELETE')).status, 409);
  const newCard = { ...card, revision: newId };
  assert.equal((await photo(owner, { scope: 'own', revision: newId })).status, 200);
  await chat(viewer, 'bar-report', { target: fixtures.photoOwner, reason: 'Fake or stolen photo', photoId });
  assert.equal((await chat(viewer, undefined, { bar: true })).candidate, undefined);
  assert.equal((await photo(viewer, newCard)).status, 404);
  const pending = await fetch(base + '/api/moderation?status=pending', { headers: { cookie: admin } }).then(response => response.json());
  photoReportId = pending.reports.find(report => report.reason === 'Fake or stolen photo' && report.nickname === 'Photo Owner').id;
  const evidenceUrl = base + '/api/moderation/photo?report=' + photoReportId;
  assert.equal((await fetch(evidenceUrl, { headers: { cookie: viewer.cookie } })).status, 401);
  assert.deepEqual(Buffer.from(await (await fetch(evidenceUrl, { headers: { cookie: admin } })).arrayBuffer()), originalBytes);
  const afterReport = await photo(owner, { previous: newId }, 'POST', await file(512, 'webp', '#61653d'));
  assert.equal(afterReport.status, 200);
  const { photoId: lastId } = await afterReport.json();
  await assert.rejects(fs.access(disk(newId)), { code: 'ENOENT' });
  assert.equal((await photo(owner, { previous: lastId }, 'DELETE')).status, 200);
  assert.equal((await chat(owner)).profile.photoId, null);
  await assert.rejects(fs.access(disk(lastId)), { code: 'ENOENT' });
  assert.deepEqual(Buffer.from(await (await fetch(evidenceUrl, { headers: { cookie: admin } })).arrayBuffer()), originalBytes);
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
  assert.equal((await fetch(base + '/api/moderation/photo?report=' + photoReportId, { headers: { cookie } })).status, 200);
  assert.equal(guest.cookie, browserCookie);
  const revisited = await chat(guest);
  assert.equal(revisited.suspended, true);
  assert.equal(revisited.guestControls, false);
  await chat(guest, 'join', { nickname: 'Try again', adult: true }, 403);
  assert.equal((await moderate(false)).status, 200);
  assert.equal((await chat(guest)).suspended, undefined);
  assert.equal((await chat({})).suspended, undefined);
});

test('guest deletion keeps pending chat evidence and photo reports can be filed without the photo', async () => {
  const actor = { cookie: 'shattana_guest=' + expiredPhoto.viewer };
  const target = { cookie: 'shattana_guest=' + expiredPhoto.owner };
  const profile = { age: 108, gender: 'Woman', interest: 'Everyone', minAge: 100, maxAge: 120, favorite: 'Akasya', answer: 'Test' };
  await chat(actor, 'bar-profile', profile);
  await chat(target, 'bar-profile', profile);
  await chat(actor, 'bar-report', { target: expiredPhoto.owner, reason: 'Fake or stolen photo', photoId: expiredPhoto.id });
  const admin = await moderatorSession();
  const reportList = await fetch(base + '/api/moderation?status=pending', { headers: { cookie: admin } }).then(response => response.json());
  const unavailable = reportList.reports.find(report => report.reason === 'Fake or stolen photo' && report.nickname === 'Disposable');
  assert.ok(unavailable);
  const missing = await fetch(base + '/api/moderation/photo?report=' + unavailable.id, { headers: { cookie: admin } });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'Photo evidence unavailable');

  const guest = { cookie: 'shattana_guest=' + deletion.guest };
  await chat(guest, 'delete-data', { confirmation: 'DELETE' });
  assert.equal((await chat({ cookie: 'shattana_guest=' + deletion.other })).matches.length, 0);
  await stopServer();
  const db = new PGlite(path.join(directory, '.shattana-db'));
  try {
    const chats = await db.query('select id,closed from chat where id=any($1::uuid[])', [[deletion.pending, deletion.ordinary]]);
    assert.equal(chats.rows.length, 2);
    assert.ok(chats.rows.every(row => row.closed));
    const messages = await db.query('select body from message where sender=$1', [deletion.guest]);
    assert.deepEqual(messages.rows, [{ body: 'Pending evidence' }]);
    const invites = await db.query('select chat_id from meetup_invite where chat_id=any($1::uuid[])', [[deletion.pending, deletion.ordinary]]);
    assert.deepEqual(invites.rows, [{ chat_id: deletion.pending }]);
    const [stored] = (await db.query('select nickname,deleted_at is not null as deleted from guest where id=$1', [deletion.guest])).rows;
    assert.deepEqual(stored, { nickname: 'Deleted guest', deleted: true });
  } finally {
    await db.close();
  }
});

test('daily SQL retains eligible messages and invites at the 30- and 90-day boundaries', async () => {
  const db = new PGlite();
  try {
    await db.exec(await fs.readFile(path.join(root, 'db/schema.sql'), 'utf8'));
    await db.exec(await fs.readFile(path.join(root, 'db/retention.sql'), 'utf8'));
    await db.transaction(async tx => {
      const actor = randomUUID();
      const target = randomUUID();
      await tx.query("insert into guest(id,nickname,school,drink,spot) values($1,'Actor','','',''),($2,'Target','','','')", [actor, target]);
      const cases = [
        { age: '30 days - 1 second', keep: true },
        { age: '30 days', keep: false },
        { age: '30 days', reportAge: '30 days', status: 'pending', keep: true },
        { age: '30 days', reportAge: '30 days', status: 'reviewed', keep: false },
        { age: '90 days - 1 second', reportAge: '90 days - 2 seconds', status: 'pending', keep: true },
        { age: '90 days', reportAge: '90 days - 1 second', status: 'pending', keep: false },
        { age: '90 days', reportAge: '90 days', status: 'pending', keep: false },
      ];
      for (const fixture of cases) {
        fixture.id = randomUUID();
        await tx.query('insert into chat(id,a,b,closed,ended_at) values($1,$2,$3,true,now()-$4::interval)',
          [fixture.id, actor, target, fixture.age]);
        await tx.query("insert into message(chat_id,sender,body,created_at) values($1,$2,'Sample',now()-$3::interval-interval '1 day')",
          [fixture.id, target, fixture.age]);
        await tx.query("insert into meetup_invite(chat_id,version,proposer,venue,meetup_date,status,updated_at) values($1,$2,$3,'Petals',current_date,'pending',now()-$4::interval-interval '1 day')",
          [fixture.id, randomUUID(), target, fixture.age]);
        if (fixture.reportAge) await tx.query("insert into report(actor,target,chat_id,reason,created_at,review_status) values($1,$2,$3,'Harassment',now()-$4::interval,$5)",
          [actor, target, fixture.id, fixture.reportAge, fixture.status]);
      }
      await tx.exec('select public.shattana_prune_retention(); select public.shattana_prune_retention();');
      const kept = cases.filter(fixture => fixture.keep).map(fixture => fixture.id).sort();
      for (const table of ['message', 'meetup_invite']) {
        const rows = (await tx.query(`select chat_id from ${table} order by chat_id`)).rows;
        assert.deepEqual(rows.map(row => row.chat_id), kept);
      }
      const reports = (await tx.query('select chat_id from report order by chat_id')).rows;
      assert.deepEqual(reports.map(row => row.chat_id), cases.filter(fixture => fixture.reportAge && fixture.reportAge !== '90 days').map(fixture => fixture.id).sort());
      assert.equal((await tx.query('select count(*)::int as total from chat')).rows[0].total, cases.length);
    });
  } finally {
    await db.close();
  }
});
