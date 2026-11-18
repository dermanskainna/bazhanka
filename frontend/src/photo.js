// Shrinks a photo in the browser before upload: at most 1200 px on the long side, JPEG ~85%.
// Phone photos (5-10 MB) become ~100-300 KB, and the EXIF rotation is applied.
const MAX_SIDE = 1200;

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function shrinkPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a photo');
  let bmp;
  try { bmp = await loadBitmap(file); } catch { throw new Error('This photo format isn’t supported — try a JPEG or PNG'); }
  const w0 = bmp.width, h0 = bmp.height;
  const k = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w0 * k);
  canvas.height = Math.round(h0 * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs get a white background in JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the photo'))), 'image/jpeg', 0.85));
}

export async function uploadPhoto(file) {
  const blob = await shrinkPhoto(file);
  const res = await fetch('/api/photos', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return data.url;
}

export const isOwnPhoto = (u) => /^\/api\/photos\/[a-z0-9]{16}$/.test(u || '');
