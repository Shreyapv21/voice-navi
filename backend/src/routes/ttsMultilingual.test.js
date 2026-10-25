const { describe, it } = require("node:test");
const assert = require("node:assert");
const { formatPedestrianInstruction } = require("../services/osmRoutingService");
const axios = require("axios");

describe("Multilingual TTS & Navigation Instruction Tests", () => {
  describe("formatPedestrianInstruction Maneuver Localization & Street Name Preservation", () => {
    const road = "Sayyaji Rao Road";

    it("formats Kannada turn and depart instructions correctly preserving street name", () => {
      const depart = formatPedestrianInstruction({
        type: "depart",
        modifier: "",
        name: road,
        distanceMeters: 150
      }, "kn-IN");
      assert.match(depart, new RegExp(road));
      assert.match(depart, /ನೇರವಾಗಿ.*ನಡೆಯಿರಿ/);

      const turnLeft = formatPedestrianInstruction({
        type: "turn",
        modifier: "left",
        name: road,
        distanceMeters: 80
      }, "kn-IN");
      assert.match(turnLeft, new RegExp(road));
      assert.match(turnLeft, /ಎಡಕ್ಕೆ/);

      const arrive = formatPedestrianInstruction({
        type: "arrive",
        modifier: "",
        name: "Mysuru Palace",
        distanceMeters: 0
      }, "kn-IN");
      assert.match(arrive, /Mysuru Palace/);
      assert.match(arrive, /ತಲುಪಿದ್ದೀರಿ/);
    });

    it("formats Malayalam turn and depart instructions correctly preserving street name", () => {
      const depart = formatPedestrianInstruction({
        type: "depart",
        modifier: "",
        name: road,
        distanceMeters: 120
      }, "ml-IN");
      assert.match(depart, new RegExp(road));
      assert.match(depart, /നേരെ.*നടക്കുക/);

      const turnRight = formatPedestrianInstruction({
        type: "turn",
        modifier: "right",
        name: road,
        distanceMeters: 60
      }, "ml-IN");
      assert.match(turnRight, new RegExp(road));
      assert.match(turnRight, /വലത്തോട്ട്/);

      const arrive = formatPedestrianInstruction({
        type: "arrive",
        modifier: "",
        name: "Railway Station",
        distanceMeters: 0
      }, "ml-IN");
      assert.match(arrive, /Railway Station/);
      assert.match(arrive, /എത്തിച്ചേർന്നു/);
    });

    it("formats Hindi, Tamil, and Telugu instructions correctly", () => {
      const hindiTurn = formatPedestrianInstruction({
        type: "turn",
        modifier: "left",
        name: road,
        distanceMeters: 50
      }, "hi-IN");
      assert.match(hindiTurn, /बाईं ओर/);

      const tamilTurn = formatPedestrianInstruction({
        type: "turn",
        modifier: "right",
        name: road,
        distanceMeters: 50
      }, "ta-IN");
      assert.match(tamilTurn, /வலதுபுறம்/);

      const teluguTurn = formatPedestrianInstruction({
        type: "turn",
        modifier: "left",
        name: road,
        distanceMeters: 50
      }, "te-IN");
      assert.match(teluguTurn, /ఎడమవైపు/);
    });

    it("formats English instructions cleanly as reference", () => {
      const enTurn = formatPedestrianInstruction({
        type: "turn",
        modifier: "left",
        name: road,
        distanceMeters: 75
      }, "en-US");
      assert.strictEqual(enTurn, "Turn left onto Sayyaji Rao Road and continue for 75 meters.");
    });
  });

  describe("Backend Neural TTS Integration", () => {
    it("generates neural Kannada audio via backend /tts endpoint", async () => {
      try {
        const response = await axios.post("http://127.0.0.1:5000/tts", {
          text: "ಹಲೋ, ಇದು ಪರೀಕ್ಷೆ",
          lang: "kn-IN"
        }, { timeout: 8000 });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.status, "success");
        assert.strictEqual(response.data.voice, "kn-IN-GaganNeural");
        assert.ok(response.data.audioUrl.endsWith(".mp3"));
      } catch (err) {
        // If server is not running in test environment, skip gracefully
        if (err.code === "ECONNREFUSED") {
          console.warn("Express server not running on port 5000 during test run, skipping network test.");
          return;
        }
        throw err;
      }
    });

    it("generates neural Malayalam audio via backend /tts endpoint", async () => {
      try {
        const response = await axios.post("http://127.0.0.1:5000/tts", {
          text: "നമസ്കാരം, ഇത് പരീക്ഷണമാണ്",
          lang: "ml-IN"
        }, { timeout: 8000 });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.status, "success");
        assert.strictEqual(response.data.voice, "ml-IN-MidhunNeural");
        assert.ok(response.data.audioUrl.endsWith(".mp3"));
      } catch (err) {
        if (err.code === "ECONNREFUSED") {
          console.warn("Express server not running on port 5000 during test run, skipping network test.");
          return;
        }
        throw err;
      }
    });
  });
});
