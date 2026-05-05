'use client';

import { useEffect, useRef, useState } from 'react';

type Brand = {
  id: string;
  slug: string;
  name: string;
  accent_color: string;
};

const COOKIE_NAME = 'broadside_brand';

function setBrandCookie(slug: string) {
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(slug)}; Path=/; Max-Age=${oneYear}; SameSite=Lax`;
}

export function BrandSwitcher() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [currentSlug, setCurrentSlug] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/brands')
      .then((r) => r.json())
      .then((data) => {
        setBrands(data.brands ?? []);
        setCurrentSlug(data.current_slug ?? null);
      })
      .catch(() => {
        setBrands([]);
      });
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const current = brands.find((b) => b.slug === currentSlug) ?? brands[0];

  if (!current) {
    return (
      <div className="text-xs text-[var(--text-dim)] px-2 py-1 border border-[var(--border)] rounded">
        No brand
      </div>
    );
  }

  function choose(slug: string) {
    setBrandCookie(slug);
    setOpen(false);
    window.location.reload();
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-[var(--border)] hover:border-[var(--accent)] text-sm text-[var(--text)] transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: current.accent_color }}
          aria-hidden
        />
        <span className="font-medium">{current.name}</span>
        <span className="text-[var(--text-dim)] text-xs">▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 mt-1 min-w-[12rem] rounded border border-[var(--border)] bg-[var(--surface)] shadow-lg z-20"
        >
          {brands.map((b) => (
            <button
              key={b.slug}
              role="option"
              aria-selected={b.slug === current.slug}
              onClick={() => choose(b.slug)}
              className={
                'w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[var(--bg)] transition-colors ' +
                (b.slug === current.slug ? 'text-[var(--accent)]' : 'text-[var(--text)]')
              }
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: b.accent_color }}
                aria-hidden
              />
              {b.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
