import { useState } from 'react';
import { Link } from 'react-router-dom';
import BookmarkletButton from '../BookmarkletButton.jsx';
import { bookmarkletCode } from '../bookmarklet.js';
import { useSession } from '../session.jsx';

// Order matters: Edge, Opera and others also say "Chrome" in their user agent.
export function detectBrowser(ua = navigator.userAgent) {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return 'mobile';
  if (/Edg\//.test(ua)) return 'edge';
  if (/OPR\/|Opera/.test(ua)) return 'opera';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'chrome';
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
const Keys = ({ win, mac }) => (
  <>{(isMac ? mac : win).map((k, i) => <span key={k}>{i > 0 && '+'}<kbd>{k}</kbd></span>)}</>
);

// Per browser: how to show the bookmarks bar, and how to add the button without dragging.
const BROWSERS = {
  chrome: {
    name: 'Chrome',
    bar: <>Chrome hides the bookmarks bar on normal pages. Show it with <Keys win={['Ctrl', 'Shift', 'B']} mac={['⌘', 'Shift', 'B']} /> (or menu <b>⋮ → Bookmarks and lists → Show bookmarks bar</b>).</>,
    manual: <>Menu <b>⋮ → Bookmarks and lists → Bookmark manager</b> → <b>⋮</b> in the top right → <b>Add new bookmark</b>. Name: <i>+ Bazhanka</i>, URL: paste the code.</>,
  },
  edge: {
    name: 'Edge',
    bar: <>Show the favorites bar with <Keys win={['Ctrl', 'Shift', 'B']} mac={['⌘', 'Shift', 'B']} /> (or <b>Settings → Appearance → Show favorites bar</b>).</>,
    manual: <>Open favorites with <Keys win={['Ctrl', 'Shift', 'O']} mac={['⌘', 'Shift', 'O']} /> → <b>⋯ → Add favorite</b>. Name: <i>+ Bazhanka</i>, URL: paste the code, folder: <i>Favorites bar</i>.</>,
  },
  firefox: {
    name: 'Firefox',
    bar: <>Show the bookmarks toolbar with <Keys win={['Ctrl', 'Shift', 'B']} mac={['⌘', 'Shift', 'B']} /> if you don’t see it.</>,
    manual: <>Right-click the button above → <b>Bookmark Link…</b> → folder <i>Bookmarks Toolbar</i> → <b>Save</b>.</>,
  },
  safari: {
    name: 'Safari',
    bar: <>Show the favorites bar with <Keys win={['Ctrl', 'Shift', 'B']} mac={['⌘', 'Shift', 'B']} /> (or <b>View → Show Favorites Bar</b>).</>,
    manual: <>Bookmark any page with <Keys win={['Ctrl', 'D']} mac={['⌘', 'D']} /> into <i>Favorites</i>, then in <b>Bookmarks → Edit Bookmarks</b> rename it to <i>+ Bazhanka</i> and replace its address with the code.</>,
  },
  opera: {
    name: 'Opera',
    bar: <>Show the bookmarks bar with <Keys win={['Ctrl', 'Shift', 'B']} mac={['⌘', 'Shift', 'B']} /> (or <b>Settings → Show bookmarks bar</b>).</>,
    manual: <>Open bookmarks with <Keys win={['Ctrl', 'Shift', 'B']} mac={['⌘', 'Shift', 'B']} /> → <b>+ Add bookmark</b> (or edit any bookmark). Name: <i>+ Bazhanka</i>, address: paste the code.</>,
  },
};

function CopyCode() {
  const [state, setState] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletCode(window.location.origin));
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  return (
    <span>
      <button type="button" className="btn ghost small" onClick={copy}>Copy the button code</button>
      {state === 'copied' && <small className="muted"> Copied. Now paste it as the bookmark’s address.</small>}
      {state === 'failed' && <small className="muted"> Your browser didn’t allow copying. Use the drag way above.</small>}
    </span>
  );
}

// Install page for the "+ Bazhanka" browser button.
export default function AddButton() {
  const { user } = useSession();
  const detected = detectBrowser();
  const [browser, setBrowser] = useState(detected === 'mobile' ? 'chrome' : detected);
  const b = BROWSERS[browser];

  return (
    <div className="page">
      <h1>The fastest way to save a wish</h1>
      <p>
        See something you love? One click on the + Bazhanka button,
        and it’s in your wishlist — title, photo and price included. No copying, no typing.
      </p>

      {detected === 'mobile' && (
        <p className="notice">
          On a phone, browsers don’t have a bookmarks bar for this button, so it can’t be used there.
          Add items by pasting a link into the form as usual, or set the button up on your computer.
        </p>
      )}

      <div className="card stack">
        <div className="browser-tabs" role="tablist" aria-label="Your browser">
          {Object.entries(BROWSERS).map(([key, v]) => (
            <button key={key} type="button" role="tab" aria-selected={browser === key}
              className={`chip-tab ${browser === key ? 'on' : ''}`} onClick={() => setBrowser(key)}>
              {v.name}{key === detected ? ' (yours)' : ''}
            </button>
          ))}
        </div>

        <h3>1. Show the bookmarks bar</h3>
        <p className="muted small">{b.bar}</p>

        <h3>2. Drag this button onto the bar</h3>
        <p><BookmarkletButton /></p>
        <details className="small">
          <summary>Dragging doesn’t work?</summary>
          <p className="muted">Add it by hand instead: <CopyCode /></p>
          <p className="muted">{b.manual}</p>
        </details>

        <h3>3. Found something you love? Press it</h3>
        <p className="muted small">
          A small Bazhanka window opens over the shop with everything already filled in. Choose a wishlist,
          take a quick look and press <b>Add to list</b> — the window closes by itself and you keep shopping.
        </p>

        <p className="muted small">
          Don’t worry about privacy: the button only picks up the product’s name, photo and price, and nothing is saved
          until you add it yourself.
        </p>
      </div>

      <p><Link to={user ? '/dashboard' : '/signup?next=/button'}>{user ? '← My lists' : 'Create an account first'}</Link></p>
    </div>
  );
}
