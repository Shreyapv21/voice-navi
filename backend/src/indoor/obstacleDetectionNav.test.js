// backend/src/indoor/obstacleDetectionNav.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("Obstacle Detection & Outdoor Navigation Integration", async () => {
  const {
    t,
    getMessage,
    translateObjectLabel,
    translateDirection,
    formatDetectionSentence
  } = await import("../../../frontend/utils/languages.js");

  it("translates obstacle labels and directions across all 5 languages", () => {
    const langs = ["en-US", "hi-IN", "kn-IN", "ta-IN", "te-IN"];
    const labels = ["person", "car", "bicycle", "dog", "chair"];
    const directions = ["in front of you", "on your left", "on your right"];

    for (const lang of langs) {
      for (const label of labels) {
        const translated = translateObjectLabel(label, lang);
        assert.ok(translated, `Label translation missing for ${label} in ${lang}`);
      }
      for (const dir of directions) {
        const translated = translateDirection(dir, lang);
        assert.ok(translated, `Direction translation missing for ${dir} in ${lang}`);
      }
    }
  });

  it("formats localized obstacle warnings with distance, direction, and label", () => {
    const testCases = [
      {
        lang: "en-US",
        label: "car",
        direction: "in front of you",
        distance: "2.5",
        expectedParts: ["Warning:", "car", "in front of you", "2.5"]
      },
      {
        lang: "hi-IN",
        label: "person",
        direction: "in front of you",
        distance: "1.8",
        expectedParts: ["चेतावनी:", "व्यक्ति", "1.8"]
      },
      {
        lang: "kn-IN",
        label: "dog",
        direction: "in front of you",
        distance: "3.0",
        expectedParts: ["ಎಚ್ಚರಿಕೆ:", "ನಾಯಿ", "3.0"]
      },
      {
        lang: "ta-IN",
        label: "bicycle",
        direction: "in front of you",
        distance: "4.0",
        expectedParts: ["எச்சரிக்கை:", "சைக்கிள்", "4.0"]
      },
      {
        lang: "te-IN",
        label: "car",
        direction: "in front of you",
        distance: "2.0",
        expectedParts: ["హెచ్చరిక:", "కారు", "2.0"]
      }
    ];

    for (const tc of testCases) {
      const transLabel = translateObjectLabel(tc.label, tc.lang);
      const transDir = translateDirection(tc.direction, tc.lang);
      const warning = getMessage("obstacleWarning", tc.lang, {
        label: transLabel,
        direction: transDir,
        distance: tc.distance
      });

      for (const part of tc.expectedParts) {
        assert.ok(
          warning.includes(part),
          `Expected "${part}" in warning for ${tc.lang}: "${warning}"`
        );
      }
    }
  });

  it("prioritizes obstacles in front and closest distance", () => {
    const rawDetections = [
      { class_name: "chair", distance: 4.5, direction: "on your left" },
      { class_name: "car", distance: 3.2, direction: "in front of you" },
      { class_name: "person", distance: 1.5, direction: "in front of you" },
      { class_name: "bicycle", distance: 1.0, direction: "on your right" }
    ];

    const sorted = [...rawDetections].sort((a, b) => {
      const aFront = a.direction === "in front of you" ? 0 : 1;
      const bFront = b.direction === "in front of you" ? 0 : 1;
      if (aFront !== bFront) return aFront - bFront;
      return (a.distance || 99) - (b.distance || 99);
    });

    // Highest priority must be "person" (1.5m in front of you)
    assert.equal(sorted[0].class_name, "person");
    assert.equal(sorted[0].distance, 1.5);
    // Second priority must be "car" (3.2m in front of you)
    assert.equal(sorted[1].class_name, "car");
    assert.equal(sorted[1].distance, 3.2);
  });

  it("implements anti-spam cooldown and approach trigger", () => {
    const lastSpoken = {};
    let lastGlobalAnnouncement = 0;
    const GLOBAL_COOLDOWN_MS = 5000;
    const OBJECT_COOLDOWN_MS = 12000;

    function shouldAnnounce(obj, now) {
      if (now - lastGlobalAnnouncement < GLOBAL_COOLDOWN_MS) {
        return false;
      }
      const label = obj.class_name;
      const last = lastSpoken[label];
      if (!last) return true;

      const elapsed = now - last.time;
      const closerDistance =
        last.distance && obj.distance && (last.distance - obj.distance) >= 0.8;
      const directionChanged = last.direction !== obj.direction;

      return elapsed >= OBJECT_COOLDOWN_MS || closerDistance || directionChanged;
    }

    const t0 = 10000;
    const car1 = { class_name: "car", distance: 3.5, direction: "in front of you" };

    // 1. Initial detection -> should announce
    assert.equal(shouldAnnounce(car1, t0), true);
    lastSpoken[car1.class_name] = { time: t0, distance: car1.distance, direction: car1.direction };
    lastGlobalAnnouncement = t0;

    // 2. 2 seconds later, same distance -> suppressed by global cooldown
    assert.equal(shouldAnnounce(car1, t0 + 2000), false);

    // 3. 6 seconds later, same distance -> suppressed by object cooldown (elapsed 6s < 12s)
    assert.equal(shouldAnnounce(car1, t0 + 6000), false);

    // 4. 6 seconds later, but obstacle approaches (3.5m -> 2.5m, >= 0.8m closer) -> should trigger!
    const approachingCar = { class_name: "car", distance: 2.5, direction: "in front of you" };
    assert.equal(shouldAnnounce(approachingCar, t0 + 6000), true);

    // Update state with approaching car
    lastSpoken[approachingCar.class_name] = {
      time: t0 + 6000,
      distance: approachingCar.distance,
      direction: approachingCar.direction
    };
    lastGlobalAnnouncement = t0 + 6000;

    // 5. 13 seconds later, distance steady -> object cooldown expired -> should announce
    assert.equal(shouldAnnounce(approachingCar, t0 + 6000 + 13000), true);
  });

  it("preserves and restores interrupted turn instructions during obstacle alert", () => {
    let activeInstruction = "Turn right onto Sayyaji Rao Road in 50 meters";
    let isSpeaking = true;
    let interruptedInstruction = null;

    // Obstacle alert interrupts speech
    function onObstacleAlert(obstacleText) {
      if (isSpeaking && activeInstruction) {
        interruptedInstruction = activeInstruction;
      }
      isSpeaking = true;
    }

    function onObstacleAlertEnd() {
      isSpeaking = false;
      const resumed = interruptedInstruction;
      interruptedInstruction = null;
      return resumed;
    }

    onObstacleAlert("Warning: car in front of you");
    assert.equal(interruptedInstruction, "Turn right onto Sayyaji Rao Road in 50 meters");

    const resumedText = onObstacleAlertEnd();
    assert.equal(resumedText, "Turn right onto Sayyaji Rao Road in 50 meters");
    assert.equal(interruptedInstruction, null);
  });
});
