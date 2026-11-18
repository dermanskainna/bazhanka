import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, money, niceDate } from '../api.js';
import { isOwnPhoto, uploadPhoto } from '../photo.js';
import { answerListOpen, onListChanged, sameProduct } from '../sync.js';
import BookmarkletButton from '../BookmarkletButton.jsx';
import BarShortcut from '../BarShortcut.jsx';
import { useSession } from '../session.jsx';
import { GiftIcon, LockIcon, AsteriskIcon, LinkIcon, CheckIcon, TrashIcon } from '../icons.jsx';

// Set by /add once the "+ Bazhanka" browser button has been used in this browser.
// Shown when the server could not read the shop page. Not reading a page is normal (many shops don't
// allow it), so this is a friendly next step, not an error.
// The button can be set up right here (no extra tab): it is draggable from this panel too.
function ManualHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="manual-help" role="status">
      <span className="manual-help-icon"><CheckIcon size={16} /></span>
      <div>
        <p className="manual-help-title"><span className="script">Link added!</span> Now give it a name and a price.</p>
        <p className="manual-help-tip">
          <span className="tip-tag">Tip</span> the{' '}
          <button type="button" className="tip-link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>+ Bazhanka button</button>{' '}
          can fill this in for you.
        </p>
        {open && (
          <ol className="tip-steps">
            <li>Show the bookmarks bar: <BarShortcut /></li>
            <li>Drag this onto it: <BookmarkletButton /></li>
            <li>Go back to the product in the shop and press it — the gift lands in this list, and this form closes</li>
          </ol>
        )}
      </div>
    </div>
  );
}

const emptyItem = { url: '', title: '', imageUrl: '', price: '', currency: 'UAH', note: '', chipIn: false };

export default function ListPage() {
  const { slug } = useParams();
  const { user } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api(`/lists/${slug}`).then(setData).catch((e) => setError(e.message));
  }, [slug]);

  // Reload when the session changes (signed out -> signed in shows "reserved by me").
  useEffect(() => { if (user !== undefined) load(); }, [load, user]);
  // A gift added from the "+ Bazhanka" window (or in another tab) shows up here without a reload.
  useEffect(() => onListChanged(load, slug), [load, slug]);
  // Lets the "+ Bazhanka" window know this list is already open here (it then won't open another tab).
  useEffect(() => (data?.isOwner ? answerListOpen(slug) : undefined), [data?.isOwner, slug]);

  if (error) return <div className="page"><h1>Oops</h1><p>{error}</p><Link to="/">Go home</Link></div>;
  if (!data) return <div className="page muted">Loading…</div>;
  return (
    <div className="guide-page">
      <div className="page wide">
        {data.isOwner ? <OwnerView data={data} reload={load} /> : <GuestView data={data} reload={load} />}
      </div>
    </div>
  );
}

function Header({ w, children }) {
  return (
    <div className="guide-head">
      <span className="tag">{w.occasion || 'Wishlist'}</span>
      <div className="guide-title-row">
        <AsteriskIcon size={34} className="orn" />
        <h1>{w.title}</h1>
        <AsteriskIcon size={34} className="orn" />
      </div>
      <p className="guide-sub">{w.ownerName}’s wishlist{w.eventDate ? ` · ${niceDate(w.eventDate)}` : ''}</p>
      {children}
    </div>
  );
}

function ItemMedia({ item }) {
  return item.imageUrl ? (
    <img className="gift-img" src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
  ) : <div className="gift-img ph"><GiftIcon size={56} /></div>;
}

// One numbered card in the "gift guide" grid. `children` are the actions under the caption.
// What a click on the photo or the title does: the owner edits the gift (`onEdit`), a guest opens the
// product in the shop (new tab). Without either it is a plain block.
function CardAction({ item, onEdit, className, label, children }) {
  if (onEdit) return <button type="button" className={`${className} card-action`} onClick={onEdit} aria-label={label}>{children}</button>;
  if (item.url) return <a className={`${className} card-action`} href={item.url} target="_blank" rel="noreferrer" aria-label={label}>{children}</a>;
  return <div className={className}>{children}</div>;
}

