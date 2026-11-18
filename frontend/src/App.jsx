import { Routes, Route, Link, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useSession } from './session.jsx';
import Home from './pages/Home.jsx';
import Auth from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ListPage from './pages/ListPage.jsx';
import Santa from './pages/Santa.jsx';
import Admin from './pages/Admin.jsx';
import Discover from './pages/Discover.jsx';
import AddButton from './pages/AddButton.jsx';
import AddFromShop from './pages/AddFromShop.jsx';
import EditItem from './pages/EditItem.jsx';
import Feedback from './Feedback.jsx';
import { GiftIcon, HeartIcon } from './icons.jsx';

function RequireUser({ children }) {
  const { user } = useSession();
  const loc = useLocation();
  if (user === undefined) return <div className="page muted">Loading…</div>;
  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return children;
}

export default function App() {
  const { user, logout, config } = useSession();
  const { pathname } = useLocation();
  // The small window opened by the + Bazhanka button shows only the form: no menu, no feedback button.
  const popup = pathname === '/add' && !!window.opener;
  if (popup) {
    return (
      <div className="shell popup-shell">
        <header className="topbar"><span className="brand"><GiftIcon size={20} /> Bazhanka</span></header>
        <main className="app-bg">
          <Routes><Route path="/add" element={<RequireUser><AddFromShop /></RequireUser>} /></Routes>
        </main>
      </div>
    );
  }
  return (
    <div className="shell">
      <header className="topbar">
        {/* The logo always leads to the main page, whether or not you are signed in. */}
        <Link to="/" className="brand"><GiftIcon size={20} /> Bazhanka</Link>
        <nav>
          {user ? (
            <>
              <NavLink to="/dashboard">My lists</NavLink>
              <NavLink to="/santa">Secret Santa</NavLink>
              {user.isAdmin && <NavLink to="/admin">Stats</NavLink>}
              <button className="nav-signout" onClick={logout}>Sign out</button>
            </>
          ) : user === null ? (
            <>
              <NavLink to="/signin">Sign in</NavLink>
              <Link to="/signup" className="btn small">Sign up</Link>
            </>
          ) : null}
        </nav>
      </header>
      <main className={pathname === '/' ? '' : 'app-bg'}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/signin" element={<Auth mode="signin" />} />
          <Route path="/signup" element={<Auth mode="signup" />} />
          <Route path="/dashboard" element={<RequireUser><Dashboard /></RequireUser>} />
          <Route path="/l/:slug" element={<ListPage />} />
          <Route path="/l/:slug/edit/:itemId" element={<RequireUser><EditItem /></RequireUser>} />
          <Route path="/button" element={<AddButton />} />
          <Route path="/add" element={<RequireUser><AddFromShop /></RequireUser>} />
          <Route path="/ideas" element={<RequireUser><Discover /></RequireUser>} />
          <Route path="/santa" element={<RequireUser><Santa /></RequireUser>} />
          <Route path="/santa/:code" element={<RequireUser><Santa /></RequireUser>} />
          <Route path="/admin" element={<RequireUser><Admin /></RequireUser>} />
          <Route path="*" element={<div className="page"><h1>Page not found</h1><Link to="/">Go home</Link></div>} />
        </Routes>
      </main>
      {config.donationUrl && (
        <footer className="footer">
          <span>© 2026 Bazhanka</span>
          <a className="support-link" href={config.donationUrl} target="_blank" rel="noreferrer"><HeartIcon size={15} /> {config.donationLabel}</a>
        </footer>
      )}
      <Feedback />
    </div>
  );
}
