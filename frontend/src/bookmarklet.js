// "+ Bazhanka" browser button (a bookmarklet).
//
// Many shops do not let our server read their pages (it identifies itself as a bot, on purpose).
// This button runs in the person's own browser, on the product page they already opened, reads the
// same product data our server would (JSON-LD Product, Open Graph / itemprop tags) and opens
// Bazhanka's /add page with the form filled in. The shop sees an ordinary visitor, nothing else.
// On a page that is not marked as a product (no JSON-LD Product, product Open Graph or price tags)
// it opens nothing and only shows a small note on the page.
//
// `grab` is turned into a string (`javascript:(...)(origin)`), so it must not use anything from
// outside its own body: no imports, no outer variables.

/* eslint-disable no-var */
function grab(origin) {
  var d = document;
  var abs = function (u) { if (!u) return ''; try { return new URL(u, location.href).href; } catch (e) { return ''; } };
  var meta = function (sel) { var el = d.querySelector(sel); return el ? String(el.getAttribute('content') || '').trim() : ''; };
  var text = function (el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; };

  // A small message in the corner of the shop page (in a shadow root, so the shop's CSS can't touch it).
  var toast = function (message) {
    var old = d.getElementById('bazhanka-toast');
    if (old) old.remove();
    var host = d.createElement('div');
    host.id = 'bazhanka-toast';
    host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var box = d.createElement('div');
    box.style.cssText = 'max-width:340px;background:#fffaf8;color:#222;border:2px solid #c8553d;border-radius:6px;' +
      'padding:14px 16px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.18)';
    var head = d.createElement('div');
    head.textContent = '+ Bazhanka';
    head.style.cssText = 'font-weight:700;color:#c8553d;margin-bottom:4px';
    var body = d.createElement('div');
    body.textContent = message;
    var row = d.createElement('div');
    row.style.cssText = 'margin-top:10px;display:flex;gap:8px;justify-content:flex-end';
    var close = function () { host.remove(); };
    var ok = d.createElement('button');
    ok.textContent = 'OK';
    ok.style.cssText = 'cursor:pointer;font:600 13px system-ui,sans-serif;border-radius:4px;padding:6px 14px;border:1px solid #222;background:#222;color:#fff';
    ok.onclick = close;
    row.appendChild(ok);
    box.appendChild(head);
    box.appendChild(body);
    box.appendChild(row);
    root.appendChild(box);
    d.documentElement.appendChild(host);
    setTimeout(close, 12000);
  };

  if (location.origin === origin) {
    toast('You’re already on Bazhanka! Open something you like in any online shop and press the button there.');
    return;
  }

  var out = { url: location.href, title: '', image: '', price: '', currency: '' };
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
  var product = null;
  var scripts = d.querySelectorAll('script[type="application/ld+json"]');
  for (var i = 0; i < scripts.length && !product; i++) {
    try { product = findProduct(JSON.parse(scripts[i].textContent), 0); } catch (e) { /* broken JSON-LD */ }
  }
  if (product) {
    out.title = String(product.name || '');
    var img = Array.isArray(product.image) ? product.image[0] : product.image;
    if (img && typeof img === 'object') img = img.url || img.contentUrl;
    if (img) out.image = abs(String(img));
    var offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    if (offer && offer.offers) offer = Array.isArray(offer.offers) ? offer.offers[0] : offer.offers;
    if (offer) {
      out.price = String(offer.price != null ? offer.price : offer.lowPrice != null ? offer.lowPrice : '');
      out.currency = String(offer.priceCurrency || '');
    }
  }

  // 2. Open Graph / microdata tags
  var priceTag = meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]') ||
    meta('[itemprop="price"]') || text(d.querySelector('[itemprop="price"]'));
  out.title = out.title || meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]');
  out.image = out.image || abs(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'));
  out.price = out.price || priceTag;
  out.currency = out.currency || meta('meta[property="product:price:currency"]') || meta('meta[property="og:price:currency"]') ||
    meta('[itemprop="priceCurrency"]');

  // Is this a product page at all? Shops mark product pages for search engines and link previews.
  var looksLikeProduct = !!product || !!priceTag || /product/i.test(meta('meta[property="og:type"]')) ||
    !!d.querySelector('[itemtype*="schema.org/Product"], [itemtype*="schema.org/Offer"]');

  var send = function () {
    // 3. Fill gaps from the page itself: the heading and the biggest picture.
    out.title = out.title || text(d.querySelector('h1')) || d.title;
    if (!out.image) {
      var best = null, area = 150 * 150;
      for (var j = 0; j < d.images.length; j++) {
        var im = d.images[j];
        var a = (im.naturalWidth || 0) * (im.naturalHeight || 0);
        if (a > area && /^https?:/.test(im.currentSrc || im.src)) { area = a; best = im; }
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
  };

  if (looksLikeProduct) send();
  else toast('Hmm, we can’t find a product here. Open the page of the item you like and press + Bazhanka again.');
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
