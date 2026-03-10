'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';

const NAV_LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/explorer', label: 'Data Explorer' },
  { href: '/compare', label: 'Compare' },
  { href: '/bowling', label: 'Bowling Forecast' },
  { href: '/holidays', label: 'Holiday Analysis' },
];

function NavLink({
  href,
  label,
  active,
  onClick,
}: {
  href: string;
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block text-sm px-4 py-3 rounded-lg transition-colors ${
        active
          ? 'bg-accent/15 text-accent'
          : 'text-secondary hover:bg-white/5 hover:text-white'
      }`}
    >
      {label}
    </Link>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close menu on route change (e.g. after clicking a link)
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Prevent body scroll when menu is open on mobile
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const linkActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href));

  return (
    <nav className="sticky top-0 z-50 bg-black/80 backdrop-blur-lg border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
          <Image
            src="/concourse-logo-trans.png"
            alt="Concourse"
            width={108}
            height={48}
            className="object-contain h-8 sm:h-10 w-auto"
            priority
          />
          <span className="text-base sm:text-xl font-bold text-gradient truncate">
            Analytics
          </span>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm px-4 py-2 rounded-full transition-colors ${
                linkActive(link.href)
                  ? 'bg-accent/15 text-accent'
                  : 'text-secondary hover:bg-white/5 hover:text-white'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Mobile hamburger button */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="md:hidden p-2 -mr-2 text-secondary hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Mobile menu overlay - portaled to body so it always sits above page content */}
      {menuOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              className="fixed inset-0 bg-black/80 z-[100] md:hidden"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <div className="fixed top-0 right-0 bottom-0 w-full max-w-[min(280px,100vw)] bg-[#0d0d0d] border-l border-border z-[101] md:hidden shadow-2xl animate-slide-in-right">
              <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
                <span className="font-semibold text-sm">Menu</span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="p-2 -mr-2 text-secondary hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-1 overflow-y-auto">
                {NAV_LINKS.map(link => (
                  <NavLink
                    key={link.href}
                    href={link.href}
                    label={link.label}
                    active={linkActive(link.href)}
                    onClick={() => setMenuOpen(false)}
                  />
                ))}
              </div>
            </div>
          </>,
          document.body
        )}
    </nav>
  );
}
