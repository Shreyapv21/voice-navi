// backend/src/routes/indoorRoutes.js
const express = require("express");
const axios = require("axios");
const multer = require("multer");
const FormData = require("form-data");
const fs = require("fs");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

const AI_BASE_URL = process.env.AI_BASE_URL || "http://127.0.0.1:8000";

/**
 * Real-Time Visual SLAM Indoor Navigation Router.
 * No predefined buildings, fixed room coordinates, or QR codes are required.
 * Builds and navigates on the dynamic topological map constructed from live camera observations.
 */

// ----------------- Real-Time SLAM Endpoints -----------------

// Health check for SLAM pipeline
router.get(["/slam/health", "/health"], async (req, res) => {
  try {
    const resp = await axios.get(`${AI_BASE_URL}/slam/health/`, { timeout: 4000 });
    res.json(resp.data);
  } catch (err) {
    res.status(503).json({ status: "unavailable", error: err.message, ai_base_url: AI_BASE_URL });
  }
});

// Process live camera frame through Visual SLAM pipeline
router.post(["/slam/frame", "/frame"], upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: "error", message: "Image frame file is required." });
    }

    const formData = new FormData();
    formData.append("file", fs.createReadStream(req.file.path));
    if (req.body.ocr_text) {
      formData.append("ocr_text", req.body.ocr_text);
    }

    const response = await axios.post(`${AI_BASE_URL}/slam/frame/`, formData, {
      headers: formData.getHeaders(),
      timeout: 10000
    });

    res.json(response.data);
  } catch (err) {
    console.error("SLAM frame error:", err.message);
    res.status(500).json({ status: "error", message: "SLAM frame processing failed: " + err.message });
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlink(req.file.path, () => {});
    }
  }
});

// Get current SLAM status, pose, tracking confidence, and map
router.get(["/slam/status", "/status"], async (req, res) => {
  try {
    const resp = await axios.get(`${AI_BASE_URL}/slam/status/`, { timeout: 5000 });
    res.json(resp.data);
  } catch (err) {
    res.status(200).json({
      status: "unconnected",
      message: "AI SLAM service unavailable: " + err.message,
      confidence: 0,
      tracking_lost: true,
      map: { nodes: [], edges: [], landmarks: [] }
    });
  }
});

// Reset SLAM session to start fresh live exploration
router.post(["/slam/reset", "/reset"], async (req, res) => {
  try {
    const resp = await axios.post(`${AI_BASE_URL}/slam/reset/`, {}, { timeout: 5000 });
    res.json(resp.data);
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Plan route on the discovered SLAM map
router.post(["/slam/route", "/slam-route"], async (req, res) => {
  try {
    const { destination, start_id } = req.body || {};
    const resp = await axios.post(`${AI_BASE_URL}/slam/route/`, { destination, start_id }, { timeout: 5000 });
    res.json(resp.data);
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Explicitly label a discovered location/landmark
router.post(["/slam/label", "/label"], async (req, res) => {
  try {
    const resp = await axios.post(`${AI_BASE_URL}/slam/label/`, req.body, { timeout: 5000 });
    res.json(resp.data);
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ----------------- Unified Indoor Navigation API -----------------

// Live route planning (unified endpoint)
router.post("/route", async (req, res) => {
  try {
    const { destination, destinationLocationId, start_id, startLocationId } = req.body || {};
    const target = destination || destinationLocationId;
    if (!target) {
      return res.status(400).json({ status: "error", message: "Destination is required." });
    }

    const resp = await axios.post(
      `${AI_BASE_URL}/slam/route/`,
      { destination: target, start_id: start_id || startLocationId },
      { timeout: 5000 }
    );
    res.json(resp.data);
  } catch (err) {
    res.status(500).json({ status: "error", message: "Route planning failed: " + err.message });
  }
});

// Actively discovered destinations from the live SLAM map
router.get("/destinations", async (req, res) => {
  try {
    const resp = await axios.get(`${AI_BASE_URL}/slam/status/`, { timeout: 5000 });
    const landmarks = resp.data?.map?.landmarks || [];
    const nodes = resp.data?.map?.nodes || [];

    const destinations = [
      ...landmarks.map((lm) => ({ id: lm.id, label: lm.label, type: lm.type, verified: lm.verified })),
      ...nodes.filter((n) => n.type !== "corridor").map((n) => ({ id: n.id, label: n.label, type: n.type, verified: n.verified }))
    ];

    res.json({ status: "success", destinations });
  } catch (err) {
    res.json({ status: "success", destinations: [] });
  }
});

// Match destination query against discovered landmarks
router.post("/match-destination", async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query) {
      return res.json({ status: "not_found", message: "Empty destination query." });
    }

    const resp = await axios.get(`${AI_BASE_URL}/slam/status/`, { timeout: 5000 });
    const landmarks = resp.data?.map?.landmarks || [];
    const qLower = query.toLowerCase().trim();

    const matched = landmarks.find((lm) => lm.label.toLowerCase().includes(qLower) || qLower.includes(lm.label.toLowerCase()));
    if (matched) {
      return res.json({
        status: "success",
        match: {
          locationId: matched.id,
          label: matched.label,
          type: matched.type,
          confidence: matched.confidence
        }
      });
    }

    res.json({
      status: "not_found",
      message: `Destination "${query}" has not been identified on the indoor map yet.`,
      discoveredLandmarks: landmarks.map((l) => l.label)
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Live Localization Assessment using real SLAM status
router.post("/localize", async (req, res) => {
  try {
    const resp = await axios.get(`${AI_BASE_URL}/slam/status/`, { timeout: 5000 });
    const slam = resp.data;
    const isSuccess = !slam.tracking_lost && slam.confidence >= 0.35;

    res.json({
      status: "success",
      assessment: {
        status: isSuccess ? "success" : "uncertain",
        confidence: slam.confidence || 0.0,
        pose: slam.pose,
        tracking_lost: slam.tracking_lost,
        state: slam.state || (slam.tracking_lost ? "tracking_lost" : "localized"),
        message: slam.status_message
      }
    });
  } catch (err) {
    res.json({
      status: "success",
      assessment: {
        status: "uncertain",
        confidence: 0,
        message: "SLAM service disconnected: " + err.message
      }
    });
  }
});

// Environment classification based on SLAM tracking state and sensors
router.post("/classify-environment", async (req, res) => {
  const { evidence } = req.body || {};
  let classification = "indoor";
  let confidence = 0.8;

  if (evidence?.userDeclared === "outdoor" || (evidence?.gpsAccuracy && evidence.gpsAccuracy < 8 && !evidence.inSlamSession)) {
    classification = "outdoor";
    confidence = 0.85;
  }

  res.json({
    status: "success",
    result: {
      classification,
      confidence,
      reason: "Classified based on active sensor stream and SLAM state."
    }
  });
});

module.exports = router;