function GiftCard({ n, item, taken, stamp, onEdit, children }) {
  const clickable = !!onEdit || !!item.url;
  const label = onEdit ? `Edit “${item.title}”` : `Open “${item.title}” in the shop`;
  return (
    <article className={`gift ${taken ? 'taken' : ''} ${clickable ? 'clickable' : ''}`}>
      <CardAction item={item} onEdit={onEdit} className="gift-frame" label={label}>
        <span className="gift-no">{n}</span>
        <ItemMedia item={item} />
        {stamp && <span className="stamp">{stamp}</span>}
      </CardAction>
      <h3 className="gift-name" title={item.title}>
        {clickable ? <CardAction item={item} onEdit={onEdit} className="gift-name-action">#{item.title}</CardAction> : `#${item.title}`}
      </h3>
      <div className="price">{item.price !== null ? money(item.price, item.currency) : '\u00a0'}</div>
      {item.chipIn && <span className="tag">Chip-in gift</span>}
      {item.note && <p className="note">{item.note}</p>}
      <div className="gift-actions">{children}</div>
    </article>
  );
}

// ---------------- Owner ----------------

function OwnerView({ data, reload }) {
  const w = data.wishlist;
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null); // 'new' while the add form is open; editing has its own page
  const newItemUrl = useRef('');
  // The gift pasted here could not be read, so it was added with the + Bazhanka button instead: this
  // half-filled form is no longer needed (the list itself refreshes in ListPage).
  useEffect(() => onListChanged((msg) => {
    if (msg?.addedUrl && sameProduct(msg.addedUrl, newItemUrl.current)) setEditing(null);
  }, w.slug), [w.slug]);
  const shareUrl = `${window.location.origin}/l/${w.slug}`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  const removeList = async () => {
    if (!confirm('Delete this wishlist and all its items? Friends who reserved gifts will lose them too.')) return;
    await api(`/wishlists/${w.id}`, { method: 'DELETE' });
    navigate('/dashboard');
  };
  const removeItem = async (id) => {
    if (!confirm('Remove this item? Someone may have already reserved it.')) return;
    await api(`/items/${id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <>
      <Header w={w} />
      <div className="card share">
        <div>
          <h3 className="share-title"><LinkIcon size={20} /> Share this link with friends</h3>
          <p className="meta-text">Guests see which gifts are taken. You won’t — so the surprise stays a surprise</p>
        </div>
        <div className="share-row">
          <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <a className="btn ghost" target="_blank" rel="noreferrer"
            href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(`My wishlist: ${w.title}`)}`}>Telegram</a>
        </div>
      </div>

      <div className="row between guide-bar">
        <h2>Items ({data.items.length})</h2>
        {editing !== 'new' && <button className="btn" onClick={() => setEditing('new')}>+ Add item</button>}
      </div>

      {editing === 'new' && (
        <ItemForm wishlistId={w.id} onUrlChange={(u) => { newItemUrl.current = u; }}
          onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
      )}

      {data.items.length === 0 && editing !== 'new' && (
        <div className="card empty"><p className="meta-text">Your list is empty. Paste a link from Rozetka, Prom, Makeup, Yakaboo or any other shop and we’ll fill in the rest — or add a gift by hand, or with the <b style={{ whiteSpace: 'nowrap' }}>+ Bazhanka</b> button while you shop</p></div>
      )}

      <div className="guide">
        {data.items.map((it, idx) => (
          <GiftCard key={it.id} n={idx + 1} item={it} onEdit={() => navigate(`/l/${w.slug}/edit/${it.id}`)}>
            <div className="row">
              {it.url && <a href={it.url} target="_blank" rel="noreferrer">Open in shop ↗</a>}
              <button className="link danger" onClick={() => removeItem(it.id)}>Remove</button>
            </div>
          </GiftCard>
        ))}
      </div>
      <div className="danger-zone">
        <button className="btn danger-btn" onClick={removeList}><TrashIcon size={16} /> Delete this wishlist</button>
        <small className="meta-text">Removes the list and all its gifts for you and your friends</small>
      </div>
    </>
  );
}

