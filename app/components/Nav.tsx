'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/explorer', label: 'Data Explorer' },
  { href: '/bowling', label: 'Bowling Forecast' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 bg-black/80 backdrop-blur-lg border-b border-border">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-gradient">
          Analytics
        </Link>
        <div className="flex items-center gap-1">
          {NAV_LINKS.map(link => {
            const active = pathname === link.href ||
              (link.href !== '/' && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm px-4 py-2 rounded-full transition-colors ${
                  active
                    ? 'bg-accent/15 text-accent'
                    : 'text-secondary hover:bg-white/5 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
