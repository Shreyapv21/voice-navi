// index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const aiRoutes = require("./routes/aiRoutes");
const navigationRoutes = require("./routes/navigationRoutes");
const indoorRoutes = require("./routes/indoorRoutes");

const app = express();

// Enable CORS for all incoming requests (supports localhost, LAN IP, and ngrok)
app.use(cors());
app.use(express.json());

// Serve static files from "public" and "uploads"
app.use("/static", express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// AI and Navigation Router mounts
app.use("/api", aiRoutes);
app.use("/", aiRoutes);
app.use("/api/navigation", navigationRoutes);
app.use("/api/indoor", indoorRoutes);
app.use("/slam", indoorRoutes);

// Serve frontend dist if available (supports single-port deployment or ngrok to port 5000)
const frontendDist = path.join(__dirname, "../../frontend/dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Node backend is running!" });
});

// Download files from uploads
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
