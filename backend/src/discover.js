import crypto from 'node:crypto';
import { converseWithWebSearch, hasAwsCredentials } from './bedrock.js';
import { shoppingSearch, webSearch, serperKey } from './serper.js';
import { fetchPreview } from './preview.js';
import { httpUrl } from './util.js';

// ---------- pure helpers (unit-tested) ----------

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

// "m.rozetka.com.ua" -> "rozetka.com.ua"; "www.shop.com" -> "shop.com". Good enough without a
// public-suffix list: common two-level suffixes keep three labels.
const SECOND_LEVEL = new Set(['com', 'org', 'net', 'co', 'in', 'kiev', 'lviv', 'kharkov', 'od', 'dp', 'edu', 'gov']);
export function baseDomain(host) {
  if (!host) return null;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const keep = parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

export function normDomain(v) {
  const s = String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

// "shop.rozetka.com.ua" matches partner "rozetka.com.ua".
export function findPartner(host, partners) {
  if (!host) return null;
  return partners.find((p) => host === p.domain || host.endsWith(`.${p.domain}`)) || null;
}

// ---------- region ----------

// Shops that deliver in the country; used to steer the search (never to fabricate links).
export const REGIONS = {
  UA: {
    name: 'Ukraine',
    language: 'Ukrainian',
    shops: [
      'rozetka.com.ua', 'prom.ua', 'epicentrk.ua', 'allo.ua', 'foxtrot.ua', 'comfy.ua', 'eva.ua',
      'makeup.ua', 'kasta.ua', 'yakaboo.ua', 'hobbygames.ua', 'geekach.com.ua', 'brain.com.ua',
    ],
  },
};
// 'serper' (Google results + a cheap AI planner, default when SERPER_API_KEY is set) or 'nova' (Bedrock web grounding).
export const provider = (override) => {
  const v = override || process.env.DISCOVER_PROVIDER;
  if (v === 'serper' || v === 'nova') return v;
  return serperKey() ? 'serper' : 'nova';
};
export const country = () => (REGIONS[process.env.DISCOVER_COUNTRY] ? process.env.DISCOVER_COUNTRY : 'UA');

// Foreign marketplaces that dominated the results for Ukrainian users and are not useful gifts there.
const FOREIGN_MARKETPLACE = /(^|\.)(etsy|ebay|wish|shein|pinterest|amazon|walmart|wayfair)\.[a-z.]+$/;
// Reserved / made-up hosts the model sometimes writes instead of a real link (RFC 2606 etc.).
const PLACEHOLDER_HOST = /(^|\.)example\.(com|org|net|edu)$|\.(example|test|invalid|localhost|local)$/;

export function isPlaceholderHost(host) {
  return !host || host === 'localhost' || PLACEHOLDER_HOST.test(host);
}
export function isForeignMarketplace(host) {
  return !!host && FOREIGN_MARKETPLACE.test(host);
}

// Compares two URLs ignoring scheme, "www.", query string, hash and a trailing slash.
export function normalizeUrl(u) {
  try {
    const x = new URL(u);
    return `${x.hostname.toLowerCase().replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`;
  } catch { return null; }
}

// Do two product titles talk about the same thing? True when they share at least one word
// (compared by 5-letter stems so "наборів"/"набір" match) or when either has no usable words.
export function titlesAgree(a, b) {
  const stems = (t) => new Set((String(t || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).map((w) => w.slice(0, 5)));
  const A = stems(a), B = stems(b);
  if (!A.size || !B.size) return true;
  for (const w of A) if (B.has(w)) return true;
  return false;
}

// Version prefix: bump it whenever the pipeline changes so old (possibly wrong) cached results die.
const CACHE_VERSION = 'v4';
export function cacheKey({ interests, budget, currency, provider: pv }) {
  const norm = String(interests).toLowerCase().replace(/[^\p{L}\p{N}\s,]/gu, ' ').split(/[\s,]+/).filter(Boolean).sort().join(' ');
  const b = budget ? Math.ceil(Number(budget) / 500) * 500 : 0; // coarse buckets so near-identical budgets share a cache entry
  return crypto.createHash('sha256').update(`${CACHE_VERSION}|${provider(pv)}|${country()}|${norm}|${b}|${currency}`).digest('hex').slice(0, 40);
}

// ---------- prompt ----------

export function systemPrompt(code = country()) {
  const r = REGIONS[code];
  return `You find real products that can be bought online right now, for a wishlist website. The user lives in ${r.name}.

RULES - follow them strictly:
1. Use web search. Every item must come from a page that you actually found in the search results.
2. "url" must be copied character by character from a search result. Never guess, shorten, construct or "fix" a URL. If you are not certain that a product page exists at that exact URL, leave the item out. A few correct items are far better than many doubtful ones.
3. "url" must be the page of ONE specific product - not a category, search, brand or home page.
4. "title" must be the product name exactly as it is written on that page (keep the page's language).
5. Shops: online shops that deliver in ${r.name}, preferably with a local domain. Search in ${r.language} (for example "<product> купити") and use "site:" queries for these shops: ${r.shops.join(', ')}. AliExpress and Temu are allowed. Do NOT use etsy, amazon, ebay or other foreign marketplaces.
6. "why": one short sentence (max 140 characters) in the language of the person's interests that explains why THIS product suits them.

Reply with ONLY a JSON array, no introduction and no explanations. Each element:
{"title": string, "url": string, "fit": "direct" | "adjacent", "why": string, "price": number or null (only if you saw it in the search results), "currency": "UAH" | "USD" | "EUR" | null}
- "direct": clearly matches the person's interests.
- "adjacent": not exactly what they asked for, but close enough to be a pleasant discovery.
Give up to 12 items, about 70% direct and 30% adjacent, from different shops.`;
}

export function buildPrompt({ interests, budget, currency }, partners, { failed = [] } = {}) {
  const lines = [`Interests / who the gift is for: ${interests}`];
  if (budget) lines.push(`Budget per item: up to ${budget} ${currency}`);
  const active = partners.filter((p) => p.active);
  if (active.length) {
    lines.push(`Also search these partner shops explicitly (with "site:" queries) and include their relevant products when they exist: ${active.map((p) => p.domain).join(', ')}.`);
  }
  if (failed.length) {
    lines.push(`These links from your previous answer turned out to be invalid or not product pages - do not repeat them, and look harder for pages that really exist:\n${failed.slice(0, 15).join('\n')}`);
  }
  return lines.join('\n');
}

// ---------- parsing ----------

// Splits "[{...},{...}" (possibly truncated or followed by prose) into its complete top-level objects.
function salvageObjects(text) {
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth++ === 0) start = i; }
    else if (ch === '}' && depth > 0 && --depth === 0 && start >= 0) {
      try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip broken object */ }
      start = -1;
    }
  }
  return out;
}

