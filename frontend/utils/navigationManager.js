// frontend/utils/navigationManager.js
import { formatLocalizedDistance, formatLocalizedDuration } from "./languages.js";

/**
 * Calculates Haversine distance in meters between two lat/lng points.
 */
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Format distance into human-friendly string (meters / kilometers) with language support.
 */
export function formatDistance(meters, langCode = "en-US") {
  return formatLocalizedDistance(meters, langCode);
}

/**
 * Format duration string from Google/OSM Routes API into human-friendly text with language support.
 */
export function formatDuration(durationStr, langCode = "en-US") {
  return formatLocalizedDuration(durationStr, langCode);
}

export class NavigationManager {
  constructor({ onStateChange, onInstruction, onArrival, onOffRoute, onError, speak }) {
    this.onStateChange = onStateChange || (() => {});
    this.onInstruction = onInstruction || (() => {});
    this.onArrival = onArrival || (() => {});
    this.onOffRoute = onOffRoute || (() => {});
    this.onError = onError || (() => {});
    this.speak = speak || (() => {});

    this.currentLanguage = "en-US";
    this.isNavigating = false;
    this.destination = null;
    this.routeData = null;
    this.currentStepIndex = 0;
    this.watchId = null;
    this.currentPosition = null;

    this.lastSpokenStepIndex = -1;
    this.lastInstructionTime = 0;
    this.lastOffRouteTime = 0;
    this.instructionCooldownMs = 10000; // 10s cooldown to prevent GPS spam
    this.offRouteCooldownMs = 25000; // 25s cooldown before recalculating
    this.stepAdvanceThresholdMeters = 20; // within 20m of step end, transition to next step
    this.offRouteThresholdMeters = 60; // > 60m away from step line segment
    this.arrivalThresholdMeters = 15; // within 15m of final destination
    this.isPaused = false;
  }

  setLanguage(langCode) {
    if (langCode) {
      this.currentLanguage = langCode;
    }
  }

  pauseNavigation() {
    this.isPaused = true;
    this.onStateChange({ isPaused: true, status: "PAUSED" });
  }

  resumeNavigation() {
    this.isPaused = false;
    this.onStateChange({ isPaused: false, status: "ACTIVE" });
  }

  repeatInstruction() {
    if (!this.isNavigating || !this.routeData?.steps?.length) return;
    const step = this.routeData.steps[this.currentStepIndex];
    if (step?.instruction) {
      this.onInstruction({
        isRepeat: true,
        instruction: step.instruction,
        distanceText: formatDistance(step.distanceMeters, this.currentLanguage)
      });
    }
  }

  nextStep() {
    if (!this.isNavigating || !this.routeData?.steps?.length) return;
    if (this.currentStepIndex < this.routeData.steps.length - 1) {
      this.currentStepIndex++;
      const nextStep = this.routeData.steps[this.currentStepIndex];
      this.lastSpokenStepIndex = this.currentStepIndex;
      this.lastInstructionTime = Date.now();
      if (nextStep.startLocation) {
        this.currentPosition = nextStep.startLocation;
      }
      this.onStateChange({
        isNavigating: true,
        status: "ACTIVE",
        currentStepIndex: this.currentStepIndex,
        currentStep: nextStep,
        currentPosition: this.currentPosition
      });
      this.onInstruction({
        isTransition: true,
        stepIndex: this.currentStepIndex,
        instruction: nextStep.instruction,
        distanceText: formatDistance(nextStep.distanceMeters, this.currentLanguage)
      });
    } else {
      this.handleArrival();
    }
  }

