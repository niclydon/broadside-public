'use client';

import { useMemo, useState } from 'react';

interface BrandAsset {
  id: string;
  filename: string;
  use_case: string;
  platform: string | null;
  brand_id: string | null;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  notes: string | null;
  is_current: boolean;
  source_label: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  vlm_description: string | null;
  vlm_description_generated_at: string | null;
  created_at: string;
  deleted_at: string | null;
}

interface BrandRef {
  id: string;
  slug: string;
  name: string;
}

interface Props {
  initialAssets: BrandAsset[];
  brands: BrandRef[];
  useCases: string[];
}

const PLATFORMS = ['linkedin', 'twitter', 'bluesky', 'github', 'substack', 'web', 'youtube', 'facebook', 'instagram', 'macos'];

export function BrandAssetsView({ initialAssets, brands, useCases }: Props) {
  const [assets, setAssets] = useState<BrandAsset[]>(initialAssets);
  const [filterUseCase, setFilterUseCase] = useState<string>('');
  const [filterPlatform, setFilterPlatform] = useState<string>('');
  const [filterBrand, setFilterBrand] = useState<string>('');
  const [filterCurrent, setFilterCurrent] = useState<boolean>(false);
  const [selected, setSelected] = useState<BrandAsset | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const filtered = useMemo(() => {
    return assets.filter((a) => {
      if (filterUseCase && a.use_case !== filterUseCase) return false;
      if (filterPlatform === '__null__' ? a.platform !== null : filterPlatform && a.platform !== filterPlatform) return false;
      if (filterBrand === '__null__' ? a.brand_id !== null : filterBrand && a.brand_id !== filterBrand) return false;
      if (filterCurrent && !a.is_current) return false;
      return true;
    });
  }, [assets, filterUseCase, filterPlatform, filterBrand, filterCurrent]);

  const brandSlugById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of brands) m.set(b.id, b.slug);
    return m;
  }, [brands]);

  async function refresh() {
    const res = await fetch('/api/brand-assets');
    if (res.ok) {
      const data = await res.json();
      setAssets(data.assets);
    }
  }

  async function handleUpdate(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/brand-assets/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, ...data.asset } : a)));
      setSelected((prev) => (prev?.id === id ? { ...prev, ...data.asset } : prev));
      // is_current flips affect siblings — refresh to pick up demotions
      if (patch.is_current === true) await refresh();
    } else {
      alert(`Update failed: ${res.status}`);
    }
  }

  async function handleDelete(id: string, hard: boolean) {
    if (!confirm(hard ? 'Hard delete? This removes the file from storage too. Cannot be undone.' : 'Soft delete this asset?')) return;
    const res = await fetch(`/api/brand-assets/${id}${hard ? '?hard=true' : ''}`, { method: 'DELETE' });
    if (res.ok) {
      if (hard) {
        setAssets((prev) => prev.filter((a) => a.id !== id));
      } else {
        setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, deleted_at: new Date().toISOString(), is_current: false } : a)));
      }
      setSelected(null);
    } else {
      alert(`Delete failed: ${res.status}`);
    }
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-[#2a2a30] bg-[#16161a] p-4">
        <select value={filterUseCase} onChange={(e) => setFilterUseCase(e.target.value)} className={selectCls}>
          <option value="">All use cases</option>
          {useCases.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <select value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)} className={selectCls}>
          <option value="">All platforms</option>
          <option value="__null__">(platform-neutral)</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)} className={selectCls}>
          <option value="">All brands</option>
          <option value="__null__">(brand-neutral)</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.slug}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-[#e8e8f0]">
          <input type="checkbox" checked={filterCurrent} onChange={(e) => setFilterCurrent(e.target.checked)} />
          Current only
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-[#6b6b7a]">{filtered.length} shown</span>
          <button onClick={() => setShowUpload(true)} className={primaryBtn}>+ Upload</button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {filtered.map((a) => (
          <button
            key={a.id}
            onClick={() => setSelected(a)}
            title={a.vlm_description ?? a.alt_text ?? a.filename}
            className={`group relative overflow-hidden rounded-xl border ${a.deleted_at ? 'border-red-900/40 opacity-50' : 'border-[#2a2a30] hover:border-[#5aadf0]'} bg-[#16161a] transition-colors`}
          >
            <div className="aspect-square bg-[#0d0d0f] relative overflow-hidden">
              {a.mime_type?.startsWith('video/') ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/brand-assets/${a.id}/thumbnail`}
                    alt={a.alt_text ?? a.filename}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="rounded-full bg-black/50 p-2 text-white text-xs">▶</div>
                  </div>
                </>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/api/brand-assets/${a.id}/file`}
                  alt={a.alt_text ?? a.vlm_description ?? a.filename}
                  className="h-full w-full object-contain"
                  loading="lazy"
                />
              )}
            </div>
            <div className="px-3 py-2 text-left">
              <div className="truncate text-[11px] font-medium text-[#e8e8f0]">{a.filename}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-[#6b6b7a]">
                <span className="rounded bg-[#0d0d0f] px-1.5 py-0.5">{a.use_case}</span>
                {a.platform && <span className="rounded bg-[#0d0d0f] px-1.5 py-0.5">{a.platform}</span>}
                {a.brand_id && <span className="rounded bg-[#0d0d0f] px-1.5 py-0.5 text-[#5aadf0]">{brandSlugById.get(a.brand_id)}</span>}
                {a.is_current && <span className="rounded bg-[#5aadf0] px-1.5 py-0.5 font-semibold text-[#0d0d0f]">CURRENT</span>}
              </div>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-[#2a2a30] p-12 text-center text-sm text-[#6b6b7a]">
            No assets match the filters.
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <DetailModal
          asset={selected}
          brands={brands}
          useCases={useCases}
          onClose={() => setSelected(null)}
          onUpdate={(patch) => handleUpdate(selected.id, patch)}
          onSoftDelete={() => handleDelete(selected.id, false)}
          onHardDelete={() => handleDelete(selected.id, true)}
        />
      )}

      {/* Upload modal */}
      {showUpload && (
        <UploadModal
          brands={brands}
          useCases={useCases}
          onClose={() => setShowUpload(false)}
          onUploaded={async () => {
            setShowUpload(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function DetailModal({
  asset,
  brands,
  useCases,
  onClose,
  onUpdate,
  onSoftDelete,
  onHardDelete,
}: {
  asset: BrandAsset;
  brands: BrandRef[];
  useCases: string[];
  onClose: () => void;
  onUpdate: (patch: Record<string, unknown>) => Promise<void>;
  onSoftDelete: () => void;
  onHardDelete: () => void;
}) {
  const [altText, setAltText] = useState(asset.alt_text ?? '');
  const [notes, setNotes] = useState(asset.notes ?? '');
  const [useCase, setUseCase] = useState(asset.use_case);
  const [platform, setPlatform] = useState(asset.platform ?? '');
  const [brandId, setBrandId] = useState(asset.brand_id ?? '');
  const [isCurrent, setIsCurrent] = useState(asset.is_current);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    await onUpdate({
      alt_text: altText.trim() || null,
      notes: notes.trim() || null,
      use_case: useCase,
      platform: platform || null,
      brand_id: brandId || null,
      is_current: isCurrent,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="grid h-[85vh] w-full max-w-5xl grid-cols-1 overflow-hidden rounded-xl border border-[#2a2a30] bg-[#16161a] md:grid-cols-[1fr,1fr]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#0d0d0f] p-4 flex items-center justify-center overflow-hidden">
          {asset.mime_type?.startsWith('video/') ? (
            <video
              src={`/api/brand-assets/${asset.id}/file`}
              controls
              className="max-h-full w-full object-contain"
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`/api/brand-assets/${asset.id}/file`}
              alt={altText || asset.filename}
              className="max-h-full w-full object-contain"
            />
          )}
        </div>
        <div className="overflow-y-auto p-6">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#6b6b7a]">Asset</p>
              <h2 className="mt-1 break-all text-sm font-medium text-[#e8e8f0]">{asset.filename}</h2>
              <p className="mt-1 text-xs text-[#6b6b7a]">
                {asset.width && asset.height ? `${asset.width}×${asset.height}` : 'unknown dimensions'} ·{' '}
                {asset.size_bytes ? `${(asset.size_bytes / 1024).toFixed(0)} KB` : 'unknown size'} · {asset.mime_type ?? 'unknown'}
              </p>
              {asset.source_label && (
                <p className="mt-0.5 text-[10px] text-[#6b6b7a]">source: {asset.source_label}</p>
              )}
            </div>
            <button onClick={onClose} className="text-[#6b6b7a] hover:text-[#e8e8f0]">×</button>
          </div>

          <div className="space-y-3 text-sm">
            <Field label="Use case">
              <select value={useCase} onChange={(e) => setUseCase(e.target.value)} className={selectCls}>
                {useCases.map((u) => (<option key={u} value={u}>{u}</option>))}
              </select>
            </Field>
            <Field label="Platform">
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={selectCls}>
                <option value="">(none)</option>
                {PLATFORMS.map((p) => (<option key={p} value={p}>{p}</option>))}
              </select>
            </Field>
            <Field label="Brand">
              <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className={selectCls}>
                <option value="">(brand-neutral)</option>
                {brands.map((b) => (<option key={b.id} value={b.id}>{b.slug}</option>))}
              </select>
            </Field>
            <Field label="Alt text">
              <textarea value={altText} onChange={(e) => setAltText(e.target.value)} rows={2} className={inputCls} />
            </Field>
            <Field label="Notes">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} />
            </Field>
            <label className="flex items-center gap-2 pt-2 text-sm text-[#e8e8f0]">
              <input type="checkbox" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)} />
              Mark as current for ({useCase}, {platform || 'platform-neutral'})
            </label>
          </div>

          <VlmDescriptionBlock asset={asset} />

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#2a2a30] pt-4">
            <div className="flex gap-2">
              {asset.deleted_at ? (
                <span className="rounded bg-red-900/30 px-2 py-1 text-xs text-red-300">Soft-deleted</span>
              ) : (
                <button onClick={onSoftDelete} className={ghostBtn}>Soft delete</button>
              )}
              <button onClick={onHardDelete} className="rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-300 hover:bg-red-900/20">Hard delete</button>
            </div>
            <div className="flex items-center gap-2">
              {saved && <span className="text-xs text-[#5aadf0]">Saved</span>}
              <a
                href={`/api/brand-assets/${asset.id}/file`}
                download={asset.filename}
                className={ghostBtn}
              >
                Download
              </a>
              <button onClick={save} disabled={saving} className={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadModal({
  brands,
  useCases,
  onClose,
  onUploaded,
}: {
  brands: BrandRef[];
  useCases: string[];
  onClose: () => void;
  onUploaded: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [useCase, setUseCase] = useState('illustration');
  const [platform, setPlatform] = useState('');
  const [brandId, setBrandId] = useState('');
  const [altText, setAltText] = useState('');
  const [notes, setNotes] = useState('');
  const [isCurrent, setIsCurrent] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function upload() {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('use_case', useCase);
    if (platform) fd.append('platform', platform);
    if (brandId) fd.append('brand_id', brandId);
    if (altText) fd.append('alt_text', altText);
    if (notes) fd.append('notes', notes);
    if (isCurrent) fd.append('is_current', 'true');

    const res = await fetch('/api/brand-assets', { method: 'POST', body: fd });
    setUploading(false);
    if (res.ok) {
      await onUploaded();
    } else {
      const text = await res.text().catch(() => '');
      alert(`Upload failed: ${res.status} ${text}`);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-[#2a2a30] bg-[#16161a] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#e8e8f0]">Upload Brand Asset</h2>
          <button onClick={onClose} className="text-[#6b6b7a] hover:text-[#e8e8f0]">×</button>
        </div>

        <div className="space-y-3 text-sm">
          <Field label="File">
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml,video/mp4,video/webm,video/quicktime"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-xs text-[#e8e8f0] file:mr-3 file:rounded file:border-0 file:bg-[#0d0d0f] file:px-3 file:py-1.5 file:text-xs file:text-[#e8e8f0] hover:file:bg-[#1f1f25]"
            />
            {file && <span className="mt-1 block text-[10px] text-[#6b6b7a]">{(file.size / 1024).toFixed(0)} KB · {file.type}</span>}
          </Field>
          <Field label="Use case">
            <select value={useCase} onChange={(e) => setUseCase(e.target.value)} className={selectCls}>
              {useCases.map((u) => (<option key={u} value={u}>{u}</option>))}
            </select>
          </Field>
          <Field label="Platform">
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={selectCls}>
              <option value="">(none)</option>
              {PLATFORMS.map((p) => (<option key={p} value={p}>{p}</option>))}
            </select>
          </Field>
          <Field label="Brand">
            <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className={selectCls}>
              <option value="">(brand-neutral)</option>
              {brands.map((b) => (<option key={b.id} value={b.id}>{b.slug}</option>))}
            </select>
          </Field>
          <Field label="Alt text">
            <input value={altText} onChange={(e) => setAltText(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 pt-1 text-sm text-[#e8e8f0]">
            <input type="checkbox" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)} />
            Mark as current
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-[#2a2a30] pt-4">
          <button onClick={onClose} className={ghostBtn}>Cancel</button>
          <button onClick={upload} disabled={!file || uploading} className={primaryBtn}>{uploading ? 'Uploading…' : 'Upload'}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.3em] text-[#6b6b7a]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function VlmDescriptionBlock({ asset }: { asset: BrandAsset }) {
  const [description, setDescription] = useState(asset.vlm_description);
  const [generatedAt, setGeneratedAt] = useState(asset.vlm_description_generated_at);
  const [busy, setBusy] = useState(false);

  async function regenerate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/brand-assets/${asset.id}/regenerate-vlm`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setDescription(data.asset.vlm_description);
        setGeneratedAt(data.asset.vlm_description_generated_at);
      } else {
        const text = await res.text().catch(() => '');
        alert(`Regenerate failed: ${res.status} ${text}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-lg border border-[#2a2a30] bg-[#0d0d0f] p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#6b6b7a]">VLM Description</span>
        <button onClick={regenerate} disabled={busy} className="text-[10px] text-[#5aadf0] hover:text-[#7ac0f5] disabled:opacity-50">
          {busy ? 'generating…' : description ? 'regenerate' : 'generate'}
        </button>
      </div>
      <p className="text-xs italic text-[#a8a4a0]">
        {description ?? <span className="text-[#6b6b7a] not-italic">no description yet — click "generate"</span>}
      </p>
      {generatedAt && (
        <p className="mt-1 text-[9px] text-[#6b6b7a]">{new Date(generatedAt).toLocaleString()}</p>
      )}
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-[#2a2a30] bg-[#0d0d0f] px-3 py-1.5 text-sm text-[#e8e8f0] focus:border-[#5aadf0] focus:outline-none';
const selectCls = inputCls;
const primaryBtn = 'rounded-lg bg-[#5aadf0] px-3 py-1.5 text-sm font-semibold text-[#0d0d0f] hover:bg-[#7ac0f5] disabled:opacity-50';
const ghostBtn = 'rounded-lg border border-[#2a2a30] px-3 py-1.5 text-sm text-[#e8e8f0] hover:bg-[#1f1f25]';
