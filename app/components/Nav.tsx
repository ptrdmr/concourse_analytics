'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  CalendarCheck,
  Clock,
  Columns2,
  Compass,
  CreditCard,
  HandCoins,
  LayoutDashboard,
  Menu,
  PartyPopper,
  Receipt,
  Sparkles,
  TrendingUp,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

const NAV_LINKS: { href: string; label: string; desc: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Overview', desc: 'Dashboard summary & key metrics', icon: LayoutDashboard },
  { href: '/payments', label: 'Payments', desc: 'Revenue breakdown & payment trends', icon: CreditCard },
  { href: '/explorer', label: 'Data Explorer', desc: 'Dive into raw data & custom queries', icon: Compass },
  { href: '/dayparts', label: 'Dayparts', desc: 'Item sales by time of day', icon: Clock },
  { href: '/compare', label: 'Compare', desc: 'Side-by-side period comparisons', icon: Columns2 },
  { href: '/specials', label: 'Specials', desc: 'Seasonal packages & specialty cocktails', icon: Sparkles },
  { href: '/reservations', label: 'Reservations', desc: 'Weekly party and lane booking trends', icon: CalendarCheck },
  { href: '/holidays', label: 'Holiday Analysis', desc: 'Performance around holidays & events', icon: PartyPopper },
  { href: '/bowling', label: 'Bowling Forecast', desc: 'Projected bowling lane revenue', icon: TrendingUp },
  { href: '/tickets', label: 'Ticket Lookup', desc: 'Search tickets by date or number', icon: Receipt },
  { href: '/employees', label: 'Employees', desc: 'Per-employee sales, tips, hours & wage', icon: Users },
  { href: '/gratuity', label: 'Gratuity', desc: 'Tips by daypart and terminal house', icon: HandCoins },
];

function NavLink({
  href,
  label,
  desc,
  icon: Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block px-4 py-3 rounded-lg transition-colors ${
        active
          ? 'bg-accent/15 text-accent'
          : 'text-secondary hover:bg-overlay/5 hover:text-foreground'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        {label}
      </span>
      <span className="block text-[11px] text-secondary/60 mt-0.5 pl-6">{desc}</span>
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

  // Widening past the desktop breakpoint hides the drawer via CSS alone, which
  // would strand the body scroll lock above with no visible control to release
  // it. Keep this query in sync with the xl:hidden classes below.
  useEffect(() => {
    if (!menuOpen) return;
    const mq = window.matchMedia('(min-width: 1280px)');
    if (mq.matches) {
      setMenuOpen(false);
      return;
    }
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMenuOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [menuOpen]);

  const linkActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href));

  return (
    <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
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

        <div className="flex items-center gap-1">
          <ThemeToggle className="hidden xl:inline-flex" />
          <div className="flex items-center gap-1 xl:hidden">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="p-2 -mr-2 text-secondary hover:text-foreground hover:bg-overlay/5 rounded-lg transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>

      <div className="hidden xl:flex max-w-7xl mx-auto px-4 sm:px-6 pb-2 items-center gap-0.5 flex-wrap">
          {NAV_LINKS.map(link => (
            <div key={link.href} className="relative group shrink-0">
              <Link
                href={link.href}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs px-2.5 py-1.5 rounded-full transition-colors ${
                  linkActive(link.href)
                    ? 'bg-accent/15 text-accent'
                    : 'text-secondary hover:bg-overlay/5 hover:text-foreground'
                }`}
              >
                <link.icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {link.label}
              </Link>
              <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 px-3 py-1.5 rounded-lg bg-card-hover border border-border text-xs text-secondary whitespace-nowrap opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 shadow-lg z-10">
                {link.desc}
              </div>
            </div>
          ))}
      </div>

      {/* Mobile menu overlay - portaled to body so it always sits above page content */}
      {menuOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              className="fixed inset-0 bg-black/80 z-[100] xl:hidden"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <div className="fixed top-0 right-0 bottom-0 w-full max-w-[min(280px,100vw)] bg-card border-l border-border z-[101] xl:hidden shadow-2xl animate-slide-in-right flex flex-col">
              <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
                <span className="font-semibold text-sm">Menu</span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="p-2 -mr-2 text-secondary hover:text-foreground hover:bg-overlay/5 rounded-lg transition-colors"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 min-h-0 p-4 space-y-1 overflow-y-auto">
                {NAV_LINKS.map(link => (
                  <NavLink
                    key={link.href}
                    href={link.href}
                    label={link.label}
                    desc={link.desc}
                    icon={link.icon}
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
