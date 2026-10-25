// frontend/components/OutdoorMap.jsx
import React, { useState, useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useLanguage } from "../utils/LanguageContext.jsx";
import {
  formatLocalizedDistance,
  formatLocalizedDuration,
  translateInstructionText
} from "../utils/languages.js";

// Demo origin coordinates (Sayyaji Rao Road, Mysuru City Center)
const DEMO_ORIGIN = {
  latitude: 12.3086,
  longitude: 76.6531,
  accuracy: 5,
  isDemo: true,
  label: "Demo Origin (Sayyaji Rao Road, Mysuru)"
};

// Preset demo destinations
const DEMO_DESTINATIONS = [
  { id: "railway_station", icon: "🚉", en: "Mysuru Railway Station", kn: "ರೈಲ್ವೆ ನಿಲ್ದಾಣ", hi: "रेलवे स्टेशन", ta: "இரயில் நிலையம்", te: "రైల్వే స్టేషన్", latitude: 12.3149, longitude: 76.6463 },
  { id: "hospital", icon: "🏥", en: "Apollo BGS Hospital", kn: "ಹತ್ತಿರದ ಆಸ್ಪತ್ರೆ", hi: "निकटतम अस्पताल", ta: "அருகிலுள்ள மருத்துவமனை", te: "సమీప ఆసుపత్రి", latitude: 12.2982, longitude: 76.6268 },
  { id: "bus_stop", icon: "🚌", en: "City Bus Stand", kn: "ಹತ್ತಿರದ ಬಸ್ ನಿಲ್ದಾಣ", hi: "निकटतम बस स्टॉप", ta: "அருகிலுள்ள பேருந்து நிறுத்தம்", te: "సమీప బస్ స్టాప్", latitude: 12.3086, longitude: 76.6552 },
  { id: "pharmacy", icon: "💊", en: "MedPlus Pharmacy", kn: "ಹತ್ತಿರದ ಔಷಧಾಲಯ", hi: "निकटतम दवा दुकान", ta: "அருகிலுள்ள மருந்தகம்", te: "సమీప ఫಾರ್ಮసీ", latitude: 12.3125, longitude: 76.6510 },
  { id: "palace", icon: "🏰", en: "Mysuru Palace", kn: "ಮೈಸೂರು ಅರಮನೆ", hi: "मैसूर महल", ta: "மைசூர் அரண்மனை", te: "మైసూర్ ప్యాలెస్", latitude: 12.3051, longitude: 76.6551 }
];