// Pulls the product list out of a model reply, tolerating code fences, surrounding prose and a
// reply that was cut off in the middle of the array. Placeholder hosts and foreign marketplaces
// are dropped here, before anything is fetched.
export function parseCandidates(text) {
  let arr = null;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try { arr = JSON.parse(text.slice(start, end + 1)); } catch { arr = null; }
  }
  if (!Array.isArray(arr)) arr = salvageObjects(start === -1 ? text : text.slice(start));
  const seen = new Set();
  const out = [];
  for (const c of arr) {
    const url = httpUrl(c?.url);
    const title = typeof c?.title === 'string' ? c.title.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    if (!url || !title || seen.has(url)) continue;
    const host = hostOf(url);
    if (isPlaceholderHost(host) || isForeignMarketplace(host)) continue;
    seen.add(url);
    out.push({
      title,
      url,
      fit: c.fit === 'adjacent' ? 'adjacent' : 'direct',
      why: typeof c.why === 'string' ? c.why.trim().slice(0, 200) : '',
      seenPrice: Number.isFinite(Number(c.price)) && Number(c.price) > 0 ? Math.round(Number(c.price) * 100) / 100 : null,
      seenCurrency: typeof c.currency === 'string' && /^[A-Za-z]{3}$/.test(c.currency) ? c.currency.toUpperCase() : null,
    });
  }
  return out;
}

// ---------- ranking ----------

// Final ordering. Relevance comes first: paid placement only reorders results inside the same
// relevance group, it never lets an irrelevant partner product beat a direct match. Inside a group,
// cards checked against the real page come before unchecked ones.
// Returned offers carry a label: 'match' | 'new', plus `partner` ({ id, name } | null).
export function rankOffers(offers, partners) {
  const decorated = offers.map((o, i) => {
    const partner = findPartner(hostOf(o.url), partners.filter((p) => p.active));
    return { ...o, partner: partner ? { id: partner.id, name: partner.name } : null, _boost: partner ? partner.boost : 0, _i: i };
  });
  const group = (o) => (o.fit === 'direct' ? 0 : 1);
  decorated.sort((a, b) => group(a) - group(b) || (b.verified ? 1 : 0) - (a.verified ? 1 : 0) || b._boost - a._boost || a._i - b._i);

  // Keep roughly 1 "try something new" per 4 cards, interleaved instead of dumped at the end.
  const direct = decorated.filter((o) => o.fit === 'direct');
  const adjacent = decorated.filter((o) => o.fit !== 'direct');
  const merged = [];
  while (direct.length || adjacent.length) {
    for (let k = 0; k < 3 && direct.length; k++) merged.push(direct.shift());
    if (adjacent.length) merged.push(adjacent.shift());
    else if (!direct.length) break;
  }
  return merged.map(({ _boost, _i, ...o }) => ({ ...o, label: o.fit === 'direct' ? 'match' : 'new' }));
}

