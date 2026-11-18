import pg from 'pg';
import { rpcQuery } from './dbrpc.js';

// Return DATE columns as plain 'YYYY-MM-DD' strings. By default pg builds a JS Date at local
// midnight, and toISOString() then shifts the day back by one on servers east of UTC (e.g. Kyiv).
pg.types.setTypeParser(1082, (v) => v);

// DB_MODE=rpc: the AWS "edge" function has no network path to the database and sends queries to the
// main function instead (see dbrpc.js). Everywhere else (local, tests, the main function) we use pg.
export const rpcMode = process.env.DB_MODE === 'rpc';

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/bazhanka';
const useSsl = process.env.DATABASE_SSL === 'true';

export const pool = rpcMode ? null : new pg.Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export const query = rpcMode ? rpcQuery : (text, params) => pool.query(text, params);

export async function tx(fn) {
  // A transaction needs one connection across several statements; the routes that use tx() are served
  // by the main function, never by the edge function.
  if (rpcMode) throw new Error('Transactions are not available in DB_MODE=rpc');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Idempotent schema. Runs on every start, so a fresh database needs no manual step.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  came_from_slug TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wishlists (
  id SERIAL PRIMARY KEY,
  owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  occasion TEXT,
  event_date DATE,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  wishlist_id INT NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  image_url TEXT,
  price NUMERIC(12,2),
  currency TEXT DEFAULT 'UAH',
  note TEXT,
  chip_in BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, user_id)
);

CREATE TABLE IF NOT EXISTS santa_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  budget TEXT,
  exchange_date DATE,
  drawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS santa_members (
  group_id INT NOT NULL REFERENCES santa_groups(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wishlist_id INT REFERENCES wishlists(id) ON DELETE SET NULL,
  giftee_id INT REFERENCES users(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- Product analytics for the report (validation metrics from the one-pager).
CREATE TABLE IF NOT EXISTS list_views (
  id SERIAL PRIMARY KEY,
  wishlist_id INT NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  visitor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_days (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  page TEXT,
  rating INT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Ideas" (discover): shops that pay for promotion, cached AI searches, usage log and funnel events.
CREATE TABLE IF NOT EXISTS partners (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,      -- bare host, e.g. "rozetka.com.ua"; subdomains match too
  boost INT NOT NULL DEFAULT 1,     -- ranking weight among relevant results (1-5)
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discover_cache (
  cache_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discover_runs (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cached BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discover_events (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,               -- 'shown' | 'click' | 'add'
  domain TEXT,
  partner_id INT REFERENCES partners(id) ON DELETE SET NULL,
  label TEXT,                       -- 'match' | 'new'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE items ADD COLUMN IF NOT EXISTS source TEXT;  -- e.g. 'discover', 'discover:partner'

CREATE INDEX IF NOT EXISTS idx_runs_user ON discover_runs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_partner ON discover_events(partner_id, kind);
CREATE INDEX IF NOT EXISTS idx_items_wishlist ON items(wishlist_id);
CREATE INDEX IF NOT EXISTS idx_res_item ON reservations(item_id);
CREATE INDEX IF NOT EXISTS idx_views_list ON list_views(wishlist_id);
`;

export async function migrate() {
  if (rpcMode) return; // the main function owns the schema
  await pool.query(SCHEMA);
}
