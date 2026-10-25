const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("voiceCommandParser multilingual intent classification", async () => {
  const { parseNavigationUtterance, normalizeTranscript } = await import(
    "../../../frontend/utils/voiceNavigation/voiceCommandParser.js"
  );

  it("normalizes Indic and English Unicode text while preserving vowel marks (matras)", () => {
    assert.equal(normalizeTranscript("Stop!"), "stop");
    assert.equal(normalizeTranscript("ನಿಲ್ಲಿಸು!"), "ನಿಲ್ಲಿಸು");
    assert.equal(normalizeTranscript("मदद करो!"), "मदद करो");
    assert.equal(normalizeTranscript("உதவி"), "உதவி");
    assert.equal(normalizeTranscript("ఆపండి!"), "ఆపండి");
  });

  it("classifies language switching commands across all 5 languages", () => {
    assert.equal(parseNavigationUtterance("change to kannada").type, "CHANGE_LANGUAGE");
    assert.equal(parseNavigationUtterance("ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡಿ").language, "kn-IN");

    assert.equal(parseNavigationUtterance("speak in hindi").type, "CHANGE_LANGUAGE");
    assert.equal(parseNavigationUtterance("हिंदी में बोलो").language, "hi-IN");

    assert.equal(parseNavigationUtterance("switch to tamil").type, "CHANGE_LANGUAGE");
    assert.equal(parseNavigationUtterance("தமிழில் பேசு").language, "ta-IN");

    assert.equal(parseNavigationUtterance("change to telugu").type, "CHANGE_LANGUAGE");
    assert.equal(parseNavigationUtterance("తెలుగులోకి మార్చండి").language, "te-IN");

    assert.equal(parseNavigationUtterance("speak in english").language, "en-US");
  });

  it("classifies safety-critical STOP commands in all languages", () => {
    assert.equal(parseNavigationUtterance("stop").type, "STOP_NAVIGATION");
    assert.equal(parseNavigationUtterance("stop navigation").type, "STOP_NAVIGATION");
    assert.equal(parseNavigationUtterance("ನಿಲ್ಲಿಸು").type, "STOP_NAVIGATION");
    assert.equal(parseNavigationUtterance("ನಿಲ್ಲಿಸಿ").type, "STOP_NAVIGATION");
    assert.equal(parseNavigationUtterance("रोको").type, "STOP_NAVIGATION");
    assert.equal(parseNavigationUtterance("नेविगेशन बंद").type, "STOP_NAVIGATION");
    assert.equal(parseNavigationUtterance("நிறுத்து").type, "STOP_NAVIGATION");
    assert.equal(parseNavigationUtterance("ఆపండి").type, "STOP_NAVIGATION");
  });

  it("classifies PAUSE, RESUME, and REPEAT commands", () => {
    assert.equal(parseNavigationUtterance("pause navigation").type, "PAUSE_NAVIGATION");
    assert.equal(parseNavigationUtterance("ವಿರಾಮ").type, "PAUSE_NAVIGATION");

    assert.equal(parseNavigationUtterance("resume navigation").type, "RESUME_NAVIGATION");
    assert.equal(parseNavigationUtterance("ಮುಂದುವರಿಸಿ").type, "RESUME_NAVIGATION");

    assert.equal(parseNavigationUtterance("say that again").type, "REPEAT_INSTRUCTION");
    assert.equal(parseNavigationUtterance("repeat the last instruction").type, "REPEAT_INSTRUCTION");
    assert.equal(parseNavigationUtterance("ಮತ್ತೆ ಹೇಳಿ").type, "REPEAT_INSTRUCTION");
    assert.equal(parseNavigationUtterance("फिर से बोलो").type, "REPEAT_INSTRUCTION");
  });

  it("classifies surroundings, obstacle, and sensor queries", () => {
    assert.equal(parseNavigationUtterance("what is in front of me").type, "DESCRIBE_AROUND");
    assert.equal(parseNavigationUtterance("ನನ್ನ ಮುಂದೆ ಏನಿದೆ").type, "DESCRIBE_AROUND");
    assert.equal(parseNavigationUtterance("मेरे सामने क्या है").type, "DESCRIBE_AROUND");

    assert.equal(parseNavigationUtterance("is there an obstacle ahead").type, "OBSTACLE_QUERY");
    assert.equal(parseNavigationUtterance("ಮುಂದೆ ಅಡಚಣೆ ಇದೆಯೇ").type, "OBSTACLE_QUERY");

    assert.equal(parseNavigationUtterance("read the signboard").type, "READ_TEXT");
    assert.equal(parseNavigationUtterance("ಇದನ್ನು ಓದಿ").type, "READ_TEXT");

    assert.equal(parseNavigationUtterance("read the qr code").type, "READ_QR");
    assert.equal(parseNavigationUtterance("ಕ್ಯೂಆರ್ ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ").type, "READ_QR");
  });

  it("correctly distinguishes between outdoor and indoor navigation starts", () => {
    const indoorRes = parseNavigationUtterance("start indoor navigation");
    assert.equal(indoorRes.type, "START_INDOOR");

    const outdoorRes = parseNavigationUtterance("start navigation");
    assert.equal(outdoorRes.type, "START_NAVIGATION");

    const knIndoorRes = parseNavigationUtterance("ಒಳಾಂಗಣ ಸಂಚಾರ ಪ್ರಾರಂಭಿಸಿ");
    assert.equal(knIndoorRes.type, "START_INDOOR");
  });

  it("extracts destination queries in natural sentences", () => {
    const dest1 = parseNavigationUtterance("take me to the nearest hospital");
    assert.equal(dest1.type, "NAVIGATE_TO");
    assert.equal(dest1.destination, "nearest hospital");

    const dest2 = parseNavigationUtterance("how do i get to the library");
    assert.equal(dest2.type, "NAVIGATE_TO");
    assert.equal(dest2.destination, "library");

    const dest3 = parseNavigationUtterance("navigate to NIE Mysore");
    assert.equal(dest3.type, "NAVIGATE_TO");
    assert.equal(dest3.destination, "NIE Mysore");
  });
});
