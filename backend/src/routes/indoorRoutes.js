const express = require("express");
const { listBuildings, getBuildingMap, getBuilding, resolveMarker } = require("../indoor/sampleBuilding");
const { calculateIndoorRoute } = require("../indoor/routeEngine");
const {
  buildDestinationCatalog,
  matchIndoorDestination,
  matchClarificationChoice
} = require("../indoor/destinationCatalog");
const { classifyEnvironment } = require("../indoor/environmentClassifier");
const {
  assessLocalization,
  observationFromGps,
  observationFromMarker,
  observationFromOcrLabel
} = require("../indoor/localizationService");
const { NIE_MYSORE_TEMPLATE } = require("../indoor/nieCollegeTemplate");

const router = express.Router();

router.get("/buildings", (req, res) => {
  res.json({
    status: "success",
    buildings: listBuildings(),
    templates: [
      {
        id: NIE_MYSORE_TEMPLATE.id,
        name: NIE_MYSORE_TEMPLATE.name,
        description: NIE_MYSORE_TEMPLATE.description,
        populated: NIE_MYSORE_TEMPLATE.populated
      }
    ]
  });
});

router.get("/destinations", (req, res) => {
  res.json({ status: "success", destinations: buildDestinationCatalog() });
});

router.post("/match-destination", (req, res) => {
  const { query } = req.body;
  res.json(matchIndoorDestination(query || ""));
});

router.post("/match-clarification", (req, res) => {
  const { query, candidates } = req.body;
  const picked = matchClarificationChoice(query, candidates);
  if (!picked) {
    return res.json({ status: "not_found", message: "Could not match your choice." });
  }
  res.json({ status: "success", match: picked });
});

router.post("/classify-environment", (req, res) => {
  res.json({ status: "success", result: classifyEnvironment(req.body?.evidence || {}) });
});

router.post("/localize", (req, res) => {
  try {
    const { gps, marker, ocrText, buildingId } = req.body || {};
    const observations = [];
    const gpsObs = observationFromGps(gps);
    if (gpsObs) observations.push(gpsObs);
    if (marker) {
      const m = observationFromMarker(marker);
      if (m.error) return res.json({ status: "error", message: m.error });
      observations.push(m);
    }
    const ocrObs = observationFromOcrLabel(ocrText, buildingId || null);
    if (ocrObs) observations.push(ocrObs);
    const assessment = assessLocalization(observations);
    res.json({ status: "success", observations, assessment });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

router.get("/buildings/:buildingId/map", (req, res) => {
  const map = getBuildingMap(req.params.buildingId);
  if (!map) {
    return res.status(404).json({ status: "error", message: "Building not found." });
  }
  res.json({ status: "success", map });
});

router.post("/route", (req, res) => {
  try {
    const { buildingId, startLocationId, destinationLocationId, preferAccessible } = req.body;

    if (!buildingId) {
      return res.status(400).json({ status: "error", message: "buildingId is required." });
    }
    if (!startLocationId) {
      return res.status(400).json({ status: "error", message: "Starting location is required." });
    }
    if (!destinationLocationId) {
      return res.status(400).json({ status: "error", message: "Destination is required." });
    }

    const building = getBuilding(buildingId);
    if (!building) {
      return res.status(404).json({ status: "error", message: "Building not found." });
    }

    const startNode = building.nodes.find((n) => n.id === startLocationId);
    const destNode = building.nodes.find((n) => n.id === destinationLocationId);
    if (!startNode || !destNode) {
      return res.status(400).json({
        status: "error",
        message: "Start or destination is not a valid location in this building."
      });
    }

    const route = calculateIndoorRoute(building, startLocationId, destinationLocationId, {
      preferAccessible
    });

    if (route.status !== "success") {
      return res.status(200).json(route);
    }

    res.json({
      status: "success",
      route: {
        buildingId: route.buildingId,
        buildingName: route.buildingName,
        startId: route.startId,
        endId: route.endId,
        totalCostMeters: route.totalCostMeters,
        nodeIds: route.nodeIds,
        nodes: route.nodes,
        edges: route.edges.map(({ from, to, distanceMeters, accessible, floorTransition, reversed }) => ({
          from,
          to,
          distanceMeters,
          accessible,
          floorTransition: floorTransition || null,
          reversed: !!reversed
        })),
        steps: route.steps
      }
    });
  } catch (err) {
    console.error("Indoor route error:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

router.post("/marker/resolve", (req, res) => {
  try {
    const { marker, buildingId } = req.body;
    const result = resolveMarker(marker, buildingId || null);
    if (result.status !== "success") {
      return res.status(200).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// SLAM proxy endpoints to AI service
const axios = require("axios");
const AI_BASE_URL = process.env.AI_BASE_URL || "http://127.0.0.1:8000";

router.get("/slam/status", async (req, res) => {
  try {
    const resp = await axios.get(`${AI_BASE_URL}/slam/status/`, { timeout: 5000 });
    res.json(resp.data);
  } catch (err) {
    res.status(200).json({
      status: "unconnected",
      message: "AI SLAM service unavailable: " + err.message,
      confidence: 0,
      map: { nodes: [], edges: [], landmarks: [] }
    });
  }
});

router.post("/slam/reset", async (req, res) => {
  try {
    const resp = await axios.post(`${AI_BASE_URL}/slam/reset/`, {}, { timeout: 5000 });
    res.json(resp.data);
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

router.post("/slam/route", async (req, res) => {
  try {
    const resp = await axios.post(`${AI_BASE_URL}/slam/route/`, req.body, { timeout: 5000 });
    res.json(resp.data);
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
