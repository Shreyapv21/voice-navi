// frontend/components/IndoorSlamPanel.jsx
import React, { useState, useEffect, useRef } from "react";
import { useLanguage } from "../utils/LanguageContext.jsx";

export function IndoorSlamPanel({ speakText, slamControlRef }) {
  const { t } = useLanguage();
  const [isExploring, setIsExploring] = useState(false);
  const [slamState, setSlamState] = useState({
    status: "idle",
    pose: { x: 0, y: 0, heading: 0 },
    confidence: 0,
    tracking_lost: false,
    tracked_features: 0,
    inlier_features: 0,
    keyframes_count: 0,
    map: { nodes: [], edges: [], landmarks: [] }
  });
  const [destinationQuery, setDestinationQuery] = useState("");
  const [routePlan, setRoutePlan] = useState(null);
  const [slamError, setSlamError] = useState("");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const frameIntervalRef = useRef(null);
  const isProcessingRef = useRef(false);
  const lastSpokenWarningTimeRef = useRef(0);

  const startExploration = async () => {
    setSlamError("");
    setRoutePlan(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Reset backend SLAM
      await fetch("/slam/reset/", { method: "POST" });

      setIsExploring(true);
      speakText(t("messages.slamStarted"));

      // Process frames every 1.2s for visual odometry
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = setInterval(captureAndProcessSlamFrame, 1200);
    } catch (err) {
      console.error("Camera access failed for SLAM:", err);
      const msg = t("messages.cameraError");
      setSlamError(msg);
      speakText(msg);
    }
  };

  const stopExploration = () => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsExploring(false);
    speakText(t("messages.slamStopped"));
  };

  const pauseExploration = () => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
  };

  const resumeExploration = () => {
    if (isExploring && !frameIntervalRef.current) {
      frameIntervalRef.current = setInterval(captureAndProcessSlamFrame, 1200);
    }
  };

  useEffect(() => {
    if (slamControlRef) {
      slamControlRef.current = {
        start: startExploration,
        stop: stopExploration,
        pause: pauseExploration,
        resume: resumeExploration,
        isExploring: () => isExploring
      };
    }
  });

  useEffect(() => {
    return () => {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const captureAndProcessSlamFrame = async () => {
    if (isProcessingRef.current || !videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    if (video.readyState < 2) return;

    isProcessingRef.current = true;
    try {
      const canvas = canvasRef.current;
      canvas.width = 480;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            isProcessingRef.current = false;
            return;
          }
          const formData = new FormData();
          formData.append("file", blob, "slam_frame.jpg");

          try {
            const res = await fetch("/slam/frame/", {
              method: "POST",
              body: formData
            });
            const data = await res.json();
            if (data.status === "success") {
              setSlamState(data);

              // Warn if tracking is lost (cooldown 8s)
              const now = Date.now();
              if (data.tracking_lost && now - lastSpokenWarningTimeRef.current > 8000) {
                lastSpokenWarningTimeRef.current = now;
                speakText(t("messages.slamLost"));
              }
            }
          } catch (err) {
            console.warn("SLAM frame request error:", err);
          } finally {
            isProcessingRef.current = false;
          }
        },
        "image/jpeg",
        0.7
      );
    } catch (err) {
      console.warn("Frame capture error:", err);
      isProcessingRef.current = false;
    }
  };

  const handlePlanRoute = async () => {
    if (!destinationQuery.trim()) return;
    try {
      const res = await fetch("/slam/route/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: destinationQuery.trim() })
      });
      const data = await res.json();
      setRoutePlan(data);
      if (data.status === "success") {
        const first = data.steps?.[0]?.instruction || "";
        speakText(`Route found to ${data.destination}. ${first}`);
      } else if (data.status === "unobserved") {
        speakText(
          t("messages.slamUnmappedDestination", { destination: destinationQuery }) +
            (data.suggestion ? ` Heading toward ${data.suggestion}.` : "")
        );
      } else {
        speakText(data.message || "Could not find a route.");
      }
    } catch (err) {
      console.error("SLAM route error:", err);
      speakText("Error planning route on explored graph.");
    }
  };

  const nodes = slamState.map?.nodes || [];
  const edges = slamState.map?.edges || [];
  const landmarks = slamState.map?.landmarks || [];

  return (
    <div className="indoor-slam-panel" role="region" aria-label="Indoor SLAM Exploration">
      <style>{`
        .indoor-slam-panel {
          background: #111827;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 16px;
          padding: 16px;
          margin-top: 15px;
          color: white;
        }
        .slam-header-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          border-radius: 20px;
          background: rgba(102, 126, 234, 0.2);
          color: #a5b4fc;
          font-weight: 600;
          font-size: 0.95rem;
          margin-bottom: 10px;
        }
        .slam-metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 10px;
          margin: 12px 0;
        }
        .slam-metric-card {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          padding: 10px 14px;
          text-align: center;
        }
        .slam-metric-val {
          font-size: 1.4rem;
          font-weight: 700;
          color: #00f2fe;
          margin-top: 4px;
        }
        .slam-map-canvas {
          width: 100%;
          height: 320px;
          background: #0b0f19;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      `}</style>

      <div className="slam-header-badge" role="status">
        {t("slam_badge")}
      </div>

      <p style={{ fontSize: "0.95rem", color: "rgba(255, 255, 255, 0.75)", lineHeight: 1.6 }}>
        {t("slam_desc")}
      </p>

      {slamError && (
        <div className="result-box indoor-error" role="alert" style={{ margin: "10px 0" }}>
          ⚠️ {slamError}
        </div>
      )}

      {/* Video preview when exploring */}
      <div style={{ display: isExploring ? "block" : "none", margin: "12px 0" }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: "100%", maxHeight: "260px", borderRadius: "10px", background: "#000" }}
          aria-label="SLAM video stream"
        />
        <canvas ref={canvasRef} style={{ display: "none" }} />
      </div>

      <div className="indoor-btn-row" style={{ display: "flex", gap: "10px", margin: "12px 0" }}>
        {!isExploring ? (
          <button
            type="button"
            className="primary-btn success-btn"
            onClick={startExploration}
            aria-label={t("btn_start_slam")}
          >
            {t("btn_start_slam")}
          </button>
        ) : (
          <button
            type="button"
            className="primary-btn danger-btn"
            onClick={stopExploration}
            aria-label={t("btn_stop_slam")}
          >
            {t("btn_stop_slam")}
          </button>
        )}
      </div>

      {/* Real-time SLAM Metrics */}
      <div className="slam-metrics-grid" role="group" aria-label="Visual SLAM Telemetry">
        <div className="slam-metric-card">
          <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>{t("slam_tracking_confidence")}</div>
          <div
            className="slam-metric-val"
            style={{ color: slamState.confidence > 0.6 ? "#4caf50" : slamState.confidence > 0.3 ? "#ff9800" : "#f44336" }}
          >
            {Math.round(slamState.confidence * 100)}%
          </div>
        </div>

        <div className="slam-metric-card">
          <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>Tracked Points</div>
          <div className="slam-metric-val">{slamState.tracked_features}</div>
        </div>

        <div className="slam-metric-card">
          <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>{t("slam_landmarks_mapped")}</div>
          <div className="slam-metric-val">{landmarks.length}</div>
        </div>

        <div className="slam-metric-card">
          <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>{t("slam_keyframes")}</div>
          <div className="slam-metric-val">{slamState.keyframes_count}</div>
        </div>
      </div>

      {slamState.tracking_lost && (
        <div className="result-box" style={{ borderColor: "#f44336", color: "#fca5a5", marginBottom: "12px" }}>
          ⚠️ <strong>Tracking Lost:</strong> Hold the device steady, turn slightly, or retrace steps to allow feature relocalization.
        </div>
      )}

      {/* Topological Map Graph Canvas */}
      <div style={{ marginTop: "12px" }}>
        <div style={{ fontSize: "0.95rem", fontWeight: "600", marginBottom: "6px" }}>
          🗺 Explored Topological Walk Graph:
        </div>
        <div className="slam-map-canvas">
          <svg width="100%" height="100%" viewBox="-15 -15 30 30" style={{ transform: "scaleY(-1)" }}>
            {/* Draw Graph Edges */}
            {edges.map((e, idx) => {
              const u = nodes.find((n) => n.id === e.from);
              const v = nodes.find((n) => n.id === e.to);
              if (!u || !v) return null;
              return (
                <line
                  key={idx}
                  x1={u.x}
                  y1={u.y}
                  x2={v.x}
                  y2={v.y}
                  stroke="#38bdf8"
                  strokeWidth="0.4"
                  strokeDasharray="1,1"
                />
              );
            })}

            {/* Draw Graph Nodes */}
            {nodes.map((node) => (
              <circle
                key={node.id}
                cx={node.x}
                cy={node.y}
                r="0.8"
                fill={node.type === "origin" ? "#4caf50" : node.type === "door" ? "#f59e0b" : "#3b82f6"}
              />
            ))}

            {/* Draw Observed Landmarks */}
            {landmarks.map((lm, idx) => (
              <g key={idx}>
                <rect x={lm.x - 1} y={lm.y - 1} width="2" height="2" fill="#ec4899" rx="0.5" />
              </g>
            ))}

            {/* Current Pose Pointer */}
            <g transform={`translate(${slamState.pose.x}, ${slamState.pose.y}) rotate(${slamState.pose.heading})`}>
              <polygon points="0,1.5 -1,-1 1,-1" fill="#00f2fe" stroke="#fff" strokeWidth="0.2" />
            </g>
          </svg>
        </div>
      </div>

      {/* Destination Request on Explored Graph */}
      <div style={{ marginTop: "16px" }}>
        <label htmlFor="slam-dest-input" style={{ display: "block", fontWeight: "600", marginBottom: "6px" }}>
          Navigate to Discovered Landmark:
        </label>
        <div className="nav-input-row" style={{ display: "flex", gap: "10px" }}>
          <input
            id="slam-dest-input"
            type="text"
            className="nav-input"
            placeholder='e.g., "Door", "Stairs", "Signboard"'
            value={destinationQuery}
            onChange={(e) => setDestinationQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handlePlanRoute()}
            aria-label="Enter indoor destination to navigate on explored graph"
          />
          <button type="button" className="primary-btn" onClick={handlePlanRoute}>
            🧭 Navigate
          </button>
        </div>
      </div>

      {routePlan && (
        <div className="result-box" style={{ marginTop: "12px", borderColor: "#38bdf8" }} aria-live="polite">
          <div className="result-title" style={{ color: "#38bdf8" }}>
            {routePlan.status === "success"
              ? `Route to ${routePlan.destination}`
              : routePlan.status === "unobserved"
              ? "Unobserved Destination"
              : "Route Status"}
          </div>
          <div className="result-content">
            {routePlan.message && <div>{routePlan.message}</div>}
            {routePlan.steps && (
              <ol style={{ paddingLeft: "20px", marginTop: "8px" }}>
                {routePlan.steps.map((s, i) => (
                  <li key={i} style={{ marginBottom: "6px" }}>
                    {s.instruction}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      <div className="result-box" style={{ marginTop: "14px", background: "rgba(255, 255, 255, 0.03)" }} role="note">
        <div style={{ fontSize: "0.85rem", opacity: 0.75, lineHeight: 1.5 }}>
          ⚠️ <strong>SLAM Safety Note:</strong> Visual odometry is calculated from monocular camera optical flow. True metric scale and floor-to-floor altitude require an IMU and depth sensor. Never describe a floor as fully mapped when only a few frames have been processed.
        </div>
      </div>
    </div>
  );
}

export default IndoorSlamPanel;
