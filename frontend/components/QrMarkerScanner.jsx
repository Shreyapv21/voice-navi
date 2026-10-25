import React, { useEffect, useRef, useState } from "react";
import { useLanguage } from "../utils/LanguageContext.jsx";

export function QrMarkerScanner({ onScan, onError, disabled }) {
  const { t } = useLanguage();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [manualMarker, setManualMarker] = useState("");
  const [localError, setLocalError] = useState("");
  const supportsBarcodeDetector =
    typeof window !== "undefined" && "BarcodeDetector" in window;

  const stopCamera = () => {
    if (loopRef.current) {
      cancelAnimationFrame(loopRef.current);
      loopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScanning(false);
  };

  useEffect(() => () => stopCamera(), []);

  const startScanning = async () => {
    setLocalError("");
    if (!supportsBarcodeDetector) {
      setLocalError("QR camera scanning is not supported in this browser. Use manual marker entry.");
      onError?.("QR scanning unavailable in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });

      const tick = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          loopRef.current = requestAnimationFrame(tick);
          return;
        }
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0 && codes[0].rawValue) {
            stopCamera();
            onScan(codes[0].rawValue.trim());
            return;
          }
        } catch {
          // ignore frame errors
        }
        loopRef.current = requestAnimationFrame(tick);
      };
      loopRef.current = requestAnimationFrame(tick);
    } catch (err) {
      const msg =
        err.name === "NotAllowedError"
          ? "Camera permission denied. Enter the marker code manually."
          : "Could not access camera for QR scanning.";
      setLocalError(msg);
      onError?.(msg);
      stopCamera();
    }
  };

  const submitManual = () => {
    const value = manualMarker.trim();
    if (!value) {
      setLocalError("Enter a marker code.");
      return;
    }
    setLocalError("");
    onScan(value);
  };

  return (
    <div className="qr-marker-panel" role="region" aria-label={t("qr_scanner_title")}>
      <p className="indoor-hint">
        {t("qr_scanner_desc")} Format: <code>INDOOR:buildingId:floorId:locationKey</code>
      </p>
      {!supportsBarcodeDetector && (
        <p className="indoor-warning" role="status">
          Camera QR scanning requires a browser with Barcode Detector support. Manual entry is always available.
        </p>
      )}

      {scanning && (
        <video
          ref={videoRef}
          playsInline
          muted
          className="qr-video"
          aria-label="QR scanner camera preview"
        />
      )}

      <div className="indoor-btn-row">
        {!scanning ? (
          <button
            type="button"
            className="primary-btn"
            onClick={startScanning}
            disabled={disabled}
            aria-label={t("btn_start_qr")}
          >
            {t("btn_start_qr")}
          </button>
        ) : (
          <button type="button" className="primary-btn danger-btn" onClick={stopCamera}>
            {t("btn_stop_qr")}
          </button>
        )}
      </div>

      <div className="indoor-manual-marker">
        <label htmlFor="manual-marker-input">Manual marker code</label>
        <div className="nav-input-row">
          <input
            id="manual-marker-input"
            type="text"
            className="nav-input"
            placeholder="INDOOR:demo-center:0:reception"
            value={manualMarker}
            onChange={(e) => setManualMarker(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitManual()}
            disabled={disabled}
          />
          <button type="button" className="primary-btn accent-btn" onClick={submitManual} disabled={disabled}>
            Apply Marker
          </button>
        </div>
      </div>

      {localError && (
        <div className="result-box indoor-error" role="alert">
          {localError}
        </div>
      )}
    </div>
  );
}

export default QrMarkerScanner;
