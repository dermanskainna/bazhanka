import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { normCurrency, parsePrice } from '../bookmarklet.js';
import { ItemForm } from './ListPage.jsx';

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
          <Link className="btn" to="/dashboard">Create a wishlist</Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="page">
        <h1>Added</h1>
        <div className="card stack">
          <p>“{done.title}” is now on <b>{done.list.title}</b>.</p>
          <div className="row">
            <Link className="btn" to={`/l/${done.list.slug}`}>Open the list</Link>
            <button className="btn ghost" onClick={() => window.close()}>Back to the shop</button>
          </div>
          <p className="muted small">If this tab doesn’t close, just switch back to the shop tab.</p>
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
        }}
        onCancel={() => window.history.length > 1 ? window.history.back() : window.close()}
      />
    </div>
  );
}
