// frontend/utils/languages.js
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  normalizeLanguageCode,
  DICTIONARIES,
  t
} from "./translations/index.js";

export {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  normalizeLanguageCode,
  DICTIONARIES,
  t
};

// Core UI and Spoken Phrases Dictionary
export const TRANSLATIONS = {
  // Common Object Labels
  objects: {
    person: {
      "en-US": "person",
      "hi-IN": "व्यक्ति",
      "kn-IN": "ವ್ಯಕ್ತಿ",
      "ta-IN": "நபர்",
      "te-IN": "వ్యక్తి",
      "ml-IN": "വ്യക്തി"
    },
    car: {
      "en-US": "car",
      "hi-IN": "गाड़ी",
      "kn-IN": "ಕಾರು",
      "ta-IN": "கார்",
      "te-IN": "కారు",
      "ml-IN": "കാർ"
    },
    chair: {
      "en-US": "chair",
      "hi-IN": "कुर्सी",
      "kn-IN": "ಕುರ್ಚಿ",
      "ta-IN": "நாற்காலி",
      "te-IN": "కుర్చీ",
      "ml-IN": "കസേര"
    },
    bottle: {
      "en-US": "bottle",
      "hi-IN": "बोतल",
      "kn-IN": "ಬಾಟಲಿ",
      "ta-IN": "பாட்டில்",
      "te-IN": "సీసా",
      "ml-IN": "കുപ്പി"
    },
    bicycle: {
      "en-US": "bicycle",
      "hi-IN": "साइकिल",
      "kn-IN": "ಸೈಕಲ್",
      "ta-IN": "சைக்கிள்",
      "te-IN": "సైకిల్",
      "ml-IN": "സൈക്കിൾ"
    },
    dog: {
      "en-US": "dog",
      "hi-IN": "कुत्ता",
      "kn-IN": "ನಾಯಿ",
      "ta-IN": "நாய்",
      "te-IN": "కుక్క",
      "ml-IN": "നായ"
    },
    cat: {
      "en-US": "cat",
      "hi-IN": "बिल्ली",
      "kn-IN": "ಬೆಕ್ಕು",
      "ta-IN": "பூனை",
      "te-IN": "పిల్లి",
      "ml-IN": "പൂച്ച"
    },
    table: {
      "en-US": "table",
      "hi-IN": "मेज़",
      "kn-IN": "ಮೇಜು",
      "ta-IN": "மேசை",
      "te-IN": "బల్ల",
      "ml-IN": "മേശ"
    },
    cell_phone: {
      "en-US": "cell phone",
      "hi-IN": "मोबाइल फोन",
      "kn-IN": "ಮೊಬೈಲ್ ಫೋನ್",
      "ta-IN": "கைப்பேசி",
      "te-IN": "సెల్ ఫోన్",
      "ml-IN": "മൊബൈൽ ഫോൺ"
    },
    laptop: {
      "en-US": "laptop",
      "hi-IN": "लैपटॉप",
      "kn-IN": "ಲ್ಯಾಪ್‌ಟಾಪ್",
      "ta-IN": "மடிக்கணினி",
      "te-IN": "ల్యాప్‌టాప్",
      "ml-IN": "ലാപ്‌ടോപ്പ്"
    },
    book: {
      "en-US": "book",
      "hi-IN": "किताब",
      "kn-IN": "ಪುಸ್ತಕ",
      "ta-IN": "புத்தகம்",
      "te-IN": "పుస్తకం",
      "ml-IN": "പുസ്തകം"
    },
    door: {
      "en-US": "door",
      "hi-IN": "दरवाज़ा",
      "kn-IN": "ಬಾಗಿಲು",
      "ta-IN": "கதவு",
      "te-IN": "తలుపు",
      "ml-IN": "വാതിൽ"
    },
    stair: {
      "en-US": "stairs",
      "hi-IN": "सीढ़ियाँ",
      "kn-IN": "ಮೆಟ್ಟಿಲುಗಳು",
      "ta-IN": "படிகள்",
      "te-IN": "మెట్లు",
      "ml-IN": "പടികൾ"
    },
    stairs: {
      "en-US": "stairs",
      "hi-IN": "सीढ़ियाँ",
      "kn-IN": "ಮೆಟ್ಟಿಲುಗಳು",
      "ta-IN": "படிகள்",
      "te-IN": "మెట్లు",
      "ml-IN": "പടികൾ"
    },
    elevator: {
      "en-US": "elevator",
      "hi-IN": "लिफ्ट",
      "kn-IN": "ಲಿಫ್ಟ್",
      "ta-IN": "மின்தூக்கி",
      "te-IN": "లిఫ్ట్",
      "ml-IN": "ലിഫ്റ്റ്"
    },
    obstacle: {
      "en-US": "obstacle",
      "hi-IN": "बाधा",
      "kn-IN": "ಅಡಚಣೆ",
      "ta-IN": "தடை",
      "te-IN": "అడ్డంకి",
      "ml-IN": "തടസ്സം"
    }
  },

  // Directions
  directions: {
    "in front of you": {
      "en-US": "in front of you",
      "hi-IN": "आपके सामने",
      "kn-IN": "ನಿಮ್ಮ ಮುಂದೆ",
      "ta-IN": "உங்கள் முன்னால்",
      "te-IN": "మీ ఎదురుగా",
      "ml-IN": "നിങ്ങളുടെ മുന്നിൽ"
    },
    "on your left": {
      "en-US": "on your left",
      "hi-IN": "आपके बाईं ओर",
      "kn-IN": "ನಿಮ್ಮ ಎಡಭಾಗದಲ್ಲಿ",
      "ta-IN": "உங்கள் இடதுபுறத்தில்",
      "te-IN": "మీ ఎడమ వైపున",
      "ml-IN": "നിങ്ങളുടെ ഇടതുവശത്ത്"
    },
    "on your right": {
      "en-US": "on your right",
      "hi-IN": "आपके दाईं ओर",
      "kn-IN": "ನಿಮ್ಮ ಬಲಭಾಗದಲ್ಲಿ",
      "ta-IN": "உங்கள் வலதுபுறத்தில்",
      "te-IN": "మీ కుడి వైపున",
      "ml-IN": "നിങ്ങളുടെ വലതുവശത്ത്"
    }
  }
};

