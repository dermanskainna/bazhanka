import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money } from '../api.js';
import { GiftIcon } from '../icons.jsx';

const SUGGESTIONS = ['coffee', 'board games', 'cozy home', 'candles', 'drawing', 'tea', 'cats', 'skincare', 'hiking', 'books', 'cooking', 'plants'];
const NOVELTY = [
  { id: 'strict', title: 'Only what I asked', hint: 'Every idea matches your words' },
  { id: 'mixed', title: 'Mix', hint: 'Mostly matches, plus a few new things' },
  { id: 'surprise', title: 'Surprise me', hint: 'Half of the ideas are new for them' },
];
const WHO = [['', 'Anyone'], ['woman', 'Woman'], ['man', 'Man'], ['girl', 'Girl'], ['boy', 'Boy'], ['teenager', 'Teenager'], ['colleague', 'Colleague'], ['parents', 'Parents'], ['couple', 'Couple']];
const OCCASION = [['', 'Any occasion'], ['birthday', 'Birthday'], ['new year', 'New Year'], ['wedding', 'Wedding'], ['housewarming', 'Housewarming'], ['thank you', 'Thank you'], ["valentine's day", "Valentine's Day"], ['just because', 'Just because']];

function Badge({ offer }) {
  return (
    <div className="idea-badges">
      {offer.label === 'new'
        ? <span className="badge new">Try something new</span>
        : <span className="badge match">Recommended</span>}
      {offer.partner && <span className="badge partner" title={`Partner shop: ${offer.partner.name}`}>Partner · {offer.partner.name}</span>}
    </div>
  );
}

