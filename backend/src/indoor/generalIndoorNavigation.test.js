const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { DEMO_CENTER, ACADEMIC_COMPLEX } = require("./sampleBuilding");
const {
  matchIndoorDestination,
  matchClarificationChoice,
  buildDestinationCatalog
} = require("./destinationCatalog");
const {
  calculateIndoorRoute,
  detectRouteDeviation,
  recalculateIndoorRoute
} = require("./routeEngine");

describe("General-Purpose Indoor Navigation & Arbitrary Destinations", () => {
  it("resolves general destinations across building catalog (library, reception, exit, labs, classrooms)", () => {
    // 1. Library in selected building
    const libMatch = matchIndoorDestination("take me to the library", { buildingId: "demo-center" });
    assert.equal(libMatch.status, "success");
    assert.ok(libMatch.match.label.toLowerCase().includes("library"));

    // 2. Reception desk in selected building
    const recMatch = matchIndoorDestination("guide me to the reception", { buildingId: "demo-center" });
    assert.equal(recMatch.status, "success");
    assert.ok(recMatch.match.label.toLowerCase().includes("reception"));

    // 3. Emergency Exit in selected building
    const exitMatch = matchIndoorDestination("take me to the emergency exit", { buildingId: "demo-center" });
    assert.equal(exitMatch.status, "success");
    assert.ok(exitMatch.match.label.toLowerCase().includes("exit"));

    // 4. Classroom in building
    const classMatch = matchIndoorDestination("classroom 101", { buildingId: "academic-complex" });
    assert.equal(classMatch.status, "success");
    assert.ok(classMatch.match.label.includes("101"));

    // 5. Research Laboratory (unique in catalog)
    const labMatch = matchIndoorDestination("robotics lab");
    assert.equal(labMatch.status, "success");
    assert.ok(labMatch.match.label.toLowerCase().includes("robotics"));

    // 6. Dean's Office (unique in catalog)
    const deanMatch = matchIndoorDestination("dean office");
    assert.equal(deanMatch.status, "success");
    assert.ok(deanMatch.match.label.toLowerCase().includes("dean"));
  });

  it("resolves nearest washroom when current location is provided", () => {
    // On ground floor of DEMO_CENTER:
    const nearestResult = matchIndoorDestination("find the nearest washroom", {
      buildingId: "demo-center",
      currentLocationId: "reception"
    });
    assert.equal(nearestResult.status, "success");
    assert.equal(nearestResult.match.locationId, "restroom_g");
    assert.equal(nearestResult.match.floorId, "0");
  });

  it("resolves nearest exit when multiple exits exist and location is known", () => {
    // Near corridor_b_g, east emergency exit is closest
    const exitResult = matchIndoorDestination("find the nearest exit", {
      buildingId: "demo-center",
      currentLocationId: "corridor_b_g"
    });
    assert.equal(exitResult.status, "success");
    assert.equal(exitResult.match.floorId, "0");
  });

  it("returns helpful unmapped status with suggestions for unknown destinations", () => {
    const unknown = matchIndoorDestination("secret underground vault");
    assert.equal(unknown.status, "not_found");
    assert.ok(unknown.suggestions && unknown.suggestions.length > 0);
  });

  it("handles multi-destination ambiguity across multiple buildings when building is unspecified", () => {
    // Both buildings have a library, so unguided query is ambiguous
    const ambiguousQuery = matchIndoorDestination("take me to the library");
    assert.equal(ambiguousQuery.status, "ambiguous");
    assert.ok(ambiguousQuery.candidates.length >= 2);
  });

  it("generates geometry-based turn instructions, junctions, and doorway notices", () => {
    // Route from main_entrance to restroom_g in DEMO_CENTER:
    // main_entrance -> reception -> corridor_a_g -> restroom_g
    const route = calculateIndoorRoute(DEMO_CENTER, "main_entrance", "restroom_g");
    assert.equal(route.status, "success");
    assert.ok(route.steps.length >= 3);

    // First step should start with walk
    assert.equal(route.steps[0].type, "walk");
    assert.ok(route.steps[0].instruction.includes("Main Entrance"));

    // Turn at corridor junction
    const junctionStep = route.steps.find((s) => s.instruction.toLowerCase().includes("junction") || s.instruction.toLowerCase().includes("doorway"));
    assert.ok(junctionStep, "Should mention junction or doorway geometry");

    // Final step is arrival
    const arrivalStep = route.steps[route.steps.length - 1];
    assert.equal(arrivalStep.type, "arrival");
    assert.ok(arrivalStep.instruction.includes("arrived at"));
  });

  it("flags floor transitions as requiring verification", () => {
    const route = calculateIndoorRoute(DEMO_CENTER, "reception", "room_101", { preferAccessible: false });
    assert.equal(route.status, "success");
    const transitionStep = route.steps.find((s) => s.type === "floor_transition");
    assert.ok(transitionStep);
    assert.equal(transitionStep.requiresConfirmation, true);
    assert.ok(transitionStep.instruction.includes("confirm your floor") || transitionStep.instruction.includes("elevator"));
  });

  it("detects route deviation when user location diverges", () => {
    const route = calculateIndoorRoute(DEMO_CENTER, "main_entrance", "restroom_g");
    assert.ok(route.nodeIds);

    // User is at reception -> on route
    const check1 = detectRouteDeviation(route, "reception");
    assert.equal(check1.deviated, false);

    // User wandered to room_102 on floor 1 -> deviated!
    const check2 = detectRouteDeviation(route, "room_102");
    assert.equal(check2.deviated, true);
  });

  it("dynamically recalculates route from deviated location", () => {
    const originalRoute = calculateIndoorRoute(DEMO_CENTER, "main_entrance", "restroom_g");
    assert.equal(originalRoute.startId, "main_entrance");

    // Recalculate from corridor_b_g
    const rerouted = recalculateIndoorRoute(DEMO_CENTER, "corridor_b_g", "restroom_g");
    assert.equal(rerouted.status, "success");
    assert.equal(rerouted.startId, "corridor_b_g");
    assert.equal(rerouted.endId, "restroom_g");
    assert.ok(rerouted.steps.length > 0);
  });

  it("handles complex multi-floor navigation in academic complex", () => {
    // Navigate from Campus Main Gate (Floor 0) to AI Research Lab (Floor 1)
    const route = calculateIndoorRoute(ACADEMIC_COMPLEX, "ac_main_gate", "ac_ai_lab", { preferAccessible: true });
    assert.equal(route.status, "success");
    assert.ok(route.nodeIds.includes("ac_lift_g"));
    assert.ok(route.nodeIds.includes("ac_lift_1"));
    assert.ok(route.nodeIds.includes("ac_ai_lab"));
    assert.ok(route.totalCostMeters > 0);
  });
});
