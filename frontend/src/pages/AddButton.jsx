import { useState } from 'react';
import { Link } from 'react-router-dom';
import BookmarkletButton from '../BookmarkletButton.jsx';
import { bookmarkletCode } from '../bookmarklet.js';
import { useSession } from '../session.jsx';
import BarShortcut, { isMac } from '../BarShortcut.jsx';

export const isMobile = (ua = navigator.userAgent) => /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
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
      {state === 'copied' && <small className="meta-text"> Copied — now paste it as the bookmark’s address</small>}
      {state === 'failed' && <small className="meta-text"> Your browser didn’t allow copying — try dragging the button</small>}
    </span>
  );
}

// Install page for the "+ Bazhanka" browser button.
export default function AddButton() {
  const { user } = useSession();
  const mobile = isMobile();

  return (
    <div className="page">
      <h1>The fastest way to save a wish</h1>
      <p className="meta-text intro-text">
        See something you love while you browse a shop? One click on the <b style={{ whiteSpace: 'nowrap' }}>+ Bazhanka</b> button,
        and it’s in your wishlist — title, photo and price included. No copying, no typing
      </p>

      {mobile && (
        <p className="notice meta-text">
          On a phone there is no bookmarks bar for this button, so it can’t be used there. Paste a link into the gift form
          instead, or set the button up on your computer
        </p>
      )}

      <div className="card stack">
        <h3>1. Show the bookmarks bar</h3>
        <p className="meta-text">
          Press <BarShortcut /> if you don’t see it under the address bar
          {isMac && ' (in Safari it’s called the Favorites bar)'}
        </p>

        <h3>2. Drag this button onto the bar</h3>
        <p><BookmarkletButton /></p>
        <details className="meta-text">
          <summary>Dragging doesn’t work?</summary>
          <p>Add it by hand: <CopyCode /></p>
          <p>
            Then right-click the bookmarks bar, choose <b>Add page</b> (or <b>Add bookmark</b>), name it <i>+ Bazhanka</i> and
            paste the code as its address
          </p>
        </details>

        <h3>3. On a product page, press + Bazhanka</h3>
        <p className="meta-text">
          Bazhanka opens with the gift already filled in. Choose a wishlist, check the details and press <b>Add to list</b> —
          then carry on shopping
        </p>
        <p className="meta-text">
          Your privacy is safe: the button only picks up the product’s name, photo and price, and nothing is saved until you
          add it yourself
        </p>
      </div>

      {!user && <p><Link to="/signup?next=/button">Create an account first</Link></p>}
    </div>
  );
}
