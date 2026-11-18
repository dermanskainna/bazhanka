import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, niceDate } from '../api.js';
import { LinkIcon } from '../icons.jsx';

function useMyLists() {
  const [lists, setLists] = useState([]);
  useEffect(() => { api('/wishlists').then((d) => setLists(d.wishlists)).catch(() => {}); }, []);
  return lists;
}

function ListPicker({ lists, value, onChange }) {
  return (
    <label>
      Which wishlist should your Secret Santa see?
      <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">— none yet —</option>
        {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
      </select>
      {lists.length === 0 && <small className="muted">You have no wishlists yet — <Link to="/dashboard">create one</Link> so your Santa knows what to get you.</small>}
    </label>
  );
}

export default function Santa() {
  const { code } = useParams();
  return code ? <Group code={code} /> : <Overview />;
}

function Overview() {
  const navigate = useNavigate();
  const lists = useMyLists();
  const [groups, setGroups] = useState(null);
  const [form, setForm] = useState({ name: '', budget: '', exchangeDate: '', wishlistId: null });
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { api('/santa').then((d) => setGroups(d.groups)).catch((e) => setError(e.message)); }, []);

  const create = async (e) => {
    e.preventDefault();
    try {
      const { code } = await api('/santa', { method: 'POST', body: form });
      navigate(`/santa/${code}`);
    } catch (err) { setError(err.message); }
  };

  const join = (e) => {
    e.preventDefault();
    const c = joinCode.trim().split('/').pop();
    if (c) navigate(`/santa/${c}`);
  };

  return (
    <div className="page">
      <h1>Secret Santa</h1>
      <p className="lead meta-text">Invite your group, Bazhanka draws the pairs. Everyone sees only the wishlist of the person they’re gifting</p>
      {error && <p className="error">{error}</p>}

      {groups?.length > 0 && (
        <section>
          <h2>My groups</h2>
          <div className="list-grid">
            {groups.map((g) => (
              <Link key={g.code} to={`/santa/${g.code}`} className="card list-card">
                <span className="tag">{g.drawn ? 'Names drawn' : 'Gathering people'}</span>
                <h3>{g.name}</h3>
                <p className="muted">{g.members} members</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid2 top">
        <form className="card stack" onSubmit={create}>
          <h2>Start a group</h2>
          <label>Group name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Group IT-23 Christmas" /></label>
          <div className="grid2">
            <label>Budget<input value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="up to 500 ₴" /></label>
            <label>Gift exchange<input type="date" value={form.exchangeDate} onChange={(e) => setForm({ ...form, exchangeDate: e.target.value })} /></label>
          </div>
          <ListPicker lists={lists} value={form.wishlistId} onChange={(v) => setForm({ ...form, wishlistId: v })} />
          <button className="btn">Create group</button>
        </form>
        <form className="card stack" onSubmit={join}>
          <h2>Join a group</h2>
          <label>Invite link or code<input required value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="abc23xyz" /></label>
          <button className="btn ghost">Open group</button>
        </form>
      </div>
    </div>
  );
}

function Group({ code }) {
  const lists = useMyLists();
  const navigate = useNavigate();
  const [g, setG] = useState(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    api(`/santa/${code}`).then((d) => { setG(d); setPick(d.myWishlistId); }).catch((e) => setError(e.message));
  }, [code]);
  useEffect(load, [load]);

  const run = async (fn) => {
    setError('');
    try { await fn(); load(); } catch (err) { setError(err.message); }
  };

  if (error && !g) return <div className="page"><p className="error">{error}</p><Link to="/santa">Back</Link></div>;
  if (!g) return <div className="page muted">Loading…</div>;
  const invite = `${window.location.origin}/santa/${g.group.code}`;

  return (
    <div className="page">
      <div className="list-header">
        <span className="tag">Secret Santa</span>
        <h1>{g.group.name}</h1>
        <p className="muted">
          {g.members.length} members{g.group.budget ? ` · budget ${g.group.budget}` : ''}{g.group.exchangeDate ? ` · exchange ${niceDate(g.group.exchangeDate)}` : ''}
        </p>
      </div>
      {error && <p className="error">{error}</p>}

      {g.group.drawn && g.isMember && g.giftee && (
        <div className="card giftee">
          <p>You are Secret Santa for</p>
          <h2>{g.giftee.name}</h2>
          {g.giftee.list ? (
            <Link className="btn" to={`/l/${g.giftee.list.slug}`}>See {g.giftee.name}’s wishlist</Link>
          ) : <p className="muted">{g.giftee.name} hasn’t attached a wishlist yet. Check back later!</p>}
          <p className="muted small">Keep it secret — nobody else knows who you’re gifting.</p>
        </div>
      )}

      {!g.isMember ? (
        g.group.drawn ? <p>Names have already been drawn in this group.</p> : (
          <div className="card stack">
            <h2>Join this Secret Santa</h2>
            <ListPicker lists={lists} value={pick} onChange={setPick} />
            <button className="btn" onClick={() => run(() => api(`/santa/${code}/join`, { method: 'POST', body: { wishlistId: pick } }))}>Join group</button>
          </div>
        )
      ) : (
        <>
          {!g.group.drawn && (
            <div className="card share">
              <div><h3 className="share-title"><LinkIcon size={20} /> Invite people</h3><p className="muted small">Send this link to your group chat. Everyone needs to join before the draw.</p></div>
              <div className="share-row">
                <input readOnly value={invite} onFocus={(e) => e.target.select()} />
                <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(invite); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } }}>{copied ? 'Copied' : 'Copy'}</button>
                <a className="btn ghost" target="_blank" rel="noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(invite)}&text=${encodeURIComponent(`Join our Secret Santa “${g.group.name}”`)}`}>Telegram</a>
              </div>
            </div>
          )}
          <div className="card stack">
            <ListPicker lists={lists} value={pick} onChange={setPick} />
            {pick !== g.myWishlistId && (
              <button className="btn" onClick={() => run(() => api(`/santa/${code}/me`, { method: 'PATCH', body: { wishlistId: pick } }))}>Save</button>
            )}
          </div>
        </>
      )}

      <section>
        <h2>Members</h2>
        <ul className="members">
          {g.members.map((m, i) => (
            <li key={i}>{m.name}{m.isMe && ' (you)'} {m.hasList ? <span className="tag">has a wishlist</span> : <span className="muted small">no wishlist yet</span>}</li>
          ))}
        </ul>
      </section>

      {g.isOwner && !g.group.drawn && (
        <div className="card stack">
          <strong>Ready? Draw names when everyone has joined.</strong>
          <p className="muted small">After the draw nobody can join or leave. You need at least 3 people.</p>
          <button className="btn" disabled={g.members.length < 3}
            onClick={() => confirm(`Draw names for ${g.members.length} people now?`) && run(() => api(`/santa/${code}/draw`, { method: 'POST' }))}>
            Draw names
          </button>
        </div>
      )}
      <p className="center">
        {g.isOwner ? (
          <button className="link danger" onClick={async () => { if (confirm('Delete this group for everyone?')) { await api(`/santa/${code}`, { method: 'DELETE' }); navigate('/santa'); } }}>Delete group</button>
        ) : g.isMember && !g.group.drawn ? (
          <button className="link danger" onClick={() => run(() => api(`/santa/${code}/me`, { method: 'DELETE' }))}>Leave group</button>
        ) : null}
      </p>
    </div>
  );
}
