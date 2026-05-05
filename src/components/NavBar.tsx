'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandSwitcher } from './BrandSwitcher';

const NAV_ITEMS = [
  { href: '/', label: 'Queue' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/suggestions', label: 'Suggestions' },
  { href: '/context', label: 'Context' },
  { href: '/brand-assets', label: 'Brand' },
  { href: '/activity', label: 'Activity' },
  { href: '/settings', label: 'Settings' },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-5">
      <nav className="flex items-center gap-6 text-sm text-[var(--text-dim)]">
        {NAV_ITEMS.map(({ href, label }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={
                active
                  ? 'text-[var(--accent)] border-b-2 border-[var(--accent)] pb-0.5 transition-colors'
                  : 'hover:text-[var(--accent)] transition-colors'
              }
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="h-5 w-px bg-[var(--border)]" aria-hidden />
      <BrandSwitcher />
    </div>
  );
}
