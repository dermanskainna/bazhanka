import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate, pool } from './db.js';
import { loadUser } from './auth.js';
import authRoutes from './routes/auth.js';
import wishlistRoutes from './routes/wishlists.js';
import santaRoutes from './routes/santa.js';
import miscRoutes from './routes/misc.js';
import discoverRoutes from './routes/discover.js';

const app = express();
app.set('trust proxy', 1); // behind Render/Fly HTTPS proxy
app.disable('x-powered-by');

// Start listening immediately and run the migration in the background. On Lambda the init phase is
// limited to 10 s and a paused Aurora cluster needs 5-15 s to wake up, so waiting for the database
// before listening makes cold starts time out. /ping does not touch the database; every other
// request waits for the migration (which also wakes the database).
const ready = migrate();
ready.catch((e) => { console.error('migration failed', e); process.exit(1); });
app.get('/ping', (_req, res) => res.type('text').send('ok'));
app.use((_req, res, next) => ready.then(() => next(), () => res.status(503).json({ error: 'Starting up, try again' })));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(loadUser);

app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/santa', santaRoutes);
app.use('/api', discoverRoutes);
app.use('/api', wishlistRoutes);
app.use('/api', miscRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built frontend (single deployable service).
const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.STATIC_DIR || path.resolve(here, '../../frontend/dist');
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side' : err.message });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Bazhanka listening on :${port}`));
