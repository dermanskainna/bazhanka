import { useEffect, useRef, useState } from 'react';
import { bookmarkletCode } from './bookmarklet.js';

// The draggable "+ Bazhanka" link. React warns about (and future versions block) javascript: URLs
// in JSX, so the href is set on the DOM node directly.
export default function BookmarkletButton() {
  const ref = useRef(null);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    ref.current?.setAttribute('href', bookmarkletCode(window.location.origin));
  }, []);
  return (
    <span className="bookmarklet-wrap">
      <a ref={ref} className="btn bookmarklet" title="Drag me to your bookmarks bar"
        onClick={(e) => { e.preventDefault(); setHint(true); }}>
        + Bazhanka
      </a>
      {hint && <small className="muted"> Drag the button to your bookmarks bar, don’t click it here.</small>}
    </span>
  );
}
