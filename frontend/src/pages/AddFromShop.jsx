import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { normCurrency, parsePrice } from '../bookmarklet.js';
import { ItemForm } from './ListPage.jsx';
import { notifyListChanged } from '../sync.js';

const LAST_LIST = 'bz:lastList';
const httpOnly = (v) => (/^https?:\/\//i.test(v || '') ? v : '');

// Landing page of the "+ Bazhanka" button: /add?url=&title=&image=&price=&currency=
// The values come from whatever page the button was pressed on, so they only prefill a form;
// nothing is saved until the person presses Add to list.
export default function AddFromShop() {
  const [params] = useSearchParams();
  const initial = useMemo(() => ({
    url: httpOnly(params.get('url')),
    title: (params.get('title') || '').slice(0, 300),
    imageUrl: httpOnly(params.get('image')),
    price: parsePrice(params.get('price')),
    currency: normCurrency(params.get('currency')),
  }), [params]);

  const [lists, setLists] = useState(null);
  const [listId, setListId] = useState('');
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');
  const [closeFailed, setCloseFailed] = useState(false);
  // Opened by the + Bazhanka button as a small window over the shop? It stays open after adding; the
  // person chooses "Open the list" or "Back to the shop", or simply presses the button on the next gift.
  const inPopup = !!window.opener;
  const closeWindow = () => {
    window.close();
    // If the browser refused, the page is still here a moment later.
    setTimeout(() => setCloseFailed(true), 400);
  };
  // Popup blocked, so the button opened /add in the shop's own tab: go back to the product.
  const backToShop = () => window.history.back();


  useEffect(() => {
    api('/wishlists').then(({ wishlists }) => {
      setLists(wishlists);
      let last = '';
      try { last = localStorage.getItem(LAST_LIST) || ''; } catch { /* private mode */ }
      const pick = wishlists.find((w) => String(w.id) === last) || wishlists[0];
      if (pick) setListId(String(pick.id));
    }).catch((e) => setError(e.message));
  }, []);

  const chosen = lists?.find((w) => String(w.id) === listId);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (lists === null) return <div className="page muted">Loading…</div>;

  if (lists.length === 0) {
    return (
      <div className="page">
        <h1>Add to a wishlist</h1>
        <div className="card empty">
          <p>You have no wishlists yet. Create one first, then press the button on the shop page again.</p>
          <a className="btn" href="/dashboard" target={inPopup ? '_blank' : undefined} rel="noreferrer">Create a wishlist</a>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="page">
        <h1>Added ✓</h1>
        <div className="card stack">
          <p>“{done.title}” is now on <b>{done.list.title}</b>.</p>
          <div className="row">
            {/* In the small window: open the list in a normal tab and close this window. */}
            <a className="btn" href={`/l/${done.list.slug}`} target={inPopup ? '_blank' : undefined} rel="noreferrer"
              onClick={inPopup ? () => setTimeout(closeWindow, 150) : undefined}>Open the list</a>
            {inPopup && <button className="btn ghost" onClick={closeWindow}>Back to the shop</button>}
            {!inPopup && window.history.length > 1 && <button className="btn ghost" onClick={backToShop}>Back to the shop</button>}
          </div>
          {inPopup && closeFailed && <p className="muted small">You can close this window now.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Add to a wishlist</h1>
      <label className="stack">
        Wishlist
        <select value={listId} onChange={(e) => {
          setListId(e.target.value);
          try { localStorage.setItem(LAST_LIST, e.target.value); } catch { /* private mode */ }
        }}>
          {lists.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
      </label>
      {!initial.url && <p className="notice">The button didn’t pass a link. Paste it below or fill the item in by hand.</p>}
      <ItemForm
        wishlistId={chosen?.id}
        initial={initial}
        onDone={(f) => {
          try { localStorage.setItem(LAST_LIST, listId); } catch { /* private mode */ }
          setDone({ title: f.title, list: chosen });
          notifyListChanged(chosen.slug);
        }}
        onCancel={() => (inPopup ? window.close() : window.history.back())}
      />
    </div>
  );
}
