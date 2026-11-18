import { useEffect, useState } from 'react';
import { api } from '../api.js';

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

function Metric({ label, value, goal, ok }) {
  return (
    <div className={`card metric ${ok === undefined ? '' : ok ? 'ok' : 'miss'}`}>
      <div className="metric-value">{value}</div>
      <div>{label}</div>
      {goal && <small className="muted">goal: {goal}</small>}
    </div>
  );
}

function Check() {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { setRes(await api('/admin/discover-check')); } catch (e) { setRes({ ok: false, error: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ marginBottom: 12 }}>
      <div className="row"><button type="button" className="btn ghost small" disabled={busy} onClick={run}>{busy ? 'Checking…' : 'Test AI search'}</button></div>
      {res && (
        <p className={res.ok ? 'notice' : 'error'}>
          {res.ok ? `Works (${res.ms} ms): ${res.offers} offers kept. ` : `Failed${res.kind ? ` [${res.kind}]` : ''}: ${res.error}. `}
          {res.region && <span className="muted">{res.region} · {res.modelId}</span>}
        </p>
      )}
      {res?.debug?.candidates !== undefined && (
        <pre className="small" style={{ whiteSpace: 'pre-wrap', background: 'var(--cream)', padding: 10, borderRadius: 6 }}>{JSON.stringify(res.debug, null, 2)}</pre>
      )}
    </div>
  );
}

function Partners() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ name: '', domain: '', boost: 1 });
  const [error, setError] = useState('');
  const load = () => api('/admin/partners').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const act = async (fn) => {
    setError('');
    try { await fn(); await load(); } catch (e) { setError(e.message); }
  };
  const add = (e) => {
    e.preventDefault();
    act(async () => { await api('/admin/partners', { method: 'POST', body: form }); setForm({ name: '', domain: '', boost: 1 }); });
  };
  if (!data) return error ? <p className="error">{error}</p> : null;
  const t = data.totals;

  return (
    <section>
      <h2>Gift ideas: partner shops</h2>
      <p className="muted">Partners rank higher among results that already fit the person’s taste and always carry a “Partner” mark. Searches run: <b>{t.searches}</b> · cards shown: <b>{t.shown}</b> · clicks: <b>{t.clicks}</b> · added to lists: <b>{t.adds}</b></p>
      <Check />
      <form className="card stack" onSubmit={add}>
        <div className="grid2">
          <label>Shop name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Example Shop" /></label>
          <label>Domain<input required value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="example.com.ua" /></label>
        </div>
        <label>Boost (1–5)<input type="number" min="1" max="5" value={form.boost} onChange={(e) => setForm({ ...form, boost: e.target.value })} /></label>
        <div><button className="btn small">Add partner</button></div>
        {error && <p className="error">{error}</p>}
      </form>
      {data.partners.length > 0 && (
        <table className="table">
          <thead><tr><td>Shop</td><td>Boost</td><td>Shown</td><td>Clicks</td><td>Added</td><td></td></tr></thead>
          <tbody>
            {data.partners.map((p) => (
              <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
                <td><b>{p.name}</b><div className="muted small">{p.domain}</div></td>
                <td>
                  <select value={p.boost} onChange={(e) => act(() => api(`/admin/partners/${p.id}`, { method: 'PATCH', body: { boost: Number(e.target.value) } }))}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}
                  </select>
                </td>
                <td>{p.shown}</td><td>{p.clicks}</td><td>{p.adds}</td>
                <td>
                  <button className="link" onClick={() => act(() => api(`/admin/partners/${p.id}`, { method: 'PATCH', body: { active: !p.active } }))}>{p.active ? 'Pause' : 'Resume'}</button>{' · '}
                  <button className="link danger" onClick={() => window.confirm(`Remove ${p.name}?`) && act(() => api(`/admin/partners/${p.id}`, { method: 'DELETE' }))}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function Admin() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/admin/stats').then(setS).catch((e) => setError(e.message)); }, []);
  if (error) return <div className="page"><p className="error">{error}</p><p className="muted">Add your email to ADMIN_EMAILS on the server to see this page.</p></div>;
  if (!s) return <div className="page muted">Loading…</div>;
  const { totals: t, guests: g, retention: r } = s;

  return (
    <div className="page">
      <h1>Validation metrics</h1>
      <p className="muted">Live numbers for the report, measured against the goals in our one-pager.</p>
      <div className="metrics">
        <Metric label="Sign-ups" value={t.signups} goal="50" ok={t.signups >= 50} />
        <Metric label="Wishlists created" value={t.wishlists} goal="20" ok={t.wishlists >= 20} />
        <Metric label="Guests who reserved" value={pct(g.guests_reserved, g.guests)} goal="≥ 30%" ok={g.guests && g.guests_reserved / g.guests >= 0.3} />
        <Metric label="Guests who made their own list" value={pct(g.guests_created_list, g.guests)} goal="≥ 15%" ok={g.guests && g.guests_created_list / g.guests >= 0.15} />
        <Metric label="Users who came back (2+ days)" value={pct(r.returning_users, r.active_users)} goal="≥ 40%" ok={r.active_users && r.returning_users / r.active_users >= 0.4} />
        <Metric label="Secret Santa groups drawn" value={t.santa_drawn} goal="3" ok={t.santa_drawn >= 3} />
      </div>
      <h2>Raw numbers</h2>
      <table className="table">
        <tbody>
          {[
            ['Users who created a list', t.list_creators],
            ['Items added', t.items],
            ['Reservations / chip-ins', t.reservations],
            ['Chip-in gifts with contributions', t.chip_in_items],
            ['Unique visitors of shared lists (incl. anonymous)', t.unique_visitors],
            ['Signed-in guests (opened someone else’s list)', g.guests],
            ['Secret Santa groups (all / drawn)', `${t.santa_groups} / ${t.santa_drawn}`],
            ['Secret Santa members', t.santa_members],
          ].map(([k, v]) => <tr key={k}><td>{k}</td><td><b>{v}</b></td></tr>)}
        </tbody>
      </table>
      <Partners />
      <h2>Sign-ups by day</h2>
      <table className="table"><tbody>{s.signupsByDay.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.n}</td></tr>)}</tbody></table>
      <h2>Feedback ({s.feedback.length})</h2>
      <div className="stack">
        {s.feedback.map((f, i) => (
          <div key={i} className="card">
            <div className="muted small">{new Date(f.created_at).toLocaleString()} · {f.name || 'anonymous'} · {f.page}{f.rating ? ` · ${'★'.repeat(f.rating)}` : ''}</div>
            <p>{f.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
