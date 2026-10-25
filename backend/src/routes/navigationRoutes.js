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

    // 1. Resolve destination using Google Places API (New)
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
      return res.status(200).json({
        status: placeResult.status || "not_found",
        message: placeResult.message || `Could not find "${destination}".`
      });
    }

    const destinationPlace = placeResult.place;

    // 2. Compute walking route with Google Routes API
    const routeResult = await calculateWalkingRoute(
      origin,
      {
        latitude: destinationPlace.latitude,
        longitude: destinationPlace.longitude
      },
      langCode
    );

    if (routeResult.status !== "success") {
      return res.status(200).json({
        status: routeResult.status,
        message: routeResult.message,
        place: destinationPlace
      });
    }

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
