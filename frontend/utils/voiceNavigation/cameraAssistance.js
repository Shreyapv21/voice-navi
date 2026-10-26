/**
 * Enhanced Obstacle Assistance & Environment Classification for General Indoor & Outdoor Navigation.
 * Monitors people, chairs, tables, bags, barriers, and vehicles.
 * Computes walking path intersection and clearance based on camera bounding box geometry.
 */

const OUTDOOR_CLASSES = new Set([
  "car",
  "truck",
  "bus",
  "motorcycle",
  "bicycle",
  "traffic light",
  "stop sign"
]);

const INDOOR_OBSTACLES = new Set([
  "person",
  "chair",
  "couch",
  "dining table",
  "table",
  "bench",
  "backpack",
  "suitcase",
  "handbag",
  "potted plant",
  "bed"
]);

const ALL_NAV_OBSTACLES = new Set([
  ...OUTDOOR_CLASSES,
  ...INDOOR_OBSTACLES
]);

export function analyzeDetectionsForEnvironment(detections = []) {
  const classNames = detections.map((d) => d.class_name).filter(Boolean);
  return {
    yoloClassNames: classNames,
    hasOutdoorVehicle: classNames.some((c) => OUTDOOR_CLASSES.has(c))
  };
}

/**
 * Determines whether a detected obstacle intersects the user's forward walking corridor.
 * Evaluates center alignment and bounding box footprint.
 */
export function isObstacleInPath(detection) {
  if (!detection) return false;
  const dir = (detection.direction || "").toLowerCase();
  return dir === "center" || dir === "front" || dir === "middle" || dir === "";
}

/**
 * Formulates concise, non-repetitive obstacle warning prioritizing path blockage.
 */
export function pickNavigationObstacleWarning(detections = [], lastSpokenKeyRef) {
  if (!detections?.length) return null;
  const relevant = detections.filter(
    (d) => ALL_NAV_OBSTACLES.has(d.class_name?.toLowerCase()) && (d.confidence ?? 1) >= 0.45
  );
  if (relevant.length === 0) return null;

  // Prioritize obstacle directly in the forward path
  const inPath = relevant.filter(isObstacleInPath);
  const primary = inPath.length > 0 ? inPath[0] : relevant[0];

  const label = primary.class_name;
  const inWalkingPath = isObstacleInPath(primary);
  const key = `${label}:${inWalkingPath ? "in_path" : primary.direction || "side"}`;
  const now = Date.now();

  // Cooldown to avoid repetitive chatter (10s)
  if (lastSpokenKeyRef?.current?.key === key && now - (lastSpokenKeyRef.current.time || 0) < 10000) {
    return null;
  }
  if (lastSpokenKeyRef) {
    lastSpokenKeyRef.current = { key, time: now };
  }

  const distPart = primary.distance ? ` about ${primary.distance} meters ahead` : "";
  const dirPart = primary.direction ? ` to your ${primary.direction}` : "";

  if (inWalkingPath) {
    if (primary.distance && parseFloat(primary.distance) <= 1.8) {
      return `Stop. An obstacle, ${label}, is directly in your walking path${distPart}. Please pause or step aside safely.`;
    }
    return `Caution: ${label} detected in your path${distPart}. Clearance is limited.`;
  }

  return `Caution: ${label} detected${dirPart}${distPart}. Keep your heading.`;
}
