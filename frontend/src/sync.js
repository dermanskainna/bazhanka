// Tells other open Bazhanka tabs that a wishlist changed (e.g. a gift was added from the
// "+ Bazhanka" window), so they refresh without a manual reload.
const NAME = 'bazhanka-sync';

export function notifyListChanged(slug, addedUrl) {
  try {
    const ch = new BroadcastChannel(NAME);
    ch.postMessage({ type: 'list-changed', slug, addedUrl: addedUrl || null });
    ch.close();
  } catch { /* old browser: tabs still refresh when you switch back to them */ }
}

// Calls `refresh(message)` when another tab changed the list `slug` (any list if slug is omitted),
// and `refresh()` whenever this tab becomes visible again. Returns an unsubscribe function.
export function onListChanged(refresh, slug) {
  let ch = null;
  try {
    ch = new BroadcastChannel(NAME);
    ch.onmessage = (e) => { if (e.data?.type === 'list-changed' && (!slug || e.data.slug === slug)) refresh(e.data); };
  } catch { /* see above */ }
  const onVisible = () => { if (document.visibilityState === 'visible') refresh(null); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { ch?.close(); document.removeEventListener('visibilitychange', onVisible); };
}

// Only one "+ Bazhanka" window at a time. Browsers reuse the named window only when the button is
// pressed in the same shop tab; from another tab (or when Firefox opens it as a tab) a second one
// appears. A newly opened one announces itself, and older ones close if their gift is already added
// (a form someone is still filling in is left alone).
export function oneAddWindow(isDone) {
  let ch;
  try { ch = new BroadcastChannel(`${NAME}-add`); } catch { return () => {}; }
  const me = Math.random().toString(36).slice(2);
  ch.onmessage = (e) => {
    if (e.data?.type === 'add-window-opened' && e.data.id !== me && isDone()) window.close();
  };
  ch.postMessage({ type: 'add-window-opened', id: me });
  return () => ch.close();
}

// Same product? Compares host (without www) and path, ignoring query and trailing slash.
export function sameProduct(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    const host = (u) => u.hostname.replace(/^www\./, '');
    const path = (u) => u.pathname.replace(/\/+$/, '');
    return host(x) === host(y) && path(x) === path(y);
  } catch { return false; }
}

// "Is this list already open in another tab?" — so the "+ Bazhanka" window doesn't open a second copy.
// Browsers don't let a page close or switch to a tab the person opened, so we just avoid adding one.
export function answerListOpen(slug) {
  let ch;
  try { ch = new BroadcastChannel(`${NAME}-who`); } catch { return () => {}; }
  ch.onmessage = (e) => { if (e.data?.type === 'who-has-list' && e.data.slug === slug) ch.postMessage({ type: 'i-have-list', id: e.data.id }); };
  return () => ch.close();
}

export function isListOpen(slug, waitMs = 300) {
  return new Promise((resolve) => {
    let ch;
    try { ch = new BroadcastChannel(`${NAME}-who`); } catch { resolve(false); return; }
    const id = Math.random().toString(36).slice(2);
    const done = (v) => { clearTimeout(t); ch.close(); resolve(v); };
    const t = setTimeout(() => done(false), waitMs);
    ch.onmessage = (e) => { if (e.data?.type === 'i-have-list' && e.data.id === id) done(true); };
    ch.postMessage({ type: 'who-has-list', slug, id });
  });
}
