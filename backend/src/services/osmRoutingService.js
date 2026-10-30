// backend/src/services/osmRoutingService.js
const axios = require("axios");

const USER_AGENT = "DhristiVoiceNavigationApp/1.0 (https://github.com/major-project/voice-navigation; majorproject@dhristi.org)";
const REFERER = "https://dhristi.org";

// Curated destinations for immediate reliable demo navigation without external API dependency
const CURATED_DEMO_DESTINATIONS = [
  {
    keys: ["railway", "railway station", "train station", "station", "station road"],
    name: "Mysuru Railway Station",
    address: "Medar Block, Yadavagiri, Mysuru, Karnataka 570001",
    latitude: 12.3149,
    longitude: 76.6463
  },
  {
    keys: ["hospital", "apollo", "nearest hospital", "clinic", "emergency"],
    name: "Apollo BGS Hospital",
    address: "Adichunchanagiri Road, Kuvempunagar, Mysuru, Karnataka 570023",
    latitude: 12.2982,
    longitude: 76.6268
  },
  {
    keys: ["bus", "bus stop", "bus stand", "city bus stand", "suburban bus stand"],
    name: "City Bus Stand",
    address: "Suburban Bus Stand Road, Lashkar Mohalla, Mysuru, Karnataka 570001",
    latitude: 12.3086,
    longitude: 76.6552
  },
  {
    keys: ["pharmacy", "medical", "drugstore", "medicine", "medplus"],
    name: "MedPlus Pharmacy",
    address: "Sayyaji Rao Road, Agrahara, Mysuru, Karnataka 570001",
    latitude: 12.3125,
    longitude: 76.6510
  },
  {
    keys: ["restaurant", "hotel", "food", "mylari", "cafe"],
    name: "Hotel Original Vinayaka Mylari",
    address: "Nazarbad Main Road, Mysuru, Karnataka 570010",
    latitude: 12.3075,
    longitude: 76.6625
  },
  {
    keys: ["palace", "mysore palace", "mysuru palace"],
    name: "Mysuru Palace",
    address: "Sayyaji Rao Rd, Agrahara, Chamrajpura, Mysuru, Karnataka 570001",
    latitude: 12.3051,
    longitude: 76.6551
  },
  {
    keys: ["library", "city library", "central library"],
    name: "City Central Library",
    address: "Chamarajapuram, Mysuru, Karnataka 570005",
    latitude: 12.3015,
    longitude: 76.6455
  }
];

function findCuratedDestination(query) {
  if (!query || typeof query !== "string") return null;
  const q = query.toLowerCase().trim();
  for (const item of CURATED_DEMO_DESTINATIONS) {
    if (item.keys.some((k) => q.includes(k) || k.includes(q))) {
      return item;
    }
  }
  return null;
}

/**
 * Resolve destination using OpenStreetMap Nominatim with curated fallback.
 */
/**
 * Search Nominatim OpenStreetMap API
 */
async function searchNominatim(q, origin, languageCode) {
  const params = {
    q: q.trim(),
    format: "json",
    limit: 6,
    addressdetails: 1
  };

  if (origin && typeof origin.latitude === "number" && typeof origin.longitude === "number") {
    const latDelta = 0.3;
    const lonDelta = 0.3;
    params.viewbox = `${origin.longitude - lonDelta},${origin.latitude + latDelta},${origin.longitude + lonDelta},${origin.latitude - latDelta}`;
    params.bounded = 0;
  }

  const response = await axios.get("https://nominatim.openstreetmap.org/search", {
    params,
    headers: {
      "User-Agent": USER_AGENT,
      Referer: REFERER,
      "Accept-Language": languageCode.split("-")[0] || "en"
    },
    timeout: 7000
  });

  let places = response.data || [];
  if (places.length > 1 && origin && typeof origin.latitude === "number" && typeof origin.longitude === "number") {
    places.sort((a, b) => {
      const distA = Math.hypot(parseFloat(a.lat) - origin.latitude, parseFloat(a.lon) - origin.longitude);
      const distB = Math.hypot(parseFloat(b.lat) - origin.latitude, parseFloat(b.lon) - origin.longitude);
      return distA - distB;
    });
  }
  return places;
}

