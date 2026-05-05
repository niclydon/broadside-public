import type { Metadata } from 'next';
import { NavBar } from '@/components/NavBar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Broadside',
  description: 'Multi-brand editorial desk for AI-assisted publishing campaigns',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preconnect"
          href="https://rsms.me/"
        />
        <link
          rel="stylesheet"
          href="https://rsms.me/inter/inter.css"
        />
      </head>
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-[var(--border)] px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />
              <span className="font-mono text-sm tracking-widest uppercase text-[var(--text)]">Broadside</span>
            </div>
            <NavBar />
          </header>
          <main className="flex-1 px-6 py-8">{children}</main>
          <footer className="border-t border-[var(--border)] px-6 py-3 text-xs text-[var(--muted)] flex items-center justify-center">
            <span>© 2026 Broadside</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
