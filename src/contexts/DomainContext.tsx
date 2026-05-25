'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export interface Domain {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface DomainContextValue {
  domains: Domain[];
  currentDomainId: string | null;
  currentDomain: Domain | null;
  loading: boolean;
  switchDomain: (domainId: string) => void;
}

const STORAGE_KEY = 'radar-report-selected-domain';
/**
 * Cookie name shared with `getCurrentDomainIdServer()` (see
 * `src/lib/domain/server.ts`). Server components read this cookie to
 * know which domain to load data for, so SSR can render with the right
 * scope without waiting for client-side context to hydrate.
 *
 * Lifetime: 1 year. Path: `/`. SameSite=Lax (default). Not HttpOnly —
 * the client component needs to read it back on hydration to keep
 * `currentDomainId` state in sync.
 */
const COOKIE_NAME = 'radar-report-selected-domain';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
}

export const DomainContext = createContext<DomainContextValue | undefined>(
  undefined
);

export function DomainProvider({
  children,
  initialDomainId,
}: {
  children: ReactNode;
  /**
   * Optional initial domain id from the server (read from cookie in the
   * server component layout). When provided, hydration happens with the
   * right value and there's no flash from null → resolved.
   */
  initialDomainId?: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [domains, setDomains] = useState<Domain[]>([]);
  const [currentDomainId, setCurrentDomainId] = useState<string | null>(
    initialDomainId ?? null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDomains = async () => {
      const { data, error } = await supabase
        .from('domains')
        .select('*')
        .order('created_at', { ascending: true });

      if (!error && data) {
        setDomains(data as Domain[]);

        // If the server already gave us an initial id, only override when
        // it's invalid (e.g. domain was deleted). Otherwise restore from
        // cookie (preferred — server can read it) or localStorage
        // (legacy — keep for users who haven't refreshed since the cookie
        // change shipped).
        const cookieValue = readCookie(COOKIE_NAME);
        const stored = cookieValue ?? localStorage.getItem(STORAGE_KEY);
        const resolvedId =
          (initialDomainId && data.some((d) => d.id === initialDomainId)
            ? initialDomainId
            : null) ??
          (stored && data.some((d) => d.id === stored) ? stored : null) ??
          data[0]?.id ??
          null;

        setCurrentDomainId(resolvedId);
        if (resolvedId) {
          writeCookie(COOKIE_NAME, resolvedId);
          localStorage.setItem(STORAGE_KEY, resolvedId);
        }
      }

      setLoading(false);
    };

    fetchDomains();
  }, [supabase, initialDomainId]);

  const switchDomain = useCallback(
    (domainId: string) => {
      setCurrentDomainId(domainId);
      writeCookie(COOKIE_NAME, domainId);
      localStorage.setItem(STORAGE_KEY, domainId);
      // Re-run server components for the current route so SSR'd data
      // (dashboard, reports list, etc.) reloads with the new scope.
      router.refresh();
    },
    [router]
  );

  const currentDomain = useMemo(
    () => domains.find((d) => d.id === currentDomainId) ?? null,
    [domains, currentDomainId]
  );

  const value = useMemo<DomainContextValue>(
    () => ({ domains, currentDomainId, currentDomain, loading, switchDomain }),
    [domains, currentDomainId, currentDomain, loading, switchDomain]
  );

  return (
    <DomainContext.Provider value={value}>{children}</DomainContext.Provider>
  );
}

export function useDomain(): DomainContextValue {
  const context = useContext(DomainContext);
  if (context === undefined) {
    throw new Error('useDomain must be used within a DomainProvider');
  }
  return context;
}