async function resolveDestination(query, origin, languageCode = "en") {
  if (!query) {
    return { status: "error", message: "Destination query is required." };
  }

  // 1. Direct coordinates object or string
  if (typeof query === "object" && query.latitude && query.longitude) {
    return {
      status: "success",
      place: {
        id: "coord_" + Date.now(),
        name: query.name || "Selected Map Location",
        address: `${query.latitude.toFixed(5)}, ${query.longitude.toFixed(5)}`,
        latitude: query.latitude,
        longitude: query.longitude
      }
    };
  }

  if (typeof query === "string") {
    const coordMatch = query.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[3]);
      return {
        status: "success",
        place: {
          id: "coord_str",
          name: "Coordinates (" + lat.toFixed(4) + ", " + lng.toFixed(4) + ")",
          address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          latitude: lat,
          longitude: lng
        }
      };
    }
  }

  // 2. Query OpenStreetMap Nominatim for real geocoding
  const curated = findCuratedDestination(query);
  const isDemoMode = !origin || !!origin.isDemo;

  console.log(`[Nominatim Geocode] Query: "${query}", Origin:`, origin ? `(${origin.latitude}, ${origin.longitude}, isDemo: ${!!origin.isDemo})` : "none");

  try {
    let places = await searchNominatim(query, origin, languageCode);
    console.log(`[Nominatim Geocode] Found ${places.length} candidate results for "${query}"`);

    // If no results, try variations if applicable (e.g. "bus stand" -> "bus station")
    if (places.length === 0 && typeof query === "string") {
      const fallbacks = [];
      if (/bus\s*stand/i.test(query)) {
        fallbacks.push(query.replace(/bus\s*stand/gi, "bus station"));
        fallbacks.push(query.replace(/bus\s*stand/gi, "bus"));
      } else if (/bus\s*stop/i.test(query)) {
        fallbacks.push(query.replace(/bus\s*stop/gi, "bus station"));
      } else if (/railway\s*station/i.test(query)) {
        fallbacks.push(query.replace(/railway\s*station/gi, "train station"));
      }

      for (const fallback of fallbacks) {
        console.log(`[Nominatim Geocode] Retrying with query variation: "${fallback}"`);
        places = await searchNominatim(fallback, origin, languageCode);
        if (places.length > 0) {
          console.log(`[Nominatim Geocode] Found ${places.length} candidate results for variation "${fallback}"`);
          break;
        }
      }
    }

    if (places.length > 0) {
      const first = places[0];
      const selected = {
        status: "success",
        place: {
          id: first.place_id ? String(first.place_id) : "osm_place",
          name: first.name || first.display_name?.split(",")?.[0] || query,
          address: first.display_name || "",
          latitude: parseFloat(first.lat),
          longitude: parseFloat(first.lon)
        }
      };
      console.log(`[Nominatim Geocode] Selected destination: "${selected.place.name}" (${selected.place.latitude}, ${selected.place.longitude})`);
      return selected;
    }
  } catch (err) {
    console.warn("[Nominatim Geocode] Search error:", err.message);
  }

  // 3. ONLY use curated demo presets if explicitly in demo testing mode or offline unit testing without origin
  if (isDemoMode && curated) {
    console.log(`[Nominatim Geocode] Using curated demo destination for "${query}" in demo mode.`);
    return {
      status: "success",
      place: {
        id: "curated_" + curated.keys[0],
        name: curated.name,
        address: curated.address,
        latitude: curated.latitude,
        longitude: curated.longitude
      }
    };
  }

  // 4. Genuine error for real navigation requests: NEVER silently substitute Mysuru!
  console.log(`[Nominatim Geocode] Destination not found: "${query}"`);
  return {
    status: "not_found",
    message: `Could not find destination "${query}". Please check the spelling, or specify a nearby landmark or street.`
  };
}

