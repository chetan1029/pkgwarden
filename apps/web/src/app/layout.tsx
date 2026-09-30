import type { Metadata } from 'next';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'pkgwarden', template: '%s · pkgwarden' },
  description:
    'Agents that review npm dependency changes before they reach main. Rules first, model judgment only when a rule asks, every step recorded.',
};

/** Header, page and footer around every route. */
export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <header className="border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-mono text-base font-semibold">
              pkgwarden
            </Link>
            <nav className="flex gap-5 text-sm text-neutral-600 dark:text-neutral-400">
              <Link href="/#scenarios" className="hover:text-neutral-900 dark:hover:text-neutral-100">
                Scenarios
              </Link>
              <Link href="/#how-it-works" className="hover:text-neutral-900 dark:hover:text-neutral-100">
                How it works
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-neutral-500">
          Every run here is a recorded trace of fake test packages. Nothing on this site downloads or runs a real
          package.
        </footer>
      </body>
    </html>
  );
}
