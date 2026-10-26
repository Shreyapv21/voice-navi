# app.py
from fastapi import FastAPI, UploadFile, File, APIRouter, WebSocket, WebSocketDisconnect, Form 
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from fastapi.responses import JSONResponse
from PIL import Image
from pytesseract import image_to_string
try:
    from gtts import gTTS
except ImportError:
    gTTS = None
import os
import uuid
import asyncio
import shutil
import tempfile
import threading
import time

import numpy as np
import cv2

from typing import Optional
from utils.text_to_speech import generate_tts_file, get_voice_for_language, LANGUAGE_VOICE_MAP
from utils.speech_to_text import convert_speech_to_text
from utils.object_detection import detect_objects
from utils.ocr_utils import extract_text_from_image, text_to_speech
from utils.live_detection import start_live_detection, stop_live_detection, running, get_current_detections, process_frame
from utils.slam_engine import slam_instance
from utils.indoor_perception import perception_engine

router = APIRouter()

# ---------------- Directories ----------------
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ---------------- FastAPI app ----------------
app = FastAPI(title="AI Voice Navigation Service", version="1.0")

# Enable CORS for React frontend (localhost + LAN dev origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):[0-9]+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploads folder
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# ---------------- Global Variables ----------------
latest_detections = []  # Add this missing global variable

# ---------------- Models ----------------
class TTSRequest(BaseModel):
    text: str
    lang: Optional[str] = "en-US"
    voice: Optional[str] = None

# ---------------- Root ----------------
@app.get("/")
def root():
    return {"message": "AI Voice Navigation Service is running 🚀"}


@app.get("/live/start/")
def live_detection_start():
    global running, latest_detections
    if running:
        return {"status": "already_running", "message": "Live detection is already running."}

    # Run live detection in a separate thread
    threading.Thread(target=start_live_detection, daemon=True).start()
    return {"status": "started", "message": "Live detection started."}

# 🔴 Live Detection Stop
@app.get("/live/stop/")
def live_detection_stop():
    global running, latest_detections
    if not running:
        return {"status": "not_running", "message": "Live detection is not running."}

    stop_live_detection()
    latest_detections = []  # Clear detections when stopped
    return {"status": "stopped", "message": "Stop signal sent to live detection."}

# ---------------- TTS ----------------
@app.post("/tts/")
async def tts_endpoint(req: TTSRequest):
    try:
        clean_text = req.text.strip() if req.text else ""
        if not clean_text:
            return {"status": "error", "message": "Text cannot be empty"}

        voice = get_voice_for_language(req.lang, req.voice)
        filename = f"tts_{uuid.uuid4().hex}.mp3"
        filepath = os.path.join(UPLOAD_DIR, filename)
        await generate_tts_file(clean_text, filepath, voice=voice)
        return {
            "status": "success",
            "file": filename,
            "filePath": f"uploads/{filename}",
            "audioUrl": f"/uploads/{filename}",
            "voice": voice,
            "lang": req.lang
        }
    except Exception as e:
        print(f"TTS Error: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/tts/voices/")
def tts_voices_endpoint():
    return {
        "status": "success",
        "engine": "edge-tts",
        "voices": LANGUAGE_VOICE_MAP
    }

# ---------------- STT ----------------
@app.post("/stt/")
async def stt_endpoint(audio: UploadFile = File(...)):
    """
    Convert speech → text using Whisper
    """
    # Save uploaded file in a temporary file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        tmp_path = tmp.name
        tmp.write(await audio.read())

    try:
        # Run Whisper transcription in a thread to avoid blocking
        text = await asyncio.to_thread(convert_speech_to_text, tmp_path)
        return {"status": "success", "text": text}
    except Exception as e:
        return {"status": "error", "text": f"Error processing audio: {str(e)}"}
    finally:
        # Delete temp file
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

