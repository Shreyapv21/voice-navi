const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const Tesseract = require("tesseract.js");

const AI_BASE_URL = "http://127.0.0.1:8000"; // FastAPI server

// Text-to-Speech
async function textToSpeech(text, lang = "en-US", voice = null) {
  const response = await axios.post(`${AI_BASE_URL}/tts/`, { text, lang, voice });
  return response.data;
}

// Speech-to-Text
async function speechToText(filePath) {
  const formData = new FormData();
  formData.append("audio", fs.createReadStream(filePath));

  const response = await axios.post(`${AI_BASE_URL}/stt/`, formData, {
    headers: formData.getHeaders(),
  });
  return response.data;
}

// Object Detection
async function detectObjects(filePath) {
  const formData = new FormData();
  formData.append("image", fs.createReadStream(filePath));

  const response = await axios.post(`${AI_BASE_URL}/detect/`, formData, {
    headers: formData.getHeaders(),
  });
  return response.data;
}

// OCR Image
async function ocrImage(filePath) {
  try {
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));

    const response = await axios.post(`${AI_BASE_URL}/ocr/`, formData, {
      headers: formData.getHeaders(),
    });
    return response.data;
  } catch (error) {
    // Fallback to local tesseract if AI service call fails
    try {
      const { data: { text } } = await Tesseract.recognize(filePath, "eng");
      return { text };
    } catch (fallbackError) {
      console.error("OCR Service Error:", fallbackError);
      throw fallbackError;
    }
  } finally {
    fs.unlink(filePath, (err) => {
      if (err && err.code !== 'ENOENT') console.error("Error deleting temp file:", err);
    });
  }
}

module.exports = {
  textToSpeech,
  speechToText,
  detectObjects,
  ocrImage,
};