export function OutdoorMap({
  userLocation,
  destinationLocation,
  destinationName,
  destinationAddress,
  routeData,
  currentStepIndex = 0,
  isNavigating = false,
  status = "IDLE",
  errorMessage = "",
  detectionState = "CAMERA_OFF",
  liveDetections = [],
  onSelectCategory,
  onSelectDestination,
  onUseDemoLocation,
  onNextStep,
  onRepeatInstruction
}) {
  const { language, t } = useLanguage();
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polylineGroupRef = useRef(null);
  const userMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);

  const onSelectDestinationRef = useRef(onSelectDestination);
  onSelectDestinationRef.current = onSelectDestination;
  const onSelectCategoryRef = useRef(onSelectCategory);
  onSelectCategoryRef.current = onSelectCategory;

  const [mapReady, setMapReady] = useState(false);

  const getLabel = (item) => {
    if (language.startsWith("kn")) return item.kn;
    if (language.startsWith("hi")) return item.hi;
    if (language.startsWith("ta")) return item.ta;
    if (language.startsWith("te")) return item.te;
    return item.en;
  };

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const initialLat = DEMO_ORIGIN.latitude;
    const initialLng = DEMO_ORIGIN.longitude;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: 15,
      zoomControl: false
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    // OpenStreetMap standard tile layer
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors | FOSSGIS OSRM Foot'
    }).addTo(map);

    // Map click handler to select destination directly on map
    map.on("click", (e) => {
      const { lat, lng } = e.latlng;
      if (onSelectDestinationRef.current) {
        onSelectDestinationRef.current({
          latitude: lat,
          longitude: lng,
          name: `Point (${lat.toFixed(4)}, ${lng.toFixed(4)})`
        });
      } else if (onSelectCategoryRef.current) {
        onSelectCategoryRef.current(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
    });

    mapInstanceRef.current = map;
    setMapReady(true);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []); // Run once on mount

  // 2. Update Map Markers, Polyline, and Viewport
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    // Custom HTML div icons (avoids Leaflet 404 image bundler issues)
    const userIcon = L.divIcon({
      className: "custom-leaflet-user-icon",
      html: `
        <div style="position:relative; width:30px; height:30px; display:flex; align-items:center; justify-content:center;">
          <div style="position:absolute; width:30px; height:30px; border-radius:50%; background:rgba(56,189,248,0.4); animation:userPulse 1.6s infinite ease-out;"></div>
          <div style="width:14px; height:14px; border-radius:50%; background:#0284c7; border:3px solid #ffffff; box-shadow:0 0 6px rgba(0,0,0,0.5);"></div>
        </div>
      `,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const destIcon = L.divIcon({
      className: "custom-leaflet-dest-icon",
      html: `
        <div style="display:flex; flex-direction:column; align-items:center;">
          <div style="background:#f43f5e; color:white; font-size:16px; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid white; box-shadow:0 2px 8px rgba(0,0,0,0.6);">🏁</div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    // Update User Location Marker
    if (userLocation?.latitude && userLocation?.longitude) {
      const userLatLng = [userLocation.latitude, userLocation.longitude];
      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng(userLatLng);
      } else {
        userMarkerRef.current = L.marker(userLatLng, { icon: userIcon, zIndexOffset: 1000 })
          .bindPopup(`<b>${userLocation.isDemo ? "📍 Demo Location" : "You (GPS)"}</b><br/>${userLocation.latitude.toFixed(4)}, ${userLocation.longitude.toFixed(4)}`)
          .addTo(map);
      }
    }

    // Update Destination Marker
    if (destinationLocation?.latitude && destinationLocation?.longitude) {
      const destLatLng = [destinationLocation.latitude, destinationLocation.longitude];
      if (destMarkerRef.current) {
        destMarkerRef.current.setLatLng(destLatLng);
      } else {
        destMarkerRef.current = L.marker(destLatLng, { icon: destIcon, zIndexOffset: 900 })
          .bindPopup(`<b>🏁 ${destinationName || "Destination"}</b><br/>${destinationAddress || ""}`)
          .addTo(map);
      }
    } else if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }

    // Update Polyline
    if (polylineGroupRef.current) {
      polylineGroupRef.current.remove();
      polylineGroupRef.current = null;
    }

    let latLngs = [];
    if (routeData?.coordinates?.length) {
      latLngs = routeData.coordinates.map((c) => [c.latitude, c.longitude]);
    } else if (routeData?.steps?.length) {
      routeData.steps.forEach((s) => {
        if (s.geometry?.coordinates) {
          s.geometry.coordinates.forEach((c) => latLngs.push([c[1], c[0]]));
        } else {
          if (s.startLocation) latLngs.push([s.startLocation.latitude, s.startLocation.longitude]);
          if (s.endLocation) latLngs.push([s.endLocation.latitude, s.endLocation.longitude]);
        }
      });
    }

    if (latLngs.length > 0) {
      const casing = L.polyline(latLngs, {
        color: "rgba(0, 242, 254, 0.4)",
        weight: 12,
        lineCap: "round",
        lineJoin: "round"
      });

      const routeLine = L.polyline(latLngs, {
        color: "#00f2fe",
        weight: 6,
        lineCap: "round",
        lineJoin: "round"
      });

      polylineGroupRef.current = L.featureGroup([casing, routeLine]).addTo(map);

      // Fit map view to route bounds
      try {
        map.fitBounds(routeLine.getBounds(), {
          padding: [45, 45],
          maxZoom: 18
        });
      } catch (err) {
        console.warn("Could not fit bounds:", err);
      }
    } else if (userLocation?.latitude && userLocation?.longitude) {
      map.setView([userLocation.latitude, userLocation.longitude], 15);
    }
  }, [mapReady, userLocation, destinationLocation, destinationName, destinationAddress, routeData]);

  const handleRecenter = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (polylineGroupRef.current) {
      map.fitBounds(polylineGroupRef.current.getBounds(), { padding: [40, 40] });
    } else if (userLocation?.latitude && userLocation?.longitude) {
      map.setView([userLocation.latitude, userLocation.longitude], 16);
    } else {
      map.setView([DEMO_ORIGIN.latitude, DEMO_ORIGIN.longitude], 15);
    }
  };

  const currentStep = routeData?.steps?.[currentStepIndex];

  return (
    <div className="outdoor-map-container" role="region" aria-label="Outdoor walking map display">
      <style>{`
        .outdoor-map-container {
          background: #111827;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 16px;
          padding: 16px;
          margin-top: 15px;
          color: white;
        }
        .outdoor-map-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          flex-wrap: wrap;
          gap: 10px;
        }
        .leaflet-map-wrap {
          position: relative;
          width: 100%;
          height: 380px;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(0, 242, 254, 0.4);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        }
        .leaflet-map-canvas {
          width: 100%;
          height: 100%;
          background: #1a202c;
        }
        .category-pill-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 14px;
        }
        .category-pill {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: #e2e8f0;
          padding: 8px 14px;
          border-radius: 20px;
          cursor: pointer;
          font-size: 0.9rem;
          font-weight: 500;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .category-pill:hover, .category-pill:focus-visible {
          background: rgba(0, 242, 254, 0.2);
          border-color: #00f2fe;
          transform: translateY(-2px);
          outline: none;
        }
        .demo-pill {
          background: rgba(251, 191, 36, 0.15);
          border-color: #fbbf24;
          color: #fef3c7;
        }
        .demo-pill:hover {
          background: rgba(251, 191, 36, 0.3);
        }
        .map-floating-bar {
          position: absolute;
          top: 12px;
          left: 12px;
          right: 12px;
          z-index: 1000;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          pointer-events: none;
        }
        .map-badge {
          background: rgba(17, 24, 39, 0.9);
          backdrop-filter: blur(8px);
          padding: 6px 14px;
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          font-size: 0.85rem;
          font-weight: 600;
          pointer-events: auto;
        }
        .map-recenter-btn {
          background: rgba(17, 24, 39, 0.9);
          border: 1px solid rgba(0, 242, 254, 0.5);
          color: #00f2fe;
          border-radius: 8px;
          padding: 6px 12px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          pointer-events: auto;
        }
        .map-recenter-btn:hover {
          background: #00f2fe;
          color: #000;
        }
        .route-summary-panel {
          background: rgba(0, 242, 254, 0.08);
          border: 1px solid rgba(0, 242, 254, 0.3);
          border-radius: 12px;
          padding: 14px 18px;
          margin-top: 12px;
        }
        .step-instruction-box {
          background: rgba(255, 255, 255, 0.08);
          border-left: 4px solid #00f2fe;
          border-radius: 8px;
          padding: 10px 14px;
          margin-top: 10px;
        }
        @keyframes userPulse {
          0% { transform: scale(0.6); opacity: 1; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>

      {/* Destination Quick Selector Pills */}
      <div>
        <div style={{ fontSize: "0.95rem", color: "rgba(255, 255, 255, 0.85)", marginBottom: "8px", fontWeight: 600 }}>
          📍 {language.startsWith("kn") ? "ತ್ವರಿತ ನಡಿಗೆ ಗಮ್ಯಸ್ಥಾನಗಳು:" : language.startsWith("hi") ? "त्वरित पैदल गंतव्य:" : language.startsWith("ta") ? "விரைவான நடைபயண இலக்குகள்:" : language.startsWith("te") ? "త్వరిత నడక గమ్యస్థానాలు:" : "Select Walking Destination:"}
        </div>
        <div className="category-pill-row" role="group" aria-label="Walking destinations">
          {DEMO_DESTINATIONS.map((dest) => (
            <button
              key={dest.id}
              type="button"
              className="category-pill"
              onClick={() => {
                if (onSelectDestination) {
                  onSelectDestination(dest);
                } else if (onSelectCategory) {
                  onSelectCategory(dest.en);
                }
              }}
              aria-label={`Walk to ${dest.en}`}
            >
              <span aria-hidden="true">{dest.icon}</span> {getLabel(dest)}
            </button>
          ))}

          {/* Explicit Demo GPS Location Button */}
          <button
            type="button"
            className="category-pill demo-pill"
            onClick={() => onUseDemoLocation?.(DEMO_ORIGIN)}
            aria-label="Use demo origin in Mysuru"
          >
            🎯 {language.startsWith("kn") ? "ಡೆಮೊ ಜಿಪಿಎಸ್ ಬಳಸಿ" : language.startsWith("hi") ? "डेमो जीपीएस उपयोग करें" : "Use Demo GPS (Mysuru)"}
          </button>
        </div>
      </div>

      <div className="outdoor-map-header">
        <div>
          <strong style={{ fontSize: "1.05rem" }}>
            🗺️ {destinationName ? destinationName : (language.startsWith("kn") ? "ಓಪನ್‌ಸ್ಟ್ರೀಟ್‌ಮ್ಯಾಪ್ ಹೊರಾಂಗಣ ನಕ್ಷೆ" : language.startsWith("hi") ? "ओपनस्ट्रीटमैप आउटडोर नक्शा" : "OpenStreetMap Walking Map (Leaflet)")}
          </strong>
          {destinationAddress && (
            <div style={{ fontSize: "0.85rem", opacity: 0.8, marginTop: 2 }}>{destinationAddress}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <span className="status-badge status-active" style={{ fontSize: "0.85rem" }}>
            {userLocation?.isDemo ? "📍 Demo Location Active" : userLocation ? "📡 GPS Active" : "📡 Ready"}
          </span>
          {isNavigating && (
            <span
              className={`status-badge ${
                detectionState === "DETECTING"
                  ? "status-active"
                  : detectionState === "PAUSED"
                  ? "status-processing"
                  : detectionState === "STARTING"
                  ? "status-processing"
                  : "status-inactive"
              }`}
              style={{ fontSize: "0.85rem" }}
            >
              {detectionState === "DETECTING"
                ? "👁️ Obstacle Camera Active"
                : detectionState === "STARTING"
                ? "👁️ Starting Camera..."
                : detectionState === "PAUSED"
                ? "⏸️ Detection Paused"
                : "⚠️ Camera Offline"}
            </span>
          )}
        </div>
      </div>

      {/* Leaflet Map Canvas */}
      <div className="leaflet-map-wrap">
        <div className="map-floating-bar">
          <div className="map-badge">
            {userLocation?.isDemo
              ? "📍 Demo: Mysuru City Center"
              : userLocation
              ? `Lat: ${userLocation.latitude.toFixed(4)}, Lng: ${userLocation.longitude.toFixed(4)}`
              : "Click map to set destination"}
          </div>
          <button
            type="button"
            className="map-recenter-btn"
            onClick={handleRecenter}
            aria-label="Recenter map"
          >
            🎯 {language.startsWith("kn") ? "ಮರುಕೇಂದ್ರೀಕರಿಸಿ" : "Recenter"}
          </button>
        </div>

        <div ref={mapContainerRef} className="leaflet-map-canvas" aria-label="Interactive Leaflet Map" />
      </div>

      <div style={{ marginTop: "8px", fontSize: "0.82rem", opacity: 0.7, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
        <span>💡 Click anywhere on the map to set a custom destination.</span>
        <span>Powered by OpenStreetMap &amp; FOSSGIS OSRM Foot</span>
      </div>

      {/* Real Route Summary & Turn-by-Turn Spoken Step Details */}
      {(routeData || isNavigating) && (
        <div className="route-summary-panel" aria-live="polite">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "#00f2fe" }}>
                🚶 {destinationName || "Active Route"}
              </span>
              <div style={{ display: "flex", gap: "18px", marginTop: "4px", fontSize: "0.95rem" }}>
                <span><strong>{t("remaining_distance") || "Distance"}:</strong> {routeData?.distanceMeters ? formatLocalizedDistance(routeData.distanceMeters, language) : (t("calculating") || "Calculating...")}</span>
                <span><strong>{t("estimated_time") || "Walking Time"}:</strong> {routeData?.duration ? formatLocalizedDuration(routeData.duration, language) : (t("calculating") || "Calculating...")}</span>
                <span><strong>{t("steps_label") || "Steps"}:</strong> {routeData?.steps?.length || 0}</span>
              </div>
            </div>

            {/* Turn Step Navigation Controls */}
            <div style={{ display: "flex", gap: "8px" }}>
              {onRepeatInstruction && (
                <button
                  type="button"
                  className="primary-btn"
                  style={{ padding: "6px 12px", fontSize: "0.85rem" }}
                  onClick={onRepeatInstruction}
                  aria-label="Repeat last instruction"
                >
                  🔊 {t("repeat") || "Repeat"}
                </button>
              )}
              {onNextStep && (
                <button
                  type="button"
                  className="primary-btn accent-btn"
                  style={{ padding: "6px 12px", fontSize: "0.85rem" }}
                  onClick={onNextStep}
                  aria-label="Advance to next step"
                >
                  ▶ {t("next_step") || "Next Step"}
                </button>
              )}
            </div>
          </div>

          {currentStep && (
            <div className="step-instruction-box">
              <div style={{ fontSize: "0.85rem", color: "#a5b4fc", fontWeight: 600 }}>
                {t("messages.turnStepOf", { current: currentStepIndex + 1, total: routeData.steps.length })}:
              </div>
              <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "#ffffff", marginTop: "4px" }}>
                {translateInstructionText(currentStep.instruction, language, destinationName)}
              </div>
              {currentStep.distanceMeters > 0 && (
                <div style={{ fontSize: "0.85rem", color: "rgba(255, 255, 255, 0.7)", marginTop: "2px" }}>
                  {t("messages.segmentDistance", { distance: formatLocalizedDistance(currentStep.distanceMeters, language) })} ({formatLocalizedDuration(currentStep.duration, language)})
                </div>
              )}
            </div>
          )}

          {/* Active Detected Obstacles in Path */}
          {liveDetections?.length > 0 && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.6)",
                borderRadius: "8px",
                padding: "8px 12px",
                marginTop: "10px",
                color: "#fca5a5",
                fontSize: "0.9rem"
              }}
              role="alert"
              aria-live="polite"
            >
              <strong>⚠️ {language.startsWith("kn") ? "ಮಾರ್ಗದಲ್ಲಿ ಅಡಚಣೆ ಪತ್ತೆಯಾಗಿದೆ:" : language.startsWith("hi") ? "रास्ते में बाधा का पता चला:" : "Obstacle in view:"}</strong>{" "}
              {liveDetections
                .slice(0, 2)
                .map((d) => `${d.class_name}${d.distance ? ` (${d.distance}m)` : ""}${d.direction ? ` ${d.direction}` : ""}`)
                .join(", ")}
            </div>
          )}
        </div>
      )}

      {errorMessage && status === "ERROR" && (
        <div className="result-box" style={{ borderColor: "#f44336", color: "#fca5a5", marginTop: "12px" }}>
          ⚠️ {errorMessage}
        </div>
      )}
    </div>
  );
}

export default OutdoorMap;