// ---------- verification ----------

const strip = ({ seenPrice, seenCurrency, ...o }) => o;

// Checks candidates against the REAL pages. The model is never trusted for what is shown:
//  - the page must open, must not redirect to a home page, and must look like a product page;
//  - title, photo and price come from the page, so the caption always matches the link;
//  - the model's "why" is kept only when its title and the page title talk about the same thing;
//  - dead links (404, no such domain, no answer) are dropped;
//  - a shop that blocks bots cannot be checked: its card is shown only if the exact URL appeared in
//    the search tool's own results (`sourceUrls`), and then marked as unchecked.
// `fetcher` is injectable for tests. `stats` receives counters and the reasons for each drop.
export async function verifyCandidates(candidates, { sourceUrls = new Set(), fetcher = fetchPreview } = {}, stats = {}) {
  const drop = (c, reason) => { (stats.dropped ||= []).push(`${reason}: ${c.url}`.slice(0, 160)); stats[reason] = (stats[reason] || 0) + 1; return null; };
  const results = await Promise.all(candidates.map(async (c) => {
    const fromSearch = sourceUrls.has(normalizeUrl(c.url));
    let p;
    try {
      p = await fetcher(c.url);
    } catch (e) {
      const msg = e.message || '';
      if (/does not allow automatic reading/.test(msg)) {
        if (!fromSearch) return drop(c, 'blocked');
        stats.uncheckedKept = (stats.uncheckedKept || 0) + 1;
        return { ...strip(c), imageUrl: null, price: c.seenPrice, currency: c.seenPrice ? c.seenCurrency || 'UAH' : null, priceApprox: !!c.seenPrice, verified: false };
      }
      return drop(c, 'unreachable'); // 404/410, unknown domain, no answer, 5xx
    }
    if (!p.title) return drop(c, 'noTitle');
    const asked = new URL(c.url), got = new URL(p.url || c.url);
    if (got.pathname.replace(/\/+$/, '') === '' && asked.pathname.replace(/\/+$/, '') !== '') return drop(c, 'redirectedHome');
    if (!p.isProduct && !fromSearch) return drop(c, 'notProduct');
    const agree = titlesAgree(c.title, p.title);
    if (!agree && !fromSearch) return drop(c, 'titleMismatch');
    stats.verified = (stats.verified || 0) + 1;
    const host = hostOf(p.url || c.url);
    return {
      ...strip(c),
      url: p.url || c.url,
      title: p.title,
      why: agree ? c.why : '',
      imageUrl: p.image || null,
      price: p.price || null,
      currency: p.currency || (p.price && /\.ua$/.test(host || '') ? 'UAH' : null),
      verified: true,
    };
  }));
  return results.filter(Boolean);
}

// ---------- search pipeline ----------

const TARGET = 6;               // stop early when this many cards survived
const BUDGET_MS = 52_000;       // the whole search must finish well inside the 60 s edge limit
const SECOND_ROUND_BEFORE_MS = 20_000;

// `debug` (optional) is filled with counters so an admin can see where candidates disappear.
export async function searchOffers(params, partners, debug = {}) {
  if (process.env.DISCOVER_MOCK === 'true') return mockOffers(params);
  debug.provider = provider(params.provider);
  return debug.provider === 'serper' ? searchSerper(params, partners, debug) : searchNova(params, partners, debug);
}

