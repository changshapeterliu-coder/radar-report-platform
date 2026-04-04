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

export const DomainContext = createContext<DomainContextValue | undefined>(
  undefined
);

export function DomainProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);

  const [domains, setDomains] = useState<Domain[]>([]);
  const [currentDomainId, setCurrentDomainId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDomains = async () => {
      const { data, error } = await supabase
        .from('domains')
        .select('*')
        .order('created_at', { ascending: true });

      if (!error && data) {
        setDomains(data as Domain[]);

        // Restore from localStorage or default to first domain
        const stored = localStorage.getItem(STORAGE_KEY);
        const validStored = stored && data.some((d) => d.id === stored);
        setCurrentDomainId(validStored ? stored : data[0]?.id ?? null);
      }

      setLoading(false);
    };

    fetchDomains();
  }, [supabase]);

  const switchDomain = useCallback((domainId: string) => {
    setCurrentDomainId(domainId);
    localStorage.setItem(STORAGE_KEY, domainId);
  }, []);

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
