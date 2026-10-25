const express = require("express");
const multer = require("multer");
const { textToSpeech, speechToText, detectObjects, ocrImage } = require("../services/aiService");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// Text-to-Speech
router.post("/tts", async (req, res) => {
  try {
    const { text, lang, language, voice } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required" });

    const result = await textToSpeech(text, lang || language || "en-US", voice);
    res.json(result);
  } catch (error) {
    console.error("TTS Error:", error.message);
    res.status(500).json({ error: "Failed to convert text to speech: " + error.message });
  }
});

// Speech-to-Text
router.post("/stt", upload.single("audio"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Audio file is required" });

    const result = await speechToText(file.path);
    res.json(result);
  } catch (error) {
    console.error("STT Error:", error.message);
    res.status(500).json({ error: "Failed to convert speech to text" });
  }
});

// Object Detection
router.post("/detect", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Image file is required" });

    const result = await detectObjects(file.path);
    res.json(result);
  } catch (error) {
    console.error("Detection Error:", error.message);
    res.status(500).json({ error: "Failed to detect objects" });
  }
});

// OCR
router.post("/ocr", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Image file is required" });

    const ocrResult = await ocrImage(file.path);
    res.json(ocrResult);
  } catch (error) {
    console.error("OCR Error:", error.message);
    res.status(500).json({ error: "Failed to extract text from image" });
  }
});

module.exports = router;