async function searchNova(params, partners, debug) {
  const started = Date.now();
  const kept = new Map(); // url -> offer
  const failed = [];
  debug.rounds = [];

  for (let round = 0; round < 2; round++) {
    const elapsed = Date.now() - started;
    if (round > 0 && (kept.size >= TARGET || elapsed > SECOND_ROUND_BEFORE_MS)) break;
    let res;
    try {
      res = await converseWithWebSearch({
        system: systemPrompt(),
        prompt: buildPrompt(params, partners, { failed }),
        timeoutMs: round === 0 ? 45_000 : Math.max(10_000, BUDGET_MS - elapsed - 9_000),
      });
    } catch (e) {
      if (round === 0) throw e; // nothing yet: let the caller report the real error
      debug.rounds.push({ error: e.message });
      break;
    }
    const sourceUrls = new Set(res.sourceUrls.map(normalizeUrl).filter(Boolean));
    const candidates = parseCandidates(res.text).filter((c) => !kept.has(c.url) && !failed.includes(c.url)).slice(0, 15);
    const stats = {};
    const offers = await verifyCandidates(candidates, { sourceUrls }, stats);
    for (const o of offers) kept.set(o.url, o);
    const keptUrls = new Set(offers.map((o) => o.url));
    candidates.forEach((c) => { if (!keptUrls.has(c.url)) failed.push(c.url); });
    debug.rounds.push({
      textHead: round === 0 ? res.text.slice(0, 400) : undefined,
      candidates: candidates.length, sourceUrls: sourceUrls.size, searches: res.searches, shape: res.shape, ...stats, kept: offers.length,
    });
  }

  const offers = [...kept.values()];
  debug.kept = offers.length;
  debug.ms = Date.now() - started;
  console.log('discover:', JSON.stringify({ ms: debug.ms, rounds: debug.rounds.map((r) => ({ candidates: r.candidates, sourceUrls: r.sourceUrls, verified: r.verified || 0, unchecked: r.uncheckedKept || 0, kept: r.kept, dropped: Object.fromEntries(['blocked', 'unreachable', 'noTitle', 'redirectedHome', 'notProduct', 'titleMismatch'].map((k) => [k, r[k] || 0])) })), kept: offers.length }));
  return offers;
}

// Offline sample data for local development and tests (DISCOVER_MOCK=true).
function mockOffers({ interests }) {
  const base = [
    ['Ceramic pour-over coffee set', 'https://shop-one.example.com/coffee-set', 'direct', 1290],
    ['Specialty coffee beans sampler', 'https://partner-shop.example.ua/beans', 'direct', 620],
    ['Hand grinder', 'https://shop-two.example.com/grinder', 'direct', 1850],
    ['Insulated travel mug', 'https://shop-one.example.com/mug', 'direct', 540],
    ['Loose-leaf tea discovery box', 'https://partner-shop.example.ua/tea', 'adjacent', 480],
    ['Cozy reading blanket', 'https://shop-two.example.com/blanket', 'adjacent', 990],
  ];
  return base.map(([title, url, fit, price]) => ({
    title, url, fit, why: `Matches “${String(interests).slice(0, 40)}”`, imageUrl: null, price, currency: 'UAH', verified: true,
  }));
}


// ---------- Google-based pipeline (serper) ----------

const PLAN_SYSTEM = `You turn a gift request into Google Shopping search queries for online shops in Ukraine.
Reply with ONLY a JSON array of 4 objects: {"q": string, "fit": "direct" | "adjacent"}.
- 3 objects "direct": concrete products that clearly match the interests (a product type, optionally with a brand or feature).
- 1 object "adjacent": a different product category that someone with these interests would still enjoy.
Write queries in Ukrainian, 2-5 words each, with no shop names, no prices and no quotes.`;

// Asks the model for product search queries; falls back to the user's own words when the model is unavailable.
export async function planQueries({ interests }, debug = {}) {
  const fallback = () => String(interests).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 4).map((q) => ({ q, fit: 'direct' }));
  if (!hasAwsCredentials()) { debug.planner = 'fallback: no AWS credentials'; return fallback(); }
  try {
    const res = await converseWithWebSearch({ system: PLAN_SYSTEM, prompt: `Gift request: ${interests}`, maxTokens: 400, timeoutMs: 15_000, grounding: false });
    const plan = parseCandidatesPlan(res.text);
    if (plan.length) { debug.planner = 'ai'; return plan; }
    debug.planner = `fallback: unreadable reply ${res.text.slice(0, 120)}`;
  } catch (e) {
    debug.planner = `fallback: ${e.message}`.slice(0, 200);
  }
  return fallback();
}

export function parseCandidatesPlan(text) {
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  let arr = [];
  try { arr = JSON.parse(text.slice(a, b + 1)); } catch { arr = []; }
  return (Array.isArray(arr) ? arr : [])
    .map((x) => ({ q: typeof x?.q === 'string' ? x.q.replace(/\s+/g, ' ').trim().slice(0, 80) : '', fit: x?.fit === 'adjacent' ? 'adjacent' : 'direct' }))
    .filter((x) => x.q.length >= 2).slice(0, 5);
}

const isGoogleHost = (h) => !!h && /(^|\.)google\.[a-z.]+$/.test(h);
const MAX_PER_SHOP = 3;
const MAX_RESULTS = 12;

