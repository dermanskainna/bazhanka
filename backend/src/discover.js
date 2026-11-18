import crypto from 'node:crypto';
import { converseWithWebSearch } from './bedrock.js';
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
const CACHE_VERSION = 'v3';
export function cacheKey({ interests, budget, currency }) {
  const norm = String(interests).toLowerCase().replace(/[^\p{L}\p{N}\s,]/gu, ' ').split(/[\s,]+/).filter(Boolean).sort().join(' ');
  const b = budget ? Math.ceil(Number(budget) / 500) * 500 : 0; // coarse buckets so near-identical budgets share a cache entry
  return crypto.createHash('sha256').update(`${CACHE_VERSION}|${country()}|${norm}|${b}|${currency}`).digest('hex').slice(0, 40);
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
