import type { ReactNode } from 'react';
import Link from 'next/link';

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; href: string };
}

export function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="bs-card p-8 flex flex-col items-center text-center">
      {icon && <div className="text-[var(--muted)] mb-3">{icon}</div>}
      <div className="text-sm font-medium text-[var(--text)]">{title}</div>
      {description && (
        <p className="text-xs text-[var(--muted)] mt-1 max-w-sm">{description}</p>
      )}
      {action && (
        <Link href={action.href} className="bs-btn bs-btn-primary mt-4 text-xs">
          {action.label}
        </Link>
      )}
    </div>
  );
}
