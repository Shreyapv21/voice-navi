// frontend/utils/translations/index.js
import { en } from "./en.js";
import { kn } from "./kn.js";
import { hi } from "./hi.js";
import { ta } from "./ta.js";
import { te } from "./te.js";
import { ml } from "./ml.js";

export const DICTIONARIES = {
  "en-US": en,
  "kn-IN": kn,
  "hi-IN": hi,
  "ta-IN": ta,
  "te-IN": te,
  "ml-IN": ml
};

export const SUPPORTED_LANGUAGES = [
  { code: "en-US", name: "English", nativeName: "English", flag: "🇺🇸", langShort: "en" },
  { code: "kn-IN", name: "Kannada", nativeName: "ಕನ್ನಡ", flag: "🇮🇳", langShort: "kn" },
  { code: "hi-IN", name: "Hindi", nativeName: "हिन्दी", flag: "🇮🇳", langShort: "hi" },
  { code: "ta-IN", name: "Tamil", nativeName: "தமிழ்", flag: "🇮🇳", langShort: "ta" },
  { code: "te-IN", name: "Telugu", nativeName: "తెలుగు", flag: "🇮🇳", langShort: "te" },
  { code: "ml-IN", name: "Malayalam", nativeName: "മലയാളം", flag: "🇮🇳", langShort: "ml" }
];

export const DEFAULT_LANGUAGE = "en-US";

/**
 * Normalize language code to full locale (e.g., 'kn' -> 'kn-IN', 'en' -> 'en-US')
 */
export function normalizeLanguageCode(code) {
  if (!code) return DEFAULT_LANGUAGE;
  const lower = code.toLowerCase().trim();
  const match = SUPPORTED_LANGUAGES.find(
    (l) =>
      l.code.toLowerCase() === lower ||
      l.langShort.toLowerCase() === lower ||
      l.name.toLowerCase() === lower ||
      l.nativeName.toLowerCase() === lower
  );
  return match ? match.code : DEFAULT_LANGUAGE;
}

/**
 * Universal translation function.
 * Supports dot notation for nested keys (e.g. 'messages.help') and parameter interpolation ({varName}).
 * Always falls back gracefully to English without breaking or showing raw keys.
 */
export function t(key, langCode = DEFAULT_LANGUAGE, params = {}) {
  const normLang = normalizeLanguageCode(langCode);
  const targetDict = DICTIONARIES[normLang] || DICTIONARIES[DEFAULT_LANGUAGE];
  const fallbackDict = DICTIONARIES[DEFAULT_LANGUAGE];

  let value = undefined;

  // Check nested key path if key contains '.'
  if (key.includes(".")) {
    const parts = key.split(".");
    let currTarget = targetDict;
    let currFallback = fallbackDict;
    for (const part of parts) {
      currTarget = currTarget ? currTarget[part] : undefined;
      currFallback = currFallback ? currFallback[part] : undefined;
    }
    value = currTarget !== undefined ? currTarget : currFallback;
  } else {
    value = targetDict[key] !== undefined ? targetDict[key] : fallbackDict[key];
  }

  if (typeof value !== "string") {
    // If key not found in root, check in messages sub-dictionary
    if (targetDict.messages?.[key] !== undefined) {
      value = targetDict.messages[key];
    } else if (fallbackDict.messages?.[key] !== undefined) {
      value = fallbackDict.messages[key];
    } else {
      value = key; // fallback to key itself
    }
  }

  // Parameter interpolation: replace {param} with params[param]
  if (params && typeof params === "object") {
    for (const [pKey, pVal] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${pKey}\\}`, "g"), pVal != null ? String(pVal) : "");
    }
  }

  return value;
}
