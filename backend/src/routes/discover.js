import { Router } from 'express';
import { query } from '../db.js';
import { requireUser, isAdmin } from '../auth.js';
import { hasAwsCredentials, bedrockConfig } from '../bedrock.js';
import { cacheKey, findPartner, hostOf, normDomain, rankOffers, searchOffers } from '../discover.js';
import { ah, HttpError, str, num, httpUrl, intId } from '../util.js';

const r = Router();

const DAILY_LIMIT = () => Number(process.env.DISCOVER_DAILY_LIMIT || 5);
const CACHE_HOURS = () => Number(process.env.DISCOVER_CACHE_HOURS || 24);
const enabled = () => process.env.DISCOVER_ENABLED !== 'false' && (process.env.DISCOVER_MOCK === 'true' || hasAwsCredentials());

const activePartners = async () => (await query('SELECT * FROM partners WHERE active ORDER BY id')).rows;

async function usedToday(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM discover_runs WHERE user_id = $1 AND NOT cached AND created_at > now() - interval '1 day'`,
    [userId],
  );
  return rows[0].n;
}

function logEvents(userId, offers) {
  if (!offers.length) return Promise.resolve();
  const values = [];
  const params = [userId];
  offers.forEach((o) => {
    params.push(hostOf(o.url), o.partner?.id || null, o.label);
    values.push(`($1,'shown',$${params.length - 2},$${params.length - 1},$${params.length})`);
  });
  return query(`INSERT INTO discover_events (user_id, kind, domain, partner_id, label) VALUES ${values.join(',')}`, params).catch(() => {});
}

r.get('/discover/status', requireUser, ah(async (req, res) => {
  const limit = DAILY_LIMIT();
  res.json({ enabled: enabled(), dailyLimit: limit, remaining: Math.max(0, limit - (await usedToday(req.user.id))) });
}));

r.post('/discover/search', requireUser, ah(async (req, res) => {
  if (!enabled()) throw new HttpError(503, 'Gift ideas are not switched on yet');
  const interests = str(req.body.interests, 300);
  if (!interests || interests.length < 3) throw new HttpError(400, 'Tell us a bit about what they like');
  const budget = num(req.body.budget);
  const currency = (str(req.body.currency, 3) || 'UAH').toUpperCase();
  const params = { interests, budget, currency };
  const key = cacheKey(params);
  const limit = DAILY_LIMIT();

  let offers;
  let cached = false;
  const hit = (await query(
    `SELECT payload FROM discover_cache WHERE cache_key = $1 AND created_at > now() - ($2 || ' hours')::interval`,
    [key, String(CACHE_HOURS())],
  )).rows[0];

  if (hit) {
    offers = hit.payload;
    cached = true;
  } else {
    if ((await usedToday(req.user.id)) >= limit) {
      throw new HttpError(429, `You have used today’s ${limit} searches — try again tomorrow`);
    }
    // Count the run before the (slow, paid) call so parallel requests cannot dodge the limit.
    await query('INSERT INTO discover_runs (user_id, cached) VALUES ($1, false)', [req.user.id]);
    try {
      offers = await searchOffers(params, await activePartners());
    } catch (e) {
      console.error('discover search failed:', e.kind || '', e.message);
      await query(`DELETE FROM discover_runs WHERE id = (SELECT max(id) FROM discover_runs WHERE user_id = $1)`, [req.user.id]).catch(() => {});
      throw new HttpError(502, `The idea search is not available right now — please try again in a minute${e.kind ? ` (${e.kind})` : ''}`);
    }
    if (offers.length) {
      await query(
        `INSERT INTO discover_cache (cache_key, payload) VALUES ($1, $2)
         ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, created_at = now()`,
        [key, JSON.stringify(offers)],
      );
    }
  }
  if (cached) await query('INSERT INTO discover_runs (user_id, cached) VALUES ($1, true)', [req.user.id]).catch(() => {});

  // Partners are applied at read time, so a new contract affects cached results immediately.
  const ranked = rankOffers(offers, await activePartners());
  await logEvents(req.user.id, ranked);
  res.json({ offers: ranked, cached, remaining: Math.max(0, limit - (await usedToday(req.user.id))) });
}));

r.post('/discover/event', requireUser, ah(async (req, res) => {
  const url = httpUrl(req.body.url);
  if (!url) throw new HttpError(400, 'Bad link');
  const partner = findPartner(hostOf(url), await activePartners());
  const label = req.body.label === 'new' ? 'new' : 'match';
  await query(
    `INSERT INTO discover_events (user_id, kind, domain, partner_id, label) VALUES ($1,'click',$2,$3,$4)`,
    [req.user.id, hostOf(url), partner?.id || null, label],
  );
  res.json({ ok: true });
}));

r.post('/discover/add', requireUser, ah(async (req, res) => {
  const { rows } = await query('SELECT id, owner_id FROM wishlists WHERE id = $1', [intId(req.body.wishlistId)]);
  if (!rows[0]) throw new HttpError(404, 'Wishlist not found');
  if (rows[0].owner_id !== req.user.id) throw new HttpError(403, 'This is not your wishlist');
  const title = str(req.body.title, 300);
  if (!title) throw new HttpError(400, 'An item needs a title');
  const url = httpUrl(req.body.url);
  const partner = url ? findPartner(hostOf(url), await activePartners()) : null;
  const label = req.body.label === 'new' ? 'new' : 'match';

  const ins = await query(
    `INSERT INTO items (wishlist_id, title, url, image_url, price, currency, note, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [rows[0].id, title, url, httpUrl(req.body.imageUrl), num(req.body.price), (str(req.body.currency, 3) || 'UAH').toUpperCase(),
      str(req.body.note, 1000), partner ? 'discover:partner' : 'discover'],
  );
  await query(
    `INSERT INTO discover_events (user_id, kind, domain, partner_id, label) VALUES ($1,'add',$2,$3,$4)`,
    [req.user.id, url ? hostOf(url) : null, partner?.id || null, label],
  ).catch(() => {});
  res.status(201).json({ itemId: ins.rows[0].id });
}));

