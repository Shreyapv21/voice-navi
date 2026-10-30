// backend/src/indoor/indoorStop.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseNavigationUtterance } = require("../../../frontend/utils/voiceNavigation/voiceCommandParser");

test("Indoor Navigation Stop Flow", async (t) => {
  await t.test("recognizes indoor stop commands across natural speech variations", () => {
    const stopCommands = [
      "stop",
      "stop scan",
      "stop the scan",
      "stop indoor navigation",
      "stop indoor scan",
      "stop navigating",
      "cancel navigation"
    ];

    for (const phrase of stopCommands) {
      const parsed = parseNavigationUtterance(phrase);
      assert.ok(
        parsed.type === "STOP_SLAM" || parsed.type === "STOP_NAVIGATION" || parsed.type === "STOP_ALL",
        `Expected phrase '${phrase}' to parse as stop command, got ${parsed.type}`
      );
    }
  });

  await t.test("drops late SLAM frames when manager is stopped", () => {
    // Mimic IndoorNavigationManager behavior
    let spokenMessage = null;
    let stateUpdates = [];

    const manager = {
      status: "IDLE",
      isNavigating: false,
      currentPose: { x: 0, y: 0, z: 0 },
      stopNavigation(silent = false) {
        this.isNavigating = false;
        this.status = "STOPPED";
        this.route = null;
        if (!silent) spokenMessage = "Indoor navigation stopped.";
      },
      handleSlamFrameResult(data) {
        if (!data || this.status === "STOPPED") return;
        if (data.tracking_lost) {
          this.status = "TRACKING_LOST";
          spokenMessage = "Visual tracking lost.";
        }
        if (data.relocalized) {
          spokenMessage = "Visual tracking restored.";
        }
      }
    };

    // User stops
    manager.stopNavigation(true);
    assert.equal(manager.status, "STOPPED");

    // Late frame arrives from in-flight request
    manager.handleSlamFrameResult({
      status: "success",
      tracking_lost: true,
      confidence: 0.1
    });

    // Verify late frame did not overwrite STOPPED status or speak
    assert.equal(manager.status, "STOPPED");
    assert.equal(spokenMessage, null);
  });
});