const MODIFIER_TRANSLATIONS = {
  left: { en: "left", kn: "ಎಡಕ್ಕೆ", ml: "ഇടത്തോട്ട്", hi: "बाईं ओर", ta: "இடதுபுறம்", te: "ఎడమవైపు" },
  right: { en: "right", kn: "ಬಲಕ್ಕೆ", ml: "വലത്തോട്ട്", hi: "दाईं ओर", ta: "வலதுபுறம்", te: "కుడివైపు" },
  straight: { en: "straight", kn: "ನೇರವಾಗಿ", ml: "നേരെ", hi: "सीधे", ta: "நேராக", te: "నేరుగా" },
  "slight left": { en: "slight left", kn: "ಸ್ವಲ್ಪ ಎಡಕ್ಕೆ", ml: "അല്പം ഇടത്തോട്ട്", hi: "हल्का बाएँ", ta: "சற்று இடதுபுறம்", te: "కాస్త ఎడమవైపు" },
  "slight right": { en: "slight right", kn: "ಸ್ವಲ್ಪ ಬಲಕ್ಕೆ", ml: "അല്പം വലത്തോട്ട്", hi: "हल्का दाएँ", ta: "சற்று வலதுபுறம்", te: "కాస్త కుడివైపు" },
  "sharp left": { en: "sharp left", kn: "ತೀಕ್ಷ್ಣವಾಗಿ ಎಡಕ್ಕೆ", ml: "കുത്തനെ ഇടത്തോട്ട്", hi: "तीखा बाएँ", ta: "கூர்மையாக இடதுபுறம்", te: "తీవ్రంగా ఎడమవైపు" },
  "sharp right": { en: "sharp right", kn: "ತೀಕ್ಷ್ಣವಾಗಿ ಬಲಕ್ಕೆ", ml: "കുത്തನೆ വലത്തോട്ട്", hi: "तीखा दाएँ", ta: "கூர்மையாக வலதுபுறம்", te: "తీవ్రంగా కుడివైపు" },
  uturn: { en: "U-turn", kn: "ಯು-ಟರ್ನ್", ml: "യു-ടേൺ", hi: "यू-टर्न", ta: "யு-டர்ன்", te: "యు-టర్న్" }
};

function getLocalizedModifier(modifier, lang) {
  if (!modifier) return "";
  const key = modifier.toLowerCase().trim();
  const entry = MODIFIER_TRANSLATIONS[key];
  if (entry && entry[lang]) return entry[lang];
  return modifier;
}

