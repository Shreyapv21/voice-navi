// frontend/components/IndoorNavigationPanel.jsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconPlayerStop,
  IconAlertTriangle,
  IconRoute,
  IconVolume,
  IconArrowRight,
  IconDoor,
  IconElevator,
  IconStairs,
  IconUser,
  IconArmchair,
  IconBuildingArch,
  IconMapPin,
  IconMoon,
  IconActivity,
  IconChevronUp,
  IconChevronDown,
  IconSearch,
  IconDoorExit
} from "@tabler/icons-react";
import {
  sendSlamFrame,
  fetchSlamStatus,
  resetSlamSession,
  planSlamRoute,
  checkSlamHealth
} from "../utils/indoor/indoorApi.js";
import { IndoorNavigationManager } from "../utils/indoor/indoorNavigationManager.js";
import { useLanguage } from "../utils/LanguageContext.jsx";

export function IndoorNavigationPanel({
  speakText,
  sharedManagerRef,
  uiSync,
  slamControlRef,
  ocrText
}) {
  const { t } = useLanguage();

  // ---------------- Session & SLAM States ----------------
  const [isScanning, setIsScanning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(true);

  // Diagnostics counters
  const [diagnostics, setDiagnostics] = useState({
    cameraStatus: "Camera inactive",
    cameraResolution: "0x0",
    framesSent: 0,
    framesProcessed: 0,
    lastLatencyMs: 0,
    backendStatus: "Checking connection...",
    lastError: null,
    lastFrameTimestamp: null
  });

  // SLAM State
  const [slamState, setSlamState] = useState({
    status: "idle",
    state: "idle",
    pose: { x: 0, y: 0, heading: 0 },
    confidence: 0,
    tracking_lost: false,
    relocalized: false,
    status_message: "Ready to start indoor scanning.",
    motion_blur: false,
    low_light: false,
    tracked_features: 0,
    inlier_features: 0,
    keyframes_count: 0,
    active_destination: null,
    scale_info: {
      type: "monocular_approximate",
      step_scale_m: 0.35,
      disclaimer: "Monocular visual odometry lacks absolute metric scale. Distances are estimated based on typical pedestrian motion."
    },
    occupancy_summary: { resolution_m: 0.2, walkable_cells: 0, obstacle_cells: 0, explored_area_m2: 0 },
    map: { nodes: [], edges: [], landmarks: [], trajectory: [] }
  });

  // ---------------- Perception State ----------------
  const [perceptionState, setPerceptionState] = useState({
    objects: [],
    structural_perception: {
      corridor_detected: false,
      corridor_heading: "centered",
      heading_guidance: "Awaiting visual corridor lines.",
      vanishing_point: [240, 160],
      floor_polygon: []
    },
    model_info: {
      detector: "YOLOv8n + Architectural Perception",
      model_status: "loading",
      supported_classes: ["door", "elevator", "person", "chair", "wall", "corridor"],
      inference_time_ms: 0
    }
  });

  // ---------------- Destination & Route State ----------------
  const [destinationInput, setDestinationInput] = useState("");
  const [isPlanningRoute, setIsPlanningRoute] = useState(false);
  const [routePlan, setRoutePlan] = useState(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [navigationFeedback, setNavigationFeedback] = useState("");

  // ---------------- Hardware Refs ----------------
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const perceptionOverlayRef = useRef(null);
  const mapCanvasRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processingIntervalRef = useRef(null);
  const isFrameProcessingRef = useRef(false);
  const managerRef = useRef(null);
  const lastWarningTimeRef = useRef(0);
  const lastSpokenPerceptionRef = useRef({});

  // ---------------- Initialize Indoor Manager ----------------
  useEffect(() => {
    if (sharedManagerRef && sharedManagerRef.current) {
      managerRef.current = sharedManagerRef.current;
    } else {
      managerRef.current = new IndoorNavigationManager({
        onStateChange: (patch) => {
          if (patch.route) setRoutePlan(patch.route);
          if (patch.currentStepIndex !== undefined) setCurrentStepIndex(patch.currentStepIndex);
        },
        onSpeak: (msg) => speakText(msg),
        onError: (_code, msg) => setNavigationFeedback(msg)
      });
      if (sharedManagerRef) sharedManagerRef.current = managerRef.current;
    }
  }, [sharedManagerRef, speakText]);

  // Check SLAM & Perception backend health on mount
  useEffect(() => {
    let isMounted = true;
    (async () => {
      const health = await checkSlamHealth();
      if (!isMounted) return;
      if (health.status === "ok") {
        setDiagnostics((prev) => ({
          ...prev,
          backendStatus: "Online (FastAPI :8000 & Express :5000)"
        }));
      } else {
        setDiagnostics((prev) => ({
          ...prev,
          backendStatus: "Offline / Unreachable (" + (health.message || "Start AI service on port 8000") + ")"
        }));
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // Ensure stream stays bound to video element across renders
  useEffect(() => {
    if (mediaStreamRef.current && videoRef.current) {
      const video = videoRef.current;
      if (video.srcObject !== mediaStreamRef.current) {
        video.srcObject = mediaStreamRef.current;
        video.muted = true;
        video.play().catch((e) => console.warn("Video play re-attach error:", e));
      }
    }
  }, [isScanning]);

  // ---------------- Camera & SLAM Control ----------------
  const startIndoorScan = async () => {
    setCameraError("");
    setNavigationFeedback("");
    setRoutePlan(null);

    // 1. Secure context validation (crucial for iOS / iPhone over ngrok)
    if (typeof window !== "undefined") {
      const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      if (!window.isSecureContext && !isLocalhost) {
        const msg = "Camera requires HTTPS. Please access this web application via your HTTPS ngrok URL on iPhone.";
        setCameraError(msg);
        speakText(msg);
        return;
      }
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const msg = "Browser camera API (getUserMedia) is unavailable. Please ensure HTTPS is enabled.";
      setCameraError(msg);
      speakText(msg);
      return;
    }

    setDiagnostics((prev) => ({ ...prev, cameraStatus: "Requesting camera permission..." }));

    // 2. Multi-tier camera constraints (tries environment rear camera, falls back gracefully)
    let stream = null;
    let lastErr = null;
    const constraintTiers = [
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: { facingMode: "environment" }, audio: false },
      { video: true, audio: false }
    ];

    for (const constraints of constraintTiers) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (stream) break;
      } catch (err) {
        lastErr = err;
        console.warn("Retrying with looser camera constraints:", err.name, err.message);
      }
    }

    if (!stream) {
      let friendlyError = "Camera access failed: " + (lastErr?.message || "Unknown error");
      if (lastErr?.name === "NotAllowedError" || lastErr?.name === "PermissionDeniedError") {
        friendlyError = "Camera permission denied. Please allow camera access in your iOS / Safari settings.";
      } else if (lastErr?.name === "NotFoundError" || lastErr?.name === "DevicesNotFoundError") {
        friendlyError = "No camera found on this device.";
      } else if (lastErr?.name === "NotReadableError" || lastErr?.name === "TrackStartError") {
        friendlyError = "Camera is currently locked by another application. Please close other camera tabs.";
      }
      setCameraError(friendlyError);
      setDiagnostics((prev) => ({ ...prev, cameraStatus: friendlyError, lastError: friendlyError }));
      speakText(friendlyError);
      return;
    }

    // 3. Bind live stream directly to video element
    mediaStreamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      video.muted = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      try {
        await video.play();
      } catch (playErr) {
        console.warn("Video play error (handled):", playErr);
      }
    }

    // 4. Initialize SLAM mapping session once on backend
    try {
      await resetSlamSession();
    } catch (resetErr) {
      console.warn("SLAM reset warning:", resetErr);
    }

    setIsScanning(true);
    setIsPaused(false);
    setDiagnostics((prev) => ({
      ...prev,
      cameraStatus: "Live stream running",
      cameraResolution: video ? `${video.videoWidth || 640}x${video.videoHeight || 480}` : "640x480"
    }));

    speakText("Indoor real-time SLAM and structural perception started. Camera active.");

    // 5. Continuous frame processing interval (every 500ms for responsive visual odometry & perception)
    if (processingIntervalRef.current) clearInterval(processingIntervalRef.current);
    processingIntervalRef.current = setInterval(captureAndSendFrame, 500);
  };

  const stopIndoorScan = useCallback(() => {
    if (processingIntervalRef.current) {
      clearInterval(processingIntervalRef.current);
      processingIntervalRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsScanning(false);
    setIsPaused(false);
    setRoutePlan(null);
    managerRef.current?.stopNavigation(true);

    // Clear overlay
    const overlay = perceptionOverlayRef.current;
    if (overlay) {
      const ctx = overlay.getContext("2d");
      ctx.clearRect(0, 0, overlay.width, overlay.height);
    }

    setDiagnostics((prev) => ({
      ...prev,
      cameraStatus: "Camera stopped",
      cameraResolution: "0x0"
    }));

    speakText("Indoor navigation session stopped.");
  }, [speakText]);

  const pauseIndoorScan = useCallback(() => {
    if (processingIntervalRef.current) {
      clearInterval(processingIntervalRef.current);
      processingIntervalRef.current = null;
    }
    setIsPaused(true);
    setDiagnostics((prev) => ({ ...prev, cameraStatus: "Paused (Scan state preserved)" }));
    speakText("Indoor navigation paused. Map and perception state preserved.");
  }, [speakText]);

  const resumeIndoorScan = useCallback(() => {
    if (isScanning && !processingIntervalRef.current) {
      processingIntervalRef.current = setInterval(captureAndSendFrame, 500);
      setIsPaused(false);
      setDiagnostics((prev) => ({ ...prev, cameraStatus: "Live stream running" }));
      speakText("Resuming indoor navigation.");
    }
  }, [isScanning, speakText]);

  // Expose controls to App and Voice Command Orchestrator
  useEffect(() => {
    if (slamControlRef) {
      slamControlRef.current = {
        start: startIndoorScan,
        stop: stopIndoorScan,
        pause: pauseIndoorScan,
        resume: resumeIndoorScan,
        isScanning: () => isScanning,
        planRoute: (dest) => handlePlanRoute(dest)
      };
    }
  }, [slamControlRef, isScanning, stopIndoorScan, pauseIndoorScan, resumeIndoorScan]);

  // Handle external UI sync commands
  useEffect(() => {
    if (!uiSync) return;
    if (uiSync.slamCommand === "start" && !isScanning) {
      startIndoorScan();
    } else if (uiSync.slamCommand === "stop" && isScanning) {
      stopIndoorScan();
    } else if (uiSync.slamCommand === "pause" && isScanning) {
      pauseIndoorScan();
    } else if (uiSync.slamCommand === "resume" && isScanning) {
      resumeIndoorScan();
    }
  }, [uiSync]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (processingIntervalRef.current) clearInterval(processingIntervalRef.current);
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ---------------- Continuous Frame Capture & Processing ----------------
  const captureAndSendFrame = async () => {
    if (isFrameProcessingRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    isFrameProcessingRef.current = true;
    const startTime = performance.now();

    try {
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.width = 480;
      canvas.height = 360;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            isFrameProcessingRef.current = false;
            return;
          }

          try {
            const data = await sendSlamFrame(blob, ocrText || null);
            const latency = Math.round(performance.now() - startTime);

            setDiagnostics((prev) => ({
              ...prev,
              framesSent: prev.framesSent + 1,
              framesProcessed: prev.framesProcessed + 1,
              lastLatencyMs: latency,
              cameraResolution: `${video.videoWidth}x${video.videoHeight}`,
              backendStatus: "Connected (200 OK)",
              lastFrameTimestamp: new Date().toLocaleTimeString(),
              lastError: null
            }));

            if (data && data.status === "success") {
              setSlamState(data);
              managerRef.current?.handleSlamFrameResult(data);

              // Update perception state
              if (data.perception) {
                setPerceptionState(data.perception);
                renderPerceptionOverlay(data.perception);
                handlePerceptionAnnouncements(data.perception);
              }

              // SLAM tracking health speech
              const now = Date.now();
              if (data.relocalized) {
                speakText("Visual tracking restored.");
              } else if (data.tracking_lost && now - lastWarningTimeRef.current > 8000) {
                lastWarningTimeRef.current = now;
                if (data.low_light) {
                  speakText("Lighting is too low. Move camera towards a lit area.");
                } else if (data.motion_blur) {
                  speakText("Camera moving too fast. Please slow down and hold steady.");
                } else {
                  speakText("Visual tracking lost. Slowly pan camera toward previously seen area.");
                }
              }
            } else if (data && data.status === "error") {
              setDiagnostics((prev) => ({
                ...prev,
                lastError: data.message || "SLAM processing error"
              }));
            }
          } catch (netErr) {
            console.warn("SLAM frame network error:", netErr);
            setDiagnostics((prev) => ({
              ...prev,
              backendStatus: "Connection Error: " + netErr.message,
              lastError: netErr.message
            }));
          } finally {
            isFrameProcessingRef.current = false;
          }
        },
        "image/jpeg",
        0.65
      );
    } catch (err) {
      console.warn("Frame capture error:", err);
      isFrameProcessingRef.current = false;
    }
  };

  // ---------------- Rate-Limited Perception Announcements ----------------
  const handlePerceptionAnnouncements = (perception) => {
    if (!perception) return;
    const now = Date.now();

    // 1. Object announcements (doors, elevators, persons, chairs)
    if (perception.objects && perception.objects.length > 0) {
      for (const obj of perception.objects) {
        const key = `${obj.class_name}_${obj.direction}`;
        const lastSpoken = lastSpokenPerceptionRef.current[key] || 0;

        // 9 second cooldown per unique object class + direction
        if (now - lastSpoken > 9000 && obj.confidence >= 0.52) {
          lastSpokenPerceptionRef.current[key] = now;

          if (obj.class_name === "door" || obj.class_name === "doorway") {
            speakText(`Doorway detected ${obj.direction}.`);
          } else if (obj.class_name === "elevator") {
            speakText(`Elevator detected ${obj.direction}.`);
          } else if (obj.class_name === "stairs") {
            speakText(`Stairs detected ${obj.direction}. Proceed with caution.`);
          } else if (obj.class_name === "person") {
            speakText(`Person ${obj.direction}.`);
          } else if (["chair", "couch", "table"].includes(obj.class_name)) {
            speakText(`Obstacle: ${obj.label} ${obj.direction}.`);
          }
          break; // Announce only one object event per frame tick to avoid voice queue overflow
        }
      }
    }

    // 2. Structural corridor wall guidance
    const struct = perception.structural_perception;
    if (struct && struct.corridor_detected && struct.corridor_heading) {
      const heading = struct.corridor_heading;
      if (heading !== "centered") {
        const lastHeadingSpoken = lastSpokenPerceptionRef.current["corridor_heading"] || 0;
        if (now - lastHeadingSpoken > 12000) {
          lastSpokenPerceptionRef.current["corridor_heading"] = now;
          if (heading === "deviating_left") {
            speakText("Approaching left wall. Bear slightly right to center in corridor.");
          } else if (heading === "deviating_right") {
            speakText("Approaching right wall. Bear slightly left to center in corridor.");
          }
        }
      }
    }
  };

  // ---------------- Render Live Perception Overlay on Camera Feed ----------------
  const renderPerceptionOverlay = (perception) => {
    const canvas = perceptionOverlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Frame scale factors from actual source frame dimensions
    const frameW = perception.model_info?.frame_size?.[0] || 480.0;
    const frameH = perception.model_info?.frame_size?.[1] || 360.0;
    const scaleX = width / frameW;
    const scaleY = height / frameH;

    // 1. Draw Structural Corridor Boundaries & Vanishing Point
    const struct = perception.structural_perception;
    if (struct && struct.corridor_detected) {
      const vp = struct.vanishing_point || [frameW / 2, frameH * 0.45];
      const vpx = vp[0] * scaleX;
      const vpy = vp[1] * scaleY;

      // Draw corridor floor polygon
      if (struct.floor_polygon && struct.floor_polygon.length >= 3) {
        ctx.fillStyle = "rgba(168, 85, 247, 0.14)";
        ctx.beginPath();
        ctx.moveTo(struct.floor_polygon[0][0] * scaleX, struct.floor_polygon[0][1] * scaleY);
        for (let i = 1; i < struct.floor_polygon.length; i++) {
          ctx.lineTo(struct.floor_polygon[i][0] * scaleX, struct.floor_polygon[i][1] * scaleY);
        }
        ctx.closePath();
        ctx.fill();
      }

      // Draw left & right wall perspective lines converging at vanishing point
      ctx.strokeStyle = "#c084fc";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 6]);

      // Left boundary
      ctx.beginPath();
      ctx.moveTo(0, height - 10);
      ctx.lineTo(vpx, vpy);
      ctx.stroke();

      // Right boundary
      ctx.beginPath();
      ctx.moveTo(width, height - 10);
      ctx.lineTo(vpx, vpy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Vanishing Point circle
      ctx.fillStyle = "#a855f7";
      ctx.beginPath();
      ctx.arc(vpx, vpy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 2. Draw Detected Objects (Doors, Elevators, Stairs, People, Obstacles)
    const objects = perception.objects || [];
    for (const obj of objects) {
      const [x1, y1, x2, y2] = obj.bbox;
      const sx1 = x1 * scaleX;
      const sy1 = y1 * scaleY;
      const sw = (x2 - x1) * scaleX;
      const sh = (y2 - y1) * scaleY;

      // Color scheme based on classification
      let boxColor = "#38bdf8"; // Cyan for doors
      let icon = "🚪";
      if (obj.class_name === "elevator") {
        boxColor = "#fbbf24"; // Gold for elevator
        icon = "🛗";
      } else if (obj.class_name === "stairs") {
        boxColor = "#f59e0b"; // Amber for stairs
        icon = "🪜";
      } else if (obj.class_name === "person") {
        boxColor = "#34d399"; // Green for person
        icon = "👤";
      } else if (["chair", "couch", "table"].includes(obj.class_name)) {
        boxColor = "#f87171"; // Red for obstacle
        icon = "🪑";
      }

      // Bounding box
      ctx.strokeStyle = boxColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(sx1, sy1, sw, sh);

      // Label badge
      const confPercent = Math.round((obj.confidence || 0) * 100);
      const labelText = `${icon} ${obj.label} ${confPercent}%`;
      ctx.font = "bold 11px sans-serif";
      const textMetrics = ctx.measureText(labelText);

      ctx.fillStyle = boxColor;
      ctx.fillRect(sx1, Math.max(0, sy1 - 20), textMetrics.width + 10, 20);

      ctx.fillStyle = "#090d16";
      ctx.fillText(labelText, sx1 + 5, Math.max(14, sy1 - 5));
    }
  };

  // ---------------- Dynamic Route Planning ----------------
  const handlePlanRoute = async (targetDest = null) => {
    const query = (targetDest || destinationInput).trim();
    if (!query) {
      setNavigationFeedback("Please enter or say a destination (e.g. 'Exit', 'Stairs', 'Doorway').");
      return;
    }

    setIsPlanningRoute(true);
    setNavigationFeedback("");

    try {
      const plan = await planSlamRoute(query);
      if (plan.status === "success") {
        setRoutePlan(plan);
        setCurrentStepIndex(0);
        setNavigationFeedback(`Navigating to ${plan.destination}. Total estimated distance: ~${plan.total_distance_m}m.`);
        const first = plan.steps?.[0]?.instruction || "";
        speakText(`Route found to ${plan.destination}. ${first}`);
      } else if (plan.status === "unobserved") {
        setRoutePlan(null);
        setNavigationFeedback(plan.message);
        const suggestion = plan.suggestion ? ` Heading suggestion: ${plan.suggestion}.` : "";
        speakText(plan.message + suggestion);
      } else if (plan.status === "arrived") {
        setRoutePlan(null);
        setNavigationFeedback(plan.message);
        speakText(plan.message);
      } else {
        setRoutePlan(null);
        const msg = plan.message || `No traversable path to ${query}.`;
        setNavigationFeedback(msg);
        speakText(msg);
      }
    } catch (err) {
      console.error("Route planning error:", err);
      const msg = `Route planning failed: ${err.message}`;
      setNavigationFeedback(msg);
      speakText(msg);
    } finally {
      setIsPlanningRoute(false);
    }
  };

  const handleNextStep = () => {
    if (!routePlan || !routePlan.steps?.length) return;
    if (currentStepIndex < routePlan.steps.length - 1) {
      const nextIdx = currentStepIndex + 1;
      setCurrentStepIndex(nextIdx);
      const nextStep = routePlan.steps[nextIdx];
      speakText(nextStep.instruction);
    }
  };

  const handleRepeatStep = () => {
    if (!routePlan || !routePlan.steps?.length) {
      speakText(slamState.status_message || "Scanning environment.");
      return;
    }
    const current = routePlan.steps[currentStepIndex];
    if (current) {
      speakText(current.instruction);
    }
  };

  // ---------------- Discovered Map Canvas Rendering ----------------
  useEffect(() => {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    // Clear background to dark unknown space
    ctx.fillStyle = "#090d16";
    ctx.fillRect(0, 0, width, height);

    // Draw subtle 1-meter coordinate grid
    ctx.strokeStyle = "#172033";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 28) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const cx = width / 2;
    const cy = height / 2;
    const scale = 28; // 28 pixels per meter

    const userX = slamState.pose?.x || 0.0;
    const userY = slamState.pose?.y || 0.0;

    // Camera/user centric offset
    const toCanvasX = (worldX) => cx + (worldX - userX * 0.4) * scale;
    const toCanvasY = (worldY) => cy - (worldY - userY * 0.4) * scale;

    const nodes = slamState.map?.nodes || [];
    const edges = slamState.map?.edges || [];
    const landmarks = slamState.map?.landmarks || [];
    const walls = slamState.map?.walls || [];
    const trajectory = slamState.map?.trajectory || [];
    const occupancy = slamState.map?.occupancy_grid || {};
    const freeCells = occupancy.free_cells || [];
    const obstacleCells = occupancy.obstacle_cells || [];
    const resM = occupancy.resolution || 0.2;
    const cellSizePx = Math.max(5, Math.round(resM * scale));

    // 1. Draw Traversable Free Space (Observed Walkable Floor)
    if (freeCells.length > 0) {
      ctx.fillStyle = "rgba(16, 185, 129, 0.26)"; // Emerald traversable floor
      for (const [fx, fy] of freeCells) {
        ctx.fillRect(toCanvasX(fx) - cellSizePx / 2, toCanvasY(fy) - cellSizePx / 2, cellSizePx, cellSizePx);
      }
    }

    // 2. Draw Obstacles / Blocked Cells
    if (obstacleCells.length > 0) {
      ctx.fillStyle = "rgba(239, 68, 68, 0.70)"; // Red obstacles & hazards
      for (const [ox, oy] of obstacleCells) {
        ctx.fillRect(toCanvasX(ox) - cellSizePx / 2, toCanvasY(oy) - cellSizePx / 2, cellSizePx, cellSizePx);
      }
    }

    // 3. Draw Observed Corridor Wall Boundaries
    if (walls.length > 0) {
      ctx.strokeStyle = "#c084fc"; // Purple corridor wall
      ctx.lineWidth = 3.5;
      ctx.setLineDash([]);
      for (const w of walls) {
        ctx.beginPath();
        ctx.moveTo(toCanvasX(w.x1), toCanvasY(w.y1));
        ctx.lineTo(toCanvasX(w.x2), toCanvasY(w.y2));
        ctx.stroke();
      }
    }

    // 4. Draw Traversed Trajectory
    if (trajectory.length > 1) {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(toCanvasX(trajectory[0].x), toCanvasY(trajectory[0].y));
      for (let i = 1; i < trajectory.length; i++) {
        ctx.lineTo(toCanvasX(trajectory[i].x), toCanvasY(trajectory[i].y));
      }
      ctx.stroke();
    }

    // 5. Draw Discovered Topological Edges
    ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    for (const edge of edges) {
      const u = nodes.find((n) => n.id === edge.from);
      const v = nodes.find((n) => n.id === edge.to);
      if (u && v) {
        ctx.beginPath();
        ctx.moveTo(toCanvasX(u.x), toCanvasY(u.y));
        ctx.lineTo(toCanvasX(v.x), toCanvasY(v.y));
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // 6. Draw Discovered Nodes & Waypoints
    for (const node of nodes) {
      const px = toCanvasX(node.x);
      const py = toCanvasY(node.y);

      ctx.fillStyle = node.type === "origin" ? "#22c55e" : "#64748b";
      ctx.beginPath();
      ctx.arc(px, py, node.type === "origin" ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();

      if (node.type === "origin" || node.type === "destination") {
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 10px sans-serif";
        ctx.fillText(node.label || node.id, px + 8, py + 3);
      }
    }

    // 7. Draw Observed Landmarks (Doorways, Elevators, Stairs, Exits, Obstacles)
    ctx.font = "bold 10px sans-serif";
    for (const lm of landmarks) {
      const lx = toCanvasX(lm.x);
      const ly = toCanvasY(lm.y);

      if (lm.type === "doorway") {
        ctx.fillStyle = "#38bdf8";
        ctx.fillRect(lx - 6, ly - 6, 12, 12);
        ctx.fillStyle = "#7dd3fc";
        ctx.fillText(`🚪 ${lm.label}`, lx + 8, ly + 4);
      } else if (lm.type === "elevator") {
        ctx.fillStyle = "#fbbf24";
        ctx.fillRect(lx - 7, ly - 7, 14, 14);
        ctx.fillStyle = "#fde68a";
        ctx.fillText(`🛗 ${lm.label}`, lx + 9, ly + 4);
      } else if (lm.type === "stairs") {
        ctx.fillStyle = "#f59e0b";
        ctx.fillRect(lx - 6, ly - 6, 12, 12);
        ctx.fillStyle = "#fcd34d";
        ctx.fillText(`🪜 ${lm.label}`, lx + 8, ly + 4);
      } else if (lm.type === "exit") {
        ctx.fillStyle = "#10b981";
        ctx.fillRect(lx - 6, ly - 6, 12, 12);
        ctx.fillStyle = "#6ee7b7";
        ctx.fillText(`🚪 ${lm.label}`, lx + 8, ly + 4);
      } else {
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(lx, ly, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fca5a5";
        ctx.fillText(lm.label, lx + 8, ly + 4);
      }
    }

    // 8. Draw Active Planned Route
    if (routePlan && routePlan.steps) {
      ctx.strokeStyle = "#a855f7";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(toCanvasX(slamState.pose.x), toCanvasY(slamState.pose.y));
      for (const step of routePlan.steps) {
        const targetNode = nodes.find((n) => n.id === step.to_id);
        if (targetNode) {
          ctx.lineTo(toCanvasX(targetNode.x), toCanvasY(targetNode.y));
        }
      }
      ctx.stroke();
    }

    // 9. Draw User Pose with Forward Heading Field-of-View Cone
    const ux = toCanvasX(slamState.pose.x);
    const uy = toCanvasY(slamState.pose.y);
    const headingRad = (slamState.pose.heading * Math.PI) / 180.0;

    // Heading field-of-view cone illuminating forward space
    ctx.fillStyle = "rgba(56, 189, 248, 0.28)";
    ctx.beginPath();
    ctx.moveTo(ux, uy);
    ctx.arc(ux, uy, 32, headingRad - 0.45, headingRad + 0.45);
    ctx.closePath();
    ctx.fill();

    // User marker
    ctx.fillStyle = slamState.tracking_lost ? "#ef4444" : "#38bdf8";
    ctx.beginPath();
    ctx.arc(ux, uy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [slamState, routePlan]);

  const discoveredLandmarks = slamState.map?.landmarks || [];
  const confidencePercent = Math.round((slamState.confidence || 0) * 100);
  const detectedObjects = perceptionState.objects || [];
  const structuralPerception = perceptionState.structural_perception;

  return (
    <div className="indoor-navigation-slam-container" role="region" aria-label="Indoor Real-Time SLAM Navigation">
      <style>{`
        .indoor-navigation-slam-container {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          color: #f8fafc;
        }
        .slam-header-card {
          background: #1e293b;
          border-radius: 0.75rem;
          padding: 1.25rem;
          border: 1px solid #334155;
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
        }
        .slam-title-group h2 {
          margin: 0 0 0.25rem 0;
          font-size: 1.4rem;
          color: #f8fafc;
        }
        .slam-title-group p {
          margin: 0;
          font-size: 0.875rem;
          color: #94a3b8;
        }
        .slam-action-buttons {
          display: flex;
          gap: 0.6rem;
          flex-wrap: wrap;
        }
        .slam-btn {
          padding: 0.65rem 1.25rem;
          font-weight: 600;
          border-radius: 0.5rem;
          border: none;
          cursor: pointer;
          transition: background 0.2s, transform 0.1s;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.95rem;
        }
        .slam-btn-primary {
          background: #2563eb;
          color: white;
        }
        .slam-btn-primary:hover {
          background: #1d4ed8;
        }
        .slam-btn-danger {
          background: #dc2626;
          color: white;
        }
        .slam-btn-danger:hover {
          background: #b91c1c;
        }
        .slam-btn-secondary {
          background: #475569;
          color: white;
        }
        .slam-btn-secondary:hover {
          background: #334155;
        }
        .slam-main-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.25rem;
        }
        @media (min-width: 900px) {
          .slam-main-grid {
            grid-template-columns: 1.1fr 1fr;
          }
        }
        .slam-camera-section {
          background: #0f172a;
          border-radius: 0.75rem;
          border: 1px solid #334155;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .video-wrapper {
          position: relative;
          width: 100%;
          height: 300px;
          background: #000;
          border-radius: 0.5rem;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .video-feed {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .video-placeholder {
          color: #64748b;
          text-align: center;
          padding: 1.5rem;
        }
        .perception-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }
        .status-badge-overlay {
          position: absolute;
          top: 0.75rem;
          left: 0.75rem;
          padding: 0.35rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          gap: 0.4rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          z-index: 2;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .dot-green { background: #22c55e; }
        .dot-red { background: #ef4444; }
        .dot-yellow { background: #f59e0b; }
        .perception-hud {
          background: #1e293b;
          border-radius: 0.5rem;
          padding: 0.75rem;
          border: 1px solid #334155;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .perception-title {
          font-size: 0.8rem;
          font-weight: 700;
          color: #94a3b8;
          text-transform: uppercase;
          display: flex;
          justify-content: space-between;
        }
        .perception-chips-container {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
        }
        .perception-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          padding: 0.3rem 0.65rem;
          border-radius: 0.35rem;
          font-size: 0.78rem;
          font-weight: 600;
        }
        .chip-door { background: rgba(56, 189, 248, 0.2); border: 1px solid #38bdf8; color: #7dd3fc; }
        .chip-elevator { background: rgba(251, 191, 36, 0.2); border: 1px solid #fbbf24; color: #fde68a; }
        .chip-stairs { background: rgba(245, 158, 11, 0.2); border: 1px solid #f59e0b; color: #fde68a; }
        .chip-person { background: rgba(52, 211, 153, 0.2); border: 1px solid #34d399; color: #a7f3d0; }
        .chip-obstacle { background: rgba(248, 113, 113, 0.2); border: 1px solid #f87171; color: #fca5a5; }
        .chip-corridor { background: rgba(192, 132, 252, 0.2); border: 1px solid #c084fc; color: #e9d5ff; }

        .telemetry-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
          gap: 0.5rem;
        }
        .telemetry-card {
          background: #1e293b;
          padding: 0.6rem;
          border-radius: 0.4rem;
          text-align: center;
          border: 1px solid #334155;
        }
        .telemetry-value {
          font-size: 1.1rem;
          font-weight: 700;
          color: #38bdf8;
        }
        .telemetry-label {
          font-size: 0.7rem;
          color: #94a3b8;
          text-transform: uppercase;
        }
        .slam-map-section {
          background: #1e293b;
          border-radius: 0.75rem;
          border: 1px solid #334155;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .map-canvas-wrapper {
          position: relative;
          width: 100%;
          height: 300px;
          background: #0f172a;
          border-radius: 0.5rem;
          overflow: hidden;
          border: 1px solid #334155;
        }
        .map-canvas {
          width: 100%;
          height: 100%;
          display: block;
        }
        .diagnostics-panel {
          background: #090d16;
          border: 1px solid #334155;
          border-radius: 0.5rem;
          padding: 0.75rem;
          font-family: monospace;
          font-size: 0.78rem;
          color: #cbd5e1;
        }
        .diagnostics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 0.4rem 1rem;
          margin-top: 0.4rem;
        }
        .slam-guidance-card {
          background: #1e293b;
          border-radius: 0.75rem;
          border: 1px solid #334155;
          padding: 1.25rem;
        }
        .destination-form {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
        .destination-input {
          flex: 1;
          padding: 0.65rem 0.9rem;
          border-radius: 0.5rem;
          border: 1px solid #475569;
          background: #0f172a;
          color: white;
          font-size: 0.95rem;
        }
        .landmarks-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          margin-bottom: 1rem;
        }
        .landmark-chip {
          padding: 0.35rem 0.75rem;
          border-radius: 9999px;
          background: #334155;
          color: #cbd5e1;
          font-size: 0.8rem;
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.15s;
        }
        .landmark-chip:hover {
          background: #475569;
          border-color: #38bdf8;
          color: white;
        }
        .route-instruction-box {
          background: #0f172a;
          border-left: 4px solid #a855f7;
          border-radius: 0.5rem;
          padding: 1rem;
          margin-top: 0.75rem;
        }
        .instruction-title {
          font-size: 0.75rem;
          text-transform: uppercase;
          color: #c084fc;
          font-weight: 700;
          margin-bottom: 0.35rem;
        }
        .instruction-text {
          font-size: 1.15rem;
          font-weight: 600;
          color: #f8fafc;
          margin: 0;
        }
        .route-controls {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.75rem;
        }
        .warning-banner {
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid #ef4444;
          border-radius: 0.5rem;
          padding: 0.75rem 1rem;
          color: #fca5a5;
          font-size: 0.9rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .scale-disclaimer {
          font-size: 0.72rem;
          color: #94a3b8;
          margin-top: 0.5rem;
          font-style: italic;
        }
      `}</style>

      {/* Header & Controls */}
      <div className="slam-header-card">
        <div className="slam-title-group">
          <h2>Indoor Real-Time SLAM & Perception</h2>
          <p>Autonomous visual mapping, real-time door & elevator perception, and obstacle guidance.</p>
        </div>

        <div className="slam-action-buttons">
          {!isScanning ? (
            <button className="slam-btn slam-btn-primary" onClick={startIndoorScan}>
              <IconPlayerPlay size={18} aria-hidden="true" />
              <span>Start Indoor Scan</span>
            </button>
          ) : (
            <>
              {!isPaused ? (
                <button className="slam-btn slam-btn-secondary" onClick={pauseIndoorScan}>
                  <IconPlayerPause size={18} aria-hidden="true" />
                  <span>Pause</span>
                </button>
              ) : (
                <button className="slam-btn slam-btn-primary" onClick={resumeIndoorScan}>
                  <IconPlayerPlay size={18} aria-hidden="true" />
                  <span>Resume</span>
                </button>
              )}
              <button className="slam-btn slam-btn-danger" onClick={stopIndoorScan}>
                <IconPlayerStop size={18} aria-hidden="true" />
                <span>Stop Scan</span>
              </button>
            </>
          )}
        </div>
      </div>

      {cameraError && (
        <div className="warning-banner" role="alert" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <IconAlertTriangle size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>{cameraError}</span>
        </div>
      )}

      {/* Main Display Grid */}
      <div className="slam-main-grid">
        {/* Left Column: Live Camera, Perception Overlay & Telemetry */}
        <div className="slam-camera-section">
          <div className="video-wrapper">
            {/* The video element is ALWAYS mounted to guarantee ref persistence and iOS stream attachment */}
            <video
              ref={videoRef}
              className="video-feed"
              playsInline
              webkit-playsinline="true"
              muted
              autoPlay
              style={{ display: isScanning ? "block" : "none" }}
              aria-label="Live camera feed for visual SLAM"
            />

            {/* Canvas overlay rendering real-time bounding boxes and corridor vanishing lines */}
            <canvas
              ref={perceptionOverlayRef}
              width={480}
              height={360}
              className="perception-overlay"
              style={{ display: isScanning ? "block" : "none" }}
            />

            {!isScanning && (
              <div className="video-placeholder">
                <p style={{ margin: "0 0 0.5rem 0", fontSize: "1.1rem", fontWeight: "600", color: "#f8fafc" }}>
                  Camera Inactive
                </p>
                <small>Tap "Start Indoor Scan" to enable camera and begin real-time SLAM & perception.</small>
              </div>
            )}

            <canvas ref={canvasRef} style={{ display: "none" }} />

            {isScanning && (
              <div className="status-badge-overlay">
                <span
                  className={`status-dot ${
                    slamState.tracking_lost ? "dot-red" : slamState.confidence > 0.6 ? "dot-green" : "dot-yellow"
                  }`}
                />
                <span>
                  {slamState.tracking_lost
                    ? "Tracking Lost"
                    : isPaused
                    ? "Paused"
                    : slamState.active_destination
                    ? "Navigating"
                    : "Exploring & Perceiving"}
                </span>
              </div>
            )}
          </div>

          {/* Active Perception HUD */}
          <div className="perception-hud">
            <div className="perception-title">
              <span>Live Indoor Perception</span>
              <span style={{ color: "#38bdf8", fontSize: "0.72rem" }}>
                {perceptionState.model_info?.detector || "Perception Active"}
              </span>
            </div>

            <div className="perception-chips-container">
              {detectedObjects.length === 0 && !structuralPerception?.corridor_detected && (
                <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
                  No structural landmarks or objects in view. Pan slowly.
                </span>
              )}

              {detectedObjects.map((obj) => {
                let chipClass = "chip-door";
                let IconComponent = IconDoor;
                if (obj.class_name === "elevator") {
                  chipClass = "chip-elevator";
                  IconComponent = IconElevator;
                } else if (obj.class_name === "stairs") {
                  chipClass = "chip-stairs";
                  IconComponent = IconStairs;
                } else if (obj.class_name === "person") {
                  chipClass = "chip-person";
                  IconComponent = IconUser;
                } else if (["chair", "couch", "table"].includes(obj.class_name)) {
                  chipClass = "chip-obstacle";
                  IconComponent = IconArmchair;
                }

                return (
                  <span
                    key={obj.id}
                    className={`perception-chip ${chipClass}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    <IconComponent size={14} aria-hidden="true" />
                    <span>{obj.label} ({obj.direction}, {Math.round(obj.confidence * 100)}%)</span>
                  </span>
                );
              })}

              {structuralPerception?.corridor_detected && (
                <span
                  className="perception-chip chip-corridor"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                >
                  <IconBuildingArch size={14} aria-hidden="true" />
                  <span>Corridor: {structuralPerception.heading_guidance || "Centered"}</span>
                </span>
              )}
            </div>
          </div>

          {/* Telemetry Row */}
          <div className="telemetry-row">
            <div className="telemetry-card">
              <div className="telemetry-value">{confidencePercent}%</div>
              <div className="telemetry-label">Confidence</div>
            </div>
            <div className="telemetry-card">
              <div className="telemetry-value">{slamState.tracked_features || 0}</div>
              <div className="telemetry-label">Tracked Points</div>
            </div>
            <div className="telemetry-card">
              <div className="telemetry-value">{slamState.keyframes_count || 0}</div>
              <div className="telemetry-label">Keyframes</div>
            </div>
            <div className="telemetry-card">
              <div className="telemetry-value">
                {slamState.pose ? `${slamState.pose.x}m, ${slamState.pose.y}m` : "0, 0"}
              </div>
              <div className="telemetry-label">Pose (X, Y)</div>
            </div>
          </div>

          {/* Environmental Warnings */}
          {slamState.low_light && (
            <div className="warning-banner" role="alert" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconMoon size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span>Low light detected. Increase lighting for visual tracking.</span>
            </div>
          )}
          {slamState.motion_blur && (
            <div className="warning-banner" role="alert" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconActivity size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span>Camera motion blur detected. Please hold phone steadily.</span>
            </div>
          )}
        </div>

        {/* Right Column: Dynamic Discovered SLAM Map */}
        <div className="slam-map-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.9rem", fontWeight: "600", color: "#94a3b8" }}>
              Dynamic Discovered Map
            </span>
            <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
              Explored: {slamState.occupancy_summary?.explored_area_m2 || 0} m²
            </span>
          </div>

          <div className="map-canvas-wrapper">
            <canvas ref={mapCanvasRef} width={450} height={300} className="map-canvas" />
          </div>

          <div style={{ fontSize: "0.75rem", color: "#94a3b8", display: "flex", gap: "0.8rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} /> Free Floor
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#a855f7", display: "inline-block" }} /> Wall Boundary
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#38bdf8", display: "inline-block" }} /> Live Pose
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconDoor size={14} aria-hidden="true" style={{ color: "#38bdf8" }} /> Doorway
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconElevator size={14} aria-hidden="true" style={{ color: "#fbbf24" }} /> Elevator
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconStairs size={14} aria-hidden="true" style={{ color: "#f59e0b" }} /> Stairs
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} /> Obstacle
            </span>
          </div>

          <div className="scale-disclaimer">
            {slamState.scale_info?.disclaimer || "Distances estimated based on pedestrian step model."}
          </div>
        </div>
      </div>

      {/* System Diagnostics HUD */}
      <div className="diagnostics-panel">
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}
          onClick={() => setShowDiagnostics((prev) => !prev)}
        >
          <span style={{ fontWeight: "700", color: "#38bdf8", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconSearch size={16} aria-hidden="true" />
            <span>System Diagnostics & Perception Health</span>
            {showDiagnostics ? (
              <IconChevronUp size={16} aria-hidden="true" />
            ) : (
              <IconChevronDown size={16} aria-hidden="true" />
            )}
          </span>
          <span style={{ color: diagnostics.backendStatus.includes("Online") || diagnostics.backendStatus.includes("200") ? "#22c55e" : "#f59e0b" }}>
            {diagnostics.backendStatus}
          </span>
        </div>

        {showDiagnostics && (
          <div className="diagnostics-grid">
            <div><strong>Camera State:</strong> {diagnostics.cameraStatus}</div>
            <div><strong>Resolution:</strong> {diagnostics.cameraResolution}</div>
            <div><strong>Frames Sent:</strong> {diagnostics.framesSent}</div>
            <div><strong>Processed:</strong> {diagnostics.framesProcessed}</div>
            <div><strong>Latency:</strong> {diagnostics.lastLatencyMs} ms</div>
            <div><strong>Perception Latency:</strong> {perceptionState.model_info?.inference_time_ms || 0} ms</div>
            <div><strong>Model Status:</strong> {perceptionState.model_info?.model_status || "Active"}</div>
            <div><strong>Recognized Objects:</strong> {detectedObjects.length}</div>
            {diagnostics.lastError && (
              <div style={{ gridColumn: "1 / -1", color: "#ef4444" }}>
                <strong>Last Diagnostic Alert:</strong> {diagnostics.lastError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Guidance & Destination Discovery */}
      <div className="slam-guidance-card">
        <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1.1rem" }}>Destination Discovery & Guidance</h3>

        <div className="destination-form">
          <input
            type="text"
            className="destination-input"
            placeholder="Where would you like to go? (e.g. Exit, Stairs, Doorway, Elevator)"
            value={destinationInput}
            onChange={(e) => setDestinationInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handlePlanRoute()}
          />
          <button
            className="slam-btn slam-btn-primary"
            onClick={() => handlePlanRoute()}
            disabled={isPlanningRoute}
          >
            <IconRoute size={18} aria-hidden="true" />
            <span>{isPlanningRoute ? "Planning..." : "Find Route"}</span>
          </button>
        </div>

        {/* Discovered Landmarks Chips */}
        {discoveredLandmarks.length > 0 && (
          <div>
            <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: "0.4rem" }}>
              Actively Discovered Landmarks:
            </div>
            <div className="landmarks-chips">
              {discoveredLandmarks.map((lm) => {
                let LandmarkIcon = IconMapPin;
                if (lm.type === "doorway") LandmarkIcon = IconDoor;
                if (lm.type === "elevator") LandmarkIcon = IconElevator;
                if (lm.type === "exit") LandmarkIcon = IconDoorExit;
                if (lm.type === "stairs") LandmarkIcon = IconStairs;

                return (
                  <button
                    key={lm.id}
                    className="landmark-chip"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                    onClick={() => {
                      setDestinationInput(lm.label);
                      handlePlanRoute(lm.label);
                    }}
                  >
                    <LandmarkIcon size={14} aria-hidden="true" />
                    <span>{lm.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Route Instructions */}
        {routePlan && routePlan.steps && routePlan.steps[currentStepIndex] && (
          <div className="route-instruction-box">
            <div className="instruction-title">
              Step {currentStepIndex + 1} of {routePlan.steps.length} — To {routePlan.destination}
            </div>
            <p className="instruction-text">{routePlan.steps[currentStepIndex].instruction}</p>

            <div className="route-controls">
              <button className="slam-btn slam-btn-secondary" onClick={handleRepeatStep}>
                <IconVolume size={18} aria-hidden="true" />
                <span>Repeat Instruction</span>
              </button>
              {currentStepIndex < routePlan.steps.length - 1 && (
                <button className="slam-btn slam-btn-primary" onClick={handleNextStep}>
                  <IconArrowRight size={18} aria-hidden="true" />
                  <span>Next Step</span>
                </button>
              )}
            </div>
          </div>
        )}

        {navigationFeedback && (
          <div style={{ marginTop: "0.75rem", fontSize: "0.9rem", color: "#38bdf8" }}>
            {navigationFeedback}
          </div>
        )}
      </div>
    </div>
  );
}
