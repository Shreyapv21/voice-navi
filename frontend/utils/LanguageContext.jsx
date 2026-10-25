// frontend/utils/LanguageContext.jsx
import React, { createContext, useContext, useState } from "react";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  normalizeLanguageCode,
  t as translateKey
} from "./languages.js";

const LanguageContext = createContext({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => {},
  t: (key) => key
});

const STORAGE_KEY = "dhristi_selected_language";

export function LanguageProvider({ children, initialLanguage, onLanguageChanged }) {
  const [language, setLanguageState] = useState(() => {
    if (initialLanguage) return normalizeLanguageCode(initialLanguage);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return normalizeLanguageCode(saved);
    } catch {
      // ignore
    }
    return DEFAULT_LANGUAGE;
  });

  const setLanguage = (langCode) => {
    const normalized = normalizeLanguageCode(langCode);
    setLanguageState(normalized);
    try {
      localStorage.setItem(STORAGE_KEY, normalized);
    } catch {
      // ignore
    }
    if (onLanguageChanged) {
      onLanguageChanged(normalized);
    }
  };

  const t = (key, params = {}) => {
    return translateKey(key, language, params);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, supportedLanguages: SUPPORTED_LANGUAGES }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export default LanguageContext;
