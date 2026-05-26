import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from '@/locales/zh';
import en from '@/locales/en';

const LANGUAGE_STORAGE_KEY = 'radar-report-language';

function getStoredLanguage(): string {
  if (typeof window === 'undefined') return 'zh';
  return localStorage.getItem(LANGUAGE_STORAGE_KEY) || 'zh';
}

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: getStoredLanguage(),
  fallbackLng: 'zh',
  interpolation: {
    escapeValue: false,
    // Project convention: locale strings use single-brace placeholders
    // (e.g. "Published {time}", "{type} · {moduleCount} modules"). Override
    // i18next's default {{var}} so existing locale files render correctly.
    // Symptom that surfaced this: dashboard latest-report strip showed
    // literal "{time}" / "{moduleCount}" because i18next's default never
    // matched the single braces.
    prefix: '{',
    suffix: '}',
  },
});

// Persist language changes to localStorage
i18n.on('languageChanged', (lng: string) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  }
});

export default i18n;
export { LANGUAGE_STORAGE_KEY };