// ---- Admin: partner shops and their funnel ----

const adminOnly = (req, _res, next) => (isAdmin(req.user) ? next() : next(new HttpError(403, 'Admins only')));

// One-click health check for admins: tells which step fails (network / permissions / model).
r.get('/admin/discover-check', requireUser, adminOnly, ah(async (_req, res) => {
  const cfg = bedrockConfig();
  const out = { region: cfg.region, modelId: cfg.modelId, enabled: enabled(), mock: process.env.DISCOVER_MOCK === 'true', credentials: hasAwsCredentials() };
  if (!out.credentials) return res.json({ ...out, ok: false, kind: 'credentials', error: 'No AWS credentials in this environment' });
  const t0 = Date.now();
  const debug = {};
  try {
    const offers = await searchOffers({ interests: 'coffee', budget: null, currency: 'UAH' }, await activePartners(), debug);
    res.json({ ...out, ok: true, ms: Date.now() - t0, offers: offers.length, debug });
  } catch (e) {
    res.json({ ...out, ok: false, ms: Date.now() - t0, kind: e.kind || 'unknown', error: e.message, debug });
  }
}));

const partnerOut = (p) => ({
  id: p.id, name: p.name, domain: p.domain, boost: p.boost, active: p.active,
  shown: Number(p.shown || 0), clicks: Number(p.clicks || 0), adds: Number(p.adds || 0),
});

r.get('/admin/partners', requireUser, adminOnly, ah(async (_req, res) => {
  const { rows } = await query(`
    SELECT p.*,
      count(e.*) FILTER (WHERE e.kind = 'shown') AS shown,
      count(e.*) FILTER (WHERE e.kind = 'click') AS clicks,
      count(e.*) FILTER (WHERE e.kind = 'add') AS adds
    FROM partners p LEFT JOIN discover_events e ON e.partner_id = p.id
    GROUP BY p.id ORDER BY p.created_at DESC`);
  const totals = (await query(`
    SELECT count(*) FILTER (WHERE kind = 'shown') AS shown,
           count(*) FILTER (WHERE kind = 'click') AS clicks,
           count(*) FILTER (WHERE kind = 'add') AS adds,
           (SELECT count(*) FROM discover_runs WHERE NOT cached) AS searches
    FROM discover_events`)).rows[0];
  res.json({ partners: rows.map(partnerOut), totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Number(v)])) });
}));

r.post('/admin/partners', requireUser, adminOnly, ah(async (req, res) => {
  const name = str(req.body.name, 120);
  const domain = normDomain(req.body.domain);
  if (!name || !domain) throw new HttpError(400, 'Shop name and a valid domain (like shop.com.ua) are required');
  const boost = Math.min(5, Math.max(1, Math.round(Number(req.body.boost) || 1)));
  const dup = await query('SELECT 1 FROM partners WHERE domain = $1', [domain]);
  if (dup.rows[0]) throw new HttpError(409, 'This shop is already a partner');
  const { rows } = await query('INSERT INTO partners (name, domain, boost) VALUES ($1,$2,$3) RETURNING *', [name, domain, boost]);
  res.status(201).json({ partner: partnerOut(rows[0]) });
}));

r.patch('/admin/partners/:id', requireUser, adminOnly, ah(async (req, res) => {
  const id = intId(req.params.id);
  const cur = (await query('SELECT * FROM partners WHERE id = $1', [id])).rows[0];
  if (!cur) throw new HttpError(404, 'Partner not found');
  const boost = req.body.boost === undefined ? cur.boost : Math.min(5, Math.max(1, Math.round(Number(req.body.boost) || 1)));
  const active = req.body.active === undefined ? cur.active : !!req.body.active;
  const { rows } = await query('UPDATE partners SET boost = $1, active = $2 WHERE id = $3 RETURNING *', [boost, active, id]);
  res.json({ partner: partnerOut(rows[0]) });
}));

r.delete('/admin/partners/:id', requireUser, adminOnly, ah(async (req, res) => {
  await query('DELETE FROM partners WHERE id = $1', [intId(req.params.id)]);
  res.json({ ok: true });
}));

export default r;
