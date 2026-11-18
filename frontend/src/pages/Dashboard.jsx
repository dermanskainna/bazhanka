import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, money, niceDate } from '../api.js';
import { useSession } from '../session.jsx';
import { GiftIcon } from '../icons.jsx';
import { onListChanged } from '../sync.js';

const OCCASIONS = ['Birthday', 'Christmas', 'St Nicholas Day', 'Graduation', 'New Year', 'Wedding', 'Just because'];

export default function Dashboard() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [lists, setLists] = useState(null);
  const [gifts, setGifts] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', occasion: 'Birthday', eventDate: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => {
      api('/wishlists').then((d) => setLists(d.wishlists)).catch((e) => setError(e.message));
      api('/me/gifts').then((d) => setGifts(d.gifts)).catch(() => {});
    };
    load();
    return onListChanged(load); // item counts stay right when gifts are added in another tab
  }, []);

  const create = async (e) => {
    e.preventDefault();
    try {
      const { wishlist } = await api('/wishlists', { method: 'POST', body: form });
      navigate(`/l/${wishlist.slug}`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page">
      <h1>Hi, {user.name}</h1>

      <section>
        <div className="row between">
          <h2>My wishlists</h2>
          {!creating && <button className="btn" onClick={() => setCreating(true)}>+ New wishlist</button>}
        </div>
        {creating && (
          <form className="card stack" onSubmit={create}>
            <label>Name<input required autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="My 20th birthday" /></label>
            <div className="grid2">
              <label>Occasion
                <select value={form.occasion} onChange={(e) => setForm({ ...form, occasion: e.target.value })}>
                  {OCCASIONS.map((o) => <option key={o}>{o}</option>)}
                </select>
              </label>
              <label>Date (optional)<input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} /></label>
            </div>
            <div className="row"><button className="btn">Create</button><button type="button" className="btn ghost" onClick={() => setCreating(false)}>Cancel</button></div>
          </form>
        )}
        {error && <p className="error">{error}</p>}
        {lists === null ? <p className="muted">Loading…</p> : lists.length === 0 && !creating ? (
          <div className="card empty">
            <p>You have no wishlists yet. Make one for your next birthday or for Christmas — it takes a minute.</p>
            <button className="btn" onClick={() => setCreating(true)}>Create my first wishlist</button>
          </div>
        ) : (
          <div className="list-grid">
            {lists.map((l) => (
              <Link key={l.id} to={`/l/${l.slug}`} className="card list-card">
                <span className="tag">{l.occasion || 'Wishlist'}</span>
                <h3>{l.title}</h3>
                <p className="muted">{l.itemCount} {l.itemCount === 1 ? 'item' : 'items'}{l.eventDate ? ` · ${niceDate(l.eventDate)}` : ''}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="card cta">
          <h3>Don’t know what to wish for?</h3>
          <p className="meta-text">Tell us what you like and get ideas from real shops — add them to your list in one tap</p>
          <Link to="/ideas" className="btn ghost">Get gift ideas</Link>
        </div>
      </section>

      <section>
        <div className="card cta">
          <h3>Add from any shop in one click</h3>
          <p className="meta-text">
            Add gifts to your wishlist by hand — or save time with the <b style={{ whiteSpace: 'nowrap' }}>+ Bazhanka</b> button:
            one click on any product in a shop, and it’s on your list with photo and price
          </p>
          <Link to="/button" className="btn ghost">Get the button</Link>
        </div>
      </section>

      <section>
        <h2 className="dash-title">Gifts I’m giving</h2>
        {gifts.length === 0 ? (
          <p className="meta-text">When you reserve or chip in on a friend’s gift, it shows up here so you don’t forget</p>
        ) : (
          <div className="stack">
            {gifts.map((g) => (
              <Link key={g.id} to={`/l/${g.slug}`} className="card gift-row">
                {g.imageUrl ? <img src={g.imageUrl} alt="" referrerPolicy="no-referrer" /> : <div className="ph"><GiftIcon size={28} /></div>}
                <div>
                  <strong>{g.title}</strong>
                  <div className="muted">for {g.ownerName} · {g.listTitle}{g.eventDate ? ` · ${niceDate(g.eventDate)}` : ''}</div>
                  {g.chipIn && <div className="muted">You chip in {money(g.myAmount, g.currency)} · {g.chipPeople} people, {money(g.chipTotal, g.currency)}{g.price ? ` of ${money(g.price, g.currency)}` : ''}</div>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
