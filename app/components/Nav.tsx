'use client';

import { useState, useEffect, type CSSProperties } from 'react';
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

type NavItem = { href: string; label: string; desc: string; icon: LucideIcon };

const OVERVIEW: NavItem = {
  href: '/',
  label: 'Overview',
  desc: 'Dashboard summary & key metrics',
  icon: LayoutDashboard,
};

// Grouped by subject — what the page is about, not what it does. A new page
// should join the group whose question it answers: what we sold, how busy we
// expect to be, who worked, or how the money came in.
//
// Labels stay short because the group label already supplies the qualifier
// ("Bowling" under Demand & Forecast, "Tickets" under Transactions) and the
// full sentence lives in `desc`, shown on hover. It is also load-bearing for
// layout: the row only fits on one line inside max-w-7xl with these lengths.
const NAV_GROUPS: { label: string; color: string; links: NavItem[] }[] = [
  {
    label: 'Sales & Menu',
    color: 'sales',
    links: [
      { href: '/explorer', label: 'Explorer', desc: 'Dive into raw data & custom queries', icon: Compass },
      { href: '/dayparts', label: 'Dayparts', desc: 'Item sales by time of day', icon: Clock },
      { href: '/compare', label: 'Compare', desc: 'Side-by-side period comparisons', icon: Columns2 },
      { href: '/specials', label: 'Specials', desc: 'Seasonal packages & specialty cocktails', icon: Sparkles },
    ],
  },
  {
    label: 'Demand & Forecast',
    color: 'demand',
    links: [
      { href: '/reservations', label: 'Reservations', desc: 'Weekly party and lane booking trends', icon: CalendarCheck },
      { href: '/holidays', label: 'Holidays', desc: 'Performance around holidays & events', icon: PartyPopper },
      { href: '/bowling', label: 'Bowling', desc: 'Projected bowling lane revenue', icon: TrendingUp },
    ],
  },
  {
    label: 'Staff',
    color: 'staff',
    links: [
      { href: '/employees', label: 'Employees', desc: 'Per-employee sales, tips, hours & wage', icon: Users },
      { href: '/gratuity', label: 'Gratuity', desc: 'Tips by daypart and terminal house', icon: HandCoins },
    ],
  },
  {
    label: 'Transactions',
    color: 'transactions',
    links: [
      { href: '/payments', label: 'Payments', desc: 'Revenue breakdown & payment trends', icon: CreditCard },
      { href: '/tickets', label: 'Tickets', desc: 'Search tickets by date or number', icon: Receipt },
    ],
  },
];

// Scopes one hue to a group box so the tint, border and label styles in
// globals.css all derive from it.
const groupStyle = (color: string) =>
  ({ '--group-color': `var(--nav-group-${color})` }) as CSSProperties;

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

function NavPill({ href, label, desc, icon: Icon, active }: NavItem & { active: boolean }) {
  return (
    <div className="relative group shrink-0">
      <Link
        href={href}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs px-2.5 py-1.5 rounded-full transition-colors ${
          active
            ? 'bg-accent/15 text-accent'
            : 'text-secondary hover:bg-overlay/5 hover:text-foreground'
        }`}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        {label}
      </Link>
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 px-3 py-1.5 rounded-lg bg-card-hover border border-border text-xs text-secondary whitespace-nowrap opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 shadow-lg z-10">
        {desc}
      </div>
    </div>
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

      {/* items-end bottom-aligns the ungrouped Overview pill with the pills sitting
          inside the group boxes, which are taller because of their label row. */}
      <div className="hidden xl:flex max-w-7xl mx-auto px-4 sm:px-6 pb-2 items-end gap-1.5 flex-wrap">
        <div className="shrink-0 mb-1.5">
          <NavPill {...OVERVIEW} active={linkActive(OVERVIEW.href)} />
        </div>
        {NAV_GROUPS.map(navGroup => (
          <div
            key={navGroup.label}
            className="nav-group shrink-0 rounded-xl px-1.5 pt-1 pb-1.5"
            style={groupStyle(navGroup.color)}
          >
            <span className="nav-group-label block px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-[0.08em] leading-none">
              {navGroup.label}
            </span>
            {/* Keeps the group's pills on one line so a wrap never splits a box. */}
            <div className="flex items-center gap-0.5">
              {navGroup.links.map(link => (
                <NavPill key={link.href} {...link} active={linkActive(link.href)} />
              ))}
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
              <div className="flex-1 min-h-0 p-4 overflow-y-auto flex flex-col gap-3">
                <div className="shrink-0">
                  <NavLink
                    {...OVERVIEW}
                    active={linkActive(OVERVIEW.href)}
                    onClick={() => setMenuOpen(false)}
                  />
                </div>
                {NAV_GROUPS.map(navGroup => (
                  <section
                    key={navGroup.label}
                    className="nav-group shrink-0 rounded-xl px-1.5 pt-1.5 pb-1.5"
                    style={groupStyle(navGroup.color)}
                  >
                    <h2 className="nav-group-label px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider">
                      {navGroup.label}
                    </h2>
                    <div className="space-y-1">
                      {navGroup.links.map(link => (
                        <NavLink
                          key={link.href}
                          {...link}
                          active={linkActive(link.href)}
                          onClick={() => setMenuOpen(false)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </>,
          document.body
        )}
    </nav>
  );
}
