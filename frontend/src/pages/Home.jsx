import { Link } from 'react-router-dom';
import { useSession } from '../session.jsx';
import { GiftIcon, LinkIcon, LockIcon, UsersIcon, ShuffleIcon, HeartIcon, MailIcon } from '../icons.jsx';

const OCCASIONS = [
  { title: 'Birthday', meta: 'Share one link with everyone', img: '/images/birthday.jpg', alt: 'Child about to blow out the candles on a birthday cake', pos: 'center 20%' },
  { title: 'Christmas', meta: 'No duplicate presents', img: '/images/christmas.jpg', alt: 'Retro Christmas illustration with Santa’s sleigh over a snowy village', pos: 'center 30%' },
  { title: 'St Nicholas', meta: 'Small surprises, big joy', img: '/images/st-nicholas.jpg', alt: 'Painting of Santa at a snowy chimney with wrapped gifts', pos: 'center 40%' },
  { title: 'Graduation', meta: 'Chip in on the big one', img: '/images/graduation.jpg', alt: 'Black-and-white graduation portrait with colourful hand-lettering', pos: 'center 30%' },
];

export default function Home() {
  const { user } = useSession();
  const start = user ? '/dashboard' : '/signup';

  return (
    <div className="landing">
      {/* ---------- hero ---------- */}
      <section className="hero-banner">
        <div className="confetti" />
        <div className="float f1" aria-hidden><GiftIcon size={64} /></div>
        <div className="float f2" aria-hidden><MailIcon size={48} /></div>
        <div className="float f3" aria-hidden><HeartIcon size={40} /></div>
        <svg className="squiggle" viewBox="0 0 80 60" fill="none" stroke="#1c1917" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 14c30-14 62 2 40 16s-30 14-18 22 38 0 46-10" />
        </svg>

        <span className="eyebrow">Shared wishlists · secret reservations</span>
        <h1>Wishes that stay surprises</h1>
        <p className="sub">
          Make a wishlist, share one link. Friends reserve gifts secretly — you never see who is giving what.
        </p>
        <div className="hero-actions">
          {user ? (
            <>
              <Link to="/dashboard" className="btn light big">Go to my wishlists</Link>
              <Link to="/santa" className="btn ghost big">Secret Santa</Link>
            </>
          ) : (
            <>
              <Link to="/signup" className="btn light big">Create my wishlist</Link>
              <Link to="/signin" className="btn ghost big">Sign in</Link>
            </>
          )}
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section className="section">
        <h2 className="section-title">How Bazhanka works</h2>
        <p className="section-sub">Three steps from idea to the perfect gift</p>
        <div className="deal-grid">
          <article className="deal">
            <div className="pic p1" aria-hidden><LinkIcon size={56} /></div>
            <h3>Paste a shop link</h3>
            <p>Title, photo and price are filled in automatically.</p>
            <Link to={start} className="btn small">Try it</Link>
          </article>
          <article className="deal">
            <div className="pic p2" aria-hidden><LockIcon size={56} /></div>
            <h3>Secret reservations</h3>
            <p>No duplicates and no spoilers — guests see an item as taken, you don’t.</p>
            <Link to={start} className="btn small">Try it</Link>
          </article>
          <article className="deal">
            <div className="pic p3" aria-hidden><UsersIcon size={56} /></div>
            <h3>Chip in together</h3>
            <p>Expensive gift? Friends add what they can and watch the total grow.</p>
            <Link to={start} className="btn small">Try it</Link>
          </article>
        </div>
      </section>

      {/* ---------- occasions ---------- */}
      <section className="section">
        <h2 className="section-title">Lists for every occasion</h2>
        <p className="section-sub">Pick a moment, start a list in a minute</p>
        <div className="occasion-row">
          {OCCASIONS.map((o) => (
            <Link key={o.title} to={start} className="occasion">
              <img className="occasion-img" src={o.img} alt={o.alt} loading="lazy" style={{ objectPosition: o.pos }} />
              <span className="occasion-name">{o.title}</span>
              <span className="occasion-meta">{o.meta}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- Secret Santa ---------- */}
      <section className="bundle">
        <div className="left">
          <div>
            <ShuffleIcon size={72} className="big-icon" />
            <p>Invite your group, we draw the pairs. Everyone sees only their giftee’s list.</p>
          </div>
        </div>
        <div className="right">
          <h2 className="section-title">Secret Santa</h2>
          <p className="section-sub" style={{ margin: 0 }}>Draw names in one tap</p>
          <div className="bundle-cards" aria-hidden>
            <div className="mini"><LinkIcon size={28} />Invite link</div>
            <div className="mini"><ShuffleIcon size={28} />Fair draw</div>
          </div>
          <Link to={user ? '/santa' : '/signup'} className="btn">Start Secret Santa</Link>
        </div>
      </section>
    </div>
  );
}
