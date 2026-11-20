'use client';

import { useEffect, useRef, useState } from 'react';
import { photoMaxBytes, photoSide, photoTargetBytes } from './photo-options';

export type PhotoSettings = { photoId: string | null; quickPhoto: boolean };

export function PhotoAvatar({ nickname, photoId, scope, target, large = false }: {
  nickname: string; photoId?: string | null; scope: 'own' | 'bar' | 'quick'; target?: string; large?: boolean;
}) {
  const query = photoId ? new URLSearchParams({ scope, revision: photoId, ...(target ? { target } : {}) }).toString() : '';
  const [image, setImage] = useState<{ query: string; url: string; loaded: boolean }>();

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    void fetch('/api/profile-photo?' + query, { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (!controller.signal.aborted && typeof data?.url === 'string') setImage({ query, url: data.url, loaded: false });
      }).catch(() => {});
    return () => controller.abort();
  }, [query]);

  const current = query && image?.query === query ? image : undefined;
  return <span className={`avatar photo-avatar${large ? ' photo-avatar-large' : ''}`} aria-hidden="true">
    {Array.from(nickname.trim())[0]?.toUpperCase() || '?'}
    {current && <img src={current.url} alt="" className={current.loaded ? 'loaded' : undefined} referrerPolicy="no-referrer"
      onLoad={() => setImage(previous => previous?.url === current.url ? { ...previous, loaded: true } : previous)}
      onError={() => setImage(previous => previous?.url === current.url ? undefined : previous)} />}
  </span>;
}

async function encodeCrop(canvas: HTMLCanvasElement) {
  let format = 'image/webp';
  const encode = (quality: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, format, quality));
  for (const quality of [0.85, 0.72, 0.59, 0.45, 0.32]) {
    let blob = await encode(quality);
    if (format === 'image/webp' && blob?.type !== format) {
      // Safari can display WebP but its canvas exports JPEG instead.
      format = 'image/jpeg';
      blob = await encode(quality);
    }
    if (!blob || blob.type !== format) throw new Error('This browser couldn’t encode the photo crop.');
    if (blob.size <= photoTargetBytes || (quality === 0.32 && blob.size <= photoMaxBytes)) return blob;
  }
  throw new Error('This crop is too detailed to save under 150 KB. Try zooming in or choosing another photo.');
}

export function PhotoEditor({ nickname, settings, update }: {
  nickname: string; settings: PhotoSettings; update: (photo: PhotoSettings) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<HTMLImageElement>();
  const [zoom, setZoom] = useState(1);
  const [left, setLeft] = useState(50);
  const [top, setTop] = useState(50);
  const [busy, setBusy] = useState(false);
  const [pendingQuick, setPendingQuick] = useState<boolean>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!source) return;
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    const { naturalWidth, naturalHeight } = source;
    const side = Math.min(naturalWidth, naturalHeight) / zoom;
    context.clearRect(0, 0, photoSide, photoSide);
    context.drawImage(source, (naturalWidth - side) * left / 100, (naturalHeight - side) * top / 100,
      side, side, 0, 0, photoSide, photoSide);
  }, [source, zoom, left, top]);

  async function choose(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    const url = URL.createObjectURL(file);
    try {
      const image = new window.Image();
      image.src = url;
      await image.decode();
      setZoom(1);
      setLeft(50);
      setTop(50);
      setSource(image);
    } catch {
      setError('This image couldn’t be opened. Try a JPG, PNG, or WebP photo.');
    } finally {
      URL.revokeObjectURL(url);
      setBusy(false);
    }
  }

  async function save(method: 'POST' | 'PATCH' | 'DELETE', quick?: boolean) {
    if (busy) return;
    setBusy(true);
    setPendingQuick(quick);
    setError('');
    setNotice('');
    try {
      const params = new URLSearchParams();
      if (settings.photoId) params.set('previous', settings.photoId);
      if (quick !== undefined) params.set('quick', quick ? '1' : '0');
      const body = method === 'POST' && canvas.current ? await encodeCrop(canvas.current) : undefined;
      const response = await fetch('/api/profile-photo?' + params, {
        method, body, cache: 'no-store', signal: AbortSignal.timeout(18_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Couldn’t save this photo setting.');
      update(data);
      if (method !== 'PATCH') setSource(undefined);
      setNotice(method === 'POST' ? 'Photo saved.' : method === 'DELETE' ? 'Photo removed.' :
        quick ? 'Your photo is visible in Quick Chat.' : 'Quick Chat will show your initial.');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setPendingQuick(undefined);
      setBusy(false);
    }
  }

  return <div className="photo-editor">
    <div className="photo-editor-intro">
      <PhotoAvatar nickname={nickname} scope="own" photoId={settings.photoId} large />
      <div><h3>Add a photo (optional)</h3><p>Your photo appears on your Across the Bar card.</p></div>
    </div>
    <input ref={input} type="file" accept="image/*" tabIndex={-1} hidden onChange={event => {
      void choose(event.currentTarget.files?.[0]);
      event.currentTarget.value = '';
    }} />
    {source ? <div className="photo-crop">
      <canvas ref={canvas} width={photoSide} height={photoSide} role="img" aria-label="Square photo crop preview" />
      <div className="photo-crop-controls">
        <label>Zoom<input type="range" min={1} max={3} step={0.01} value={zoom} disabled={busy} onChange={event => setZoom(Number(event.target.value))} /></label>
        <label>Move left or right<input type="range" min={0} max={100} value={left} disabled={busy} onChange={event => setLeft(Number(event.target.value))} /></label>
        <label>Move up or down<input type="range" min={0} max={100} value={top} disabled={busy} onChange={event => setTop(Number(event.target.value))} /></label>
      </div>
      <div className="photo-editor-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void save('POST')}>Save photo</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setSource(undefined)}>Cancel crop</button>
      </div>
    </div> : <div className="photo-editor-actions">
      <button type="button" className="secondary" disabled={busy} onClick={() => input.current?.click()}>{settings.photoId ? 'Replace photo' : 'Choose photo'}</button>
      {settings.photoId && <button type="button" className="secondary" disabled={busy} onClick={() => void save('DELETE')}>Remove photo</button>}
    </div>}
    <label className="photo-share">
      <input type="checkbox" role="switch" checked={pendingQuick ?? settings.quickPhoto} disabled={busy || !settings.photoId}
        onChange={event => void save('PATCH', event.target.checked)} />
      <span>Show my photo in Quick Chat</span>
    </label>
    {busy && <p role="status">Working on your photo…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
  </div>;
}
