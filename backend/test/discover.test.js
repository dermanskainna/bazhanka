// Unit tests for the gift-idea pipeline plus an integration run against DISCOVER_MOCK mode.
// The integration part needs a running Postgres (DATABASE_URL), like api.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { parseCandidates, rankOffers, findPartner, cacheKey, buildPrompt, normDomain, baseDomain, verifyCandidates, searchSerper, shoppingToOffers, diversify, roundRobin, planSystem, parseCandidatesPlan, titlesAgree, isForeignMarketplace, isPlaceholderHost, normalizeUrl } from '../src/discover.js';
import { parsePriceText } from '../src/serper.js';
import { signRequest, signingKey, collectCitations, collectToolInfo } from '../src/bedrock.js';

const partners = [
  { id: 1, name: 'Partner Shop', domain: 'partner-shop.example.ua', boost: 3, active: true },
  { id: 2, name: 'Paused Shop', domain: 'paused.example.com', boost: 5, active: false },
];

test('SigV4 signing key matches the AWS documentation example', () => {
  const k = signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iam');
  assert.equal(k.toString('hex'), 'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
});

test('SigV4 request signing is well-formed and deterministic', () => {
  const args = {
    host: 'bedrock-runtime.us-east-1.amazonaws.com', path: '/model/us.amazon.nova-2-lite-v1:0/converse',
    region: 'us-east-1', body: '{}', creds: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', sessionToken: 'tok' },
    now: new Date('2026-01-02T03:04:05.678Z'),
  };
  const a = signRequest(args);
  assert.equal(a['x-amz-date'], '20260102T030405Z');
  assert.match(a.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260102\/us-east-1\/bedrock\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/);
  assert.equal(signRequest(args).authorization, a.authorization);
});

test('parseCandidates tolerates fences/prose and drops junk and duplicates', () => {
  const text = 'Here you go:\n```json\n[{"title":"A","url":"https://a-shop.com/p?utm_source=x","fit":"direct","why":"ok"},' +
    '{"title":"A again","url":"https://a-shop.com/p"},{"title":"Bad","url":"javascript:alert(1)"},{"url":"https://b-shop.com"},' +
    '{"title":"B","url":"https://b-shop.com/x","fit":"adjacent"}]\n```';
  const out = parseCandidates(text);
  assert.deepEqual(out.map((o) => [o.title, o.fit]), [['A', 'direct'], ['B', 'adjacent']]);
  assert.equal(out[0].url, 'https://a-shop.com/p', 'tracking params stripped');
  assert.deepEqual(parseCandidates('no json here'), []);
  assert.deepEqual(parseCandidates('[broken'), []);
});

test('parseCandidates keeps a price only when it is a positive number', () => {
  const out = parseCandidates('[{"title":"A","url":"https://a-shop.com/1","price":1299.5,"currency":"uah"},{"title":"B","url":"https://b-shop.com/1","price":"abc","currency":"zz"},{"title":"C","url":"https://c-shop.com/1","price":null}]');
  assert.deepEqual(out.map((o) => [o.seenPrice, o.seenCurrency]), [[1299.5, 'UAH'], [null, null], [null, null]]);
});

test('parseCandidates salvages complete items from a reply cut off mid-array', () => {
  const text = 'Sure! [{"title":"A","url":"https://a-shop.com/1","why":"has } brace"},{"title":"B","url":"https://b-shop.com/2","fit":"adjacent"},{"title":"C","url":"https://c.exa';
  const out = parseCandidates(text);
  assert.deepEqual(out.map((o) => o.title), ['A', 'B']);
  assert.equal(out[0].why, 'has } brace');
  assert.deepEqual(parseCandidates('{"title":"Solo","url":"https://s-shop.com/1"}').map((o) => o.title), ['Solo']);
});

test('collectCitations finds web sources in any response shape and dedupes', () => {
  const a = { message: { content: [{ text: 'x', citationsContent: [{ location: { web: { url: 'https://a-shop.com/1', domain: 'a.example' } } }] }] } };
  const b = { message: { content: [{ text: 'x' }, { citationsContent: { citations: [{ location: { web: { url: 'https://b-shop.com/2' } } }, { location: { web: { url: 'https://b-shop.com/2' } } }] } }] } };
  assert.deepEqual(collectCitations(a), [{ url: 'https://a-shop.com/1', domain: 'a.example' }]);
  assert.deepEqual(collectCitations(b), [{ url: 'https://b-shop.com/2', domain: null }]);
  assert.deepEqual(collectCitations({ message: { content: [{ text: 'none' }] } }), []);
  assert.deepEqual(collectCitations(undefined), []);
});

test('baseDomain compares shops by registrable domain', () => {
  assert.equal(baseDomain('m.rozetka.com.ua'), 'rozetka.com.ua');
  assert.equal(baseDomain('www.shop.ua'), 'www.shop.ua'.split('.').slice(-2).join('.'));
  assert.equal(baseDomain('a.b.example.com'), 'example.com');
  assert.equal(baseDomain('example.com'), 'example.com');
  assert.equal(baseDomain(null), null);
});

test('partner matching covers subdomains and ignores inactive partners in ranking', () => {
  assert.equal(findPartner('shop.partner-shop.example.ua', partners).id, 1);
  assert.equal(findPartner('notpartner-shop.example.ua', partners), null);
  const ranked = rankOffers([{ title: 'x', url: 'https://paused.example.com/a', fit: 'direct' }], partners);
  assert.equal(ranked[0].partner, null);
});

test('ranking: relevance first, partner boost inside a group, adjacent items interleaved and labelled', () => {
  const offers = [
    { title: 'adj partner', url: 'https://partner-shop.example.ua/adj', fit: 'adjacent' },
    { title: 'd1', url: 'https://x1-shop.com/1', fit: 'direct' },
    { title: 'd2', url: 'https://x2-shop.com/2', fit: 'direct' },
    { title: 'd partner', url: 'https://partner-shop.example.ua/d', fit: 'direct' },
    { title: 'd3', url: 'https://x3-shop.com/3', fit: 'direct' },
    { title: 'adj plain', url: 'https://x4-shop.com/4', fit: 'adjacent' },
  ];
  const r = rankOffers(offers, partners);
  assert.equal(r.length, offers.length);
  assert.equal(r[0].title, 'd partner', 'boosted partner leads the direct matches');
  assert.equal(r[0].label, 'match');
  assert.equal(r[3].label, 'new', 'one "try something new" after three matches');
  assert.equal(r[3].title, 'adj partner', 'partner leads inside the adjacent group too');
  assert.equal(r.filter((o) => o.partner).length, 2);
  // Paid placement never lifts an adjacent item above a direct match.
  assert.ok(r.findIndex((o) => o.title === 'adj partner') > r.findIndex((o) => o.title === 'd1'));
});

test('placeholder hosts and foreign marketplaces are dropped at parse time', () => {
  const out = parseCandidates(JSON.stringify([
    { title: 'A', url: 'https://www.example.com/p/1' }, { title: 'B', url: 'https://shop.example/p' },
    { title: 'C', url: 'https://www.etsy.com/listing/1/x' }, { title: 'D', url: 'https://www.amazon.com/dp/B0' },
    { title: 'E', url: 'https://rozetka.com.ua/ua/p1/p1/' },
  ]));
  assert.deepEqual(out.map((o) => o.title), ['E']);
  assert.ok(isPlaceholderHost('example.com') && isPlaceholderHost('a.test') && !isPlaceholderHost('rozetka.com.ua'));
  assert.ok(isForeignMarketplace('www.etsy.com') && isForeignMarketplace('etsy.com') && !isForeignMarketplace('prom.ua') && !isForeignMarketplace('aliexpress.com') && !isForeignMarketplace('www.temu.com'));
});

test('titlesAgree and normalizeUrl', () => {
  assert.ok(titlesAgree('Набір для кави Hario', 'Hario V60 набір для заварювання кави'));
  assert.ok(!titlesAgree('Coffee grinder', 'Шкарпетки чоловічі'));
  assert.equal(normalizeUrl('https://www.a.ua/x/?q=1#h'), 'a.ua/x');
});

test('collectToolInfo reads queries and urls from tool blocks', () => {
  const r = collectToolInfo([{ toolUse: { input: { query: 'кава купити' } } }, { toolResult: { content: [{ text: 'see https://prom.ua/p1, and https://a.ua/x.' }] } }]);
  assert.deepEqual(r.queries, ['кава купити']);
  assert.deepEqual(r.urls.sort(), ['https://a.ua/x', 'https://prom.ua/p1']);
});

test('verifyCandidates uses page data and drops fake, dead and mismatched links', async () => {
  const cands = ['ok', 'dead', 'home', 'nonprod', 'mismatch', 'blocked', 'blockedseen'].map((k) => ({ title: k === 'mismatch' ? 'Coffee grinder' : 'Coffee set', url: `https://shop-${k}.com.ua/p/${k}`, fit: 'direct', why: 'why', seenPrice: null, seenCurrency: null }));
  const pages = {
    ok: { title: 'Coffee set Hario', url: 'https://shop-ok.com.ua/p/ok', image: 'https://i/1.jpg', price: 900, currency: 'UAH', isProduct: true },
    home: { title: 'Shop', url: 'https://shop-home.com.ua/', isProduct: true },
    nonprod: { title: 'Blog about coffee set', url: 'https://shop-nonprod.com.ua/p/nonprod', isProduct: false },
    mismatch: { title: 'Шкарпетки', url: 'https://shop-mismatch.com.ua/p/mismatch', isProduct: true },
  };
  const fetcher = async (u) => {
    const k = u.split('/').pop();
    if (k === 'dead') throw new Error('The shop answered with 404');
    if (k.startsWith('blocked')) throw new Error('This shop does not allow automatic reading');
    return pages[k];
  };
  const stats = {};
  const out = await verifyCandidates(cands, { sourceUrls: new Set(['shop-blockedseen.com.ua/p/blockedseen']), fetcher }, stats);
  assert.deepEqual(out.map((o) => o.url).sort(), ['https://shop-blockedseen.com.ua/p/blockedseen', 'https://shop-ok.com.ua/p/ok']);
  const ok = out.find((o) => o.verified);
  assert.equal(ok.title, 'Coffee set Hario'); assert.equal(ok.price, 900); assert.equal(ok.imageUrl, 'https://i/1.jpg');
  assert.equal(out.find((o) => !o.verified).priceApprox, false);
  assert.equal(stats.unreachable, 1); assert.equal(stats.redirectedHome, 1); assert.equal(stats.notProduct, 1); assert.equal(stats.titleMismatch, 1); assert.equal(stats.blocked, 1);
});

test('parsePriceText understands Ukrainian and US formats', () => {
  assert.deepEqual(parsePriceText('1 299,00 ₴'), { price: 1299, currency: 'UAH' });
  assert.deepEqual(parsePriceText('899 грн'), { price: 899, currency: 'UAH' });
  assert.deepEqual(parsePriceText('$1,299.50'), { price: 1299.5, currency: 'USD' });
  assert.deepEqual(parsePriceText('€12.99'), { price: 12.99, currency: 'EUR' });
  assert.deepEqual(parsePriceText(''), { price: null, currency: null });
});

test('shopping listings: real shop links only, budget respected, shops varied', () => {
  const L = (url, price = 500, title = 'Кавомолка') => ({ title, url, shop: 'S', price, currency: 'UAH', imageUrl: null });
  const st = {};
  const o = shoppingToOffers([L('https://www.google.com/aclk?x=1'), L('https://www.etsy.com/listing/1'), L('https://rozetka.com.ua/p1/p1/'), L('https://prom.ua/p2', 5000), L('https://temu.com/x')], 'direct', { budget: 1000, currency: 'UAH' }, st);
  assert.deepEqual(o.map((x) => x.url), ['https://rozetka.com.ua/p1/p1/', 'https://temu.com/x']);
  assert.equal(st.googleRedirect, 1); assert.equal(st.overBudget, 1);
  const many = Array.from({ length: 6 }, (_, i) => ({ ...o[0], url: `https://rozetka.com.ua/p${i}/` }));
  assert.equal(diversify(many).length, 4);
  assert.deepEqual(roundRobin([[1, 2, 3], [4], [5, 6]]), [1, 4, 5, 2, 6, 3]);
  assert.match(planSystem('strict'), /No "adjacent"/);
  assert.match(planSystem('surprise'), /4 objects "adjacent"/);
  assert.notEqual(cacheKey({ interests: 'tea', novelty: 'strict', currency: 'UAH' }), cacheKey({ interests: 'tea', novelty: 'surprise', currency: 'UAH' }));
  assert.deepEqual(parseCandidatesPlan('```json\n[{"q":"кавомолка","fit":"direct"},{"q":"чай","fit":"adjacent"},{"q":""}]```').map((x) => x.fit), ['direct', 'adjacent']);
});

test('serper pipeline: checked shop pages first, Google listings fill the gap', async () => {
  const debug = {};
  const out = await searchSerper({ interests: 'кава', budget: null, currency: 'UAH' }, [], debug, {
    planQueries: async () => [{ q: 'кавомолка', fit: 'direct', for: 'кава' }, { q: 'чай', fit: 'adjacent', for: 'чай' }],
    webSearch: async (q) => [{ title: 'Кавомолка Hario', url: `https://shop-${encodeURIComponent(q.split(' ')[0])}.com.ua/p/1` }, { title: 'x', url: 'https://www.example.com/p' }, { title: 'Категорія', url: `https://cat-${encodeURIComponent(q.split(' ')[0])}.com.ua/c` }],
    fetcher: async (u) => (u.includes('//cat-') ? { title: 'Категорія', url: u, isProduct: false } : { title: 'Кавомолка Hario', url: u, price: 900, currency: 'UAH', isProduct: true }),
    shoppingSearch: async (q) => [{ title: `${q} Google`, shop: 'Molodo', url: 'https://www.google.com/search?ibp=oshop&q=' + encodeURIComponent(q), price: 500, currency: 'UAH' }],
  });
  assert.equal(debug.verifyStats.notProduct, 2);
  const pages = out.filter((o) => !o.viaGoogle);
  assert.equal(pages.length, 2);
  assert.ok(pages.every((o) => o.verified && o.price === 900));
  assert.ok(out.some((o) => o.viaGoogle && o.shop === 'Molodo'), 'too few pages: Google listings added');
  assert.equal(out.find((o) => o.fit === 'adjacent' && !o.viaGoogle).via, 'чай');
});

test('serper pipeline: every interest is represented, not only the first query', async () => {
  const qs = ['свічки', 'малювання', 'чай', 'коти'];
  const out = await searchSerper({ interests: qs.join(', '), budget: null, currency: 'UAH' }, [], {}, {
    planQueries: async () => qs.map((q) => ({ q, fit: 'direct', for: q })),
    webSearch: async (q) => Array.from({ length: 5 }, (_, i) => ({ title: `${q} ${i}`, url: `https://s${i}-${encodeURIComponent(q.split(' ')[0])}.com.ua/p/${i}/` })),
    fetcher: async (u) => ({ title: 'Товар ' + u, url: u, price: 300, currency: 'UAH', isProduct: true }),
    shoppingSearch: async () => [],
  });
  assert.deepEqual([...new Set(out.map((o) => o.via))].sort(), ['коти', 'малювання', 'свічки', 'чай']);
});

test('cache key ignores case, order and punctuation; budget is bucketed', () => {
  const a = cacheKey({ interests: 'Coffee, Board games', budget: 1200, currency: 'UAH' });
  const b = cacheKey({ interests: 'board games coffee!', budget: 1400, currency: 'UAH' });
  assert.equal(a, b);
  assert.notEqual(a, cacheKey({ interests: 'board games coffee', budget: 1400, currency: 'USD' }));
});

test('prompt mentions only active partners; normDomain cleans input', () => {
  assert.match(buildPrompt({ interests: 'tea', budget: 500, currency: 'UAH' }, partners), /partner-shop\.example\.ua/);
  assert.doesNotMatch(buildPrompt({ interests: 'tea', budget: null, currency: 'UAH' }, partners), /paused\.example\.com/);
  assert.equal(normDomain('https://www.Shop.com.ua/path'), 'shop.com.ua');
  assert.equal(normDomain('not a domain'), null);
});

// ---------- integration (mock search backend) ----------
const PORT = 3800 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
let server;

before(async () => {
  server = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, PORT: String(PORT), ADMIN_EMAILS: 'admin-disc@example.com', DISCOVER_MOCK: 'true', DISCOVER_DAILY_LIMIT: '2' },
    stdio: 'inherit',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => server.kill());

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = [cookie, ...set.map((c) => c.split(';')[0])].filter(Boolean).join('; ');
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}
const uniq = Date.now();
const signup = (c, name) => c('POST', '/api/auth/signup', { email: `${name}-${uniq}@example.com`, name, password: 'password123' });