// Turns raw Google Shopping listings into offers: real merchant links only, relevant budget, varied shops.
export function shoppingToOffers(listings, fit, { budget, currency }, stats = {}) {
  const out = [];
  for (const l of listings) {
    const url = httpUrl(l.url);
    const host = hostOf(url);
    if (!url || !l.title) { stats.badListing = (stats.badListing || 0) + 1; continue; }
    if (isGoogleHost(host)) { stats.googleRedirect = (stats.googleRedirect || 0) + 1; continue; }
    if (isPlaceholderHost(host) || isForeignMarketplace(host)) { stats.blockedShop = (stats.blockedShop || 0) + 1; continue; }
    if (budget && l.price && (l.currency || 'UAH') === currency && l.price > budget * 1.15) { stats.overBudget = (stats.overBudget || 0) + 1; continue; }
    out.push({ title: l.title, url, fit, why: '', shop: l.shop || null, imageUrl: l.imageUrl || null, price: l.price || null, currency: l.price ? l.currency || (/\.ua$/.test(host) ? 'UAH' : null) : null, verified: true });
  }
  return out;
}

export function diversify(offers) {
  const perShop = new Map();
  const seen = new Set();
  const out = [];
  for (const o of offers) {
    const key = normalizeUrl(o.url);
    const shop = hostOf(o.url);
    if (!key || seen.has(key)) continue;
    if ((perShop.get(shop) || 0) >= MAX_PER_SHOP) continue;
    seen.add(key);
    perShop.set(shop, (perShop.get(shop) || 0) + 1);
    out.push(o);
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

export async function searchSerper(params, partners, debug = {}, deps = {}) {
  const shopping = deps.shoppingSearch || shoppingSearch;
  const web = deps.webSearch || webSearch;
  const fetcher = deps.fetcher || fetchPreview;
  const started = Date.now();
  const gl = country().toLowerCase();
  const plan = await (deps.planQueries || planQueries)(params, debug);
  debug.plan = plan;
  const stats = debug.stats = {};

  // 1. Google Shopping: every listing already has title + link + price + photo of the same product.
  const settled = await Promise.allSettled(plan.map((p) => shopping(p.q, { gl, hl: gl === 'ua' ? 'uk' : 'en' })));
  let offers = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === 'rejected') { errors.push(r.reason.message); return; }
    stats.listings = (stats.listings || 0) + r.value.length;
    if (i === 0 && r.value[0]) debug.sampleListing = r.value[0];
    offers.push(...shoppingToOffers(r.value, plan[i].fit, params, stats));
  });
  if (errors.length === plan.length) throw Object.assign(new Error(errors[0]), { kind: 'search' });
  if (errors.length) debug.errors = errors;
  offers = diversify(offers);
  stats.fromShopping = offers.length;

  // 2. Too few (or partner shops to include): look inside shops with ordinary results and check the pages.
  const active = partners.filter((p) => p.active).slice(0, 2);
  const direct = plan.find((p) => p.fit === 'direct') || plan[0];
  if ((offers.length < 6 || active.length) && direct) {
    const queries = [...active.map((p) => ({ q: `site:${p.domain} ${direct.q}`, fit: 'direct' }))];
    if (offers.length < 6) queries.push({ q: `${direct.q} купити`, fit: 'direct' });
    const found = await Promise.allSettled(queries.map((x) => web(x.q, { gl, hl: gl === 'ua' ? 'uk' : 'en' })));
    const candidates = [];
    const urls = new Set();
    found.forEach((r, i) => {
      if (r.status !== 'fulfilled') { (debug.errors ||= []).push(r.reason.message); return; }
      for (const x of r.value) {
        const u = httpUrl(x.url), h = hostOf(u);
        if (!u || isGoogleHost(h) || isPlaceholderHost(h) || isForeignMarketplace(h)) continue;
        urls.add(normalizeUrl(u));
        candidates.push({ title: x.title, url: u, fit: queries[i].fit, why: '', seenPrice: null, seenCurrency: null });
      }
    });
    const vstats = debug.verifyStats = {};
    const checked = await verifyCandidates(candidates.slice(0, 12), { sourceUrls: urls, fetcher }, vstats);
    offers = diversify([...offers, ...checked.filter((c) => !offers.some((o) => normalizeUrl(o.url) === normalizeUrl(c.url)))]);
  }

  debug.kept = offers.length;
  debug.ms = Date.now() - started;
  console.log('discover(serper):', JSON.stringify({ ms: debug.ms, plan: plan.map((p) => p.q), stats, verify: debug.verifyStats, kept: offers.length }));
  return offers;
}
