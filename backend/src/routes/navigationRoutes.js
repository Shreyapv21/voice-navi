const express = require("express");
const {
  resolveDestination,
  calculateWalkingRoute,
  translateDynamicText
} = require("../services/osmRoutingService");

const router = express.Router();

/**
 * Main route calculation endpoint.
 * Handles destination + current coordinates -> OpenStreetMap Nominatim -> OSRM foot routing.
 */
router.post("/route", async (req, res) => {
  try {
    const { origin, destination, language } = req.body;

    if (!destination || (typeof destination !== "string" && typeof destination !== "object")) {
      return res.status(400).json({
        status: "error",
        message: "Destination name or address is required."
      });
    }

    if (!origin || typeof origin.latitude !== "number" || typeof origin.longitude !== "number") {
      return res.status(400).json({
        status: "error",
        message: "User origin GPS coordinates (latitude and longitude) are required."
      });
    }

    const langCode = language || "en";
    const destStr = typeof destination === "object" ? (destination.name || `${destination.latitude}, ${destination.longitude}`) : destination;
    console.log(`[NavigationRoute API] Received /route request: destination="${destStr}", origin=(${origin.latitude.toFixed(5)}, ${origin.longitude.toFixed(5)}, isDemo: ${!!origin.isDemo}), lang=${langCode}`);

    // 1. Resolve destination using OpenStreetMap Nominatim
    const placeResult = await resolveDestination(destination, origin, langCode);

    if (placeResult.status === "unconfigured") {
      return res.status(200).json({
        status: "unconfigured",
        message: placeResult.message
      });
    }

    if (placeResult.status === "ambiguous") {
      return res.status(200).json({
        status: "ambiguous",
        message: placeResult.message,
        candidates: placeResult.candidates
      });
    }

    if (placeResult.status !== "success" || !placeResult.place) {
      console.warn(`[NavigationRoute API] Geocode failed for "${destStr}": status=${placeResult.status}, message=${placeResult.message}`);
      return res.status(200).json({
        status: placeResult.status || "not_found",
        message: placeResult.message || `Could not find "${destStr}".`
      });
    }

    const destinationPlace = placeResult.place;
    console.log(`[NavigationRoute API] Resolved destination place: "${destinationPlace.name}" at (${destinationPlace.latitude}, ${destinationPlace.longitude})`);

    // 2. Compute walking route using OpenStreetMap OSRM Foot routing
    const routeResult = await calculateWalkingRoute(
      origin,
      {
        name: destinationPlace.name,
        latitude: destinationPlace.latitude,
        longitude: destinationPlace.longitude
      },
      langCode
    );

    if (routeResult.status !== "success") {
      console.warn(`[NavigationRoute API] Walking route calculation failed: status=${routeResult.status}, message=${routeResult.message}`);
      return res.status(200).json({
        status: routeResult.status,
        message: routeResult.message,
        place: destinationPlace
      });
    }

    console.log(`[NavigationRoute API] Walking route successfully calculated: ${routeResult.distanceMeters}m, ${routeResult.steps?.length} steps to "${destinationPlace.name}"`);

    return res.json({
      status: "success",
      destination: {
        name: destinationPlace.name,
        address: destinationPlace.address,
        location: {
          latitude: destinationPlace.latitude,
          longitude: destinationPlace.longitude
        }
      },
      distanceMeters: routeResult.distanceMeters,
      duration: routeResult.duration,
      coordinates: routeResult.coordinates,
      polyline: routeResult.polyline,
      steps: routeResult.steps
    });
  } catch (error) {
    console.error("Navigation route error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error calculating route: " + error.message
    });
  }
});

/**
 * Standalone place resolution endpoint.
 */
router.post("/resolve", async (req, res) => {
  try {
    const { query, origin, language } = req.body;
    const result = await resolveDestination(query, origin, language || "en");
    res.json(result);
  } catch (error) {
    console.error("Resolve error:", error);
    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});

/**
 * Text translation endpoint.
 */
router.post("/translate", async (req, res) => {
  try {
    const { text, targetLanguage, sourceLanguage } = req.body;
    const result = await translateDynamicText(text, targetLanguage, sourceLanguage);
    res.json(result);
  } catch (error) {
    console.error("Translate error:", error);
    res.status(500).json({
      text: req.body.text || "",
      translated: false,
      error: error.message
    });
  }
});

module.exports = router;