  /**
   * Request user's current GPS position using browser Geolocation API.
   */
  async getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("Geolocation is not supported by your browser."));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
        },
        (error) => {
          reject(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 5000
        }
      );
    });
  }

  /**
   * Start a walking navigation session to the requested destination text.
   */
  async startNavigation(destinationQuery, languageCode = "en-US", options = {}) {
    try {
      this.stopNavigation(false);
      this.isNavigating = true;
      this.onStateChange({
        isNavigating: true,
        status: "RESOLVING",
        destinationName: typeof destinationQuery === "object" ? (destinationQuery.name || "Selected Destination") : destinationQuery,
        steps: []
      });

      // 1. Get user GPS location or fallback to demo origin
      let origin = options.origin || null;
      let isDemo = !!options.isDemo;

      if (!origin) {
        try {
          origin = await this.getCurrentLocation();
          this.currentPosition = origin;
          this.isDemoLocation = false;
        } catch (geoErr) {
          console.warn("Real GPS acquisition failed:", geoErr.message);
          let errorCode = "LOCATION_UNAVAILABLE";
          let userMsg = "Unable to determine your location. Please check your GPS signal.";
          if (geoErr && geoErr.code === 1) {
            errorCode = "LOCATION_PERMISSION_DENIED";
            userMsg = "Location permission is required to navigate. Please allow location access in your browser.";
          } else if (geoErr && geoErr.code === 2) {
            errorCode = "LOCATION_POSITION_UNAVAILABLE";
            userMsg = "GPS position is unavailable. Please ensure location services are enabled on your device.";
          } else if (geoErr && geoErr.code === 3) {
            errorCode = "LOCATION_TIMEOUT";
            userMsg = "Location request timed out. Please try again or refresh your GPS.";
          }
          this.isNavigating = false;
          this.onStateChange({
            isNavigating: false,
            status: "LOCATION_ERROR",
            errorMessage: userMsg
          });
          this.onError(errorCode, userMsg);
          return false;
        }
      } else {
        this.currentPosition = origin;
        this.isDemoLocation = isDemo;
      }

      // 2. Query backend route endpoint
      const response = await fetch("/api/navigation/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: { latitude: origin.latitude, longitude: origin.longitude },
          destination: destinationQuery,
          language: languageCode
        })
      });

      const data = await response.json();

      if (data.status === "unconfigured") {
        this.isNavigating = false;
        this.onStateChange({ isNavigating: false, status: "UNCONFIGURED" });
        this.onError("API_KEY_UNCONFIGURED", data.message);
        return false;
      }

      if (data.status === "ambiguous") {
        this.isNavigating = false;
        this.onStateChange({ isNavigating: false, status: "AMBIGUOUS", candidates: data.candidates });
        this.onError("DESTINATION_AMBIGUOUS", data.message, data.candidates);
        return false;
      }

      if (data.status !== "success" || !data.steps || data.steps.length === 0) {
        this.isNavigating = false;
        this.onStateChange({ isNavigating: false, status: "ROUTE_NOT_FOUND" });
        this.onError("ROUTE_NOT_FOUND", data.message || `No route could be found.`);
        return false;
      }

      // 3. Initialize Route
      this.setLanguage(languageCode);
      this.destination = data.destination;
      this.routeData = data;
      this.currentStepIndex = 0;
      this.lastSpokenStepIndex = -1;
      this.lastInstructionTime = 0;

      const formattedDist = formatDistance(data.distanceMeters, this.currentLanguage);
      const formattedDur = formatDuration(data.duration, this.currentLanguage);

      this.onStateChange({
        isNavigating: true,
        status: "ACTIVE",
        destination: this.destination,
        distanceMeters: data.distanceMeters,
        duration: data.duration,
        formattedDistance: formattedDist,
        formattedDuration: formattedDur,
        steps: data.steps,
        currentStepIndex: 0,
        currentStep: data.steps[0],
        routeData: data,
        coordinates: data.coordinates,
        isDemoLocation: isDemo,
        currentPosition: origin
      });

      // 4. Initial spoken confirmation & guidance
      const firstStep = data.steps[0];
      this.onInstruction({
        isInitial: true,
        destinationName: this.destination.name,
        distanceText: formattedDist,
        durationText: formattedDur,
        firstInstruction: firstStep.instruction
      });

      // 5. Start continuous location tracking
      this.startPositionTracking(languageCode);
      return true;
    } catch (err) {
      console.error("Failed to start navigation:", err);
      this.isNavigating = false;
      this.onStateChange({ isNavigating: false, status: "ERROR" });
      this.onError("GENERAL_ERROR", err.message);
      return false;
    }
  }

  /**
   * Continuous location watcher for turn-by-turn guidance.
   */
  startPositionTracking(languageCode) {
    if (!("geolocation" in navigator)) return;

    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
    }

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!this.isNavigating || !this.routeData) return;

        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        this.currentPosition = { latitude: userLat, longitude: userLng };

        this.processLocationUpdate(userLat, userLng, languageCode);
      },
      (error) => {
        console.warn("Geolocation watch error:", error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 3000
      }
    );
  }

  processLocationUpdate(userLat, userLng, languageCode) {
    if (this.isPaused) return;
    if (!this.routeData || !this.routeData.steps) return;

    const steps = this.routeData.steps;
    const destLoc = this.destination.location;

    // Check overall arrival at final destination
    if (destLoc) {
      const distToDestination = calculateDistanceMeters(userLat, userLng, destLoc.latitude, destLoc.longitude);
      if (distToDestination <= this.arrivalThresholdMeters) {
        this.handleArrival();
        return;
      }
    }

    const currentStep = steps[this.currentStepIndex];
    if (!currentStep) return;

    const endLoc = currentStep.endLocation;
    let distToEndOfStep = 0;
    if (endLoc?.latitude && endLoc?.longitude) {
      distToEndOfStep = calculateDistanceMeters(userLat, userLng, endLoc.latitude, endLoc.longitude);
    }

    // Advance to next step if user is close to the end of the current step
    if (distToEndOfStep > 0 && distToEndOfStep <= this.stepAdvanceThresholdMeters) {
      if (this.currentStepIndex < steps.length - 1) {
        this.currentStepIndex++;
        const nextStep = steps[this.currentStepIndex];
        this.lastSpokenStepIndex = this.currentStepIndex;
        this.lastInstructionTime = Date.now();

        this.onStateChange({
          isNavigating: true,
          status: "ACTIVE",
          currentStepIndex: this.currentStepIndex,
          currentStep: nextStep,
          distanceToStep: distToEndOfStep
        });

        this.onInstruction({
          isTransition: true,
          stepIndex: this.currentStepIndex,
          instruction: nextStep.instruction,
          distanceText: formatDistance(nextStep.distanceMeters, this.currentLanguage)
        });
        return;
      } else {
        // Last step reached
        this.handleArrival();
        return;
      }
    }

    // Check if we need to speak an approaching instruction (e.g. approaching a turn)
    const now = Date.now();
    if (
      this.lastSpokenStepIndex !== this.currentStepIndex &&
      now - this.lastInstructionTime > this.instructionCooldownMs
    ) {
      this.lastSpokenStepIndex = this.currentStepIndex;
      this.lastInstructionTime = now;

      this.onInstruction({
        isApproaching: true,
        stepIndex: this.currentStepIndex,
        instruction: currentStep.instruction,
        distanceText: formatDistance(distToEndOfStep || currentStep.distanceMeters, this.currentLanguage)
      });
    }

    // Off-route check
    if (currentStep.startLocation && currentStep.endLocation) {
      const distToStart = calculateDistanceMeters(
        userLat,
        userLng,
        currentStep.startLocation.latitude,
        currentStep.startLocation.longitude
      );

      // If user is far from both start and end of current step, trigger off-route recalculation
      if (distToStart > this.offRouteThresholdMeters && distToEndOfStep > this.offRouteThresholdMeters) {
        if (now - this.lastOffRouteTime > this.offRouteCooldownMs) {
          this.lastOffRouteTime = now;
          this.handleOffRoute(languageCode);
        }
      }
    }
  }

  async handleOffRoute(languageCode) {
    if (!this.destination) return;
    this.onOffRoute();

    try {
      if (languageCode) {
        this.setLanguage(languageCode);
      }
      if (!this.currentPosition) return;
      const response = await fetch("/api/navigation/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: this.currentPosition,
          destination: this.destination.name || this.destination.address,
          language: languageCode || this.currentLanguage
        })
      });

      const data = await response.json();
      if (data.status === "success" && data.steps && data.steps.length > 0) {
        this.routeData = data;
        this.currentStepIndex = 0;
        this.lastSpokenStepIndex = 0;
        this.lastInstructionTime = Date.now();

        const formattedDist = formatDistance(data.distanceMeters, this.currentLanguage);
        const formattedDur = formatDuration(data.duration, this.currentLanguage);

        this.onStateChange({
          isNavigating: true,
          status: "ACTIVE",
          distanceMeters: data.distanceMeters,
          duration: data.duration,
          formattedDistance: formattedDist,
          formattedDuration: formattedDur,
          steps: data.steps,
          currentStepIndex: 0,
          currentStep: data.steps[0]
        });

        this.onInstruction({
          isRecalculated: true,
          instruction: data.steps[0].instruction,
          distanceText: formattedDist
        });
      }
    } catch (err) {
      console.warn("Route recalculation error:", err);
    }
  }

  handleArrival() {
    this.stopNavigation(false);
    this.onStateChange({
      isNavigating: false,
      status: "ARRIVED",
      destination: this.destination
    });
    this.onArrival(this.destination);
  }

  stopNavigation(userInitiated = true) {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.isNavigating = false;
    if (userInitiated) {
      this.onStateChange({
        isNavigating: false,
        status: "STOPPED"
      });
    }
  }
}
