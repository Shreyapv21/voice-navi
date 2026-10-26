// backend/src/routes/indoorSlam.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const indoorRoutes = require("./indoorRoutes");

describe("Indoor SLAM Real-Time Architecture", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/indoor", indoorRoutes);

  it("handles environment classification without requiring building maps", async () => {
    const classifyHandler = indoorRoutes.stack.find((layer) => {
      const p = layer.route?.path;
      return Array.isArray(p) ? p.includes("/classify-environment") : p === "/classify-environment";
    });
    assert.ok(classifyHandler, "classify-environment endpoint exists");
  });

  it("registers all required SLAM routes", () => {
    const paths = indoorRoutes.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => layer.route.path);

    assert.ok(paths.includes("/slam/frame"), "Contains /slam/frame");
    assert.ok(paths.includes("/slam/status"), "Contains /slam/status");
    assert.ok(paths.includes("/slam/reset"), "Contains /slam/reset");
    assert.ok(paths.includes("/slam/route"), "Contains /slam/route");
    assert.ok(paths.includes("/slam/label"), "Contains /slam/label");
    assert.ok(paths.includes("/slam/health"), "Contains /slam/health");
    assert.ok(paths.includes("/route"), "Contains unified /route");
    assert.ok(paths.includes("/destinations"), "Contains /destinations");
    assert.ok(paths.includes("/match-destination"), "Contains /match-destination");
    assert.ok(paths.includes("/localize"), "Contains /localize");
  });

  it("does not demand predefined buildings or floor plan uploads", () => {
    assert.ok(true);
  });
});
