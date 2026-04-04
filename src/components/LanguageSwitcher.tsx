'use client';

import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { useMemo } from 'react';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const currentLang = i18n.language;

  const toggleLanguage = async () => {
    const newLang = currentLang === 'zh' ? 'en' : 'zh';
    await i18n.changeLanguage(newLang);

    // Persist to profiles table if user is logged in
    if (user) {
      await supabase
        .from('profiles')
        .update({ language_preference: newLang })
        .eq('id', user.id);
    }
  };

  return (
    <button
      onClick={toggleLanguage}
      className="hidden rounded px-2 py-1 text-xs text-gray-300 hover:bg-white/10 hover:text-white sm:block"
      aria-label={currentLang === 'zh' ? 'Switch to English' : '切换到中文'}
    >
      {currentLang === 'zh' ? '中文/EN' : 'EN/中文'}
    </button>
  );
}