# ---------------- Object Detection ----------------
@app.post("/detect/")
async def detect_endpoint(image: UploadFile = File(...)):
    """
    Detect objects in image using YOLOv8
    """
    # Save uploaded image
    filename = os.path.join(UPLOAD_DIR, f"detect_{uuid.uuid4().hex}.jpg")
    with open(filename, "wb") as f:
        f.write(await image.read())

    try:
        results, output_file = detect_objects(filename)
        return {
            "status": "success",
            "detections": results,
            "output_file": os.path.basename(output_file),
            "fileUrl": f"/uploads/{os.path.basename(output_file)}"
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/live/frame/")
async def process_live_frame(file: UploadFile = File(...)):
    """
    Process a single image frame uploaded from browser client camera.
    """
    try:
        content = await file.read()
        nparr = np.frombuffer(content, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            return JSONResponse({"status": "error", "message": "Invalid image frame", "detections": []}, status_code=400)

        detections = process_frame(frame)
        return {"status": "success", "detections": detections}
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e), "detections": []}, status_code=500)

@app.get("/live/detections/")
def get_live_detections():
    """Get current detection results for frontend"""
    global latest_detections
    if not running:
        return {"status": "not_running", "detections": []}
    
    try:
        # Get current detections from live_detection module
        current_detects = get_current_detections()
        
        detections = []
        for detection in current_detects:
            # Handle both tuple formats: (label, distance, direction) or (label, distance, direction, confidence)
            if len(detection) == 3:
                label, distance, direction = detection
                confidence = 0.8  # Default confidence
            else:
                label, distance, direction, confidence = detection
            
            detections.append({
                "class_name": label,
                "distance": distance,
                "direction": direction,
                "confidence": round(float(confidence), 2)
            })
        
        latest_detections = detections  # Update global for WebSocket
        return {"status": "running", "detections": detections}
    
    except Exception as e:
        print(f"Error in get_live_detections: {e}")
        return {"status": "error", "detections": [], "message": str(e)}

@app.get("/live/status/")
def get_live_status():
    """Check if live detection is running"""
    return {"running": running}
    
@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("📡 Client connected to WebSocket")
    try:
        while True:
            await asyncio.sleep(1)  # Send updates every second
            if running and latest_detections:
                await websocket.send_json({
                    "status": "running", 
                    "detections": latest_detections
                })
            else:
                await websocket.send_json({
                    "status": "not_running", 
                    "detections": []
                })
    except WebSocketDisconnect:
        print("📡 Client disconnected from WebSocket")
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        await websocket.close()
# In your app.py - Update the OCR endpoint
@app.post("/ocr/")
async def read_text(file: UploadFile = File(...)):
    """
    Extract text from uploaded image and optionally generate speech.
    """
    try:
        print(f"📸 Received file: {file.filename}, content-type: {file.content_type}")
        
        # Validate file type
        if not file.content_type.startswith('image/'):
            return JSONResponse(
                {"status": "error", "message": "File must be an image"}, 
                status_code=400
            )

        # Save uploaded image
        file_extension = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
        file_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.{file_extension}")
        
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        print(f"💾 Image saved to: {file_path}")

        # Perform OCR
        try:
            img = Image.open(file_path)
            print(f"🖼️ Image opened successfully: {img.size}, mode: {img.mode}")
            
            # Convert image to RGB if necessary (for PNG with transparency)
            if img.mode != 'RGB':
                img = img.convert('RGB')
            
            # Perform OCR
            extracted_text = image_to_string(img).strip()
            print(f"📖 Extracted text: {extracted_text}")

        except Exception as ocr_error:
            print(f"❌ OCR processing error: {str(ocr_error)}")
            return JSONResponse(
                {"status": "error", "message": f"OCR processing failed: {str(ocr_error)}"}, 
                status_code=500
            )

        # Convert extracted text to speech
        audio_file = None
        if extracted_text:
            try:
                audio_file = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}_ocr.mp3")
                await generate_tts_file(extracted_text, audio_file, voice=get_voice_for_language("en-US"))
                print(f"🔊 Audio file saved: {audio_file}")
            except Exception as tts_error:
                print(f"❌ TTS error: {str(tts_error)}")
                # Continue even if TTS fails

        return {
            "status": "success",
            "text": extracted_text,
            "audio_file": os.path.basename(audio_file) if audio_file else None,
            "fileUrl": f"/uploads/{os.path.basename(audio_file)}" if audio_file else None
        }

    except Exception as e:
        print(f"❌ General error in OCR endpoint: {str(e)}")
        return JSONResponse(
            {"status": "error", "message": f"Server error: {str(e)}"}, 
            status_code=500
        )