/**
 * Get translated message by key with optional placeholders.
 * Fallbacks to English if key or language is missing.
 */
export function getMessage(key, langCode = DEFAULT_LANGUAGE, params = {}) {
  return t(`messages.${key}`, langCode, params);
}

/**
 * Translate an object label to target language.
 */
export function translateObjectLabel(label, langCode = DEFAULT_LANGUAGE) {
  if (!label) return "";
  const normLang = normalizeLanguageCode(langCode);
  const normalized = label.toLowerCase().replace(/\s+/g, "_");
  if (TRANSLATIONS.objects[normalized]?.[normLang]) {
    return TRANSLATIONS.objects[normalized][normLang];
  }
  if (TRANSLATIONS.objects[label.toLowerCase()]?.[normLang]) {
    return TRANSLATIONS.objects[label.toLowerCase()][normLang];
  }
  return label;
}

/**
 * Translate a direction phrase to target language.
 */
export function translateDirection(direction, langCode = DEFAULT_LANGUAGE) {
  if (!direction) return "";
  const normLang = normalizeLanguageCode(langCode);
  const key = direction.toLowerCase().trim();
  if (TRANSLATIONS.directions[key]?.[normLang]) {
    return TRANSLATIONS.directions[key][normLang];
  }
  return direction;
}

/**
 * Format a detection summary in target language.
 */
