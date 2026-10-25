// backend/src/routes/osmRouting.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  resolveDestination,
  calculateWalkingRoute,
  CURATED_DEMO_DESTINATIONS
} = require("../services/osmRoutingService");

describe("OpenStreetMap Foot Routing Service", () => {
  it("resolves destination by coordinates object", async () => {
    const res = await resolveDestination({ latitude: 12.3149, longitude: 76.6463, name: "Test Station" });
    assert.strictEqual(res.status, "success");
    assert.strictEqual(res.place.latitude, 12.3149);
    assert.strictEqual(res.place.longitude, 76.6463);
    assert.strictEqual(res.place.name, "Test Station");
  });

  it("resolves destination by coordinate string", async () => {
    const res = await resolveDestination("12.3086, 76.6531");
    assert.strictEqual(res.status, "success");
    assert.strictEqual(res.place.latitude, 12.3086);
    assert.strictEqual(res.place.longitude, 76.6531);
  });

  it("resolves destination using curated presets fallback", async () => {
    const res = await resolveDestination("nearest hospital");
    assert.strictEqual(res.status, "success");
    assert.match(res.place.name, /Hospital/i);
    assert.ok(res.place.latitude > 0);
  });

  it("calculates real pedestrian route between demo points", async () => {
    const origin = { latitude: 12.3086, longitude: 76.6531 };
    const destination = { latitude: 12.3149, longitude: 76.6463, name: "Mysuru Railway Station" };

    const route = await calculateWalkingRoute(origin, destination);
    assert.strictEqual(route.status, "success");
    assert.ok(route.distanceMeters > 0, "Distance should be positive");
    assert.ok(route.steps.length > 0, "Route should contain turn-by-turn steps");
    assert.ok(route.coordinates.length > 0, "Route should contain coordinates array");
    assert.strictEqual(route.routingSource, "openstreetmap_routed_foot");

    // First step should give natural walking instruction
    assert.ok(route.steps[0].instruction.length > 5);
    // Last step should announce arrival
    assert.match(route.steps[route.steps.length - 1].instruction, /arrived|destination/i);
  });
});