# ---------------- SLAM Endpoints ----------------
class SLAMRouteRequest(BaseModel):
    destination: str
    start_id: Optional[str] = None

class SLAMLabelRequest(BaseModel):
    target_id: Optional[str] = "current"
    label: str
    type: Optional[str] = "room"

class SLAMMapLoadRequest(BaseModel):
    map_data: dict

@app.get("/slam/health/")
@app.get("/slam/health")
def slam_health():
    return {
        "status": "ok",
        "service": "Visual SLAM Engine",
        "frame_count": slam_instance.frame_count,
        "state": slam_instance.state,
        "keyframes": len(slam_instance.keyframes),
        "landmarks": len(slam_instance.observed_landmarks)
    }

@app.post("/slam/frame/")
@app.post("/slam/frame")
async def slam_process_frame(
    file: UploadFile = File(...),
    ocr_text: Optional[str] = Form(None)
):
    """
    Process single camera frame through Visual SLAM Engine (Visual Odometry & Landmark Graph Mapping).
    """
    try:
        content = await file.read()
        nparr = np.frombuffer(content, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            return JSONResponse({"status": "error", "message": "Invalid image frame"}, status_code=400)

        # Real-time indoor object recognition and structural perception
        try:
            perception_res = perception_engine.process(frame, ocr_text=ocr_text)
            detections = perception_res.get("objects", [])
        except Exception as pe:
            print(f"Perception error: {pe}")
            perception_res = {"objects": [], "structural_perception": {}, "model_info": {"status": "error"}}
            detections = []

        structural = perception_res.get("structural_perception", {})
        result = slam_instance.process_frame(
            frame,
            detected_objects=detections,
            structural_perception=structural,
            ocr_text=ocr_text
        )
        result["perception"] = {
            "objects": detections,
            "structural_perception": perception_res.get("structural_perception", {}),
            "model_info": perception_res.get("model_info", {})
        }
        return JSONResponse(result)
    except Exception as e:
        print(f"SLAM error: {e}")
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)

@app.get("/slam/status/")
@app.get("/slam/status")
def slam_get_status():
    """
    Get current SLAM pose, tracking confidence, keyframes, scale info, and explored graph.
    """
    return JSONResponse(slam_instance._build_status())

@app.post("/slam/reset/")
@app.post("/slam/reset")
def slam_reset():
    """
    Reset Visual SLAM exploration session.
    """
    slam_instance.reset()
    return {"status": "success", "message": "SLAM mapping session reset to origin."}

@app.post("/slam/route/")
@app.post("/slam/route")
def slam_plan_route(req: SLAMRouteRequest):
    """
    Plan a walking route on the explored topological graph towards target landmark with turn angles.
    """
    result = slam_instance.plan_route_to_target(req.destination, start_node_id=req.start_id)
    return JSONResponse(result)

@app.post("/slam/label/")
@app.post("/slam/label")
def slam_label_location(req: SLAMLabelRequest):
    """
    Explicitly label a node, landmark, or current position with a meaningful destination name.
    """
    target = req.target_id or "current"
    loc_type = req.type or "room"
    result = slam_instance.label_location(target, req.label, location_type=loc_type)
    return JSONResponse(result)

@app.get("/slam/map/")
@app.get("/slam/map")
def slam_export_map():
    """
    Export current explored SLAM map.
    """
    return JSONResponse(slam_instance.export_map())

@app.post("/slam/map/load/")
def slam_load_map(req: SLAMMapLoadRequest):
    """
    Load a pre-mapped indoor environment or saved SLAM graph.
    """
    result = slam_instance.load_map(req.map_data)
    return JSONResponse(result)




@app.post("/perception/frame/")
@app.post("/perception/frame")
async def perception_only_frame(
    file: UploadFile = File(...),
    ocr_text: Optional[str] = Form(None)
):
    try:
        content = await file.read()
        nparr = np.frombuffer(content, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            return JSONResponse({"status": "error", "message": "Invalid image frame"}, status_code=400)
        res = perception_engine.process(frame, ocr_text=ocr_text)
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)
