// "+ Bazhanka" browser button (a bookmarklet).
//
// Many shops do not let our server read their pages (it identifies itself as a bot, on purpose).
// This button runs in the person's own browser, on the product page they already opened, reads the
// same product data our server would (JSON-LD Product, Open Graph / itemprop tags) and opens
// Bazhanka's /add page with the form filled in. The shop sees an ordinary visitor, nothing else.
// A page counts as a product if it is marked as one (JSON-LD Product, product Open Graph, price tags)
// or, for shops without such markup, if it shows a heading, a current price with a currency and a buy
// button or a product-like address. Otherwise the button opens nothing and only shows a small note.
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
  // The address the person sees. Not <link rel=canonical>: single-page shops (silpo.ua) leave it pointing
  // at the previous page, e.g. the category. Tracking parameters are stripped by the server on save.

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
  var marked = !!product || !!priceTag || /product/i.test(meta('meta[property="og:type"]')) ||
    !!d.querySelector('[itemtype*="schema.org/Product"], [itemtype*="schema.org/Offer"]');

  // Some shops (e.g. silpo.ua) have no such markup. Then look at what a person sees: a heading,
  // a visible current price with a currency, and a buy button or a product-like address.
  var h1 = d.querySelector('h1');
  var visible = function (el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  var struck = function (el) {
    for (var e = el; e && e !== d.body; e = e.parentElement) {
      if (/^(S|DEL|STRIKE)$/.test(e.tagName)) return true;
      if (/line-through/.test(getComputedStyle(e).textDecorationLine || '')) return true;
    }
    return false;
  };
  var PRICE = /^\s*(₴|\$|€|£)?\s*(\d{1,3}(?:[\s ]\d{3})+|\d+)([.,]\d{1,2})?\s*(грн\.?|₴|uah|\$|€|£|zł|usd|eur)?\s*$/i;
  // A price needs a currency sign or word: "29.99 грн", "₴ 1 299", "$15".
  var priceIn = function (t) { if (t.length > 30) return null; var m = t.match(PRICE); return m && (m[1] || m[4]) ? m : null; };
  var visiblePrice = null, after = [], before = [];
  if (h1) {
    var all = d.body.querySelectorAll('*');
    after = []; before = [];
    for (var k = 0; k < all.length; k++) {
      var el = all[k];
      if (/^(SCRIPT|STYLE|NOSCRIPT|OPTION|INPUT|TEXTAREA)$/.test(el.tagName)) continue;
      var t = el.textContent || '';
      var m = priceIn(t);
      if (!m) continue;
      // The innermost element that holds the whole price (a child holding it too wins).
      var inner = false;
      for (var c = 0; c < el.children.length && !inner; c++) inner = !!priceIn(el.children[c].textContent || '');
      if (inner || !visible(el) || struck(el)) continue;
      ((h1.compareDocumentPosition(el) & 4) ? after : before).push({ text: t, cur: m[1] || m[4], el: el });
    }
    visiblePrice = after[0] || before[0] || null;
  }
  var buyButton = false;
  var buttons = d.querySelectorAll('button, a, [role="button"], input[type="submit"]');
  for (var b = 0; b < buttons.length && !buyButton; b++) {
    var bt = (buttons[b].textContent || buttons[b].value || '').replace(/\s+/g, ' ').trim();
    if (bt.length < 40 && /(у кошик|в кошик|до кошика|додати в кошик|купити|в корзину|купить|add to (cart|bag|basket)|buy now|buy it)/i.test(bt) && visible(buttons[b])) buyButton = true;
  }
  var productUrl = /\/(product|products|p|item|items|goods|dp|tovar|tovary|produkt)\/|\/p\d{4,}|[-_/]\d{5,}(\.html?)?\/?$/i.test(location.pathname);
  // A catalogue page also has a heading, prices and cart buttons. On a product page the heading and the
  // price sit together in a small block; on a catalogue the smallest block holding both is the whole grid.
  var catalogue = false;
  if (h1 && visiblePrice) {
    var box = h1.parentElement;
    while (box && !box.contains(visiblePrice.el)) box = box.parentElement;
    var inBox = 0, prices = after.concat(before);
    for (var pi = 0; pi < prices.length; pi++) if (box && box.contains(prices[pi].el)) inBox++;
    catalogue = !box || box === d.body || box === d.documentElement || inBox > 3;
  }
  var seen = !marked && !!h1 && !!visiblePrice && !catalogue && (buyButton || productUrl);
  var looksLikeProduct = marked || seen;
  // The picture shown biggest on the page, in its best available quality: shops often show a small or
  // blurred version first and keep the sharp one in srcset / <picture> / data-zoom-image.
  var bestSrc = function (im) {
    var cands = [], add = function (set) {
      String(set || '').split(/,\s+/).forEach(function (part) {
        var bits = part.trim().split(/\s+/), w = parseFloat(bits[1]) || 1;
        if (/^(https?:)?\/\//.test(bits[0]) || /^\//.test(bits[0])) cands.push({ u: abs(bits[0]), w: /x$/.test(bits[1] || '') ? w * 1000 : w });
      });
    };
    add(im.getAttribute('srcset'));
    if (im.parentElement && im.parentElement.tagName === 'PICTURE') {
      var srcs = im.parentElement.querySelectorAll('source');
      for (var i = 0; i < srcs.length; i++) add(srcs[i].getAttribute('srcset'));
    }
    var zoom = im.getAttribute('data-zoom-image') || im.getAttribute('data-large') || im.getAttribute('data-original') || im.getAttribute('data-full');
    if (zoom) cands.push({ u: abs(zoom), w: 1e9 });
    cands.sort(function (x, y) { return y.w - x.w; });
    var pick = cands.length && /^https?:/.test(cands[0].u) ? cands[0].u : '';
    return pick || im.currentSrc || im.src;
  };
  var biggestImage = function () {
    var best = null, area = 120 * 120;
    for (var j = 0; j < d.images.length; j++) {
      var im = d.images[j], r = im.getBoundingClientRect();
      var a = r.width * r.height;
      var banner = r.width > 2 * r.height; // promo banners are wide; product photos are about square or tall
      if (a > area && !banner && im.naturalWidth > 0 && /^https?:/.test(im.currentSrc || im.src)) { area = a; best = im; }
    }
    return best ? bestSrc(best) : '';
  };
  if (seen) {
    // Shops without product markup usually have site-wide og:title / og:image (shop name and logo).
    out.title = text(h1) || out.title;
    out.image = biggestImage() || out.image;
    out.price = out.price || visiblePrice.text.replace(/[^\d.,\s ]/g, '').trim();
    var cur = visiblePrice.cur.toLowerCase();
    out.currency = out.currency || (/грн|₴|uah/.test(cur) ? 'UAH' : cur === '$' || cur === 'usd' ? 'USD' : cur === '€' || cur === 'eur' ? 'EUR' : cur === '£' ? 'GBP' : cur === 'zł' ? 'PLN' : '');
  }

  var send = function () {
    // 3. Fill gaps from the page itself: the heading and the biggest picture.
    out.title = out.title || text(d.querySelector('h1')) || d.title;
    if (!out.image) out.image = biggestImage();
    var q = new URLSearchParams();
    q.set('url', out.url.slice(0, 2000));
    // Some shops put HTML entities into JSON-LD ("Lay&#39;s"); DOMParser decodes them without running anything.
    if (/&[#a-z0-9]+;/i.test(out.title)) out.title = new DOMParser().parseFromString(out.title, 'text/html').documentElement.textContent || out.title;
    if (out.title) q.set('title', out.title.replace(/\s+/g, ' ').trim().slice(0, 300));
    if (/^https?:/.test(out.image)) q.set('image', out.image.slice(0, 2000));
    if (out.price) q.set('price', out.price.slice(0, 40));
    if (out.currency) q.set('currency', out.currency.slice(0, 8));
    var target = origin + '/add?' + q.toString();
    // A small window over the shop (like "Save" buttons do), not a new tab: it closes itself after the
    // gift is added. One name, so pressing the button again reuses the same window.
    var W = 560, H = Math.max(520, Math.min(860, (screen.availHeight || 900) - 80));
    var left = Math.max(0, (window.screenX || 0) + (window.outerWidth || 1200) - W - 40);
    var top = Math.max(0, (window.screenY || 0) + 60);
    var w = window.open(target, 'bazhanka-add', 'popup=yes,width=' + W + ',height=' + H + ',left=' + left + ',top=' + top);
    if (!w) location.href = target; // popup blocked: open in this tab, /add then offers "Back to the shop"
    else try { w.focus(); } catch (e) { /* ignore */ }
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
