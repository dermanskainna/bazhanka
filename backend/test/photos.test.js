// Own gift photos: upload, serve, attach to an item. Needs Postgres (DATABASE_URL), like api.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 4900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
let server;

before(async () => {
  server = spawn(process.execPath, ['src/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/livez`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => server.kill());

// Smallest valid JPEG header is enough: the server checks the magic bytes, not the full image.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])]);

async function session() {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `photo-${Date.now()}-${Math.random()}@example.com`, name: 'Photo', password: 'password123' }),
  });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

test('upload a photo, attach it to a gift, serve it with long caching', async () => {
  const cookie = await session();
  const up = await fetch(`${BASE}/api/photos`, { method: 'POST', headers: { cookie, 'Content-Type': 'image/jpeg' }, body: JPEG });
  assert.equal(up.status, 201);
  const { url } = await up.json();
  assert.match(url, /^\/api\/photos\/[a-z0-9]{16}$/);

  const got = await fetch(BASE + url);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/jpeg');
  assert.match(got.headers.get('cache-control'), /immutable/);
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), JPEG);

  const json = (b) => ({ method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const { wishlist } = await (await fetch(`${BASE}/api/wishlists`, json({ title: 'Photos' }))).json();
  const item = await (await fetch(`${BASE}/api/wishlists/${wishlist.id}/items`, json({ title: 'Mine', imageUrl: url }))).json();
  assert.equal(item.item.imageUrl, url, 'own photo path is accepted as the item image');
  const odd = await (await fetch(`${BASE}/api/wishlists/${wishlist.id}/items`, json({ title: 'Odd', imageUrl: '/api/photos/../../etc/passwd' }))).json();
  assert.equal(odd.item.imageUrl, null, 'any other relative path is dropped');
});

test('only signed-in users upload, and only real images', async () => {
  const anon = await fetch(`${BASE}/api/photos`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: JPEG });
  assert.equal(anon.status, 401);
  const cookie = await session();
  const html = await fetch(`${BASE}/api/photos`, { method: 'POST', headers: { cookie, 'Content-Type': 'image/jpeg' }, body: '<script>alert(1)</script>' });
  assert.equal(html.status, 400, 'content is checked by its bytes, not by the header');
  assert.equal((await fetch(`${BASE}/api/photos/nope`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/photos/aaaaaaaaaaaaaaaa`)).status, 404);
});
