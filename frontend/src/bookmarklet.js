// "+ Bazhanka" browser button (a bookmarklet).
//
// Many shops do not let our server read their pages (it identifies itself as a bot, on purpose).
// This button runs in the person's own browser, on the product page they already opened, reads the
// same product data our server would (JSON-LD Product, Open Graph / itemprop tags) and opens
// Bazhanka's /add page with the form filled in. The shop sees an ordinary visitor, nothing else.
//
// `grab` is turned into a string (`javascript:(...)(origin)`), so it must not use anything from
// outside its own body: no imports, no outer variables.

/* eslint-disable no-var */
function grab(origin) {
  var d = document;
  var out = { url: location.href, title: '', image: '', price: '', currency: '' };
  var abs = function (u) { if (!u) return ''; try { return new URL(u, location.href).href; } catch (e) { return ''; } };
  var meta = function (sel) { var el = d.querySelector(sel); return el ? String(el.getAttribute('content') || '').trim() : ''; };
  var text = function (el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; };

  var canon = d.querySelector('link[rel="canonical"]');
  if (canon && canon.href && /^https?:/.test(canon.href) && new URL(canon.href).host === location.host) out.url = canon.href;

  // 1. JSON-LD Product (most shops have it; it is what search engines read)
  var isProduct = function (n) { var t = n && n['@type']; return t === 'Product' || (Array.isArray(t) && t.indexOf('Product') !== -1); };
  var findProduct = function (n, depth) {
    if (!n || typeof n !== 'object' || depth > 6) return null;
    if (Array.isArray(n)) { for (var i = 0; i < n.length; i++) { var f = findProduct(n[i], depth + 1); if (f) return f; } return null; }
    if (isProduct(n)) return n;
    return findProduct(n['@graph'], depth + 1) || findProduct(n.mainEntity, depth + 1);
  };
  var scripts = d.querySelectorAll('script[type="application/ld+json"]');
  for (var i = 0; i < scripts.length && !out.title; i++) {
    try {
      var p = findProduct(JSON.parse(scripts[i].textContent), 0);
      if (!p) continue;
      out.title = String(p.name || '');
      var img = Array.isArray(p.image) ? p.image[0] : p.image;
      if (img && typeof img === 'object') img = img.url || img.contentUrl;
      if (img) out.image = abs(String(img));
      var offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
      if (offer && offer.offers) offer = Array.isArray(offer.offers) ? offer.offers[0] : offer.offers;
      if (offer) {
        out.price = String(offer.price != null ? offer.price : offer.lowPrice != null ? offer.lowPrice : '');
        out.currency = String(offer.priceCurrency || '');
      }
    } catch (e) { /* broken JSON-LD: try the next one */ }
  }

  // 2. Open Graph / microdata tags
  out.title = out.title || meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]');
  out.image = out.image || abs(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'));
  out.price = out.price || meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]') ||
    meta('[itemprop="price"]') || text(d.querySelector('[itemprop="price"]'));
  out.currency = out.currency || meta('meta[property="product:price:currency"]') || meta('meta[property="og:price:currency"]') ||
    meta('[itemprop="priceCurrency"]');

  // 3. Last resort for pages without any product markup: the heading and the biggest picture.
  out.title = out.title || text(d.querySelector('h1')) || d.title;
  if (!out.image) {
    var best = null, area = 150 * 150;
    var imgs = d.images;
    for (var j = 0; j < imgs.length; j++) {
      var a = (imgs[j].naturalWidth || 0) * (imgs[j].naturalHeight || 0);
      if (a > area && /^https?:/.test(imgs[j].currentSrc || imgs[j].src)) { area = a; best = imgs[j]; }
    }
    if (best) out.image = best.currentSrc || best.src;
  }

  var q = new URLSearchParams();
  q.set('url', out.url.slice(0, 2000));
  if (out.title) q.set('title', out.title.replace(/\s+/g, ' ').trim().slice(0, 300));
  if (/^https?:/.test(out.image)) q.set('image', out.image.slice(0, 2000));
  if (out.price) q.set('price', out.price.slice(0, 40));
  if (out.currency) q.set('currency', out.currency.slice(0, 8));
  var target = origin + '/add?' + q.toString();
  var w = window.open(target, '_blank');
  if (!w) location.href = target;
}
/* eslint-enable no-var */

export function bookmarkletCode(origin) {
  // Browsers percent-decode a javascript: URL before running it, so encode the whole code.
  return `javascript:${encodeURIComponent(`(${grab.toString()})(${JSON.stringify(origin)});void 0`)}`;
}

// Same rules as the server (backend/src/preview.js): "1.299,00" -> 1299, "1,299.00" -> 1299.
export function parsePrice(v) {
  const cleaned = String(v ?? '').replace(/\s| /g, '').replace(/[^\d.,]/g, '');
  if (!cleaned) return '';
  let s = cleaned;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100) : '';
}

export const CURRENCIES = ['UAH', 'EUR', 'USD', 'PLN', 'GBP'];

export function normCurrency(v) {
  const c = String(v || '').trim().toUpperCase();
  if (c === 'ГРН' || c === '₴') return 'UAH';
  return CURRENCIES.includes(c) ? c : 'UAH';
}
