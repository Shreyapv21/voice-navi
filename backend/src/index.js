// index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const multer = require("multer");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const aiRoutes = require("./routes/aiRoutes");
const navigationRoutes = require("./routes/navigationRoutes");
const indoorRoutes = require("./routes/indoorRoutes");

const app = express();
const upload = multer({ dest: "uploads/" });

// Enable CORS for all incoming requests (supports localhost, LAN IP, and ngrok)
app.use(cors());
app.use(express.json());

// Serve static files from "public" and "uploads"
app.use("/static", express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// AI and Navigation Router mounts
app.use("/api", aiRoutes);
app.use("/api/navigation", navigationRoutes);
app.use("/api/indoor", indoorRoutes);

// Health check
app.get("/", (req, res) => {
  res.send("✅ Node backend is running!");
});

// ------------------ TTS ------------------
app.post("/tts", async (req, res) => {
  try {
    const { text, lang, language, voice } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const aiBaseUrl = process.env.AI_BASE_URL || "http://127.0.0.1:8000";
    const response = await axios.post(`${aiBaseUrl}/tts/`, {
      text,
      lang: lang || language || "en-US",
      voice
    });

    res.json(response.data);
  } catch (err) {
    console.error("Error calling FastAPI:", err.message);
    res.status(500).json({ error: "Failed to connect to AI service: " + err.message });
  }
});

// ------------------ STT ------------------
app.post("/stt", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Audio file required" });
    }

    const formData = new FormData();
    formData.append("audio", fs.createReadStream(req.file.path));

    const aiBaseUrl = process.env.AI_BASE_URL || "http://127.0.0.1:8000";
    const response = await axios.post(`${aiBaseUrl}/stt/`, formData, {
      headers: formData.getHeaders(),
    });

    res.json(response.data);
  } catch (err) {
    console.error("Error calling FastAPI:", err.message);
    res.status(500).json({ error: "Failed to connect to AI service" });
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlink(req.file.path, () => {});
    }
  }
});

// ------------------ DETECT ------------------
app.post("/detect", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Image file required" });
    }

    const formData = new FormData();
    formData.append("image", fs.createReadStream(req.file.path));

    const aiBaseUrl = process.env.AI_BASE_URL || "http://127.0.0.1:8000";
    const response = await axios.post(`${aiBaseUrl}/detect/`, formData, {
      headers: formData.getHeaders(),
    });

    res.json(response.data);
  } catch (err) {
    console.error("Error calling FastAPI:", err.message);
    res.status(500).json({ error: "Failed to connect to AI service" });
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlink(req.file.path, () => {});
    }
  }
});

// ------------------ DOWNLOAD FILES ------------------
app.get("/download/:filename", (req, res) => {
  const filePath = path.join(__dirname, "uploads", req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  res.download(filePath);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Node backend running at http://localhost:${PORT}`);
});
