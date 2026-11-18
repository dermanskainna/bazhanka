import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { ItemForm } from './ListPage.jsx';

// Edit one gift on its own page: /l/:slug/edit/:itemId (list owner only).
export default function EditItem() {
  const { slug, itemId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/lists/${slug}`).then(setData).catch((e) => setError(e.message));
  }, [slug]);

  const back = () => navigate(`/l/${slug}`);

  if (error) return <div className="page"><p className="error">{error}</p><Link to={`/l/${slug}`}>← Back to the list</Link></div>;
  if (!data) return <div className="page muted">Loading…</div>;

  const item = data.items.find((i) => String(i.id) === String(itemId));
  if (!data.isOwner || !item) {
    return (
      <div className="page">
        <h1>Gift not found</h1>
        <p>It may have been removed, or this isn’t your list.</p>
        <Link to={`/l/${slug}`}>← Back to the list</Link>
      </div>
    );
  }

  return (
    <div className="page narrow-wide">
      <Link to={`/l/${slug}`} className="back-link">← {data.wishlist.title}</Link>
      <h1>Edit gift</h1>
      <ItemForm item={item} onDone={back} onCancel={back} />
    </div>
  );
}