function IdeaCard({ offer, listId, hasLists, onAdded }) {
  const [state, setState] = useState('idle'); // idle | adding | added
  const [error, setError] = useState('');

  const add = async () => {
    setState('adding');
    setError('');
    try {
      await api('/discover/add', {
        method: 'POST',
        body: {
          wishlistId: listId, title: offer.title, url: offer.url, imageUrl: offer.imageUrl,
          price: offer.price, currency: offer.currency || 'UAH', label: offer.label,
        },
      });
      setState('added');
      onAdded();
    } catch (e) {
      setError(e.message);
      setState('idle');
    }
  };
  const trackClick = () => {
    api('/discover/event', { method: 'POST', body: { url: offer.url, label: offer.label } }).catch(() => {});
  };
  const host = (() => { try { return new URL(offer.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();

  return (
    <article className="idea-card">
      <div className="idea-pic">
        {offer.imageUrl
          ? <img src={offer.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
          : <GiftIcon size={40} />}
      </div>
      <div className="idea-body">
        <Badge offer={offer} />
        <h3 className="idea-title" title={offer.title}>{offer.title}</h3>
        {offer.via && <p className="muted small idea-why">For: {offer.via}</p>}
        {offer.why && <p className="muted small idea-why">{offer.why}</p>}
        {offer.verified === false && <p className="muted small idea-why">We could not open this shop automatically — please check price and details there.</p>}
      </div>
      <div className="idea-foot">
        <div className="row between idea-meta">
          <span className="price" title={offer.priceApprox ? 'Price seen in search results — please check it in the shop' : undefined}>{offer.price ? `${offer.priceApprox ? '≈ ' : ''}${money(offer.price, offer.currency || 'UAH')}` : ''}</span>
          <a href={offer.url} target="_blank" rel="noreferrer noopener sponsored" onClick={trackClick} className="small">{offer.shop || host} ↗</a>
        </div>
        {state === 'added'
          ? <span className="status mine">Added to your list ✓</span>
          : <button className="btn small" disabled={!hasLists || state === 'adding'} onClick={add}>{state === 'adding' ? 'Adding…' : '+ Add to wishlist'}</button>}
        {error && <p className="error small">{error}</p>}
      </div>
    </article>
  );
}

export default function Discover() {
  const [status, setStatus] = useState(null);
  const [lists, setLists] = useState([]);
  const [listId, setListId] = useState('');
  const [interests, setInterests] = useState('');
  const [budget, setBudget] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [novelty, setNovelty] = useState('mixed');
  const [who, setWho] = useState('');
  const [occasion, setOccasion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { offers, cached }
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    api('/discover/status').then((s) => { setStatus(s); setRemaining(s.remaining); }).catch((e) => setError(e.message));
    api('/wishlists').then((d) => { setLists(d.wishlists); if (d.wishlists[0]) setListId(String(d.wishlists[0].id)); }).catch(() => {});
  }, []);

  const addSuggestion = (s) => {
    const have = interests.toLowerCase();
    if (have.includes(s)) return;
    setInterests((cur) => (cur.trim() ? `${cur.trim().replace(/,$/, '')}, ${s}` : s));
  };

  const search = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api('/discover/search', { method: 'POST', body: { interests, budget: budget || undefined, budgetMin: budgetMin || undefined, novelty, who: who || undefined, occasion: occasion || undefined } });
      setResult(d);
      setRemaining(d.remaining);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page wide">
      <h1>Gift ideas</h1>
      <p className="lead meta-text">Not sure what to put on your list? Tell us what you like and we’ll find real things in online shops</p>

      {status && !status.enabled && <p className="notice meta-text">Gift ideas are not switched on yet — please check back soon</p>}

      <form className="card stack" onSubmit={search}>
        <label>Who is it for and what do they like?
          <textarea required minLength={3} maxLength={300} rows={3} value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="She loves candles, drawing, tea and cats — what could I give her?" />
        </label>
        <div className="row">
          {SUGGESTIONS.map((s) => <button key={s} type="button" className="chip-btn" onClick={() => addSuggestion(s)}>{s}</button>)}
        </div>
        <small className="meta-text">We look for every interest you mention and for gifts that combine them</small>

        <fieldset className="novelty">
          <legend>What kind of ideas?</legend>
          <div className="seg">
            {NOVELTY.map((n) => (
              <label key={n.id} className={`seg-opt ${novelty === n.id ? 'on' : ''}`}>
                <input type="radio" name="novelty" value={n.id} checked={novelty === n.id} onChange={() => setNovelty(n.id)} />
                <b>{n.title}</b><small className="muted">{n.hint}</small>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid2">
          <label>Recipient
            <select value={who} onChange={(e) => setWho(e.target.value)}>{WHO.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
          </label>
          <label>Occasion
            <select value={occasion} onChange={(e) => setOccasion(e.target.value)}>{OCCASION.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
          </label>
        </div>
        <div className="grid2">
          <label><span className="label-row">Price from, ₴ <small className="label-note">(optional)</small></span>
            <input type="number" min="0" step="50" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} placeholder="200" />
          </label>
          <label><span className="label-row">Price up to, ₴ <small className="label-note">(optional)</small></span>
            <input type="number" min="0" step="50" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="1500" />
          </label>
        </div>
        <label>Add ideas to
          {lists.length ? (
            <select value={listId} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          ) : <span className="meta-text">You have no wishlist yet — <Link to="/dashboard">create one</Link> to save ideas</span>}
        </label>
        <div className="row between">
          <button className="btn" disabled={busy || (status && !status.enabled) || remaining === 0}>{busy ? 'Searching shops… this can take up to a minute' : 'Find ideas'}</button>
          {remaining !== null && <span className="meta-text">{remaining} fresh {remaining === 1 ? 'search' : 'searches'} left today</span>}
        </div>
        {error && <p className="error">{error}</p>}
      </form>

      {result && (
        result.offers.length === 0
          ? <div className="card empty"><p className="meta-text">We couldn’t find good matches — try different words or a bigger budget</p></div>
          : (
            <>
              <div className="row between">
                <h2>Ideas for you</h2>
                <span className="meta-text">Some shops are partners who pay for promotion — they are marked. We still show only what fits your taste</span>
              </div>
              <div className="ideas-grid">
                {result.offers.map((o) => (
                  <IdeaCard key={o.url} offer={o} listId={listId} hasLists={lists.length > 0}
                    onAdded={() => setLists((l) => l.map((x) => (String(x.id) === listId ? { ...x, itemCount: (x.itemCount || 0) + 1 } : x)))} />
                ))}
              </div>
            </>
          )
      )}
    </div>
  );
}
