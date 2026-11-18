import crypto from 'node:crypto';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomCode(len = 8) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wrap async route handlers so thrown errors reach the error middleware.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function str(v, max = 500) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

export function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

// Advertising / tracking query parameters that only clutter a saved shop link.
const TRACKING_PARAM = /^(utm_.+|gad_.+|gclid|gbraid|wbraid|fbclid|yclid|msclkid|_ga|_gl|mc_cid|mc_eid)$/i;

export function httpUrl(v) {
  const s = str(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return null;
  }
}

// Route ids must be positive integers; anything else is "not found" (not a database error).
export function intId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new HttpError(404, 'Not found');
  return n;
}

// Secret Santa: random derangement as a single cycle, so nobody draws themselves
// and there are no closed pairs.
export function drawPairs(userIds) {
  const ids = [...userIds];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const pairs = new Map();
  ids.forEach((id, i) => pairs.set(id, ids[(i + 1) % ids.length]));
  return pairs;
}
