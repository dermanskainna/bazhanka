import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate, pool, query } from './db.js';
import { rpcHandler } from './dbrpc.js';
import { loadUser } from './auth.js';
import authRoutes from './routes/auth.js';
import wishlistRoutes from './routes/wishlists.js';
import santaRoutes from './routes/santa.js';
import miscRoutes from './routes/misc.js';
import discoverRoutes from './routes/discover.js';

const app = express();
app.set('trust proxy', 1); // behind Render/Fly HTTPS proxy
app.disable('x-powered-by');
// Signed SQL calls from the AWS edge function (see dbrpc.js). Registered before loadUser on purpose.
if (process.env.DB_RPC_SERVER === 'true') {
  app.post('/internal/db', express.json({ limit: '1mb' }), rpcHandler(pool));
}

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(loadUser);

// Liveness without the database: readiness check of the edge function, which must not wake Aurora.
app.get('/livez', (_req, res) => res.json({ ok: true }));

app.get('/healthz', async (_req, res) => {
  try {
    await query('SELECT 1');
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
await migrate();
app.listen(port, () => console.log(`Bazhanka listening on :${port}`));
