// frontend/utils/voiceNavigation/voiceCommandParser.js

/**
 * Normalizes voice transcript preserving international Unicode alphabets (Kannada, Hindi, Tamil, Telugu, etc.)
 */
export function normalizeTranscript(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if normalized text contains any of the search phrases.
 */
function containsAny(text, phrases) {
  return phrases.some((p) => {
    if (p.includes(" ")) {
      return text.includes(p);
    }
    // Word boundary match for single words
    const regex = new RegExp(`(^|\\s)${p}(\\s|$)`, "u");
    return regex.test(text);
  });
}

/**
 * Parse navigation commands across English, Hindi, Kannada, Tamil, and Telugu.
 */
export function parseNavigationUtterance(raw) {
  const original = (raw || "").trim();
  const text = normalizeTranscript(original);
  if (!text) return { type: "UNKNOWN" };

  // 1. LANGUAGE SWITCHING COMMANDS
  if (
    containsAny(text, [
      "kannada",
      "change to kannada",
      "speak in kannada",
      "switch to kannada",
      "ಕನ್ನಡ",
      "ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡಿ",
      "ಕನ್ನಡಕ್ಕೆ ಬದಲಿಸಿ",
      "ಕನ್ನಡ ಭಾಷೆ"
    ])
  ) {
    return { type: "CHANGE_LANGUAGE", language: "kn-IN", languageName: "Kannada" };
  }

  if (
    containsAny(text, [
      "hindi",
      "change to hindi",
      "speak in hindi",
      "switch to hindi",
      "हिंदी",
      "हिन्दी",
      "हिंदी में बोलो",
      "हिंदी में बात करो",
      "हिंदी भाषा"
    ])
  ) {
    return { type: "CHANGE_LANGUAGE", language: "hi-IN", languageName: "Hindi" };
  }

  if (
    containsAny(text, [
      "tamil",
      "change to tamil",
      "speak in tamil",
      "switch to tamil",
      "தமிழ்",
      "தமிழில் பேசு",
      "தமிழுக்கு மாற்று",
      "தமிழ் மொழி"
    ])
  ) {
    return { type: "CHANGE_LANGUAGE", language: "ta-IN", languageName: "Tamil" };
  }

  if (
    containsAny(text, [
      "telugu",
      "change to telugu",
      "speak in telugu",
      "switch to telugu",
      "తెలుగు",
      "తెలుగులో మాట్లాడండి",
      "తెలుగులోకి మార్చండి",
      "తెలుగు భాష"
    ])
  ) {
    return { type: "CHANGE_LANGUAGE", language: "te-IN", languageName: "Telugu" };
  }

  if (
    containsAny(text, [
      "english",
      "change to english",
      "speak in english",
      "switch to english",
      "अंग्रेजी",
      "ಇಂಗ್ಲಿಷ್",
      "ஆங்கிலம்",
      "ఇంగ్లీష్"
    ])
  ) {
    return { type: "CHANGE_LANGUAGE", language: "en-US", languageName: "English" };
  }

  // 2. HELP / WHAT CAN I SAY
  if (
    containsAny(text, [
      "help",
      "what can i say",
      "voice commands",
      "commands",
      "मदद",
      "सहायता",
      "क्या कह सकता हूँ",
      "सಹಾಯ",
      "ಸಹಾಯ",
      "ಏನು ಹೇಳಬಹುದು",
      "ಆಜ್ಞೆಗಳು",
      "உதவி",
      "என்ன சொல்லலாம்",
      "கட்டளைகள்",
      "సహాయం",
      "నేనేమి చెప్పగలను",
      "ఆదేశాలు"
    ])
  ) {
    return { type: "HELP" };
  }

  // 2.1 REPEAT ONBOARDING / INTRODUCTION
  if (
    containsAny(text, [
      "repeat onboarding",
      "repeat introduction",
      "repeat intro",
      "say onboarding",
      "welcome message",
      "how does this work",
      "introduction",
      "ಪರಿಚಯ ಮತ್ತೆ ಹೇಳಿ",
      "ಪರಿಚಯ",
      "ಸ್ವಾಗತ ಸಂದೇಶ",
      "परिचय दोहराएं",
      "परिचय",
      "प्रस्तावना",
      "அறிமுகத்தை மீண்டும் சொல்",
      "அறிமுகம்",
      "పరిచయం మళ్లీ చెప్పండి",
      "పరిచయం"
    ])
  ) {
    return { type: "REPEAT_ONBOARDING" };
  }

  // 2.2 SLAM EXPLORATION COMMANDS
  if (
    containsAny(text, [
      "start slam exploration",
      "start slam",
      "begin slam",
      "start visual slam",
      "start indoor exploration",
      "begin indoor exploration",
      "explore building",
      "slam exploration",
      "start visual odometry",
      "visual slam",
      "ಸ್ಲ್ಯಾಮ್ ಪ್ರಾರಂಭಿಸಿ",
      "ಒಳಾಂಗಣ ಅನ್ವೇಷಣೆ ಪ್ರಾರಂಭಿಸಿ",
      "ಸ್ಲ್ಯಾಮ್ ಶುರು ಮಾಡು",
      "ಅನ್ವೇಷಣೆ ಪ್ರಾರಂಭಿಸಿ",
      "ಸ್ಲ್ಯಾಮ್",
      "स्लैम शुरू करो",
      "स्लैम शुरू",
      "इनडोर खोज शुरू",
      "विजुअल स्लैम",
      "स्लैम नेविगेशन",
      "स्लैम",
      "ஸ்லாம் தொடங்கு",
      "உள்ளரங்க ஆய்வு தொடங்கு",
      "ஸ்லாம் ஆரம்பி",
      "ஸ்லாம்",
      "స్లామ్ ప్రారంభించండి",
      "ఇండోర్ అన్వేషణ ప్రారంభించండి",
      "స్లామ్ మొదలుపెట్టు",
      "స్లామ్"
    ])
  ) {
    return { type: "START_SLAM" };
  }

  if (
    containsAny(text, [
      "stop slam exploration",
      "stop slam",
      "end slam",
      "stop exploration",
      "close slam",
      "quit slam",
      "ಸ್ಲ್ಯಾಮ್ ನಿಲ್ಲಿಸಿ",
      "ಅನ್ವೇಷಣೆ ನಿಲ್ಲಿಸಿ",
      "ಸ್ಲ್ಯಾಮ್ ರದ್ದುಮಾಡಿ",
      "ಸ್ಲ್ಯಾಮ್ ಮುಕ್ತಾಯ",
      "स्लैम बंद करो",
      "स्लैम रोको",
      "खोज बंद करो",
      "ஸ்லாம் நிறுத்து",
      "ஆய்வை நிறுத்து",
      "స్లామ్ ఆపండి",
      "అన్వేషణ ఆపండి"
    ])
  ) {
    return { type: "STOP_SLAM" };
  }

  if (
    containsAny(text, [
      "pause slam",
      "pause exploration",
      "ಸ್ಲ್ಯಾಮ್ ವಿರಾಮಗೊಳಿಸಿ",
      "ಸ್ಲ್ಯಾಮ್ ವಿರಾಮ",
      "स्लैम रोकें",
      "स्लैम पॉज़",
      "ஸ்லாம் இடைநிறுத்து",
      "స్లామ్ పాజ్ చేయండి",
      "స్లామ్ పాజ్"
    ])
  ) {
    return { type: "PAUSE_SLAM" };
  }

  if (
    containsAny(text, [
      "resume slam",
      "resume exploration",
      "continue slam",
      "ಸ್ಲ್ಯಾಮ್ ಮುಂದುವರಿಸಿ",
      "ಸ್ಲ್ಯಾಮ್ ಪುನರಾರಂಭಿಸಿ",
      "स्लैम जारी रखें",
      "स्लैम फिर से शुरू",
      "ஸ்லாம் தொடரவும்",
      "స్లామ్ కొనసాగించండి"
    ])
  ) {
    return { type: "RESUME_SLAM" };
  }

  // 2.3 LIVE DETECTION & CAMERA CONTROL
  if (
    containsAny(text, [
      "start live detection",
      "start detection",
      "start camera",
      "open camera",
      "turn on camera",
      "enable camera",
      "activate camera",
      "ಕ್ಯಾಮೆರಾ ಪ್ರಾರಂಭಿಸಿ",
      "ಲೈವ್ ಪತ್ತೆ ಪ್ರಾರಂಭಿಸಿ",
      "ಕ್ಯಾಮೆರಾ ಆನ್ ಮಾಡಿ",
      "ಕ್ಯಾಮೆರಾ ತೆರೆಯಿರಿ",
      "ಕ್ಯಾಮೆರಾ",
      "कैमरा शुरू करो",
      "लाइव डिटेक्शन शुरू करो",
      "कैमरा चालू करो",
      "कैमरा खोलो",
      "कैमरा",
      "கேமராவைத் தொடங்கு",
      "நேரலை கண்டறிதலைத் தொடங்கு",
      "கேமராவைத் திற",
      "கேமரா",
      "కెమెరా ప్రారంభించండి",
      "లైవ్ గుర్తింపు ప్రారంభించండి",
      "కెమెరా ఆన్ చేయండి",
      "కెమెరా"
    ])
  ) {
    return { type: "START_LIVE_DETECTION" };
  }

  if (
    containsAny(text, [
      "stop live detection",
      "stop detection",
      "stop camera",
      "close camera",
      "turn off camera",
      "disable camera",
      "ಕ್ಯಾಮೆರಾ ನಿಲ್ಲಿಸಿ",
      "ಕ್ಯಾಮೆರಾ ಆಫ್ ಮಾಡಿ",
      "ಕ್ಯಾಮೆರಾ ಮುಚ್ಚಿ",
      "कैमरा बंद करो",
      "लाइव डिटेक्शन बंद करो",
      "கேமராவை நிறுத்து",
      "கேமராவை மூடு",
      "కెమెరా ఆపండి",
      "కెమెరా ఆఫ్ చేయండి"
    ])
  ) {
    return { type: "STOP_LIVE_DETECTION" };
  }

  // 2.4 OPEN INDOOR / OUTDOOR NAVIGATION MODES
  if (
    containsAny(text, [
      "open indoor navigation",
      "switch to indoor navigation",
      "switch to indoor",
      "go to indoor mode",
      "indoor mode",
      "open indoor",
      "show indoor map",
      "show indoor",
      "ಒಳಾಂಗಣ ಮೋಡ್",
      "ಒಳಾಂಗಣ ಸಂಚಾರ ತೆರೆಯಿರಿ",
      "ಒಳಾಂಗಣ ನಕ್ಷೆ ತೋರಿಸಿ",
      "इनडोर मोड",
      "इनडोर नेविगेशन खोलो",
      "इनडोर नक्शा दिखाओ",
      "உள்ளரங்க பயன்முறை",
      "உள்ளரங்க வழிசெலுத்தலைத் திற",
      "ఇండోర్ మోడ్",
      "ఇండోర్ నావిగేషన్ తెరవండి"
    ])
  ) {
    return { type: "OPEN_INDOOR" };
  }

  if (
    containsAny(text, [
      "open outdoor navigation",
      "switch to outdoor navigation",
      "switch to outdoor",
      "go to outdoor mode",
      "outdoor mode",
      "open outdoor",
      "show outdoor map",
      "show outdoor",
      "show map",
      "walking map",
      "gps map",
      "outdoor navigation",
      "ಹೊರಾಂಗಣ ಮೋಡ್",
      "ಹೊರಾಂಗಣ ಸಂಚಾರ ತೆರೆಯಿರಿ",
      "ಹೊರಾಂಗಣ ನಕ್ಷೆ ತೋರಿಸಿ",
      "ನಕ್ಷೆ ತೋರಿಸಿ",
      "आउटडोर मोड",
      "आउटडोर नेविगेशन खोलो",
      "आउटडोर नक्शा दिखाओ",
      "नक्शा दिखाओ",
      "வெளிப்புற பயன்முறை",
      "வெளிப்புற வரைபடம் காட்டு",
      "అవుట్‌డోర్ మోడ్",
      "అవుట్‌డోర్ నావిగేషన్ తెరవండి",
      "మ్యాప్ చూపించు"
    ])
  ) {
    return { type: "OPEN_OUTDOOR" };
  }

  // 3. INDOOR NAVIGATION COMMANDS
  if (
    containsAny(text, [
      "start indoor navigation",
      "begin indoor navigation",
      "indoor navigation",
      "where am i inside this building",
      "take me to the second floor",
      "take me to second floor",
      "find the nearest staircase",
      "find the elevator",
      "find elevator",
      "take me to the nearest exit",
      "find the accessible route",
      "where is the reception",
      "i am lost",
      "help me find my location",
      "इनडोर नेविगेशन शुरू",
      "इस इमारत में मैं कहाँ हूँ",
      "लिफ्ट ढूंढो",
      "सीढ़ी ढूंढो",
      "निकास द्वार ढूंढो",
      "ಒಳಾಂಗಣ ಸಂಚಾರ ಪ್ರಾರಂಭಿಸಿ",
      "ಕಟ್ಟಡದಲ್ಲಿ ನಾನು ಎಲ್ಲಿದ್ದೇನೆ",
      "ಲಿಫ್ಟ್ ಹುಡುಕಿ",
      "ಮೆಟ್ಟಿಲು ಹುಡುಕಿ",
      "உள்ளரங்க வழிகாட்டல்",
      "உள்ளரங்க வழிசெலுத்தலைத் தொடங்கு",
      "லிஃப்ட் கண்டுபிடி",
      "படி கண்டுபிடி",
      "ఇండోర్ నావిగేషన్ ప్రారంభించండి",
      "భవనంలో నేను ఎక్కడ ఉన్నాను",
      "లిఫ్ట్ కనుగొనండి",
      "మెట్లు కనుగొనండి"
    ])
  ) {
    return { type: "START_INDOOR" };
  }

  // 4. START NAVIGATION (OUTDOOR / GENERAL)
  if (
    text === "start" ||
    text === "begin" ||
    containsAny(text, [
      "start navigation",
      "begin voice navigation",
      "begin navigation",
      "start navigating",
      "start outdoor navigation",
      "नेविगेशन शुरू",
      "नेविगेशन शुरू करो",
      "मार्गदर्शन शुरू करो",
      "शुरू करो",
      "प्रारंभ करो",
      "ನ್ಯಾವಿಗೇಷನ್ ಪ್ರಾರಂಭಿಸಿ",
      "ಸಂಚಾರ ಪ್ರಾರಂಭಿಸಿ",
      "ಪ್ರಾರಂಭಿಸಿ",
      "ಪ್ರಾರಂಭಿಸು",
      "ಶುರು ಮಾಡು",
      "வழிசெலுத்தலைத் தொடங்கு",
      "வழிகாட்டலைத் தொடங்கு",
      "தொடங்கு",
      "தொடங்குங்கள்",
      "నావిగేషన్ ప్రారంభించండి",
      "దారి చూపించడం ప్రారంభించండి",
      "ప్రారంభించండి",
      "ప్రారంభించు"
    ])
  ) {
    return { type: "START_NAVIGATION" };
  }

  // 4. STOP / CANCEL NAVIGATION
  if (
    containsAny(text, [
      "stop navigation",
      "cancel navigation",
      "end navigation",
      "stop navigating",
      "cancel",
      "stop",
      "halt",
      "quit",
      "नेविगेशन बंद",
      "नेविगेशन रोको",
      "रद्द करो",
      "रोको",
      "रुक जाओ",
      "बंद करो",
      "ನ್ಯಾವಿಗೇಷನ್ ನಿಲ್ಲಿಸಿ",
      "ರದ್ದುಮಾಡಿ",
      "ರದ್ದು ಮಾಡಿ",
      "ನಿಲ್ಲಿಸಿ",
      "ನಿಲ್ಲಿಸು",
      "ನಿಲ್ಲು",
      "ಸಾಕು",
      "வழிசெலுத்தலை நிறுத்து",
      "ரத்து செய்",
      "நிறுத்து",
      "நிறுத்துங்கள்",
      "போதும்",
      "నావిగేషన్ ఆపండి",
      "రద్దు చేయండి",
      "ఆపండి",
      "ఆపు",
      "చాలు"
    ])
  ) {
    return { type: "STOP_NAVIGATION" };
  }

  // 5. PAUSE NAVIGATION
  if (
    containsAny(text, [
      "pause navigation",
      "pause",
      "hold navigation",
      "नेविगेशन रोकें",
      "रोकें",
      "ನ್ಯಾವಿಗೇಷನ್ ವಿರಾಮಗೊಳಿಸಿ",
      "ವಿರಾಮ",
      "வழிசெலுத்தலை இடைநிறுத்து",
      "இடைநிறுத்து",
      "నావిగేషన్ పాజ్ చేయండి",
      "పాజ్"
    ])
  ) {
    return { type: "PAUSE_NAVIGATION" };
  }

  // 6. RESUME NAVIGATION
  if (
    containsAny(text, [
      "resume navigation",
      "resume",
      "continue navigation",
      "continue",
      "नेविगेशन जारी रखो",
      "आगे बढ़ो",
      "ನ್ಯಾವಿಗೇಷನ್ ಪುನರಾರಂಭಿಸಿ",
      "ಮುಂದುವರಿಸಿ",
      "வழிசெலுத்தலைத் தொடர்",
      "தொடரவும்",
      "నావిగేషన్ పునఃప్రారంభించండి",
      "కొనసాగించండి"
    ])
  ) {
    return { type: "RESUME_NAVIGATION" };
  }

  // 7. REPEAT INSTRUCTION
  if (
    containsAny(text, [
      "repeat instruction",
      "repeat the last instruction",
      "say that again",
      "repeat direction",
      "repeat",
      "फिर से बोलो",
      "दोहराएं",
      "निर्देश दोहराएं",
      "ಮತ್ತೆ ಹೇಳಿ",
      "ಪುನರಾವರ್ತಿಸಿ",
      "ಸೂಚನೆಯನ್ನು ಮತ್ತೆ ಹೇಳಿ",
      "மீண்டும் சொல்",
      "மறுபடி சொல்",
      "வழிமுறையை மீண்டும் சொல்",
      "మళ్లీ చెప్పండి",
      "పునరావృతం చేయండి",
      "సూచన మళ్లీ చెప్పండి"
    ])
  ) {
    return { type: "REPEAT_INSTRUCTION" };
  }

  // 8. REROUTING / FIND ANOTHER ROUTE
  if (
    containsAny(text, [
      "find another route",
      "reroute me",
      "reroute",
      "recalculate route",
      "different route",
      "नया रास्ता ढूंढो",
      "रास्ता बदलो",
      "ಮತ್ತೊಂದು ಮಾರ್ಗ ಹುಡುಕಿ",
      "ಮಾರ್ಗ ಮರುಲೆಕ್ಕಾಚಾರ ಮಾಡಿ",
      "வேறு பாதை கண்டுபிடி",
      "பாதையை மாற்று",
      "మరో మార్గం కనుగొనండి",
      "మార్గాన్ని మార్చండి"
    ])
  ) {
    return { type: "REROUTE" };
  }

  // 9. NEXT TURN / NEXT STEP
  if (
    containsAny(text, [
      "what is my next turn",
      "what's my next turn",
      "next turn",
      "next direction",
      "next step",
      "what's next",
      "whats next",
      "अगला मोड़ क्या है",
      "अगला कदम",
      "ಮುಂದಿನ ತಿರುವು ಯಾವುದು",
      "ಮುಂದಿನ ಹಂತ",
      "அடுத்த திருப்பம் என்ன",
      "அடுத்த படி",
      "తదుపరి మలుపు ఏమిటి",
      "తదుపరి దశ"
    ])
  ) {
    return { type: "NEXT_STEP" };
  }

  // 10. ROUTE PROGRESS / DISTANCE REMAINING / TIME LEFT
  if (
    containsAny(text, [
      "how far is my destination",
      "how far is it",
      "how much time is left",
      "how much distance is left",
      "eta",
      "remaining distance",
      "कितनी दूरी बची है",
      "कितना समय बचा है",
      "ಎಷ್ಟು ದೂರ ಉಳಿದಿದೆ",
      "ಎಷ್ಟು ಸಮಯ ಉಳಿದಿದೆ",
      "எவ்வளவு தூரம் மீதமுள்ளது",
      "எவ்வளவு நேரம் உள்ளது",
      "ఎంత దూరం మిగిలి ఉంది",
      "ఎంత సమయం మిగిలి ఉంది"
    ])
  ) {
    return { type: "ROUTE_PROGRESS" };
  }

  // 11. WHERE AM I / MY LOCATION
  if (
    containsAny(text, [
      "where am i",
      "what is my location",
      "my location",
      "tell me where am i",
      "मैं कहाँ हूँ",
      "मेरा स्थान क्या है",
      "ನಾನು ಎಲ್ಲಿದ್ದೇನೆ",
      "ನನ್ನ ಪ್ರಸ್ತುತ ಸ್ಥಳ",
      "நான் எங்கே இருக்கிறேன்",
      "என் இருப்பிடம் என்ன",
      "నేను ఎక్కడ ఉన్నాను",
      "నా స్థానం ఏమిటి"
    ])
  ) {
    return { type: "WHERE_AM_I" };
  }

  // 12. SURROUNDINGS / WHAT IS IN FRONT OF ME
  if (
    containsAny(text, [
      "what is in front of me",
      "what's in front of me",
      "what is in front",
      "describe my surroundings",
      "describe surroundings",
      "what is around me",
      "what's around me",
      "look around",
      "what do you see",
      "मेरे सामने क्या है",
      "आसपास क्या है",
      "सामने देखो",
      "ನನ್ನ ಮುಂದೆ ಏನಿದೆ",
      "ಸುತ್ತಲೂ ಏನಿದೆ",
      "முன்னால் என்ன இருக்கிறது",
      "என்னைச் சுற்றி என்ன உள்ளது",
      "నా ముందు ఏముంది",
      "చుట్టూ ఏముంది"
    ])
  ) {
    return { type: "DESCRIBE_AROUND" };
  }

  // 13. OBSTACLES / STAIRS / DOORS AHEAD
  if (
    containsAny(text, [
      "is there an obstacle ahead",
      "obstacle ahead",
      "any obstacles",
      "are there stairs ahead",
      "is there a door nearby",
      "repeat the obstacle warning",
      "tell me what is on my left",
      "tell me what is on my right",
      "क्या आगे कोई बाधा है",
      "क्या सीढ़ियाँ हैं",
      "ಮುಂದೆ ಅಡಚಣೆ ಇದೆಯೇ",
      "ಮುಂದೆ ಮೆಟ್ಟಿಲುಗಳಿವೆಯೇ",
      "முன்னால் ஏதேனும் தடை உள்ளதா",
      "ముందు ఏమైనా అడ్డంకి ఉందా"
    ])
  ) {
    return { type: "OBSTACLE_QUERY" };
  }

  // 14. READ SIGNBOARD / OCR TEXT
  if (
    containsAny(text, [
      "read the signboard",
      "read signboard",
      "read this text",
      "read text",
      "read this",
      "what does this board say",
      "what does it say",
      "यह पढ़ो",
      "बोर्ड पढ़ो",
      "यह बोर्ड क्या कहता है",
      "ಇದನ್ನು ಓದಿ",
      "ಬೋರ್ಡ್ ಓದಿ",
      "ಈ ಬೋರ್ಡ್ ಏನು ಹೇಳುತ್ತದೆ",
      "இதைப் படி",
      "பலகையைப் படி",
      "இந்தப் பலகை என்ன சொல்கிறது",
      "దీన్ని చదవండి",
      "బోర్డు చదవండి",
      "ఈ బోర్డు ఏమి చెబుతోంది"
    ])
  ) {
    return { type: "READ_TEXT" };
  }

  // 15. READ QR CODE
  if (
    containsAny(text, [
      "read the qr code",
      "read qr code",
      "scan qr code",
      "scan qr",
      "read qr",
      "क्यूआर कोड पढ़ो",
      "क्यूआर स्कैन करो",
      "ಕ್ಯೂಆರ್ ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ",
      "ಕ್ಯೂಆರ್ ಓದಿ",
      "க்யூஆர் குறியீட்டை ஸ்கேன் செய்",
      "క్యూఆర్ కోడ్ స్కాన్ చేయండి"
    ])
  ) {
    return { type: "READ_QR" };
  }

  // 16. ENVIRONMENT QUERY / DECLARATION
  if (containsAny(text, ["indoors or outdoors", "inside or outside", "where am i indoors or outdoors"])) {
    return { type: "ENVIRONMENT_QUERY" };
  }
  if (containsAny(text, ["i am indoors", "i am inside", "मैं अंदर हूँ", "ನಾನು ಒಳಗೆ ಇದ್ದೇನೆ", "நான் உள்ளே இருக்கிறேன்", "నేను లోపల ఉన్నాను"])) {
    return { type: "DECLARE_INDOOR" };
  }
  if (containsAny(text, ["i am outdoors", "i am outside", "मैं बाहर हूँ", "ನಾನು ಹೊರಗೆ ಇದ್ದೇನೆ", "நான் வெளியே இருக்கிறேன்", "నేను బయట ఉన్నాను"])) {
    return { type: "DECLARE_OUTDOOR" };
  }

  // 18. DESTINATION EXTRACTION PATTERNS
  const patterns = [
    // English patterns
    /^(?:please\s+)?(?:take me to|navigate to|directions to|guide me to|how do i get to|go to|find|find the nearest|show route to)\s+(.+)$/iu,
    /^(?:where is the|where is)\s+(.+)$/iu,

    // Hindi patterns
    /^(?:मुझे\s+)?(.+?)\s+(?:ले चलो|का रास्ता बताओ|पहुंचाओ|ले जाओ)$/iu,
    /^(?:निकटतम|पास का)\s+(.+?)\s*(?:ढूंढो|खोजो)?$/iu,

    // Kannada patterns
    /^(.+?)\s*(?:ಗೆ ಕರೆದೊಯ್ಯಿರಿ|ಗೆ ದಾರಿ ತೋರಿಸಿ|ಗೆ ಹೋಗಿ|ಗೆ ಮಾರ್ಗ ತೋರಿಸಿ)$/iu,
    /^(?:ಹತ್ತಿರದ|ಸಮೀಪದ)\s+(.+?)\s*(?:ಹುಡುಕಿ)?$/iu,

    // Tamil patterns
    /^(.+?)\s*(?:க்கு அழைத்துச் செல்|க்கு வழி சொல்|க்குச் செல்)$/iu,
    /^(?:அருகிலுள்ள)\s+(.+?)\s*(?:ஐக் கண்டுபிடி)?$/iu,

    // Telugu patterns
    /^(.+?)\s*(?:కి తీసుకెళ్లండి|కి దారి చూపించు|కి వెళ్లండి)$/iu,
    /^(?:సమీపంలోని|దగ్గరలోని)\s+(.+?)\s*(?:ను కనుగొనండి)?$/iu
  ];

  for (const regex of patterns) {
    const match = original.match(regex);
    if (match?.[1]) {
      const destination = match[1]
        .replace(/[.,/#!$%^&*;:{}=\-_`~()?]/gu, "")
        .replace(/\b(the|a|an)\b/gi, "")
        .trim();
      if (destination.length > 1) {
        return { type: "NAVIGATE_TO", destination };
      }
    }
  }

  // 19. SHORT PHRASES AS POSSIBLE DESTINATIONS (e.g. "Hospital", "Central Library", "Classroom 101")
  const words = text.split(" ");
  if (words.length >= 1 && words.length <= 5 && !containsAny(text, ["yes", "no", "ok", "okay", "cancel", "hi", "hello"])) {
    return { type: "POSSIBLE_DESTINATION", destination: original };
  }

  return { type: "UNKNOWN" };
}
