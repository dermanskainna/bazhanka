// The keys that show the bookmarks bar: the same in Chrome, Edge, Firefox, Opera and Safari (Favorites bar).
export const isMac = typeof navigator !== 'undefined'
  && (/Mac/i.test(navigator.platform || '') || /Macintosh|Mac OS X/i.test(navigator.userAgent));

export default function BarShortcut() {
  const keys = isMac ? ['⌘', 'Shift', 'B'] : ['Ctrl', 'Shift', 'B'];
  return <>{keys.map((k, i) => <span key={k}>{i > 0 && '+'}<kbd>{k}</kbd></span>)}</>;
}
