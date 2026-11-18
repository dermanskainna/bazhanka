import express, { Router } from 'express';
import { query } from '../db.js';
import { requireUser } from '../auth.js';
import { ah, HttpError, randomCode } from '../util.js';

// Own photos for gifts. Stored in the database (no extra storage service to run or pay for): the
// browser shrinks a photo to about 1200 px before upload, so one is typically 100-300 KB.
// An item points at its photo with image_url = "/api/photos/<key>".

const r = Router();
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PER_USER = 300;
export const OWN_PHOTO = /^\/api\/photos\/[a-z0-9]{16}$/;

// Trust the bytes, not the Content-Type header.
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

r.post('/photos', requireUser, express.raw({ type: () => true, limit: MAX_BYTES }), ah(async (req, res) => {
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const mime = sniff(buf);
  if (!mime) throw new HttpError(400, 'Please choose a JPEG, PNG or WebP photo');

  // Forget this user's uploads that never made it onto a gift (older than a day).
  await query(
    `DELETE FROM photos p WHERE p.owner_id = $1 AND p.created_at < now() - interval '1 day'
       AND NOT EXISTS (SELECT 1 FROM items i WHERE i.image_url = '/api/photos/' || p.key)`,
    [req.user.id],
  ).catch(() => {});
  const { rows } = await query('SELECT count(*)::int AS n FROM photos WHERE owner_id = $1', [req.user.id]);
  if (rows[0].n >= MAX_PER_USER) throw new HttpError(429, 'You have uploaded a lot of photos — remove some gifts first');

  const key = randomCode(16);
  await query('INSERT INTO photos (key, owner_id, mime, data) VALUES ($1, $2, $3, $4)', [key, req.user.id, mime, buf]);
  res.status(201).json({ url: `/api/photos/${key}` });
}));

r.get('/photos/:key', ah(async (req, res) => {
  if (!/^[a-z0-9]{16}$/.test(req.params.key)) throw new HttpError(404, 'Photo not found');
  const { rows } = await query('SELECT mime, data FROM photos WHERE key = $1', [req.params.key]);
  if (!rows[0]) throw new HttpError(404, 'Photo not found');
  res.set({
    'Content-Type': rows[0].mime,
    // A key never changes its content, so browsers may keep it for a year.
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
  });
  res.send(rows[0].data);
}));

export default r;
