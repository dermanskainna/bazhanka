import { Router } from 'express';
import crypto from 'node:crypto';
import { query, tx } from '../db.js';
import { requireUser } from '../auth.js';
import { fetchPreview } from '../preview.js';
import { ah, HttpError, str, num, httpUrl, randomCode, intId } from '../util.js';

const r = Router();

async function ownedWishlist(id, userId) {
  const { rows } = await query('SELECT * FROM wishlists WHERE id = $1', [intId(id)]);
  if (!rows[0]) throw new HttpError(404, 'Wishlist not found');
  if (rows[0].owner_id !== userId) throw new HttpError(403, 'This is not your wishlist');
  return rows[0];
}

async function ownedItem(id, userId) {
  const { rows } = await query(
    'SELECT i.*, w.owner_id FROM items i JOIN wishlists w ON w.id = i.wishlist_id WHERE i.id = $1',
    [intId(id)],
  );
  if (!rows[0]) throw new HttpError(404, 'Item not found');
  if (rows[0].owner_id !== userId) throw new HttpError(403, 'This is not your item');
  return rows[0];
}

function itemFields(body) {
  return {
    title: str(body.title, 300),
    url: httpUrl(body.url),
    image_url: httpUrl(body.imageUrl),
    price: num(body.price),
    currency: (str(body.currency, 3) || 'UAH').toUpperCase(),
    note: str(body.note, 1000),
    chip_in: !!body.chipIn,
  };
}

const itemOut = (i) => ({
  id: i.id,
  title: i.title,
  url: i.url,
  imageUrl: i.image_url,
  price: i.price === null ? null : Number(i.price),
  currency: i.currency,
  note: i.note,
  chipIn: i.chip_in,
});

const listOut = (w) => ({
  id: w.id,
  title: w.title,
  occasion: w.occasion,
  eventDate: w.event_date ? String(w.event_date).slice(0, 10) : null,
  slug: w.slug,
  itemCount: w.item_count !== undefined ? Number(w.item_count) : undefined,
});

// ---- Owner: my wishlists ----

r.get('/wishlists', requireUser, ah(async (req, res) => {
  const { rows } = await query(
    `SELECT w.*, (SELECT count(*) FROM items i WHERE i.wishlist_id = w.id) AS item_count
     FROM wishlists w WHERE owner_id = $1 ORDER BY created_at DESC`,
    [req.user.id],
  );
  res.json({ wishlists: rows.map(listOut) });
}));

r.post('/wishlists', requireUser, ah(async (req, res) => {
  const title = str(req.body.title, 120);
  if (!title) throw new HttpError(400, 'Give your wishlist a name');
  const { rows } = await query(
    `INSERT INTO wishlists (owner_id, title, occasion, event_date, slug) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, title, str(req.body.occasion, 60), str(req.body.eventDate, 10), randomCode(10)],
  );
  res.status(201).json({ wishlist: listOut(rows[0]) });
}));

r.patch('/wishlists/:id', requireUser, ah(async (req, res) => {
  const w = await ownedWishlist(req.params.id, req.user.id);
  const title = str(req.body.title, 120) || w.title;
  const { rows } = await query(
    'UPDATE wishlists SET title=$1, occasion=$2, event_date=$3 WHERE id=$4 RETURNING *',
    [title, str(req.body.occasion, 60), str(req.body.eventDate, 10), w.id],
  );
  res.json({ wishlist: listOut(rows[0]) });
}));

r.delete('/wishlists/:id', requireUser, ah(async (req, res) => {
  const w = await ownedWishlist(req.params.id, req.user.id);
  await query('DELETE FROM wishlists WHERE id = $1', [w.id]);
  res.json({ ok: true });
}));

// ---- Owner: items ----

r.post('/preview', requireUser, ah(async (req, res) => {
  res.json({ preview: await fetchPreview(String(req.body.url || '')) });
}));

r.post('/wishlists/:id/items', requireUser, ah(async (req, res) => {
  const w = await ownedWishlist(req.params.id, req.user.id);
  const f = itemFields(req.body);
  if (!f.title) throw new HttpError(400, 'An item needs a title');
  const { rows } = await query(
    `INSERT INTO items (wishlist_id, title, url, image_url, price, currency, note, chip_in)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [w.id, f.title, f.url, f.image_url, f.price, f.currency, f.note, f.chip_in],
  );
  res.status(201).json({ item: itemOut(rows[0]) });
}));

r.patch('/items/:id', requireUser, ah(async (req, res) => {
  const item = await ownedItem(req.params.id, req.user.id);
  const f = itemFields({ ...{ chipIn: item.chip_in }, ...req.body });
  if (!f.title) throw new HttpError(400, 'An item needs a title');
  const { rows } = await query(
    `UPDATE items SET title=$1, url=$2, image_url=$3, price=$4, currency=$5, note=$6, chip_in=$7
     WHERE id=$8 RETURNING *`,
    [f.title, f.url, f.image_url, f.price, f.currency, f.note, f.chip_in, item.id],
  );
  res.json({ item: itemOut(rows[0]) });
}));

r.delete('/items/:id', requireUser, ah(async (req, res) => {
  const item = await ownedItem(req.params.id, req.user.id);
  await query('DELETE FROM items WHERE id = $1', [item.id]);
  res.json({ ok: true });
}));