function formatPedestrianInstruction(step, isFirst = false, isLast = false, destName = "", languageCode = "en") {
  let effectiveLang = languageCode;
  let effectiveFirst = isFirst;
  let effectiveLast = isLast;
  let effectiveDest = destName;

  if (typeof isFirst === "string") {
    effectiveLang = isFirst;
    effectiveFirst = false;
    effectiveLast = false;
    effectiveDest = "";
  }

  const lang = (effectiveLang || "en").split("-")[0].toLowerCase();
  const dist = Math.round(step.distance || step.distanceMeters || 0);
  const rawStreet = step.name ? step.name.trim() : "";
  const m = step.maneuver || step;
  const type = m.type || step.type || "continue";
  const rawMod = m.modifier || step.modifier || "";
  const mod = getLocalizedModifier(rawMod, lang);
  isFirst = !!effectiveFirst;
  isLast = !!effectiveLast;
  destName = effectiveDest || "";
  if (!destName && (type === "arrive" || isLast) && (step.name || step.destinationName)) {
    destName = step.name || step.destinationName;
  }

  // 1. Kannada (kn)
  if (lang === "kn") {
    if (isLast || type === "arrive") {
      return destName ? `ನೀವು ನಿಮ್ಮ ಗಮ್ಯಸ್ಥಾನವಾದ ${destName} ತಲುಪಿದ್ದೀರಿ.` : "ನೀವು ನಿಮ್ಮ ಗಮ್ಯಸ್ಥಾನವನ್ನು ತಲುಪಿದ್ದೀರಿ.";
    }
    const defaultMod = mod || "ನೇರವಾಗಿ";
    if (isFirst || type === "depart") {
      if (rawStreet) return `${rawStreet} ನಲ್ಲಿ ${defaultMod} ${dist > 0 ? dist + " ಮೀಟರ್ ನಡೆಯಿರಿ." : "ನಡೆಯಿರಿ."}`;
      return `${defaultMod} ${dist > 0 ? dist + " ಮೀಟರ್ ನಡೆಯಿರಿ." : "ನಡೆಯಿರಿ."}`;
    }
    if (type === "turn") {
      if (rawStreet) return `${rawStreet} ಗೆ ${mod || "ತಿರುಗಿ"} ${dist > 0 ? "ಮತ್ತು " + dist + " ಮೀಟರ್ ಮುಂದುವರಿಯಿರಿ." : ""}`.trim();
      return `${mod || "ತಿರುಗಿ"} ಮತ್ತು ${dist} ಮೀಟರ್ ಮುಂದುವರಿಯಿರಿ.`;
    }
    if (type === "end of road") {
      return `ರಸ್ತೆಯ ಕೊನೆಯಲ್ಲಿ, ${rawStreet ? rawStreet + " ಗೆ " : ""}${mod || "ತಿರುಗಿ"} ${dist} ಮೀಟರ್ ಮುಂದುವರಿಯಿರಿ.`;
    }
    if (type === "fork") {
      return `ಕವಲೊಡೆದ ದಾರಿಯಲ್ಲಿ ${mod || "ಮುಂದೆ"} ${dist} ಮೀಟರ್ ನಡೆಯಿರಿ.`;
    }
    if (type === "roundabout" || type === "rotary") {
      return `ರೌಂಡ್‌ಎಬೌಟ್ ಪ್ರವೇಶಿಸಿ ಮತ್ತು ${dist} ಮೀಟರ್ ನಂತರ ನಿರ್ಗಮಿಸಿ.`;
    }
    return `${rawStreet ? rawStreet + " ನಲ್ಲಿ " : ""}${defaultMod} ${dist} ಮೀಟರ್ ಮುಂದುವರಿಯಿರಿ.`;
  }

  // 2. Malayalam (ml)
  if (lang === "ml") {
    if (isLast || type === "arrive") {
      return destName ? `നിങ്ങൾ നിങ്ങളുടെ ലക്ഷ്യസ്ഥാനമായ ${destName} എത്തിച്ചേർന്നു.` : "നിങ്ങൾ ലക്ഷ്യസ്ഥാനത്ത് എത്തിച്ചേർന്നു.";
    }
    const defaultMod = mod || "നേരെ";
    if (isFirst || type === "depart") {
      if (rawStreet) return `${rawStreet} ലൂടെ ${defaultMod} ${dist > 0 ? dist + " മീറ്റർ നടക്കുക." : "നടക്കുക."}`;
      return `${defaultMod} ${dist > 0 ? dist + " മീറ്റർ നടക്കുക." : "നടക്കുക."}`;
    }
    if (type === "turn") {
      if (rawStreet) return `${rawStreet} ലേക്ക് ${mod || "തിരിഞ്ഞ്"} ${dist > 0 ? dist + " മീറ്റർ മുന്നോട്ട് പോകുക." : ""}`.trim();
      return `${mod || "തിരിഞ്ഞ്"} ${dist} മീറ്റർ മുന്നോട്ട് പോകുക.`;
    }
    if (type === "end of road") {
      return `റോഡിന്റെ അവസാനം, ${rawStreet ? rawStreet + " ലേക്ക് " : ""}${mod || "തിരിഞ്ഞ്"} ${dist} മീറ്റർ മുന്നോട്ട് പോകുക.`;
    }
    if (type === "fork") {
      return `വഴി തിരിയുന്നിടത്ത് ${mod || "മുന്നോട്ട്"} ${dist} മീറ്റർ നടക്കുക.`;
    }
    if (type === "roundabout" || type === "rotary") {
      return `റൗണ്ട്എബൗട്ടിൽ പ്രവേശിച്ച് ${dist} മീറ്റർ കഴിഞ്ഞ് പുറത്തേക്ക് കടക്കുക.`;
    }
    return `${rawStreet ? rawStreet + " ലൂടെ " : ""}${defaultMod} ${dist} മീറ്റർ മുന്നോട്ട് പോകുക.`;
  }

  // 3. Hindi (hi)
  if (lang === "hi") {
    if (isLast || type === "arrive") {
      return destName ? `आप अपने गंतव्य ${destName} पर पहुँच गए हैं।` : "आप अपने गंतव्य पर पहुँच गए हैं।";
    }
    const defaultMod = mod || "सीधे";
    if (isFirst || type === "depart") {
      if (rawStreet) return `${rawStreet} पर ${defaultMod} ${dist > 0 ? dist + " मीटर चलें।" : "चलें।"}`;
      return `${defaultMod} ${dist > 0 ? dist + " मीटर चलें।" : "चलें।"}`;
    }
    if (type === "turn") {
      if (rawStreet) return `${rawStreet} पर ${mod || "मुड़ें"} और ${dist} मीटर आगे बढ़ें।`;
      return `${mod || "मुड़ें"} और ${dist} मीटर आगे बढ़ें।`;
    }
    if (type === "end of road") {
      return `सड़क के अंत में, ${rawStreet ? rawStreet + " पर " : ""}${mod || "मुड़ें"} और ${dist} मीटर आगे बढ़ें।`;
    }
    return `${rawStreet ? rawStreet + " पर " : ""}${defaultMod} ${dist} मीटर आगे बढ़ें।`;
  }

  // 4. Tamil (ta)
  if (lang === "ta") {
    if (isLast || type === "arrive") {
      return destName ? `நீங்கள் உங்கள் இலக்கான ${destName} ஐ அடைந்துவிட்டீர்கள்.` : "நீங்கள் உங்கள் இலக்கை அடைந்துவிட்டீர்கள்.";
    }
    const defaultMod = mod || "நேராக";
    if (isFirst || type === "depart") {
      if (rawStreet) return `${rawStreet} இல் ${defaultMod} ${dist > 0 ? dist + " மீட்டர் நடக்கவும்." : "நடக்கவும்."}`;
      return `${defaultMod} ${dist > 0 ? dist + " மீட்டர் நடக்கவும்." : "நடக்கவும்."}`;
    }
    if (type === "turn") {
      if (rawStreet) return `${rawStreet} இல் ${mod || "திரும்பி"} ${dist} மீட்டர் தொடரவும்.`;
      return `${mod || "திரும்பி"} ${dist} மீட்டர் தொடரவும்.`;
    }
    if (type === "end of road") {
      return `சாலையின் முடிவில், ${rawStreet ? rawStreet + " இல் " : ""}${mod || "திரும்பி"} ${dist} மீட்டர் தொடரவும்.`;
    }
    return `${rawStreet ? rawStreet + " இல் " : ""}${defaultMod} ${dist} மீட்டர் தொடரவும்.`;
  }

  // 5. Telugu (te)
  if (lang === "te") {
    if (isLast || type === "arrive") {
      return destName ? `మీరు మీ గమ్యస్థానమైన ${destName} చేరుకున్నారు.` : "మీరు మీ గమ్యస్థానానికి చేరుకున్నారు.";
    }
    const defaultMod = mod || "నేరుగా";
    if (isFirst || type === "depart") {
      if (rawStreet) return `${rawStreet} లో ${defaultMod} ${dist > 0 ? dist + " మీటర్లు నడవండి." : "నడవండి."}`;
      return `${defaultMod} ${dist > 0 ? dist + " మీటర్లు నడవండి." : "నడవండి."}`;
    }
    if (type === "turn") {
      if (rawStreet) return `${rawStreet} లో ${mod || "తిరిగి"} ${dist} మీటర్లు కొనసాగించండి.`;
      return `${mod || "తిరిగి"} ${dist} మీటర్లు కొనసాగించండి.`;
    }
    if (type === "end of road") {
      return `రోడ్డు చివరలో, ${rawStreet ? rawStreet + " లో " : ""}${mod || "తిరిగి"} ${dist} మీటర్లు కొనసాగించండి.`;
    }
    return `${rawStreet ? rawStreet + " లో " : ""}${defaultMod} ${dist} మీటర్లు కొనసాగించండి.`;
  }

  // 6. English Default (en)
  const streetName = rawStreet ? `on ${rawStreet}` : "forward";
  const ontoStreet = rawStreet ? `onto ${rawStreet}` : "onto the walkway";

  if (isLast || type === "arrive") {
    return `You have arrived at your destination: ${destName || "destination"}.`;
  }

  if (isFirst || type === "depart") {
    if (dist > 0) {
      return `Head ${rawMod || "straight"} ${streetName} and walk for ${dist} meters.`;
    }
    return `Head ${rawMod || "straight"} ${streetName}.`;
  }

  if (type === "turn") {
    return `Turn ${rawMod || "ahead"} ${ontoStreet} and continue for ${dist} meters.`;
  }

  if (type === "end of road") {
    return `At the end of the road, turn ${rawMod || "ahead"} ${ontoStreet} and continue for ${dist} meters.`;
  }

  if (type === "fork") {
    return `Keep ${rawMod || "ahead"} at the fork ${ontoStreet} for ${dist} meters.`;
  }

  if (type === "roundabout" || type === "rotary") {
    return `Enter the roundabout and take the exit ${ontoStreet} for ${dist} meters.`;
  }

  if (type === "new name") {
    return `Continue as the path becomes ${step.name || "the roadway"} for ${dist} meters.`;
  }

  return `Continue ${rawMod ? rawMod + " " : ""}${streetName} for ${dist} meters.`;
}

