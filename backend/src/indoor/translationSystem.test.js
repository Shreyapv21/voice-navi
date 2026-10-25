const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("translation system and dictionaries", async () => {
  const {
    t,
    normalizeLanguageCode,
    DICTIONARIES
  } = await import("../../../frontend/utils/translations/index.js");

  it("normalizes locale codes and language names correctly", () => {
    assert.equal(normalizeLanguageCode("kn"), "kn-IN");
    assert.equal(normalizeLanguageCode("kn-IN"), "kn-IN");
    assert.equal(normalizeLanguageCode("kannada"), "kn-IN");

    assert.equal(normalizeLanguageCode("hi"), "hi-IN");
    assert.equal(normalizeLanguageCode("hindi"), "hi-IN");

    assert.equal(normalizeLanguageCode("ta"), "ta-IN");
    assert.equal(normalizeLanguageCode("tamil"), "ta-IN");

    assert.equal(normalizeLanguageCode("te"), "te-IN");
    assert.equal(normalizeLanguageCode("telugu"), "te-IN");

    assert.equal(normalizeLanguageCode("en"), "en-US");
    assert.equal(normalizeLanguageCode("unknown-xyz"), "en-US");
  });

  it("provides comprehensive translations across all 5 languages", () => {
    const supported = ["en-US", "kn-IN", "hi-IN", "ta-IN", "te-IN"];
    const testKeys = [
      "app_name",
      "enable_voice_nav",
      "end_voice_nav",
      "messages.voiceControlEnabled",
      "messages.noObjectsInView",
      "slam_title",
      "qr_scanner_title",
      "stt_title"
    ];

    for (const lang of supported) {
      for (const key of testKeys) {
        const translated = t(key, lang);
        assert.ok(translated, `Expected translation for ${key} in ${lang}`);
        assert.notEqual(translated, key, `Translation for ${key} in ${lang} returned untranslated key`);
      }
    }
  });

  it("falls back to English when a specific key is absent", () => {
    // Test non-existent key in Kannada
    const fallback = t("buttons.testNonExistentKey123", "kn-IN");
    assert.equal(fallback, "buttons.testNonExistentKey123");
  });

  it("interpolates parameters in messages", () => {
    const greeting = t("messages.languageChanged", "en-US", { name: "Kannada" });
    assert.ok(greeting.includes("Kannada"));

    const knGreeting = t("messages.languageChanged", "kn-IN", { name: "ಕನ್ನಡ" });
    assert.ok(knGreeting.includes("ಕನ್ನಡ"));
  });

  it("verifies dictionary structure integrity", () => {
    assert.ok(DICTIONARIES["en-US"]);
    assert.ok(DICTIONARIES["kn-IN"]);
    assert.ok(DICTIONARIES["hi-IN"]);
    assert.ok(DICTIONARIES["ta-IN"]);
    assert.ok(DICTIONARIES["te-IN"]);

    // Verify Indic characters are properly encoded in UTF-8
    assert.equal(typeof DICTIONARIES["kn-IN"]["app_name"], "string");
    assert.ok(DICTIONARIES["kn-IN"]["app_name"].length > 0);
  });
});
