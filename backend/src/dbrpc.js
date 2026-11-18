import crypto from 'node:crypto';
import { signRequest } from './bedrock.js';

// SQL over lambda:Invoke.
//
// On AWS the main API function lives in a VPC next to Aurora and has no internet access. A second
// function (the "edge" function, outside the VPC) handles the routes that need the internet: link
// preview and gift ideas. It has no route to the database, so it sends every query to the main
// function with lambda:Invoke. The Lambda Web Adapter delivers such a non-HTTP event to
// AWS_LWA_PASS_THROUGH_PATH (we use /internal/db), where `rpcHandler` runs it on the normal pg pool.
//
// The handler is also reachable through the public Function URL, so every call is signed with an
// HMAC key derived from JWT_SECRET (both functions have it) and must be fresh. Calls that arrive as
// HTTP requests (they carry an object request context) are rejected even with a valid signature.

const MAX_SKEW_MS = 60_000;

const rpcKey = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required for the database RPC');
  return crypto.createHash('sha256').update(`bazhanka-db-rpc:${secret}`).digest();
};

const canonical = ({ ts, text, params }) => `${ts}\n${text}\n${JSON.stringify(params ?? [])}`;

export function signCall(call) {
  return crypto.createHmac('sha256', rpcKey()).update(canonical(call)).digest('hex');
}

export function verifyCall(call, now = Date.now()) {
  if (!call || typeof call.text !== 'string' || typeof call.sig !== 'string' || !Number.isFinite(call.ts)) return 'malformed call';
  if (call.params !== undefined && !Array.isArray(call.params)) return 'malformed call';
  if (Math.abs(now - call.ts) > MAX_SKEW_MS) return 'stale call';
  const want = Buffer.from(signCall(call), 'hex');
  const got = Buffer.from(call.sig, 'hex');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return 'bad signature';
  return null;
}

// Lambda Web Adapter puts the event's request context in this header. For an invoke (pass-through)
// event there is none; an HTTP request through the Function URL always has an object here.
export function isPassThrough(headerValue) {
  if (headerValue === undefined) return true;
  try {
    const v = JSON.parse(headerValue);
    return v === null || typeof v !== 'object';
  } catch {
    return false;
  }
}

// Express handler for the main function (DB_RPC_SERVER=true).
export function rpcHandler(pool) {
  return async (req, res) => {
    if (!isPassThrough(req.get('x-amzn-request-context'))) return res.status(404).json({ error: 'Not found' });
    const call = req.body?.bazhankaDb;
    const problem = verifyCall(call);
    if (problem) {
      console.warn('db rpc rejected:', problem);
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    try {
      const r = await pool.query(call.text, call.params || []);
      res.json({ rows: r.rows, rowCount: r.rowCount });
    } catch (e) {
      // Same fields routes may look at on a pg error.
      res.json({ error: { message: e.message, code: e.code, constraint: e.constraint } });
    }
  };
}

// The adapter may hand back our JSON as is, as a JSON string, or wrapped like an HTTP response.
export function unwrapPayload(payload) {
  let v = payload;
  for (let i = 0; i < 3; i++) {
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { break; }
      continue;
    }
    if (v && typeof v === 'object' && !('rows' in v) && !('error' in v) && 'body' in v) {
      v = v.isBase64Encoded ? Buffer.from(String(v.body), 'base64').toString('utf8') : v.body;
      continue;
    }
    break;
  }
  return v;
}

// query() for the edge function (DB_MODE=rpc). Returns { rows, rowCount } like pg.
// Note: values travel as JSON, so timestamps arrive as ISO strings instead of Date objects.
export async function rpcQuery(text, params = [], { timeoutMs = 30_000 } = {}) {
  const fn = process.env.DB_RPC_FUNCTION;
  if (!fn) throw new Error('DB_RPC_FUNCTION is not set');
  const region = process.env.AWS_REGION || process.env.BEDROCK_REGION || 'us-east-1';
  const ts = Date.now();
  const call = { ts, text, params };
  const body = JSON.stringify({ bazhankaDb: { ...call, sig: signCall(call) } });
  const host = `lambda.${region}.amazonaws.com`;
  const path = `/2015-03-31/functions/${fn}/invocations`;
  const headers = signRequest({
    host, path, region, service: 'lambda', body,
    creds: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    },
  });
  delete headers.host;

  // DB_RPC_ENDPOINT is only for tests (a fake Lambda Invoke endpoint on localhost).
  const base = process.env.DB_RPC_ENDPOINT || `https://${host}`;
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
  const raw = await res.text();
  if (!res.ok || res.headers.get('x-amz-function-error')) {
    throw new Error(`Database call failed (lambda ${res.status}${res.headers.get('x-amz-function-error') ? ', function error' : ''}): ${raw.slice(0, 300)}`);
  }
  const out = unwrapPayload(raw);
  if (out?.error) {
    const err = new Error(out.error.message || 'Database error');
    if (out.error.code) err.code = out.error.code;
    if (out.error.constraint) err.constraint = out.error.constraint;
    throw err;
  }
  if (!out || !Array.isArray(out.rows)) throw new Error(`Unexpected database reply: ${String(raw).slice(0, 200)}`);
  return { rows: out.rows, rowCount: out.rowCount ?? out.rows.length };
}