/**
 * Calculate walking route using verified OpenStreetMap foot routing server.
 * Verified endpoint: https://routing.openstreetmap.de/routed-foot/route/v1/foot/{coordinates}
 */
async function calculateWalkingRoute(origin, destination, languageCode = "en") {
  if (!origin?.latitude || !origin?.longitude || !destination?.latitude || !destination?.longitude) {
    return {
      status: "error",
      message: "Valid origin and destination coordinates are required."
    };
  }

  const coords = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  console.log(`[OSM Route Request] Walking route from (${origin.latitude.toFixed(5)}, ${origin.longitude.toFixed(5)}) to (${destination.latitude.toFixed(5)}, ${destination.longitude.toFixed(5)}) [${destination.name || "destination"}]`);

  const endpoints = [
    `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coords}?overview=full&steps=true&geometries=geojson`,
    `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&steps=true&geometries=geojson`
  ];

  let routeData = null;
  let activeEndpoint = "";
  let lastError = null;

  for (const url of endpoints) {
    try {
      console.log(`[OSM Route Request] Fetching: ${url}`);
      const res = await axios.get(url, {
        headers: { "User-Agent": USER_AGENT },
        timeout: 9000
      });
      console.log(`[OSM Route Response] HTTP ${res.status}, OSRM code: ${res.data?.code}, routes: ${res.data?.routes?.length || 0}`);
      if (res.data?.code === "Ok" && res.data.routes?.length > 0) {
        routeData = res.data.routes[0];
        activeEndpoint = url;
        break;
      } else if (res.data?.code === "NoRoute") {
        lastError = new Error("No navigable walking path found between your location and this destination.");
      }
    } catch (err) {
      console.warn(`[OSM Route Request] Error from ${url}:`, err.message);
      lastError = err;
    }
  }

  if (!routeData) {
    console.error(`[OSM Route Request] Route calculation failed:`, lastError?.message);
    return {
      status: "error",
      message: `OpenStreetMap foot routing service could not calculate route: ${lastError?.message || "No pedestrian route found"}`
    };
  }

  const leg = routeData.legs?.[0] || {};
  const rawSteps = leg.steps || [];

  const steps = rawSteps.map((step, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === rawSteps.length - 1;
    const coords = step.geometry?.coordinates || [];
    const startCoord = coords[0] || step.maneuver?.location;
    const endCoord = coords[coords.length - 1] || startCoord;

    return {
      stepNumber: idx + 1,
      instruction: formatPedestrianInstruction(step, isFirst, isLast, destination.name, languageCode),
      name: step.name || "",
      type: step.maneuver?.type || "continue",
      modifier: step.maneuver?.modifier || "",
      maneuver: `${step.maneuver?.type || "WALK"}_${step.maneuver?.modifier || ""}`.toUpperCase(),
      distanceMeters: Math.round(step.distance || 0),
      duration: `${Math.round(step.duration || 0)}s`,
      startLocation: startCoord
        ? { latitude: startCoord[1], longitude: startCoord[0] }
        : null,
      endLocation: endCoord
        ? { latitude: endCoord[1], longitude: endCoord[0] }
        : null,
      geometry: step.geometry
    };
  });

  // Extract all coordinates in [lat, lng] format for Leaflet polyline
  const fullCoordinates = (routeData.geometry?.coordinates || []).map((c) => ({
    latitude: c[1],
    longitude: c[0]
  }));

  return {
    status: "success",
    routingSource: "openstreetmap_routed_foot",
    distanceMeters: Math.round(routeData.distance || 0),
    duration: `${Math.round(routeData.duration || 0)}s`,
    coordinates: fullCoordinates,
    steps: steps,
    endpoint: activeEndpoint
  };
}

/**
 * Text translation fallback stub.
 */
async function translateDynamicText(text) {
  return { text: text, translated: false };
}

module.exports = {
  resolveDestination,
  calculateWalkingRoute,
  translateDynamicText,
  formatPedestrianInstruction,
  CURATED_DEMO_DESTINATIONS
};