// `initial` prefills a new item (used by the "+ Bazhanka" browser button page, /add).
export function ItemForm({ wishlistId, item, initial, onDone, onCancel, onUrlChange }) {
  const [f, setF] = useState(item ? { ...emptyItem, ...item, price: item.price ?? '', imageUrl: item.imageUrl || '', url: item.url || '', note: item.note || '' } : { ...emptyItem, ...initial });
  // '' | loading | ok | button | manual (shop not readable, or read but without a title) | missing (404) | bad (not a usable link)
  const [status, setStatus] = useState(initial?.title ? 'button' : '');
  const titleRef = useRef(null);
  useEffect(() => { onUrlChange?.(f.url); }, [f.url, onUrlChange]);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const [photo, setPhoto] = useState({ busy: false, error: '' });
  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // choosing the same file again should work too
    if (!file) return;
    setPhoto({ busy: true, error: '' });
    try {
      const url = await uploadPhoto(file);
      setF((cur) => ({ ...cur, imageUrl: url }));
      setPhoto({ busy: false, error: '' });
    } catch (err) {
      setPhoto({ busy: false, error: err.message });
    }
  };

  const fetchPreview = async (url) => {
    if (!/^https?:\/\//i.test(url)) return;
    setStatus('loading');
    setError('');
    try {
      const { preview } = await api('/preview', { method: 'POST', body: { url } });
      setF((cur) => ({
        ...cur,
        url: preview.url || url,
        title: cur.title || preview.title || '',
        imageUrl: cur.imageUrl || preview.image || '',
        price: cur.price || preview.price || '',
        currency: preview.currency || cur.currency,
      }));
      // A page without a product title is as good as unreadable for the person: same friendly hint.
      if (preview.title) setStatus('ok');
      else { setStatus('manual'); titleRef.current?.focus(); }
    } catch (err) {
      if (err.reason === 'bad_link') { setStatus('bad'); setError(err.message); return; }
      setStatus(err.reason === 'not_found' ? 'missing' : 'manual');
      titleRef.current?.focus();
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (item) await api(`/items/${item.id}`, { method: 'PATCH', body: f });
      else await api(`/wishlists/${wishlistId}/items`, { method: 'POST', body: f });
      onDone(f);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="card stack item-form" onSubmit={save}>
      <label>
        Shop link
        <input type="url" value={f.url} placeholder="https://rozetka.com.ua/…" onChange={set('url')}
          onPaste={(e) => { const t = e.clipboardData.getData('text'); setTimeout(() => fetchPreview(t.trim()), 0); }}
          onBlur={() => !item && !f.title && fetchPreview(f.url)} autoFocus={!item} />
        {status === 'bad' ? <small className="field-error">{error}</small> : (
          <small className="field-hint">
            {status === 'loading' ? 'Looking up the product…' : status === 'ok' ? 'Filled in from the shop — check it below.' :
              status === 'manual' ? '' :
              status === 'missing' ? 'The shop says this page doesn’t exist. Check the link, or fill the item in by hand.' :
              status === 'button' ? 'Filled in from the shop page you opened — check it below.' : 'Paste a shop link — we’ll fill in the title, photo and price for you.'}
          </small>
        )}
      </label>
      {status === 'manual' && <ManualHelp />}
      {f.imageUrl && <img className="preview-img" src={f.imageUrl} alt="" referrerPolicy="no-referrer" />}
      <label>Title<input ref={titleRef} required value={f.title} onChange={set('title')} placeholder="What do you want?" /></label>
      <div className="grid2">
        <label>Price<input inputMode="decimal" value={f.price} onChange={set('price')} placeholder="e.g. 1200" /></label>
        <label>Currency
          <select value={f.currency} onChange={set('currency')}>{['UAH', 'EUR', 'USD', 'PLN', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select>
        </label>
      </div>
      <div className="photo-field">
        <span className="field-label">Photo (optional)</span>
        <div className="row">
          <label className={`btn ghost small upload-btn ${photo.busy ? 'busy' : ''}`}>
            <input type="file" accept="image/*" onChange={pickPhoto} disabled={photo.busy} />
            {photo.busy ? 'Uploading…' : isOwnPhoto(f.imageUrl) ? 'Choose another photo' : f.imageUrl ? 'Use my own photo instead' : 'Upload my own photo'}
          </label>
          {f.imageUrl && !photo.busy && <button type="button" className="link danger" onClick={() => setF({ ...f, imageUrl: '' })}>Remove photo</button>}
        </div>
        {photo.error && <small className="field-error">{photo.error}</small>}
        {isOwnPhoto(f.imageUrl) ? (
          <small className="muted">Your own photo is used for this gift.</small>
        ) : (
          <input type="url" aria-label="Photo link" value={f.imageUrl} onChange={set('imageUrl')} placeholder="…or paste a link to a picture" />
        )}
      </div>
      <label>Note for friends (optional)<textarea rows={2} value={f.note} onChange={set('note')} placeholder="Size M, any colour except yellow" /></label>
      <label className="check"><input type="checkbox" checked={f.chipIn} onChange={set('chipIn')} /> Let several friends chip in on this gift</label>
      {status !== 'bad' && error && <p className="error">{error}</p>}
      <div className="row"><button className="btn">{item ? 'Save' : 'Add to list'}</button><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

// ---------------- Guest ----------------

function GuestView({ data, reload }) {
  const w = data.wishlist;
  const { user } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [amounts, setAmounts] = useState({});
  const [busy, setBusy] = useState(null);

  const needSignIn = () => navigate(`/signup?next=${encodeURIComponent(`/l/${w.slug}`)}`);

  const act = async (it, method, body) => {
    if (!user) return needSignIn();
    setError('');
    setBusy(it.id);
    try {
      await api(`/items/${it.id}/reserve`, { method, body });
      if (method === 'DELETE') setAmounts((a) => ({ ...a, [it.id]: '' }));
      reload();
    } catch (err) {
      setError(err.message);
      reload();
    } finally {
      setBusy(null);
    }
  };

  const available = data.items.filter((i) => !i.reserved).length;

  return (
    <>
      <Header w={w}>
        <p className="hint"><LockIcon size={16} className="inline-icon" /> Reservations are secret: {w.ownerName} won’t see who is giving what, but other guests will see an item as taken — so nobody buys the same thing twice.</p>
      </Header>
      {error && <p className="error">{error}</p>}
      {data.items.length === 0 && <div className="card empty"><p>{w.ownerName} hasn’t added any items yet. Check back soon!</p></div>}
      {data.items.length > 0 && <p className="muted guide-count">{available} of {data.items.length} gifts still open</p>}
      <div className="guide">
        {data.items.map((it, idx) => {
          const takenByOther = it.reserved && !it.reservedByMe && !it.chipIn;
          const pct = it.chip && it.price ? Math.min(100, Math.round((it.chip.total / it.price) * 100)) : 0;
          return (
            <GiftCard key={it.id} n={idx + 1} item={it} taken={takenByOther} stamp={takenByOther ? 'Reserved' : it.reservedByMe ? 'Yours' : null}>
              {it.url && <a href={it.url} target="_blank" rel="noreferrer">Open in shop ↗</a>}

              {it.chipIn ? (
                <div className="chip">
                  <div className="progress"><div style={{ width: `${pct}%` }} /></div>
                  <small className="muted">
                    {money(it.chip.total, it.currency)}{it.price ? ` of ${money(it.price, it.currency)}` : ''} collected · {it.chip.people} {it.chip.people === 1 ? 'person' : 'people'}
                    {it.chip.mine > 0 && ` · you: ${money(it.chip.mine, it.currency)}`}
                  </small>
                  <form className="row" onSubmit={(e) => { e.preventDefault(); act(it, 'POST', { amount: amounts[it.id] }); }}>
                    <input className="amount" inputMode="decimal" required placeholder={it.chip.mine ? String(it.chip.mine) : 'Amount'}
                      value={amounts[it.id] || ''} onChange={(e) => setAmounts({ ...amounts, [it.id]: e.target.value })} />
                    <button className="btn small" disabled={busy === it.id}>{it.chip.mine ? 'Change my part' : 'Chip in'}</button>
                    {it.chip.mine > 0 && <button type="button" className="link danger" onClick={() => act(it, 'DELETE')}>Leave</button>}
                  </form>
                </div>
              ) : it.reservedByMe ? (
                <div className="row">
                  <span className="status mine">You’re giving this</span>
                  <button className="link danger" disabled={busy === it.id} onClick={() => act(it, 'DELETE')}>Cancel reservation</button>
                </div>
              ) : takenByOther ? (
                <span className="status">Already reserved by someone</span>
              ) : (
                <button className="btn small" disabled={busy === it.id} onClick={() => act(it, 'POST')}>I’ll gift this</button>
              )}
            </GiftCard>
          );
        })}
      </div>

      <div className="card cta">
        <h3>Want friends to know what to get you?</h3>
        <p>Make your own wishlist in a minute and share one link.</p>
        <Link className="btn" to={user ? '/dashboard' : `/signup?next=/dashboard`}>Create my wishlist</Link>
      </div>
    </>
  );
}
