import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './api.js';

export default function Feedback() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState(0);
  const [state, setState] = useState('idle');
  const loc = useLocation();
  // On phones the floating button is hidden (it covered the page); the footer has a "Feedback" button instead.
  useEffect(() => {
    const show = () => { setOpen(true); setState('idle'); };
    window.addEventListener('bz:open-feedback', show);
    return () => window.removeEventListener('bz:open-feedback', show);
  }, []);

  const send = async (e) => {
    e.preventDefault();
    setState('sending');
    try {
      await api('/feedback', { method: 'POST', body: { message, rating, page: loc.pathname } });
      setState('sent');
      setMessage('');
      setRating(0);
    } catch {
      setState('error');
    }
  };

  if (!open) {
    return <button className="feedback-fab" onClick={() => { setOpen(true); setState('idle'); }}>Feedback</button>;
  }
  return (
    <div className="feedback-panel card">
      <div className="row between">
        <strong>How is Bazhanka working for you?</strong>
        <button className="link" onClick={() => setOpen(false)} aria-label="Close">✕</button>
      </div>
      {state === 'sent' ? (
        <p>Thank you! We read every message.</p>
      ) : (
        <form onSubmit={send} className="stack">
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button type="button" key={n} className={n <= rating ? 'on' : ''} onClick={() => setRating(n)} aria-label={`${n} stars`}>★</button>
            ))}
          </div>
          <textarea required rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What was confusing? What would you add?" />
          {state === 'error' && <p className="error">Could not send, try again.</p>}
          <button className="btn" disabled={state === 'sending'}>Send</button>
        </form>
      )}
    </div>
  );
}
