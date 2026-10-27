// frontend/utils/indoor/indoorNavigationManager.js
import { planSlamRoute, resetSlamSession, fetchSlamStatus } from "./indoorApi.js";

/**
 * Real-Time Visual SLAM Indoor Navigation Session Manager.
 * Orchestrates live exploration, destination discovery, dynamic path planning,
 * and speech announcements without requiring pre-defined buildings or maps.
 */
export class IndoorNavigationManager {
  constructor({ onStateChange, onSpeak, onError }) {
    this.onStateChange = onStateChange || (() => {});
    this.onSpeak = onSpeak || (() => {});
    this.onError = onError || (() => {});

    this.isNavigating = false;
    this.isExploring = false;
    this.isPaused = false;
    this.status = "IDLE"; // IDLE | INITIALIZING | EXPLORING | NAVIGATING | TRACKING_LOST | ARRIVED | STOPPED

    this.currentPose = { x: 0, y: 0, heading: 0 };
    this.destination = null;
    this.route = null;
    this.currentStepIndex = 0;
    this.lastSpokenStepIndex = -1;
    this.lastSpokenWarningTime = 0;
  }

  resetNavigationState(partial = {}) {
    this.isNavigating = false;
    this.isPaused = false;
    this.route = null;
    this.destination = null;
    this.currentStepIndex = 0;
    this.lastSpokenStepIndex = -1;
    this.status = "IDLE";

    this.onStateChange({
      isNavigating: false,
      isPaused: false,
      status: "IDLE",
      destination: null,
      currentStepIndex: 0,
      currentStep: null,
      nextStep: null,
      route: null,
      ...partial
    });
  }

  /**
   * Update manager with new SLAM frame result from the camera stream.
   */
  handleSlamFrameResult(data) {
    if (!data) return;

    if (data.pose) {
      this.currentPose = data.pose;
    }

    // Check tracking lost
    if (data.tracking_lost) {
      this.status = "TRACKING_LOST";
      this.onStateChange({
        status: "TRACKING_LOST",
        tracking_lost: true,
        confidence: data.confidence || 0.1
      });

      const now = Date.now();
      if (now - this.lastSpokenWarningTime > 8000) {
        this.lastSpokenWarningTime = now;
        this.onSpeak(data.status_message || "Visual tracking lost. Please pause and slowly pan the camera.");
      }
      return;
    }

    // Relocalized notification
    if (data.relocalized) {
      this.onSpeak("Visual tracking restored.");
    }

    // Check dynamic obstacle rerouting from SLAM engine
    if (data.replanned_route && this.isNavigating) {
      this.route = data.replanned_route;
      this.currentStepIndex = 0;
      this.onStateChange({
        status: "NAVIGATING",
        route: data.replanned_route,
        currentStepIndex: 0,
        currentStep: data.replanned_route.steps?.[0] || null,
        nextStep: data.replanned_route.steps?.[1] || null
      });
      const msg = data.status_message || "Route blocked by newly observed obstacle. Recalculated path.";
      this.onSpeak(msg);
    }

    // Check arrival if navigating
    if (this.isNavigating && this.route && this.route.steps) {
      const lastStep = this.route.steps[this.route.steps.length - 1];
      if (this.currentStepIndex >= this.route.steps.length - 1) {
        this.status = "ARRIVED";
        this.isNavigating = false;
        this.onSpeak(`You have arrived at ${this.destination}.`);
        this.onStateChange({
          status: "ARRIVED",
          isNavigating: false,
          currentStep: lastStep,
          nextStep: null
        });
      }
    }
  }

