import { DiscoverError } from './bedrock.js';

// Google results through serper.dev (https://serper.dev, ~$1 per 1000 queries, 2500 free).
// Every link comes from a real Google result, so nothing can be invented.

export const serperKey = () => process.env.SERPER_API_KEY || '';

async function call(endpoint, body, timeoutMs = 12_000) {
  let res;
  try {
    res = await fetch(`https://google.serper.dev/${endpoint}`, {
      method: 'POST',
      headers: { 'X-API-KEY': serperKey(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
    throw new DiscoverError(timedOut ? 'timeout' : 'network', `Could not reach serper.dev: ${e.cause?.code || e.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const kind = res.status === 401 || res.status === 403 ? 'access' : res.status === 429 ? 'throttled' : 'search';
    throw new DiscoverError(kind, `serper ${res.status}: ${data.message || 'request failed'}`);
  }
  return data;
}

// "1 299,00 ₴" -> { price: 1299, currency: 'UAH' }; "$12.99" -> { price: 12.99, currency: 'USD' }
export function parsePriceText(text) {
  const t = String(text ?? '');
  const m = t.match(/\d[\d\s .,]*/);
  if (!m) return { price: null, currency: null };
  let n = m[0].replace(/[\s ]/g, '').replace(/[.,]+$/, '');
  const lastDot = n.lastIndexOf('.'), lastComma = n.lastIndexOf(',');
  const sep = Math.max(lastDot, lastComma);
  if (sep !== -1) {
    const decimals = n.length - sep - 1;
    if (lastDot !== -1 && lastComma !== -1) n = n.slice(0, sep).replace(/[.,]/g, '') + '.' + n.slice(sep + 1);
    else if (decimals === 3 || n.split(/[.,]/).length > 2) n = n.replace(/[.,]/g, '');
    else n = n.replace(',', '.');
  }
  const price = Number(n);
  const currency = /₴|грн|uah/i.test(t) ? 'UAH' : /\$|usd/i.test(t) ? 'USD' : /€|eur/i.test(t) ? 'EUR' : /zł|pln/i.test(t) ? 'PLN' : null;
  return { price: Number.isFinite(price) && price > 0 ? price : null, currency };
}

// Google Shopping listings: title, shop name, product link, price and photo all belong to one listing.
export async function shoppingSearch(q, { gl = 'ua', hl = 'uk', num = 12 } = {}) {
  const data = await call('shopping', { q, gl, hl, num });
  return (data.shopping || []).map((x) => ({
    title: String(x.title || '').trim(),
    shop: String(x.source || '').trim(),
    url: x.link || '',
    imageUrl: x.imageUrl || null,
    ...parsePriceText(x.price),
  }));
}

// Ordinary Google results (used to look inside a particular shop with "site:").
export async function webSearch(q, { gl = 'ua', hl = 'uk', num = 10 } = {}) {
  const data = await call('search', { q, gl, hl, num });
  return (data.organic || []).map((x) => ({ title: String(x.title || '').trim(), url: x.link || '', snippet: x.snippet || '' }));
}
