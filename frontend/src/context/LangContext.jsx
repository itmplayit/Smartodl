import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { translate } from '../utils/i18n';

const KEY = 'smartodl-lang';
const LangContext = createContext({ lang: 'en', setLang: () => {}, t: (k, f) => f || k });

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem(KEY) === 'hi' ? 'hi' : 'en'; } catch { return 'en'; }
  });

  useEffect(() => { document.documentElement.lang = lang === 'hi' ? 'hi' : 'en'; }, [lang]);

  const setLang = useCallback((next) => {
    setLangState(next);
    try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  }, []);

  const t = useCallback((key, fallback) => translate(lang, key, fallback), [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export const useLang = () => useContext(LangContext);
