'use client';

import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { useMemo, useState, useRef, useEffect } from 'react';

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
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-gray-300 hover:bg-white/10 hover:text-white"
        aria-label="Language"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
        </svg>
        <span className="hidden sm:inline">Language: {currentLabel}</span>
        <span className="sm:hidden">{currentLabel}</span>
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded bg-white py-1 shadow-lg border border-gray-200">
          <div className="px-3 py-1.5 text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
            Language
          </div>
          <button
            onClick={() => selectLanguage('zh')}
            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
              currentLang === 'zh' ? 'bg-gray-50 font-semibold text-[#232f3e]' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span>中文</span>
            {currentLang === 'zh' && <span className="text-[#ff9900]">✓</span>}
          </button>
          <button
            onClick={() => selectLanguage('en')}
            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
              currentLang === 'en' ? 'bg-gray-50 font-semibold text-[#232f3e]' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span>English</span>
            {currentLang === 'en' && <span className="text-[#ff9900]">✓</span>}
          </button>
        </div>
      )}
    </div>
  );
}