export function formatDetectionSentence(item, langCode = DEFAULT_LANGUAGE) {
  const normLang = normalizeLanguageCode(langCode);
  const translatedLabel = translateObjectLabel(item.class_name, normLang);
  const translatedDir = translateDirection(item.direction, normLang);

  if (normLang.startsWith("hi")) {
    return item.distance
      ? `${translatedDir} लगभग ${item.distance} मीटर पर ${translatedLabel}`
      : `${translatedDir} ${translatedLabel}`;
  }
  if (normLang.startsWith("kn")) {
    return item.distance
      ? `${translatedDir} ಸುಮಾರು ${item.distance} ಮೀಟರ್ ದೂರದಲ್ಲಿ ${translatedLabel}`
      : `${translatedDir} ${translatedLabel}`;
  }
  if (normLang.startsWith("ta")) {
    return item.distance
      ? `${translatedDir} சுமார் ${item.distance} மீட்டர் தொலைவில் ${translatedLabel}`
      : `${translatedDir} ${translatedLabel}`;
  }
  if (normLang.startsWith("te")) {
    return item.distance
      ? `${translatedDir} దాదాపు ${item.distance} మీటర్ల దూరంలో ${translatedLabel}`
      : `${translatedDir} ${translatedLabel}`;
  }
  if (normLang.startsWith("ml")) {
    return item.distance
      ? `${translatedDir} ഏകദേശം ${item.distance} മീറ്റർ അകലെ ${translatedLabel}`
      : `${translatedDir} ${translatedLabel}`;
  }

  // Default English
  return item.distance
    ? `${translatedLabel} approximately ${item.distance} meters ${translatedDir}`
    : `${translatedLabel} ${translatedDir}`;
}

/**
 * Format distance into localized human-friendly string.
 */
export function formatLocalizedDistance(meters, langCode = DEFAULT_LANGUAGE) {
  const norm = normalizeLanguageCode(langCode).split("-")[0];
  const m = Math.round(Number(meters) || 0);

  if (m >= 1000) {
    const km = (m / 1000).toFixed(1);
    switch (norm) {
      case "kn": return `${km} ಕಿಲೋಮೀಟರ್`;
      case "ml": return `${km} കിലോമീറ്റർ`;
      case "hi": return `${km} किलोमीटर`;
      case "ta": return `${km} கிலோமீட்டர்`;
      case "te": return `${km} కిలోమీటర్లు`;
      default: return `${km} kilometers`;
    }
  }

  switch (norm) {
    case "kn": return `${m} ಮೀಟರ್`;
    case "ml": return `${m} മീറ്റർ`;
    case "hi": return `${m} मीटर`;
    case "ta": return `${m} மீட்டர்`;
    case "te": return `${m} మీటర్లు`;
    default: return `${m} meters`;
  }
}

/**
 * Format duration into localized human-friendly string.
 */
export function formatLocalizedDuration(durationStr, langCode = DEFAULT_LANGUAGE) {
  const norm = normalizeLanguageCode(langCode).split("-")[0];
  let seconds = 0;
  if (typeof durationStr === "string") {
    seconds = parseInt(durationStr.replace("s", ""), 10) || 0;
  } else if (typeof durationStr === "number") {
    seconds = durationStr;
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 1) {
    switch (norm) {
      case "kn": return "ಒಂದು ನಿಮಿಷಕ್ಕಿಂತ ಕಡಿಮೆ";
      case "ml": return "ഒരു മിനിറ്റിൽ താഴെ";
      case "hi": return "एक मिनट से कम";
      case "ta": return "ஒரு நிமிடத்திற்கும் குறைவு";
      case "te": return "ఒక నిమిషం కంటే తక్కువ";
      default: return "less than a minute";
    }
  }

  if (minutes === 1) {
    switch (norm) {
      case "kn": return "1 ನಿಮಿಷ";
      case "ml": return "1 മിനിറ്റ്";
      case "hi": return "1 मिनट";
      case "ta": return "1 நிமிடம்";
      case "te": return "1 నిమిషం";
      default: return "1 minute";
    }
  }

  if (minutes < 60) {
    switch (norm) {
      case "kn": return `${minutes} ನಿಮಿಷಗಳು`;
      case "ml": return `${minutes} മിനിറ്റ്`;
      case "hi": return `${minutes} मिनट`;
      case "ta": return `${minutes} நிமிடங்கள்`;
      case "te": return `${minutes} నిమిషాలు`;
      default: return `${minutes} minutes`;
    }
  }

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  switch (norm) {
    case "kn": return `${hours} ಗಂಟೆ ${remMinutes} ನಿಮಿಷಗಳು`;
    case "ml": return `${hours} മണിക്കൂർ ${remMinutes} മിനിറ്റ്`;
    case "hi": return `${hours} घंटे ${remMinutes} मिनट`;
    case "ta": return `${hours} மணி ${remMinutes} நிமிடங்கள்`;
    case "te": return `${hours} గంటలు ${remMinutes} నిమిషాలు`;
    default: return `${hours} hour${hours > 1 ? "s" : ""} ${remMinutes} minute${remMinutes > 1 ? "s" : ""}`;
  }
}