  /**
   * Plan and begin navigation to an observed destination query.
   */
  async navigateToDestination(destinationQuery) {
    if (!destinationQuery || !destinationQuery.trim()) {
      this.onError("EMPTY_DESTINATION", "Please specify a destination.");
      return null;
    }

    const cleanQuery = destinationQuery.trim();
    this.onStateChange({ status: "PLANNING_ROUTE", errorMessage: "" });

    try {
      const plan = await planSlamRoute(cleanQuery);

      if (plan.status === "unobserved") {
        this.onStateChange({
          status: "UNOBSERVED_DESTINATION",
          errorMessage: plan.message
        });
        this.onSpeak(plan.message);
        return plan;
      }

      if (plan.status === "arrived") {
        this.status = "ARRIVED";
        this.destination = plan.destination;
        this.onSpeak(plan.message);
        this.onStateChange({
          status: "ARRIVED",
          isNavigating: false,
          destination: plan.destination
        });
        return plan;
      }

      if (plan.status === "success" && plan.steps?.length > 0) {
        this.destination = plan.destination;
        this.route = plan;
        this.currentStepIndex = 0;
        this.lastSpokenStepIndex = 0;
        this.isNavigating = true;
        this.isPaused = false;
        this.status = "NAVIGATING";

        const firstStep = plan.steps[0];
        const nextStep = plan.steps.length > 1 ? plan.steps[1] : null;

        this.onStateChange({
          status: "NAVIGATING",
          isNavigating: true,
          isPaused: false,
          destination: plan.destination,
          route: plan,
          currentStepIndex: 0,
          currentStep: firstStep,
          nextStep: nextStep,
          totalDistanceM: plan.total_distance_m
        });

        this.onSpeak(`Starting route to ${plan.destination}. ${firstStep.instruction}`);
        return plan;
      }

      const msg = plan.message || `No traversable path found to ${cleanQuery}.`;
      this.onStateChange({ status: "ROUTE_ERROR", errorMessage: msg });
      this.onSpeak(msg);
      return null;
    } catch (err) {
      const msg = `Route planning error: ${err.message}`;
      this.onStateChange({ status: "ROUTE_ERROR", errorMessage: msg });
      this.onError("ROUTE_ERROR", msg);
      return null;
    }
  }

  /**
   * Repeat the current navigational instruction.
   */
  repeatInstruction() {
    if (!this.route || !this.route.steps?.length) {
      this.onSpeak("No active route instructions to repeat.");
      return;
    }
    const current = this.route.steps[this.currentStepIndex];
    if (current) {
      this.onSpeak(current.instruction, { repeat: true });
    }
  }

  /**
   * Advance to next step in the route.
   */
  nextStep() {
    if (!this.route || !this.route.steps?.length) return;
    if (this.currentStepIndex < this.route.steps.length - 1) {
      this.currentStepIndex += 1;
      const current = this.route.steps[this.currentStepIndex];
      const next = this.currentStepIndex < this.route.steps.length - 1 ? this.route.steps[this.currentStepIndex + 1] : null;

      this.onStateChange({
        currentStepIndex: this.currentStepIndex,
        currentStep: current,
        nextStep: next
      });

      if (current.type === "arrival") {
        this.status = "ARRIVED";
        this.isNavigating = false;
        this.onSpeak(current.instruction);
      } else {
        this.onSpeak(current.instruction);
      }
    }
  }

  /**
   * Pause navigation guidance.
   */
  pauseNavigation() {
    this.isPaused = true;
    this.onStateChange({ isPaused: true });
    this.onSpeak("Indoor navigation paused.");
  }

  /**
   * Resume navigation guidance.
   */
  resumeNavigation() {
    this.isPaused = false;
    this.onStateChange({ isPaused: false });
    this.onSpeak("Resuming indoor navigation.");
    this.repeatInstruction();
  }

  /**
   * Stop active navigation session.
   */
  stopNavigation(silent = false) {
    this.isNavigating = false;
    this.isPaused = false;
    this.status = "STOPPED";
    this.route = null;
    this.destination = null;

    this.onStateChange({
      isNavigating: false,
      isPaused: false,
      status: "STOPPED",
      destination: null,
      route: null,
      currentStep: null,
      nextStep: null
    });

    if (!silent) {
      this.onSpeak("Indoor navigation stopped.");
    }
  }
}
