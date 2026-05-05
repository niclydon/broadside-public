'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface MediaRecord {
  id: string;
  content_group_id: string | null;
  kind: string;
  path: string;
  filename: string | null;
  mime_type: string | null;
  alt_text: string | null;
  created_at: string;
}

interface Props {
  groupId: string;
}

export function CampaignMedia({ groupId }: Props) {
  const [media, setMedia] = useState<MediaRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editingAlt, setEditingAlt] = useState<string | null>(null);
  const [altInput, setAltInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const loadMedia = useCallback(async () => {
    const res = await fetch(`/api/media?group_id=${groupId}`);
    if (res.ok) {
      const data = await res.json();
      setMedia(data.media);
    }
  }, [groupId]);

  useEffect(() => { loadMedia(); }, [loadMedia]);

  const uploadFiles = async (files: FileList | File[]) => {
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        form.append('group_id', groupId);
        const res = await fetch('/api/media', { method: 'POST', body: form });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'upload failed' }));
          setError(data.error);
          return;
        }
      }
      await loadMedia();
    } finally {
      setUploading(false);
    }
  };

  const deleteItem = async (id: string) => {
    const res = await fetch(`/api/media/${id}`, { method: 'DELETE' });
    if (res.ok) setMedia((m) => m.filter((item) => item.id !== id));
  };

  const saveAltText = async (id: string) => {
    const res = await fetch(`/api/media/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alt_text: altInput || null }),
    });
    if (res.ok) {
      setMedia((m) => m.map((item) => item.id === id ? { ...item, alt_text: altInput || null } : item));
      setEditingAlt(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  };

  const isVideo = (mime: string | null) => mime?.startsWith('video/');

  return (
    <div className="bs-card p-4">
      <div className="bs-label mb-2">Campaign assets ({media.length})</div>

      {/* Upload zone */}
      <div
        className="border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer mb-3"
        style={{ borderColor: dragOver ? 'var(--accent)' : 'var(--border)' }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/mp4,video/webm"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); }}
        />
        <p className="text-xs text-[var(--muted)]">
          {uploading ? 'Uploading…' : 'Drop files here or click to upload'}
        </p>
        <p className="text-[0.5625rem] text-[var(--muted)] mt-1">
          Images (JPG, PNG, GIF, WebP, SVG) and video (MP4, WebM) · max 20MB
        </p>
      </div>

      {error && <div className="text-xs mb-3" style={{ color: 'var(--danger)' }}>{error}</div>}

      {/* Gallery */}
      {media.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {media.map((item) => (
            <div key={item.id} className="rounded border border-[var(--border)] overflow-hidden group relative">
              {isVideo(item.mime_type) ? (
                <video
                  src={`/api/media/${item.id}/file`}
                  className="w-full aspect-video object-cover bg-[var(--bg)]"
                  muted
                  playsInline
                  onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                  onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                />
              ) : (
                <img
                  src={`/api/media/${item.id}/file`}
                  alt={item.alt_text ?? item.filename ?? 'media'}
                  className="w-full aspect-square object-cover bg-[var(--bg)]"
                  loading="lazy"
                />
              )}

              {/* Overlay controls */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-[0.5rem] text-white/80 truncate flex-1">{item.filename}</span>
                  <button
                    type="button"
                    className="text-[0.5rem] text-white/80 hover:text-white px-1"
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`/api/media/${item.id}/file`); }}
                  >
                    URL
                  </button>
                  <button
                    type="button"
                    className="text-[0.5rem] text-red-400 hover:text-red-300 px-1"
                    onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}
                  >
                    Delete
                  </button>
                </div>

                {editingAlt === item.id ? (
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={altInput}
                      onChange={(e) => setAltInput(e.target.value)}
                      placeholder="Alt text…"
                      className="flex-1 text-[0.5rem] rounded bg-black/50 text-white px-1 py-0.5 border border-white/20 focus:outline-none"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') saveAltText(item.id); if (e.key === 'Escape') setEditingAlt(null); }}
                    />
                    <button
                      type="button"
                      className="text-[0.5rem] text-[#4ade80] px-1"
                      onClick={() => saveAltText(item.id)}
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="text-[0.5rem] text-white/60 hover:text-white text-left"
                    onClick={(e) => { e.stopPropagation(); setEditingAlt(item.id); setAltInput(item.alt_text ?? ''); }}
                  >
                    {item.alt_text ? `Alt: ${item.alt_text}` : '+ Add alt text'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
