'use client';

import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { useMemo, useState, useRef, useEffect } from 'react';
import { Globe, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Language switcher, living in the top navbar.
 *
 * Design: `.kiro/steering/ui-design-system.md` §10 keep-list — UX preserved,
 * colors migrated from #232f3e / #ff9900 hex hardcode to design tokens.
 */

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLang = i18n.language;
  const currentLabel = currentLang === 'zh' ? '中文' : 'English';

  const selectLanguage = async (lang: 'zh' | 'en') => {
    if (lang === currentLang) {
      setOpen(false);
      return;
    }

    await i18n.changeLanguage(lang);
    if (user) {
      await supabase
        .from('profiles')
        .update({ language_preference: lang })
        .eq('id', user.id);
    }
    // Reload to re-fetch translated content across the app
    window.location.reload();
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-foreground-muted transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label="Language"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Globe className="h-4 w-4" strokeWidth={1.75} />
        <span className="hidden sm:inline">{currentLabel}</span>
        <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-40 rounded-md border border-border bg-popover py-1 shadow-md"
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
            Language
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => selectLanguage('zh')}
            className={cn(
              'flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors',
              currentLang === 'zh'
                ? 'bg-muted font-medium text-foreground'
                : 'text-foreground-muted hover:bg-muted hover:text-foreground'
            )}
          >
            <span>中文</span>
            {currentLang === 'zh' && (
              <Check className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
            )}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => selectLanguage('en')}
            className={cn(
              'flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors',
              currentLang === 'en'
                ? 'bg-muted font-medium text-foreground'
                : 'text-foreground-muted hover:bg-muted hover:text-foreground'
            )}
          >
            <span>English</span>
            {currentLang === 'en' && (
              <Check className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
