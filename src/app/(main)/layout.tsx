'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useRole } from '@/hooks/useRole';
import { DomainProvider, useDomain } from '@/contexts/DomainContext';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import NotificationUI from '@/components/NotificationUI';

function NavBar() {
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
    ...(isAdmin ? [{ href: '/admin', label: 'Admin' }] : []),
  ];

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  return (
    <nav className="bg-[#232f3e] text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Left: Logo + Domain Switcher */}
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-lg font-bold text-[#ff9900]">
              Radar Report Platform
            </Link>

            {/* Domain Switcher */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setDomainDropdownOpen(!domainDropdownOpen)}
                className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-white/10"
              >
                <span>{currentDomain?.name ?? 'Select Domain'}</span>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {domainDropdownOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded bg-white py-1 shadow-lg">
                  {domains.map((domain) => (
                    <button
                      key={domain.id}
                      onClick={() => {
                        switchDomain(domain.id);
                        setDomainDropdownOpen(false);
                      }}
                      className={`block w-full px-4 py-2 text-left text-sm ${
                        domain.id === currentDomain?.id
                          ? 'bg-gray-100 font-semibold text-[#232f3e]'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
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
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive(link.href)
                    ? 'bg-white/15 text-[#ff9900]'
                    : 'text-gray-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right: Language, Notifications, User Menu */}
          <div className="flex items-center gap-3">
            {/* Language Switcher */}
            <LanguageSwitcher />

            {/* Notifications */}
            <NotificationUI />

            {/* User Menu */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
              >
                <span className="max-w-[120px] truncate">{user?.email ?? ''}</span>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded bg-white py-1 shadow-lg">
                  <div className="border-b px-4 py-2 text-xs text-gray-500">{user?.email}</div>
                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      signOut();
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>

            {/* Mobile Hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="rounded p-1.5 text-gray-300 hover:bg-white/10 hover:text-white sm:hidden"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="border-t border-white/10 sm:hidden">
          <div className="space-y-1 px-4 py-3">
            {/* Domain Switcher (mobile) */}
            <div className="border-b border-white/10 pb-2 mb-2">
              <p className="mb-1 text-xs text-gray-400">Domain</p>
              {domains.map((domain) => (
                <button
                  key={domain.id}
                  onClick={() => {
                    switchDomain(domain.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`block w-full rounded px-3 py-1.5 text-left text-sm ${
                    domain.id === currentDomain?.id
                      ? 'bg-white/15 text-[#ff9900]'
                      : 'text-gray-300 hover:bg-white/10'
                  }`}
                >
                  {domain.name}
                </button>
              ))}
            </div>

            {/* Nav Links (mobile) */}
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`block rounded px-3 py-2 text-sm font-medium ${
                  isActive(link.href)
                    ? 'bg-white/15 text-[#ff9900]'
                    : 'text-gray-300 hover:bg-white/10'
                }`}
              >
                {link.label}
              </Link>
            ))}

            {/* User info + Sign Out (mobile) */}
            <div className="border-t border-white/10 pt-2 mt-2">
              <p className="px-3 py-1 text-xs text-gray-400">{user?.email}</p>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  signOut();
                }}
                className="block w-full rounded px-3 py-2 text-left text-sm text-gray-300 hover:bg-white/10"
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
      <main className="flex-1 bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </DomainProvider>
  );
}