/**
 * Translates an English route step instruction into target language if needed,
 * preserving street/place names cleanly without English grammatical glue words.
 */
export function translateInstructionText(instruction, langCode = DEFAULT_LANGUAGE, destinationName = "") {
  if (!instruction || typeof instruction !== "string") return "";
  const norm = normalizeLanguageCode(langCode).split("-")[0];
  if (norm === "en") return instruction;

  const text = instruction.trim();

  // Arrival patterns
  if (/you have arrived|you will arrive|arrived at/i.test(text)) {
    const dest = destinationName || "";
    switch (norm) {
      case "kn": return dest ? `ನೀವು ನಿಮ್ಮ ಗಮ್ಯಸ್ಥಾನವಾದ ${dest} ತಲುಪಿದ್ದೀರಿ.` : "ನೀವು ನಿಮ್ಮ ಗಮ್ಯಸ್ಥಾನವನ್ನು ತಲುಪಿದ್ದೀರಿ.";
      case "ml": return dest ? `നിങ്ങൾ ${dest} എന്ന ലക്ഷ്യസ്ഥാനത്ത് എത്തിച്ചേർന്നു.` : "നിങ്ങൾ ലക്ഷ്യസ്ഥാനത്ത് എത്തിച്ചേർന്നു.";
      case "hi": return dest ? `आप अपने गंतव्य ${dest} पर पहुँच गए हैं।` : "आप अपने गंतव्य पर पहुँच गए हैं।";
      case "ta": return dest ? `நீங்கள் ${dest} என்ற உங்கள் சேருமிடத்தை அடைந்துவிட்டீர்கள்.` : "நீங்கள் உங்கள் சேருமிடத்தை அடைந்துவிட்டீர்கள்.";
      case "te": return dest ? `మీరు మీ గమ్యస్థానమైన ${dest} చేరుకున్నారు.` : "మీరు మీ గమ్యాన్ని చేరుకున్నారు.";
    }
  }

  // Turn patterns: e.g. "Turn left onto Sayyaji Rao Road", "Turn slight right onto ..."
  const turnMatch = text.match(/turn\s+(sharp\s+|slight\s+)?(left|right)(\s+onto\s+(.*))?/i);
  if (turnMatch) {
    const modifier = (turnMatch[1] || "").trim().toLowerCase();
    const dir = turnMatch[2].toLowerCase();
    const road = (turnMatch[4] || "").trim();

    const isLeft = dir === "left";
    const isSharp = modifier === "sharp";
    const isSlight = modifier === "slight";

    switch (norm) {
      case "kn": {
        const turnWord = isSharp ? (isLeft ? "ತೀವ್ರವಾಗಿ ಎಡಕ್ಕೆ" : "ತೀವ್ರವಾಗಿ ಬಲಕ್ಕೆ")
          : isSlight ? (isLeft ? "ಸ್ವಲ್ಪ ಎಡಕ್ಕೆ" : "ಸ್ವಲ್ಪ ಬಲಕ್ಕೆ")
          : (isLeft ? "ಎಡಕ್ಕೆ" : "ಬಲಕ್ಕೆ");
        return road ? `${road} ನಲ್ಲಿ ${turnWord} ತಿರುಗಿ.` : `${turnWord} ತಿರುಗಿ.`;
      }
      case "ml": {
        const turnWord = isSharp ? (isLeft ? "കൂടുതൽ ഇടത്തോട്ട്" : "കൂടുതൽ വലത്തോട്ട്")
          : isSlight ? (isLeft ? "ചെറുതായി ഇടത്തോട്ട്" : "ചെറുതായി വലത്തോട്ട്")
          : (isLeft ? "ഇടത്തോട്ട്" : "വലത്തോട്ട്");
        return road ? `${road} ലേക്ക് ${turnWord} തിരിയുക.` : `${turnWord} തിരിയുക.`;
      }
      case "hi": {
        const turnWord = isSharp ? (isLeft ? "तेज़ बाएं" : "तेज़ दाएं")
          : isSlight ? (isLeft ? "हल्का बाएं" : "हल्का दाएं")
          : (isLeft ? "बाएं" : "दाएं");
        return road ? `${road} पर ${turnWord} मुड़ें।` : `${turnWord} मुड़ें।`;
      }
      case "ta": {
        const turnWord = isSharp ? (isLeft ? "கூர்மையாக இடதுபுறம்" : "கூர்மையாக வலதுபுறம்")
          : isSlight ? (isLeft ? "சற்று இடதுபுறம்" : "சற்று வலதுபுறம்")
          : (isLeft ? "இடதுபுறம்" : "வலதுபுறம்");
        return road ? `${road} இல் ${turnWord} திரும்பவும்.` : `${turnWord} திரும்பவும்.`;
      }
      case "te": {
        const turnWord = isSharp ? (isLeft ? "తీవ్రంగా ఎడమవైపు" : "తీవ్రంగా కుడివైపు")
          : isSlight ? (isLeft ? "కొద్దిగా ఎడమవైపు" : "కొద్దిగా కుడివైపు")
          : (isLeft ? "ఎడమవైపు" : "కుడివైపు");
        return road ? `${road} పై ${turnWord} తిరగండి.` : `${turnWord} తిరగండి.`;
      }
    }
  }

  // Head straight / Depart patterns
  const headMatch = text.match(/(head\s+(straight\s+ahead|north|south|east|west|straight)?|walk\s+straight|depart)(\s+on(to)?\s+(.*))?/i);
  if (headMatch) {
    const road = (headMatch[5] || "").trim();
    switch (norm) {
      case "kn": return road ? `${road} ನಲ್ಲಿ ನೇರವಾಗಿ ಮುಂದುವರಿಯಿರಿ.` : "ನೇರವಾಗಿ ಮುಂದುವರಿಯಿರಿ.";
      case "ml": return road ? `${road} ലൂടെ നേരെ നടക്കുക.` : "നേരെ നടക്കുക.";
      case "hi": return road ? `${road} पर सीधे आगे बढ़ें।` : "सीधे आगे बढ़ें।";
      case "ta": return road ? `${road} இல் நேராக செல்லவும்.` : "நேராக செல்லவும்.";
      case "te": return road ? `${road} లో నేరుగా ముందుకు సాగండి.` : "నేరుగా ముందుకు సాగండి.";
    }
  }

  // Continue onto pattern
  const contMatch = text.match(/continue(\s+straight)?(\s+onto\s+(.*))?/i);
  if (contMatch) {
    const road = (contMatch[3] || "").trim();
    switch (norm) {
      case "kn": return road ? `${road} ನಲ್ಲಿ ಮುಂದುವರಿಯಿರಿ.` : "ಮುಂದೆ ಸಾಗಿರಿ.";
      case "ml": return road ? `${road} ലൂടെ യാത്ര തുടരുക.` : "നേരെ തുടരുക.";
      case "hi": return road ? `${road} पर आगे बढ़ते रहें।` : "सीधे आगे बढ़ते रहें।";
      case "ta": return road ? `${road} இல் தொடரவும்.` : "தொடர்ந்து செல்லவும்.";
      case "te": return road ? `${road} లో కొనసాగించండి.` : "ముందుకు కొనసాగండి.";
    }
  }

  return instruction;
}