// ---- Shared link view ----
// The owner gets the plain list. Guests additionally get reservation status,
// but never the identities of other givers.

r.get('/lists/:slug', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT w.*, u.name AS owner_name FROM wishlists w JOIN users u ON u.id = w.owner_id WHERE w.slug = $1`,
    [req.params.slug],
  );
  const w = rows[0];
  if (!w) throw new HttpError(404, 'This wishlist does not exist (or was deleted)');
  const isOwner = req.user?.id === w.owner_id;

  // Anonymous visitor id for the "guests" metric.
  let vid = req.cookies?.bz_vid;
  if (!vid) {
    vid = crypto.randomUUID();
    res.cookie('bz_vid', vid, { httpOnly: true, sameSite: 'lax', maxAge: 365 * 24 * 3600 * 1000, secure: process.env.NODE_ENV === 'production' });
  }
  if (!isOwner) {
    query('INSERT INTO list_views (wishlist_id, user_id, visitor_id) VALUES ($1,$2,$3)', [w.id, req.user?.id || null, vid]).catch(() => {});
  }

  const items = (await query('SELECT * FROM items WHERE wishlist_id = $1 ORDER BY created_at', [w.id])).rows;
  let out = items.map(itemOut);

  if (!isOwner) {
    const res2 = await query(
      `SELECT item_id, user_id, amount FROM reservations WHERE item_id = ANY($1::int[])`,
      [items.map((i) => i.id)],
    );
    out = out.map((it) => {
      const rs = res2.rows.filter((x) => x.item_id === it.id);
      const mine = rs.find((x) => req.user && x.user_id === req.user.id);
      const base = { ...it, reserved: rs.length > 0, reservedByMe: !!mine };
      if (it.chipIn) {
        base.chip = {
          total: rs.reduce((s, x) => s + Number(x.amount || 0), 0),
          people: rs.length,
          mine: mine ? Number(mine.amount || 0) : 0,
        };
        base.reserved = it.price ? base.chip.total >= it.price : false;
      }
      return base;
    });
  }

  res.json({
    wishlist: { ...listOut(w), ownerName: w.owner_name },
    isOwner,
    items: out,
  });
}));

// ---- Guests: reserve / chip in ----

r.post('/items/:id/reserve', requireUser, ah(async (req, res) => {
  const result = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT i.*, w.owner_id FROM items i JOIN wishlists w ON w.id = i.wishlist_id WHERE i.id = $1 FOR UPDATE OF i`,
      [intId(req.params.id)],
    );
    const item = rows[0];
    if (!item) throw new HttpError(404, 'Item not found');
    if (item.owner_id === req.user.id) throw new HttpError(403, "You can't reserve gifts from your own list — that would spoil the surprise");

    if (item.chip_in) {
      const amount = num(req.body.amount);
      if (!amount) throw new HttpError(400, 'Enter how much you want to chip in');
      await c.query(
        `INSERT INTO reservations (item_id, user_id, amount) VALUES ($1,$2,$3)
         ON CONFLICT (item_id, user_id) DO UPDATE SET amount = EXCLUDED.amount`,
        [item.id, req.user.id, amount],
      );
    } else {
      const taken = await c.query('SELECT user_id FROM reservations WHERE item_id = $1', [item.id]);
      if (taken.rows.some((x) => x.user_id !== req.user.id)) throw new HttpError(409, 'Someone has already reserved this gift');
      await c.query('INSERT INTO reservations (item_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [item.id, req.user.id]);
    }
    return { ok: true };
  });
  res.json(result);
}));

r.delete('/items/:id/reserve', requireUser, ah(async (req, res) => {
  await query('DELETE FROM reservations WHERE item_id = $1 AND user_id = $2', [intId(req.params.id), req.user.id]);
  res.json({ ok: true });
}));

// Gifts I am giving, across all lists.
r.get('/me/gifts', requireUser, ah(async (req, res) => {
  const { rows } = await query(
    `SELECT r.amount, i.id, i.title, i.url, i.image_url, i.price, i.currency, i.chip_in,
            w.title AS list_title, w.slug, w.event_date, u.name AS owner_name,
            (SELECT COALESCE(sum(amount),0) FROM reservations r2 WHERE r2.item_id = i.id) AS chip_total,
            (SELECT count(*) FROM reservations r2 WHERE r2.item_id = i.id) AS chip_people
     FROM reservations r
     JOIN items i ON i.id = r.item_id
     JOIN wishlists w ON w.id = i.wishlist_id
     JOIN users u ON u.id = w.owner_id
     WHERE r.user_id = $1
     ORDER BY w.event_date NULLS LAST, r.created_at DESC`,
    [req.user.id],
  );
  res.json({
    gifts: rows.map((g) => ({
      ...itemOut(g),
      myAmount: g.amount === null ? null : Number(g.amount),
      chipTotal: Number(g.chip_total),
      chipPeople: Number(g.chip_people),
      listTitle: g.list_title,
      slug: g.slug,
      ownerName: g.owner_name,
      eventDate: g.event_date ? String(g.event_date).slice(0, 10) : null,
    })),
  });
}));

export default r;
