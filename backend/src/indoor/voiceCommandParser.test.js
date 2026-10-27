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

  it("handles voice scan control, silence, and all required indoor destination requests", () => {
    // 1. Scan control commands
    assert.equal(parseNavigationUtterance("start scan").type, "START_SLAM");
    assert.equal(parseNavigationUtterance("start a scan").type, "START_SLAM");
    assert.equal(parseNavigationUtterance("pause scan").type, "PAUSE_SLAM");
    assert.equal(parseNavigationUtterance("resume scan").type, "RESUME_SLAM");
    assert.equal(parseNavigationUtterance("stop scan").type, "STOP_SLAM");
    assert.equal(parseNavigationUtterance("reset scan").type, "RESET_SLAM");
    assert.equal(parseNavigationUtterance("reset map").type, "RESET_SLAM");
    assert.equal(parseNavigationUtterance("reset indoor scan").type, "RESET_SLAM");

    // 2. Silence / stop speaking
    assert.equal(parseNavigationUtterance("stop speaking").type, "STOP_SPEAKING");
    assert.equal(parseNavigationUtterance("be quiet").type, "STOP_SPEAKING");
    assert.equal(parseNavigationUtterance("silence").type, "STOP_SPEAKING");
    assert.equal(parseNavigationUtterance("बोलना बंद करो").type, "STOP_SPEAKING");
    assert.equal(parseNavigationUtterance("ಮಾತನಾಡುವುದನ್ನು ನಿಲ್ಲಿಸಿ").type, "STOP_SPEAKING");

    // 3. Repeat directions
    assert.equal(parseNavigationUtterance("repeat the directions").type, "REPEAT_INSTRUCTION");
    assert.equal(parseNavigationUtterance("repeat directions").type, "REPEAT_INSTRUCTION");

    // 4. Obstacle queries
    assert.equal(parseNavigationUtterance("what obstacles are ahead").type, "OBSTACLE_QUERY");

    // 5. Where am I
    assert.equal(parseNavigationUtterance("where am i").type, "WHERE_AM_I");

    // 6. Destination requests
    const dExit = parseNavigationUtterance("Take me to the nearest exit.");
    assert.equal(dExit.type, "NAVIGATE_TO");
    assert.match(dExit.destination, /exit/i);

    const dLift = parseNavigationUtterance("Find the lift.");
    assert.equal(dLift.type, "NAVIGATE_TO");
    assert.match(dLift.destination, /lift/i);

    const dStairs = parseNavigationUtterance("Take me to the stairs.");
    assert.equal(dStairs.type, "NAVIGATE_TO");
    assert.match(dStairs.destination, /stairs/i);

    const dDoor = parseNavigationUtterance("Find the nearest door.");
    assert.equal(dDoor.type, "NAVIGATE_TO");
    assert.match(dDoor.destination, /door/i);

    const dRec = parseNavigationUtterance("Guide me to the reception.");
    assert.equal(dRec.type, "NAVIGATE_TO");
    assert.match(dRec.destination, /reception/i);

    const dRest = parseNavigationUtterance("Find the restroom.");
    assert.equal(dRest.type, "NAVIGATE_TO");
    assert.match(dRest.destination, /restroom/i);
  });
});
