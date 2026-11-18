import { Router } from 'express';
import { query } from '../db.js';
import { requireUser, isAdmin } from '../auth.js';
import { ah, HttpError, str } from '../util.js';

const r = Router();

// Support for the project itself (a Monobank jar). DONATION_URL / DONATION_LABEL override the defaults;
// with no link at all the site shows no support links.
const SUPPORT_URL = 'https://send.monobank.ua/jar/5jhAhkuKYy'; // Monobank jar “Підтримати Бажанку”

r.get('/config', (_req, res) => {
  res.json({
    donationUrl: process.env.DONATION_URL || SUPPORT_URL || null,
    donationLabel: process.env.DONATION_LABEL || 'Support Bazhanka',
  });
});

r.post('/feedback', ah(async (req, res) => {
  const message = str(req.body.message, 3000);
  if (!message) throw new HttpError(400, 'Write a few words first');
  const rating = Number(req.body.rating);
  await query('INSERT INTO feedback (user_id, page, rating, message) VALUES ($1,$2,$3,$4)', [
    req.user?.id || null,
    str(req.body.page, 200),
    rating >= 1 && rating <= 5 ? rating : null,
    message,
  ]);
  res.status(201).json({ ok: true });
}));

// Validation metrics from the one-pager, for the report. Restricted to ADMIN_EMAILS.
r.get('/admin/stats', requireUser, ah(async (req, res) => {
  if (!isAdmin(req.user)) throw new HttpError(403, 'Admins only');
  const one = async (sql) => (await query(sql)).rows[0];

  const totals = await one(`
    SELECT (SELECT count(*) FROM users) AS signups,
           (SELECT count(*) FROM wishlists) AS wishlists,
           (SELECT count(DISTINCT owner_id) FROM wishlists) AS list_creators,
           (SELECT count(*) FROM items) AS items,
           (SELECT count(*) FROM reservations) AS reservations,
           (SELECT count(*) FROM items i WHERE i.chip_in AND EXISTS (SELECT 1 FROM reservations r WHERE r.item_id = i.id)) AS chip_in_items,
           (SELECT count(*) FROM santa_groups) AS santa_groups,
           (SELECT count(*) FROM santa_groups WHERE drawn_at IS NOT NULL) AS santa_drawn,
           (SELECT count(*) FROM santa_members) AS santa_members,
           (SELECT count(DISTINCT visitor_id) FROM list_views) AS unique_visitors`);

  // A "guest" = a signed-in user who opened someone else's wishlist.
  const guests = await one(`
    WITH g AS (
      SELECT v.user_id, min(v.created_at) AS first_view
      FROM list_views v JOIN wishlists w ON w.id = v.wishlist_id
      WHERE v.user_id IS NOT NULL AND v.user_id <> w.owner_id
      GROUP BY v.user_id
    )
    SELECT count(*) AS guests,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM reservations r WHERE r.user_id = g.user_id)) AS guests_reserved,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM wishlists w WHERE w.owner_id = g.user_id AND w.created_at > g.first_view)) AS guests_created_list
    FROM g`);

  const retention = await one(`
    SELECT count(*) AS active_users,
           count(*) FILTER (WHERE days >= 2) AS returning_users
    FROM (SELECT user_id, count(*) AS days FROM activity_days GROUP BY user_id) t`);

  const signupsByDay = (await query(`
    SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM users GROUP BY 1 ORDER BY 1`)).rows;

  const feedback = (await query(`
    SELECT f.created_at, f.page, f.rating, f.message, u.name FROM feedback f
    LEFT JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC LIMIT 200`)).rows;

  const n = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));
  res.json({ totals: n(totals), guests: n(guests), retention: n(retention), signupsByDay, feedback });
}));

export default r;
