// Database RPC used on AWS by the edge function (outside the VPC) to reach Aurora through the main
// function. Unit tests for signing, plus an end-to-end run: edge server (DB_MODE=rpc) -> fake Lambda
// Invoke endpoint -> main server (/internal/db) -> Postgres (DATABASE_URL), like api.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

process.env.JWT_SECRET ||= 'test-secret-for-rpc-signing';
const { signCall, verifyCall, isPassThrough, unwrapPayload } = await import('../src/dbrpc.js');

test('signed calls verify; tampered, stale and malformed calls do not', () => {
  const call = { ts: Date.now(), text: 'SELECT $1::int AS n', params: [1] };
  const ok = { ...call, sig: signCall(call) };
  assert.equal(verifyCall(ok), null);
  assert.equal(verifyCall({ ...ok, text: 'DROP TABLE users' }), 'bad signature');
  assert.equal(verifyCall({ ...ok, params: [2] }), 'bad signature');
  assert.equal(verifyCall({ ...ok, sig: 'abc' }), 'bad signature');
  assert.equal(verifyCall(ok, call.ts + 120_000), 'stale call');
  assert.equal(verifyCall({ text: 'x' }), 'malformed call');
  assert.equal(verifyCall(null), 'malformed call');
});

test('only pass-through (invoke) events are accepted, not Function URL requests', () => {
  assert.equal(isPassThrough(undefined), true);
  assert.equal(isPassThrough('null'), true);
  assert.equal(isPassThrough('"PassThrough"'), true);
  assert.equal(isPassThrough(JSON.stringify({ http: { method: 'POST', path: '/internal/db' } })), false);
  assert.equal(isPassThrough('not json'), false);
});

test('invoke payload is unwrapped whatever shape the adapter returns', () => {
  const reply = { rows: [{ n: 1 }], rowCount: 1 };
  assert.deepEqual(unwrapPayload(JSON.stringify(reply)), reply);
  assert.deepEqual(unwrapPayload(JSON.stringify(JSON.stringify(reply))), reply);
  assert.deepEqual(unwrapPayload(JSON.stringify({ statusCode: 200, body: JSON.stringify(reply) })), reply);
  assert.deepEqual(unwrapPayload(JSON.stringify({ statusCode: 200, isBase64Encoded: true, body: Buffer.from(JSON.stringify(reply)).toString('base64') })), reply);
});

// ---------- end to end ----------

const port = () => 4100 + Math.floor(Math.random() * 800);
const MAIN = port();
let EDGE = port();
while (EDGE === MAIN) EDGE = port();
let fakeLambda, fakePort, main, edge;
let invokes = 0;

async function waitUp(base) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/livez`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${base} did not start`);
}

before(async () => {
  const env = { ...process.env, DISCOVER_MOCK: 'true' };
  main = spawn(process.execPath, ['src/index.js'], { env: { ...env, PORT: String(MAIN), DB_RPC_SERVER: 'true' }, stdio: 'inherit' });
  await waitUp(`http://localhost:${MAIN}`);

  // Stands in for lambda:Invoke + Lambda Web Adapter pass-through: forwards the event body to
  // /internal/db without a request context and returns the app's JSON as the invoke payload.
  fakeLambda = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    invokes++;
    assert.match(req.url, /^\/2015-03-31\/functions\/bazhanka-backend\/invocations$/);
    assert.match(req.headers.authorization || '', /^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/us-east-1\/lambda\/aws4_request/);
    const r = await fetch(`http://localhost:${MAIN}/internal/db`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(await r.text());
  });
  await new Promise((r) => fakeLambda.listen(0, r));
  fakePort = fakeLambda.address().port;

  edge = spawn(process.execPath, ['src/index.js'], {
    env: {
      ...env, PORT: String(EDGE), DB_MODE: 'rpc', DB_RPC_FUNCTION: 'bazhanka-backend', DB_RPC_ENDPOINT: `http://localhost:${fakePort}`,
      AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'AKIDTEST', AWS_SECRET_ACCESS_KEY: 'test', DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
    },
    stdio: 'inherit',
  });
  await waitUp(`http://localhost:${EDGE}`);
});

after(() => { main?.kill(); edge?.kill(); fakeLambda?.close(); });

function client(base) {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = [cookie, ...set.map((c) => c.split(';')[0])].filter(Boolean).join('; ');
    return { status: res.status, body: await res.json().catch(() => null), cookie };
  };
}

test('edge function serves preview and gift ideas with the database reached over RPC', async () => {
  const uniq = Date.now();
  const m = client(`http://localhost:${MAIN}`);
  const signup = await m('POST', '/api/auth/signup', { email: `rpc-${uniq}@example.com`, name: 'Rpc', password: 'password123' });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const list = await m('POST', '/api/wishlists', { title: 'RPC list' });
  assert.equal(list.status, 201, JSON.stringify(list.body));

  // Same session cookie on the edge function: loadUser runs its query over RPC.
  const cookie = signup.cookie;
  const e = async (method, path, body) => {
    const res = await fetch(`http://localhost:${EDGE}${path}`, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const before = invokes;
  assert.deepEqual((await e('GET', '/healthz')).body, { ok: true });

  const status = await e('GET', '/api/discover/status');
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.enabled, true);

  const search = await e('POST', '/api/discover/search', { interests: `coffee rpc ${uniq}`, currency: 'UAH' });
  assert.equal(search.status, 200, JSON.stringify(search.body));
  assert.ok(search.body.offers.length > 0);
  const again = await e('POST', '/api/discover/search', { interests: `coffee rpc ${uniq}`, currency: 'UAH' });
  assert.equal(again.body.cached, true, 'JSONB cache round-trips through RPC');

  const add = await e('POST', '/api/discover/add', { wishlistId: list.body.wishlist?.id ?? list.body.id, title: 'From ideas', url: 'https://shop-one.example.com/mug', price: 540 });
  assert.equal(add.status, 201, JSON.stringify(add.body));

  // Preview is served by the edge function; a bad link is answered without touching the shop.
  const bad = await e('POST', '/api/preview', { url: 'not a link' });
  assert.equal(bad.status, 400);
  const priv = await e('POST', '/api/preview', { url: 'http://127.0.0.1:9001/2018-06-01/runtime/invocation/next' });
  assert.equal(priv.status, 400, 'SSRF guard still blocks the Lambda runtime API');

  assert.ok(invokes > before, 'queries went through the fake Lambda');

  // Routes with transactions are not for the edge function: a clear 500, not a hang.
  const tx = await e('POST', '/api/santa', { name: 'x' });
  assert.equal(tx.status, 500);
});

test('the RPC endpoint rejects unsigned calls and HTTP (Function URL) requests', async () => {
  const url = `http://localhost:${MAIN}/internal/db`;
  const unsigned = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bazhankaDb: { ts: Date.now(), text: 'SELECT 1', params: [], sig: '00' } }) });
  assert.equal(unsigned.status, 403);

  const call = { ts: Date.now(), text: 'SELECT 1 AS one', params: [] };
  const signed = { bazhankaDb: { ...call, sig: signCall(call) } };
  const viaUrl = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-amzn-request-context': JSON.stringify({ http: { method: 'POST' } }) }, body: JSON.stringify(signed) });
  assert.equal(viaUrl.status, 404);

  const ok = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signed) });
  assert.deepEqual(await ok.json(), { rows: [{ one: 1 }], rowCount: 1 });
});
