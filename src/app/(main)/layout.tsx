'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Menu, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useRole } from '@/hooks/useRole';
import { DomainProvider, useDomain } from '@/contexts/DomainContext';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import NotificationUI from '@/components/NotificationUI';
import { cn } from '@/lib/utils';

/**
 * Main app layout + top navigation.
 *
 * Design: see `.kiro/steering/ui-design-system.md` §9.3 (Nav bar). White
 * background, border-b, h-14. Active route = bottom underline in primary
 * color (not filled pill). Hover = text color change, never bg change.
 *
 * Power reference: design-system-scaffold `ui-guidelines.md` → "App Surfaces"
 * (Linear-style restraint) and `design-guidelines.md` §3.12 (Clear
 * Affordances), §5.6 (Navigation Systems), §5.11 (Landmarks and Orientation).
 */

function NavBar() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { isAdmin } = useRole();
  const { domains, currentDomain, switchDomain } = useDomain();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [domainDropdownOpen, setDomainDropdownOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const navLinks = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/reports', label: 'Reports' },
    { href: '/news', label: 'News' },
    { href: '/alerts', label: t('nav.alerts') },
    { href: '/requests', label: 'Request' },
    ...(isAdmin ? [{ href: '/admin', label: 'Admin' }] : []),
  ];

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-card">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4">
          {/* Left: Logo + Domain Switcher */}
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-base font-semibold text-primary hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
            >
              Radar Report Platform
            </Link>

            {/* Domain Switcher — desktop + mobile (always visible, not hidden in hamburger) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setDomainDropdownOpen((v) => !v)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                aria-haspopup="menu"
                aria-expanded={domainDropdownOpen}
                aria-label="Switch domain"
              >
                <span className="max-w-[120px] truncate font-medium text-foreground">
                  {currentDomain?.name ?? 'Select Domain'}
                </span>
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
              {domainDropdownOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-full z-50 mt-1 w-48 rounded-md border border-border bg-popover py-1 shadow-md"
                >
                  {domains.map((domain) => (
                    <button
                      type="button"
                      key={domain.id}
                      role="menuitem"
                      onClick={() => {
                        switchDomain(domain.id);
                        setDomainDropdownOpen(false);
                      }}
                      className={cn(
                        'block w-full px-3 py-1.5 text-left text-sm transition-colors',
                        domain.id === currentDomain?.id
                          ? 'bg-muted font-medium text-foreground'
                          : 'text-foreground-muted hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {domain.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Center: Nav Links (desktop) */}
          <div className="hidden sm:flex sm:items-center sm:gap-1">
            {navLinks.map((link) => {
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                    active
                      ? 'text-foreground'
                      : 'text-foreground-muted hover:text-foreground'
                  )}
                >
                  {link.label}
                  {/* Active underline — 2px, primary, anchored to bottom of navbar */}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-x-3 -bottom-[1px] h-0.5 bg-primary"
                    />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Right: Language, Notifications, User Menu */}
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <NotificationUI />

            {/* User Menu — desktop */}
            <div className="relative hidden sm:block">
              <button
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label="User menu"
              >
                <span className="max-w-[140px] truncate">{user?.email ?? ''}</span>
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
              {userMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-popover py-1 shadow-md"
                >
                  <div className="border-b border-border px-3 py-2 text-xs text-foreground-muted">
                    {user?.email}
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      signOut();
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm text-foreground-muted transition-colors hover:bg-muted hover:text-foreground"
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>

            {/* Mobile Hamburger */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:hidden"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" strokeWidth={1.75} />
              ) : (
                <Menu className="h-5 w-5" strokeWidth={1.75} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="border-t border-border bg-card sm:hidden">
          <div className="mx-auto max-w-7xl space-y-1 px-4 py-3 sm:px-6">
            {navLinks.map((link) => {
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-muted text-foreground'
                      : 'text-foreground-muted hover:bg-muted hover:text-foreground'
                  )}
                >
                  {link.label}
                </Link>
              );
            })}

            {/* User info + Sign Out (mobile) */}
            <div className="mt-2 border-t border-border pt-2">
              <p className="px-3 py-1 text-xs text-foreground-muted">{user?.email}</p>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  signOut();
                }}
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-foreground-muted transition-colors hover:bg-muted hover:text-foreground"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <DomainProvider>
      <NavBar />
      <main className="flex-1 bg-background">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </DomainProvider>
  );
}