test('discover: search, partner label, add to wishlist, funnel stats, limits and permissions', async () => {
  const admin = client();
  await admin('POST', '/api/auth/signup', { email: 'admin-disc@example.com', name: 'Admin', password: 'password123' });
  await admin('POST', '/api/auth/login', { email: 'admin-disc@example.com', password: 'password123' });

  const u = client();
  assert.equal((await client()('POST', '/api/discover/search', { interests: 'coffee' })).status, 401);
  await signup(u, 'disc-user');
  assert.equal((await u('GET', '/api/admin/partners')).status, 403, 'partners are admin-only');
  assert.equal((await u('POST', '/api/admin/partners', { name: 'x', domain: 'x.com' })).status, 403);

  const domain = `partner-shop.example.ua`;
  await admin('DELETE', '/api/admin/partners/0'); // 404 is fine, just exercises id validation
  const list0 = (await admin('GET', '/api/admin/partners')).body.partners;
  const old = list0.find((p) => p.domain === domain);
  if (old) await admin('DELETE', `/api/admin/partners/${old.id}`);
  assert.equal((await admin('POST', '/api/admin/partners', { name: 'Bad', domain: 'nope' })).status, 400);
  const created = await admin('POST', '/api/admin/partners', { name: 'Partner Shop', domain, boost: 3 });
  assert.equal(created.status, 201);
  assert.equal((await admin('POST', '/api/admin/partners', { name: 'Partner Shop', domain })).status, 409);

  assert.equal((await u('POST', '/api/discover/search', { interests: 'a' })).status, 400, 'too short');
  const interests = `coffee and tea ${uniq}`;
  const s1 = await u('POST', '/api/discover/search', { interests });
  assert.equal(s1.status, 200);
  assert.equal(s1.body.cached, false);
  assert.equal(s1.body.remaining, 1);
  const offers = s1.body.offers;
  assert.ok(offers.length >= 4);
  assert.ok(offers.some((o) => o.label === 'new'), 'has a "try something new" card');
  assert.ok(offers.some((o) => o.label === 'match'));
  const partnerOffers = offers.filter((o) => o.partner);
  assert.ok(partnerOffers.length >= 1 && partnerOffers.every((o) => o.partner.name === 'Partner Shop'));
  assert.equal(offers[0].partner?.name, 'Partner Shop', 'boosted partner match leads');

  const s2 = await u('POST', '/api/discover/search', { interests: `tea gadgets ${uniq}` });
  assert.equal(s2.body.cached, false, 'different words -> new search');
  const s3 = await u('POST', '/api/discover/search', { interests: `${uniq} And tea, coffee!` });
  assert.equal(s3.status, 200);
  assert.equal(s3.body.cached, true, 'same words in a different order hit the cache');
  assert.equal((await u('POST', '/api/discover/search', { interests: `a brand new thing ${uniq}` })).status, 429, 'daily limit reached');

  const { body: { wishlist } } = await u('POST', '/api/wishlists', { title: 'Ideas test' });
  const pick = partnerOffers[0];
  const add = await u('POST', '/api/discover/add', { wishlistId: wishlist.id, title: pick.title, url: pick.url, price: pick.price, currency: 'UAH', label: pick.label });
  assert.equal(add.status, 201);
  const other = client();
  await signup(other, 'disc-other');
  assert.equal((await other('POST', '/api/discover/add', { wishlistId: wishlist.id, title: 'x' })).status, 403, 'cannot add to someone else’s list');
  assert.equal((await u('POST', '/api/discover/event', { url: pick.url, label: pick.label })).status, 200);

  const view = (await u('GET', `/api/lists/${wishlist.slug}`)).body;
  assert.ok(view.items.some((i) => i.title === pick.title), 'item landed in the wishlist');

  const stats = (await admin('GET', '/api/admin/partners')).body;
  const p = stats.partners.find((x) => x.domain === domain);
  assert.ok(p.shown >= 1 && p.clicks === 1 && p.adds === 1, JSON.stringify(p));
  assert.ok(stats.totals.searches >= 2);

  assert.equal((await admin('PATCH', `/api/admin/partners/${p.id}`, { active: false })).status, 200);
  const off = (await u('POST', '/api/discover/search', { interests: `${uniq} coffee tea and` })).body;
  assert.ok(off.offers.every((o) => !o.partner), 'paused partner is no longer promoted, even from cache');
});
