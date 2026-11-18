import { Link } from 'react-router-dom';
import BookmarkletButton from '../BookmarkletButton.jsx';
import { useSession } from '../session.jsx';

// Install page for the "+ Bazhanka" browser button.
export default function AddButton() {
  const { user } = useSession();
  return (
    <div className="page">
      <h1>Add from any shop</h1>
      <p>
        Some shops don’t let our server read their pages, so a pasted link can’t fill in the details.
        This button works in <b>your</b> browser instead: open a product in any shop, press the button,
        and Bazhanka opens with the title, photo and price already filled in.
      </p>

      <div className="card stack">
        <h3>1. Put the button on your bookmarks bar</h3>
        <p className="muted small">
          Drag it with the mouse onto the bookmarks bar. Don’t see the bar? Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>
          (<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> on a Mac).
        </p>
        <p><BookmarkletButton /></p>

        <h3>2. Open a product in any shop and press it</h3>
        <p className="muted small">
          A Bazhanka tab opens with the form filled in. Pick the wishlist, check the details and press <b>Add to list</b>.
          If the shop page has no product details in it, fill in what is missing by hand.
        </p>

        <p className="muted small">
          The button reads only the product details of the page you are looking at and passes them to the Bazhanka form;
          nothing is saved until you press Add to list. On phones bookmark buttons are awkward: there, paste the link
          into the form as usual.
        </p>
      </div>

      <p><Link to={user ? '/dashboard' : '/signup?next=/button'}>{user ? '← My lists' : 'Create an account first'}</Link></p>
    </div>
  );
}
