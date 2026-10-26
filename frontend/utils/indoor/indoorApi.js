// frontend/utils/indoor/indoorApi.js
/**
 * Real-Time Visual SLAM Indoor Navigation API client.
 * Connects directly to the SLAM processing service with automatic dual-routing.
 */

const API_BASE = "/api/indoor";

/**
 * Health check to verify SLAM service is online.
 */
export async function checkSlamHealth() {
  try {
    const res = await fetch("/slam/health/", { cache: "no-store" });
    if (res.ok) return await res.json();
  } catch {
    // Retry through backend
  }

  try {
    const res = await fetch(`${API_BASE}/slam/health`, { cache: "no-store" });
    if (res.ok) return await res.json();
  } catch {
    //
  }
  return { status: "unavailable", message: "Cannot reach SLAM service on port 8000 or 5000." };
}

/**
 * Send captured camera frame to the Visual SLAM engine.
 */
export async function sendSlamFrame(imageBlob, ocrText = null) {
  const formData = new FormData();
  formData.append("file", imageBlob, "slam_frame.jpg");
  if (ocrText) {
    formData.append("ocr_text", ocrText);
  }

  // Attempt direct /slam/frame/ first (proxied directly to FastAPI on 8000)
  try {
    const res = await fetch("/slam/frame/", {
      method: "POST",
      body: formData
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Network retry through backend proxy
  }

  const res = await fetch(`${API_BASE}/slam/frame`, {
    method: "POST",
    body: formData
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`SLAM frame processing failed with status ${res.status}: ${errText.slice(0, 80)}`);
  }
  return await res.json();
}

/**
 * Fetch current SLAM tracking state, pose, confidence, and discovered map.
 */
export async function fetchSlamStatus() {
  try {
    const res = await fetch("/slam/status/", { cache: "no-store" });
    if (res.ok) return await res.json();
  } catch {
    // Fallback
  }
  const res = await fetch(`${API_BASE}/slam/status`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch SLAM status.");
  return await res.json();
}

/**
 * Reset SLAM session to start fresh live exploration.
 */
export async function resetSlamSession() {
  try {
    const res = await fetch("/slam/reset/", { method: "POST" });
    if (res.ok) return await res.json();
  } catch {
    // Fallback
  }
  const res = await fetch(`${API_BASE}/slam/reset`, { method: "POST" });
  return await res.json();
}

/**
 * Plan path on the actively discovered map to an observed destination.
 */
export async function planSlamRoute(destination, startId = null) {
  try {
    const res = await fetch("/slam/route/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination, start_id: startId })
    });
    if (res.ok) return await res.json();
  } catch {
    // Fallback
  }

  const res = await fetch(`${API_BASE}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destination, start_id: startId })
  });
  return await res.json();
}

/**
 * Explicitly label a discovered location or waypoint.
 */
export async function labelSlamLocation(label, type = "room", targetId = "current") {
  try {
    const res = await fetch("/slam/label/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, type, target_id: targetId })
    });
    if (res.ok) return await res.json();
  } catch {
    // Fallback
  }
  const res = await fetch(`${API_BASE}/slam/label`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, type, target_id: targetId })
  });
  return await res.json();
}

/**
 * Get all actively discovered landmarks and destinations from live SLAM map.
 */
export async function fetchDiscoveredDestinations() {
  const res = await fetch(`${API_BASE}/destinations`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return data.destinations || [];
}

/**
 * Match user destination against discovered landmarks.
 */
export const calculateRoute = async (payload) => {
  const dest = payload?.destination || payload?.destinationLocationId;
  const start = payload?.start_id || payload?.startLocationId;
  return await planSlamRoute(dest, start);
};

/**
 * Localize current position using SLAM tracking status.
 */
export async function localizeIndoor() {
  const res = await fetch(`${API_BASE}/localize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  return await res.json();
}
