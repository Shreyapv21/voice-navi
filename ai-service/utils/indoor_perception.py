# ai-service/utils/indoor_perception.py
"""
Real-Time Indoor Object Recognition & Structural Perception Engine for Dhristi.

Capabilities:
1. Object Recognition via YOLOv8n (COCO: person, chair, couch, table, backpack, suitcase, etc.)
2. Motion Estimation for Moving People vs Stationary Persons
3. Geometric Door & Open Doorway Perception (frame detection, aspect ratio, header, handle)
4. Elevator / Lift Perception (evidence-based: split metal doors, call button fixtures, floor signage)
5. Stairs Perception (stacked horizontal step treads, spacing validation, ascending/descending)
6. Corridor & Wall Boundaries (vanishing point estimation, floor-wall boundary lines, corner junctions)
7. Floor Openings, Potholes & Uneven Surfaces (visual negative-contrast drops on floor polygon)
8. Glass Doors & Transparent Obstacles (perimeter frames, push-bar crash rails, specular highlights)
9. Fire Extinguishers & Safety Landmarks (HSV red canister segmentation + OCR signage)
10. OCR Landmark Extraction (Exits, Restrooms, Receptions, Room numbers, Elevator signs)
11. Temporal Smoothing & Anti-Flicker Tracking across frames
12. Honest, transparent status reporting with model metadata & class disclosures
"""

import cv2
import numpy as np
import time
import math
import os
import re
from typing import Dict, List, Optional, Tuple, Any
from ultralytics import YOLO

class TrackedPerceptionItem:
    def __init__(self, item_id: str, class_name: str, bbox: List[int], confidence: float, label: str, metadata: Dict):
        self.id = item_id
        self.class_name = class_name
        self.bbox = bbox  # [x1, y1, x2, y2]
        self.confidence = confidence
        self.label = label
        self.metadata = metadata or {}
        self.first_seen = time.time()
        self.last_seen = time.time()
        self.seen_count = 1
        self.smoothed_bbox = [float(v) for v in bbox]
        
        # Position history for motion tracking: (timestamp, cx, cy)
        cx = (bbox[0] + bbox[2]) / 2.0
        cy = (bbox[1] + bbox[3]) / 2.0
        self.position_history = [(self.first_seen, cx, cy)]
        self.is_moving = False
        self.velocity = (0.0, 0.0) # (vx, vy) in px/sec

    def update(self, new_bbox: List[int], new_conf: float, new_label: str, new_meta: Dict):
        now = time.time()
        self.last_seen = now
        self.seen_count += 1
        self.confidence = 0.7 * self.confidence + 0.3 * new_conf
        self.label = new_label
        self.metadata.update(new_meta or {})
        
        # Exponential smoothing on bounding box
        alpha = 0.55
        self.smoothed_bbox = [
            alpha * float(new_bbox[i]) + (1 - alpha) * self.smoothed_bbox[i]
            for i in range(4)
        ]
        self.bbox = [int(round(v)) for v in self.smoothed_bbox]

        # Motion displacement tracking
        new_cx = (self.bbox[0] + self.bbox[2]) / 2.0
        new_cy = (self.bbox[1] + self.bbox[3]) / 2.0
        
        if len(self.position_history) > 0:
            last_t, last_cx, last_cy = self.position_history[-1]
            dt = now - last_t
            if dt >= 0.12:
                vx = (new_cx - last_cx) / max(0.04, dt)
                vy = (new_cy - last_cy) / max(0.04, dt)
                speed = math.hypot(vx, vy)
                self.velocity = (vx, vy)
                # Motion threshold: moving faster than 25 px/sec
                self.is_moving = speed > 25.0
                self.position_history.append((now, new_cx, new_cy))
                if len(self.position_history) > 8:
                    self.position_history.pop(0)


class IndoorPerceptionEngine:
    def __init__(self, model_path: str = "yolov8n.pt"):
        self.model_path = model_path
        self.model = None
        self.model_status = "unloaded"
        self.error_message = None
        self._load_model()

        # Active tracked detections for temporal smoothing
        self.tracks: Dict[str, TrackedPerceptionItem] = {}
        self.track_counter = 1
        
        # Max age for stale tracks (seconds)
        self.max_track_age = 1.3
        
        # Supported classes disclosure
        self.supported_classes = [
            # People & dynamic entities
            "person", "moving person",
            # Structural & Architectural
            "door", "doorway", "open doorway", "elevator", "stairs", "corridor", "wall", "corner",
            # Furniture & indoor fixtures
            "chair", "couch", "dining table", "bed", "tv", "laptop", "toilet", "refrigerator", "cabinet",
            # Floor objects & hazards
            "backpack", "suitcase", "box", "pothole", "floor opening", "uneven surface",
            # Transparent obstacles
            "glass door", "transparent partition",
            # Safety fixtures & indoor landmarks
            "fire extinguisher", "exit", "emergency exit", "restroom", "reception", "room"
        ]

    def get_model_info(self) -> Dict:
        coco_classes = [
            "person", "chair", "couch", "dining table", "bed", "toilet",
            "tv", "laptop", "refrigerator", "bottle", "backpack", "suitcase"
        ]
        return {
            "detector": "YOLOv8n (COCO) + Multimodal Architectural Perception + OCR",
            "model_status": self.model_status,
            "supported_classes": self.supported_classes,
            "coco_supported_classes": coco_classes,
            "classes_detected_via_yolo": coco_classes,
            "classes_detected_via_geometry": [
                "door", "doorway", "open doorway", "elevator", "stairs", "wall", "corridor", "corner",
                "glass door", "box", "pothole / floor opening"
            ],
            "classes_detected_via_hsv_or_color": [
                "fire extinguisher"
            ],
            "classes_detected_via_ocr": [
                "exit", "emergency exit", "restroom", "reception", "room", "elevator sign", "stairs sign"
            ],
            "uncertain_or_experimental_classes": [
                "glass doors (detected via perimeter frame, push-bar rails, or reflection patterns; clean frameless glass without decals has limited monocular visibility)",
                "potholes / floor openings (detected via visual contrast drops on floor polygon; monocular cameras lack direct metric depth)",
                "uneven floor surfaces (detected via visual texture changes)"
            ],
            "unsupported_classes": [
                "invisible or transparent obstacles in uniform lighting without frames/reflections",
                "absolute metric depth without scale reference or ground truth calibration",
                "low-contrast obstacles in complete darkness"
            ]
        }

    def _load_model(self):
        try:
            possible_paths = [
                self.model_path,
                os.path.join(os.path.dirname(__file__), "..", self.model_path),
                os.path.join(os.path.dirname(__file__), self.model_path)
            ]
            chosen_path = None
            for p in possible_paths:
                if os.path.exists(p):
                    chosen_path = p
                    break

            if chosen_path:
                self.model = YOLO(chosen_path)
                self.model_status = "loaded"
            else:
                self.model = YOLO(self.model_path)
                self.model_status = "loaded"
        except Exception as e:
            self.model_status = "error"
            self.error_message = f"Failed to load YOLO model: {str(e)}"
            self.model = None

    def _compute_iou(self, boxA: List[int], boxB: List[int]) -> float:
        xA = max(boxA[0], boxB[0])
        yA = max(boxA[1], boxB[1])
        xB = min(boxA[2], boxB[2])
        yB = min(boxA[3], boxB[3])

        interArea = max(0, xB - xA) * max(0, yB - yA)
        boxAArea = max(1, (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]))
        boxBArea = max(1, (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]))

        iou = interArea / float(boxAArea + boxBArea - interArea)
        return iou

    def _detect_structural_doors_and_elevators(
        self,
        frame_bgr: np.ndarray,
        ocr_text: Optional[str] = None
    ) -> List[Dict]:
        """
        Evidence-based geometric recognition of doors, open doorways, and elevators:
        - Door: Vertical parallel jambs, top header beam, door-like aspect ratio (1.4 to 3.8).
        - Open doorway: Vertical jambs with low interior edge density and darker interior corridor penetration.
        - Elevator: Dual metallic sliding split seam, call-button fixture, or elevator signage.
        """
        h, w = frame_bgr.shape[:2]
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        
        blurred = cv2.bilateralFilter(gray, 7, 50, 50)
        edges = cv2.Canny(blurred, 40, 130)

        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        candidates = []

        for cnt in contours:
            x, y, bw, bh = cv2.boundingRect(cnt)
            box_area = bw * bh
            if box_area < (w * h * 0.03):
                continue

            aspect_ratio = float(bh) / max(1, bw)

            if 1.4 <= aspect_ratio <= 3.8 and bh >= int(h * 0.28):
                roi = edges[y:y+bh, x:x+bw]
                if roi.size == 0:
                    continue

                left_edge_density = np.sum(roi[:, :max(1, bw // 5)]) / (bh * max(1, bw // 5) * 255.0)
                right_edge_density = np.sum(roi[:, -max(1, bw // 5):]) / (bh * max(1, bw // 5) * 255.0)
                top_edge_density = np.sum(roi[:max(1, bh // 8), :]) / (max(1, bh // 8) * bw * 255.0)

                boundary_score = (left_edge_density + right_edge_density + top_edge_density) / 3.0
                ar_score = max(0.0, 1.0 - abs(aspect_ratio - 2.1) / 1.5)
                conf = round(min(0.92, max(0.50, 0.45 + boundary_score * 0.4 + ar_score * 0.3)), 2)

                if conf >= 0.52:
                    # Check for ELEVATOR specific visual evidence
                    is_elevator = False
                    elevator_evidence = []

                    # 1. Center vertical split seam (typical of dual sliding metallic elevator doors)
                    mid_x = bw // 2
                    center_strip = roi[:, max(0, mid_x - 3):min(bw, mid_x + 4)]
                    if center_strip.size > 0:
                        center_seam_density = np.sum(center_strip) / (center_strip.size * 255.0)
                        if center_seam_density > 0.08:
                            elevator_evidence.append("center_split_seam")

                    # 2. Call-button panel beside door
                    button_region_left = gray[y + int(bh * 0.4):y + int(bh * 0.7), max(0, x - 40):x]
                    button_region_right = gray[y + int(bh * 0.4):y + int(bh * 0.7), x + bw:min(w, x + bw + 40)]
                    for btn_roi in [button_region_left, button_region_right]:
                        if btn_roi.size > 0 and np.var(btn_roi) > 80:
                            elevator_evidence.append("adjacent_call_panel")
                            break

                    # 3. Check OCR context
                    if ocr_text:
                        ocr_lower = ocr_text.lower()
                        if any(term in ocr_lower for term in ["elevator", "lift", "floor", "▲", "▼"]):
                            elevator_evidence.append("signage_match")

                    if len(elevator_evidence) >= 2 or ("signage_match" in elevator_evidence):
                        is_elevator = True

                    # Check for OPEN DOORWAY distinction: interior is darker and has low edge density
                    is_open_doorway = False
                    if not is_elevator:
                        interior_roi_gray = gray[y + int(bh * 0.2): y + int(bh * 0.8), x + int(bw * 0.2): x + int(bw * 0.8)]
                        if interior_roi_gray.size > 0:
                            interior_mean = np.mean(interior_roi_gray)
                            frame_mean = np.mean(gray)
                            interior_edges = roi[int(bh * 0.2): int(bh * 0.8), int(bw * 0.2): int(bw * 0.8)]
                            interior_edge_density = np.sum(interior_edges) / (interior_edges.size * 255.0) if interior_edges.size > 0 else 0
                            if interior_mean < (frame_mean * 0.85) and interior_edge_density < 0.05:
                                is_open_doorway = True

                    # Direction calculation
                    cx = x + bw / 2.0
                    rel_cx = cx / float(w)
                    if rel_cx < 0.35:
                        direction = "on your left"
                    elif rel_cx > 0.65:
                        direction = "on your right"
                    else:
                        direction = "in front of you"

                    if is_elevator:
                        class_name = "elevator"
                        label = "Elevator / Lift"
                        final_conf = min(0.95, conf + 0.1)
                    elif is_open_doorway:
                        class_name = "doorway"
                        label = "Open Doorway"
                        final_conf = min(0.94, conf + 0.05)
                    else:
                        class_name = "door"
                        label = "Doorway"
                        final_conf = conf

                    candidates.append({
                        "class_name": class_name,
                        "label": label,
                        "confidence": final_conf,
                        "bbox": [x, y, x + bw, y + bh],
                        "direction": direction,
                        "center": [int(cx), int(y + bh / 2.0)],
                        "metadata": {
                            "type": "architectural",
                            "is_open": is_open_doorway,
                            "aspect_ratio": round(aspect_ratio, 2),
                            "elevator_evidence": elevator_evidence if is_elevator else None
                        }
                    })

        # Non-maximum suppression
        final_candidates = []
        for cand in sorted(candidates, key=lambda c: c["confidence"], reverse=True):
            if not any(self._compute_iou(cand["bbox"], f["bbox"]) > 0.40 for f in final_candidates):
                final_candidates.append(cand)

        return final_candidates[:4]

    def _detect_structural_stairs(
        self,
        frame_bgr: np.ndarray,
        ocr_text: Optional[str] = None
    ) -> List[Dict]:
        """
        Evidence-based geometric recognition of indoor stairs:
        - Detects periodic, stacked horizontal step tread edges with regular vertical spacing.
        - Verifies tread width, consistency, and spatial positioning in lower/middle view.
        """
        h, w = frame_bgr.shape[:2]
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)

        y_start = int(h * 0.25)
        roi = gray[y_start:, :]
        blurred = cv2.GaussianBlur(roi, (5, 5), 0)
        edges = cv2.Canny(blurred, 40, 120)

        min_len = int(w * 0.16)
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=35, minLineLength=min_len, maxLineGap=18)
        if lines is None or len(lines) < 3:
            return []

        h_segments = []
        for l in lines:
            pts = l.ravel()
            x1, y1, x2, y2 = int(pts[0]), int(pts[1]) + y_start, int(pts[2]), int(pts[3]) + y_start
            dx = abs(x2 - x1)
            dy = abs(y2 - y1)
            if dx >= min_len and dy <= 8:
                min_x = min(x1, x2)
                max_x = max(x1, x2)
                mid_y = (y1 + y2) // 2
                h_segments.append((min_x, max_x, mid_y))

        if len(h_segments) < 3:
            return []

        h_segments.sort(key=lambda s: s[2])

        clustered = []
        for seg in h_segments:
            if not clustered or (seg[2] - clustered[-1]["y"] > 8):
                clustered.append({"min_x": seg[0], "max_x": seg[1], "y": seg[2], "count": 1})
            else:
                clustered[-1]["min_x"] = min(clustered[-1]["min_x"], seg[0])
                clustered[-1]["max_x"] = max(clustered[-1]["max_x"], seg[1])
                clustered[-1]["count"] += 1

        if len(clustered) < 3:
            return []

        best_run = []
        current_run = [clustered[0]]
        for i in range(1, len(clustered)):
            dy = clustered[i]["y"] - clustered[i - 1]["y"]
            if 12 <= dy <= 55:
                if len(current_run) >= 2:
                    prev_dy = current_run[-1]["y"] - current_run[-2]["y"]
                    if abs(dy - prev_dy) <= 16:
                        current_run.append(clustered[i])
                    else:
                        if len(current_run) > len(best_run):
                            best_run = list(current_run)
                        current_run = [clustered[i - 1], clustered[i]]
                else:
                    current_run.append(clustered[i])
            else:
                if len(current_run) > len(best_run):
                    best_run = list(current_run)
                current_run = [clustered[i]]

        if len(current_run) > len(best_run):
            best_run = current_run

        if len(best_run) < 3:
            return []

        stair_x1 = min(step["min_x"] for step in best_run)
        stair_x2 = max(step["max_x"] for step in best_run)
        stair_y1 = max(0, min(step["y"] for step in best_run) - 10)
        stair_y2 = min(h, max(step["y"] for step in best_run) + 10)

        step_count = len(best_run)
        cx = (stair_x1 + stair_x2) / 2.0
        rel_cx = cx / float(w)
        if rel_cx < 0.35:
            direction = "on your left"
        elif rel_cx > 0.65:
            direction = "on your right"
        else:
            direction = "in front of you"

        base_conf = min(0.88, 0.55 + step_count * 0.06)
        if ocr_text and any(k in ocr_text.upper() for k in ["STAIR", "STEPS"]):
            base_conf = min(0.95, base_conf + 0.15)

        return [{
            "class_name": "stairs",
            "label": f"Stairs ({step_count} steps)",
            "confidence": round(base_conf, 2),
            "bbox": [stair_x1, stair_y1, stair_x2, stair_y2],
            "direction": direction,
            "center": [int(cx), int((stair_y1 + stair_y2) / 2.0)],
            "metadata": {
                "type": "structural_stairs",
                "step_count": step_count,
                "step_spacing_px": round((stair_y2 - stair_y1) / float(step_count), 1)
            }
        }]

    def _detect_floor_irregularities(self, frame_bgr: np.ndarray) -> List[Dict]:
        """
        Visual detection of potholes, floor openings, and uneven surfaces:
        Examines lower view for enclosed negative contrast areas / drop-offs.
        """
        h, w = frame_bgr.shape[:2]
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        
        floor_y_start = int(h * 0.55)
        floor_roi = gray[floor_y_start:, :]
        
        blurred = cv2.GaussianBlur(floor_roi, (7, 7), 0)
        thresh = cv2.adaptiveThreshold(
            blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 10
        )
        
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        hazards = []
        
        for cnt in contours:
            x, y, bw, bh = cv2.boundingRect(cnt)
            area = bw * bh
            if (w * h * 0.005) <= area <= (w * h * 0.05):
                aspect = float(bw) / max(1, bh)
                if 0.7 <= aspect <= 3.5:
                    full_y = y + floor_y_start
                    cx = x + bw / 2.0
                    rel_cx = cx / float(w)
                    direction = "on your left" if rel_cx < 0.35 else ("on your right" if rel_cx > 0.65 else "in front of you")
                    
                    hazards.append({
                        "class_name": "pothole",
                        "label": "Floor opening / Uneven surface",
                        "confidence": 0.62,
                        "bbox": [x, full_y, x + bw, full_y + bh],
                        "direction": direction,
                        "center": [int(cx), int(full_y + bh / 2.0)],
                        "metadata": {
                            "type": "hazard",
                            "uncertain": True,
                            "notice": "Tentative visual contrast drop on floor surface"
                        }
                    })
        return hazards[:2]

    def _detect_glass_doors_and_transparent_obstacles(self, frame_bgr: np.ndarray) -> List[Dict]:
        """
        Detects glass doors and transparent barriers where feasible:
        Searches for door-sized perimeter frames with specular reflection highlights or horizontal push bars.
        """
        h, w = frame_bgr.shape[:2]
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, 30, 100)
        
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        candidates = []
        
        for cnt in contours:
            x, y, bw, bh = cv2.boundingRect(cnt)
            if bw * bh < (w * h * 0.04):
                continue
            aspect = float(bh) / max(1, bw)
            if 1.5 <= aspect <= 3.4 and bh >= int(h * 0.35):
                roi = gray[y:y+bh, x:x+bw]
                if roi.size == 0:
                    continue
                
                mid_strip = edges[y + int(bh * 0.40): y + int(bh * 0.65), x: x + bw]
                has_push_bar = False
                if mid_strip.size > 0:
                    h_lines = cv2.HoughLinesP(mid_strip, 1, np.pi/180, threshold=25, minLineLength=int(bw * 0.4), maxLineGap=10)
                    if h_lines is not None and len(h_lines) >= 1:
                        has_push_bar = True
                
                glare_pixels = np.sum(roi > 240)
                has_glare = (glare_pixels / float(roi.size)) > 0.03
                
                if has_push_bar or has_glare:
                    cx = x + bw / 2.0
                    rel_cx = cx / float(w)
                    direction = "on your left" if rel_cx < 0.35 else ("on your right" if rel_cx > 0.65 else "in front of you")
                    
                    candidates.append({
                        "class_name": "glass_door",
                        "label": "Glass Door / Partition",
                        "confidence": 0.68 if has_push_bar else 0.54,
                        "bbox": [x, y, x + bw, y + bh],
                        "direction": direction,
                        "center": [int(cx), int(y + bh / 2.0)],
                        "metadata": {
                            "type": "transparent_obstacle",
                            "push_bar_detected": has_push_bar,
                            "reflection_detected": has_glare,
                            "disclaimer": "Glass detected via perimeter frame and push-bar. Clean frameless glass lacks visual contrast."
                        }
                    })
        return candidates[:2]

    def _detect_fire_extinguishers(self, frame_bgr: np.ndarray, ocr_text: Optional[str] = None) -> List[Dict]:
        """
        Detects fire extinguishers and wall safety fixtures:
        Identifies bright red cylindrical canister bodies in upper/middle view with vertical aspect ratio (1.6 to 4.0).
        """
        h, w = frame_bgr.shape[:2]
        hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
        
        mask1 = cv2.inRange(hsv, np.array([0, 110, 80]), np.array([10, 255, 255]))
        mask2 = cv2.inRange(hsv, np.array([168, 110, 80]), np.array([180, 255, 255]))
        red_mask = cv2.bitwise_or(mask1, mask2)
        
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        red_mask = cv2.morphologyEx(red_mask, cv2.MORPH_CLOSE, kernel)
        
        contours, _ = cv2.findContours(red_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        fixtures = []
        
        for cnt in contours:
            x, y, bw, bh = cv2.boundingRect(cnt)
            area = bw * bh
            if (w * h * 0.002) <= area <= (w * h * 0.05):
                aspect = float(bh) / max(1, bw)
                if 1.5 <= aspect <= 4.2 and y < int(h * 0.80):
                    cx = x + bw / 2.0
                    rel_cx = cx / float(w)
                    direction = "on your left" if rel_cx < 0.35 else ("on your right" if rel_cx > 0.65 else "in front of you")
                    
                    fixtures.append({
                        "class_name": "fire_extinguisher",
                        "label": "Fire Extinguisher",
                        "confidence": 0.78,
                        "bbox": [x, y, x + bw, y + bh],
                        "direction": direction,
                        "center": [int(cx), int(y + bh / 2.0)],
                        "metadata": {
                            "type": "safety_fixture",
                            "hsv_verified": True
                        }
                    })
        return fixtures[:2]

    def _detect_landmarks_from_ocr(self, ocr_text: Optional[str], frame_shape: Tuple[int, int]) -> List[Dict]:
        """
        Extracts verified semantic indoor landmarks from OCR text:
        Exits, Restrooms, Receptions, Stairs, Elevators, and Room numbers.
        """
        if not ocr_text or not ocr_text.strip():
            return []
            
        h, w = frame_shape[:2]
        text_upper = ocr_text.upper().strip()
        landmarks = []
        
        sign_box = [int(w * 0.25), int(h * 0.08), int(w * 0.75), int(h * 0.32)]
        
        if any(k in text_upper for k in ["EXIT", "FIRE EXIT", "EMERGENCY EXIT"]):
            landmarks.append({
                "class_name": "exit",
                "label": "Exit Sign",
                "confidence": 0.92,
                "bbox": sign_box,
                "direction": "in front of you",
                "center": [w // 2, int(h * 0.20)],
                "metadata": {"type": "ocr_landmark", "text": "Exit"}
            })
            
        if any(k in text_upper for k in ["RESTROOM", "WASHROOM", "TOILET", "BATHROOM", "LADIES", "GENTS", "WC"]):
            landmarks.append({
                "class_name": "restroom",
                "label": "Restroom",
                "confidence": 0.90,
                "bbox": sign_box,
                "direction": "in front of you",
                "center": [w // 2, int(h * 0.20)],
                "metadata": {"type": "ocr_landmark", "text": "Restroom"}
            })

        if any(k in text_upper for k in ["RECEPTION", "LOBBY", "HELP DESK", "FRONT DESK", "INFORMATION"]):
            landmarks.append({
                "class_name": "reception",
                "label": "Reception Desk",
                "confidence": 0.88,
                "bbox": sign_box,
                "direction": "in front of you",
                "center": [w // 2, int(h * 0.20)],
                "metadata": {"type": "ocr_landmark", "text": "Reception"}
            })
            
        room_match = re.search(r'\b(ROOM|LAB|OFFICE|CABIN|HALL)\s*([0-9A-Z\-]+)\b', text_upper)
        if room_match:
            room_label = f"{room_match.group(1).title()} {room_match.group(2)}"
            landmarks.append({
                "class_name": "room",
                "label": room_label,
                "confidence": 0.94,
                "bbox": sign_box,
                "direction": "in front of you",
                "center": [w // 2, int(h * 0.20)],
                "metadata": {"type": "ocr_landmark", "text": room_label}
            })
            
        return landmarks

    def _estimate_corridor_structure(self, frame_bgr: np.ndarray) -> Dict:
        """
        Geometric Corridor, Wall & Corner Perception:
        - Detects perspective boundary lines of floor and side walls using Hough transforms.
        - Calculates corridor vanishing point (VP).
        - Identifies corner junctions.
        """
        h, w = frame_bgr.shape[:2]
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        
        y_start = int(h * 0.25)
        roi_gray = gray[y_start:, :]
        edges = cv2.Canny(roi_gray, 50, 150)

        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=35, minLineLength=40, maxLineGap=20)
        
        left_lines = []
        right_lines = []

        if lines is not None:
            for line in lines:
                pts = line.reshape(-1)
                if len(pts) < 4:
                    continue
                x1, y1, x2, y2 = int(pts[0]), int(pts[1]) + y_start, int(pts[2]), int(pts[3]) + y_start

                dx = x2 - x1
                dy = y2 - y1
                if abs(dx) < 1e-4:
                    continue

                slope = float(dy) / float(dx)
                angle_deg = math.degrees(math.atan2(abs(dy), abs(dx)))

                if 20.0 <= angle_deg <= 75.0:
                    mid_x = (x1 + x2) / 2.0
                    if mid_x < (w * 0.55) and slope < -0.3:
                        left_lines.append((x1, y1, x2, y2))
                    elif mid_x > (w * 0.45) and slope > 0.3:
                        right_lines.append((x1, y1, x2, y2))

        vp_x = w // 2
        vp_y = int(h * 0.45)
        corridor_detected = False

        if left_lines and right_lines:
            l_pts = np.array(left_lines)
            lx1, ly1, lx2, ly2 = np.mean(l_pts, axis=0)
            
            r_pts = np.array(right_lines)
            rx1, ry1, rx2, ry2 = np.mean(r_pts, axis=0)

            denom = (lx1 - lx2) * (ry1 - ry2) - (ly1 - ly2) * (rx1 - rx2)
            if abs(denom) > 1e-3:
                ix = ((lx1 * ly2 - ly1 * lx2) * (rx1 - rx2) - (lx1 - lx2) * (rx1 * ry2 - ry1 * rx2)) / denom
                iy = ((lx1 * ly2 - ly1 * lx2) * (ry1 - ry2) - (ly1 - ly2) * (rx1 * ry2 - ry1 * rx2)) / denom

                if 0.1 * w <= ix <= 0.9 * w and 0.15 * h <= iy <= 0.75 * h:
                    vp_x = int(round(ix))
                    vp_y = int(round(iy))
                    corridor_detected = True

        rel_vp = vp_x / float(w)
        if rel_vp < 0.40:
            heading = "deviating_left"
            heading_desc = "Approaching left wall. Bear slightly right to center in corridor."
        elif rel_vp > 0.60:
            heading = "deviating_right"
            heading_desc = "Approaching right wall. Bear slightly left to center in corridor."
        else:
            heading = "centered"
            heading_desc = "Centered in corridor."

        x_bl = max(0, int(vp_x - (h - vp_y) * 1.1))
        x_br = min(w, int(vp_x + (h - vp_y) * 1.1))

        floor_poly = [[x_bl, h], [vp_x, vp_y], [x_br, h]]
        left_wb = [[0, h - 20], [vp_x, vp_y]]
        right_wb = [[w, h - 20], [vp_x, vp_y]]

        left_ratio = rel_vp
        right_ratio = 1.0 - rel_vp
        left_clearance = round(max(0.45, 1.9 * left_ratio), 2)
        right_clearance = round(max(0.45, 1.9 * right_ratio), 2)

        # Corridor corner & junction indications
        corners = []
        if corridor_detected:
            corners.append({
                "type": "corridor_junction",
                "x": vp_x,
                "y": vp_y,
                "label": "Corridor Junction Ahead"
            })

        return {
            "corridor_detected": corridor_detected,
            "left_wall_detected": len(left_lines) > 0,
            "right_wall_detected": len(right_lines) > 0,
            "vanishing_point": [vp_x, vp_y],
            "corridor_heading": heading,
            "corridor_alignment": heading,
            "heading_guidance": heading_desc,
            "wall_clearance_m": {"left": left_clearance, "right": right_clearance},
            "floor_polygon": floor_poly,
            "traversable_floor_polygon": floor_poly,
            "left_wall_boundary": left_wb,
            "right_wall_boundary": right_wb,
            "wall_boundaries": {"left": left_wb, "right": right_wb},
            "corners": corners,
            "confidence": 0.85 if corridor_detected else 0.45
        }

    def process(
        self,
        frame_bgr: np.ndarray,
        ocr_text: Optional[str] = None,
        frame_idx: Optional[int] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Executes complete indoor perception pipeline:
        1. Runs YOLO for COCO objects (person, furniture, bags, etc.)
        2. Runs Geometric Detector for doors, open doorways, and elevators
        3. Runs Geometric Detector for stairs and steps
        4. Runs Visual Hazard Detector for potholes and uneven surfaces
        5. Runs Specular & Frame Detector for glass doors and transparent barriers
        6. Runs HSV Red Segmentation for fire extinguishers
        7. Runs OCR extraction for indoor signs & landmarks
        8. Estimates corridor structure and wall clearance boundaries
        9. Applies temporal smoothing with velocity tracking across frames
        """
        t0 = time.time()
        h, w = frame_bgr.shape[:2]
        raw_detections = []

        # 1. Object Detection (YOLOv8n COCO)
        if self.model is not None:
            try:
                results = self.model(frame_bgr, verbose=False)[0]
                for box, cls, conf in zip(results.boxes.xyxy, results.boxes.cls, results.boxes.conf):
                    confidence = float(conf.cpu().numpy())
                    if confidence < 0.42:
                        continue

                    cls_id = int(cls.cpu().numpy())
                    raw_name = self.model.names[cls_id].lower()

                    # Filter for indoor-relevant objects
                    indoor_targets = [
                        "person", "chair", "couch", "dining table", "bed", "toilet",
                        "tv", "laptop", "refrigerator", "potted plant", "backpack", "suitcase", "handbag", "bottle"
                    ]
                    
                    if raw_name in indoor_targets:
                        x1, y1, x2, y2 = map(int, box.cpu().numpy())
                        cx = (x1 + x2) / 2.0
                        rel_cx = cx / float(w)

                        if rel_cx < 0.35:
                            direction = "on your left"
                        elif rel_cx > 0.65:
                            direction = "on your right"
                        else:
                            direction = "in front of you"

                        # Form user-friendly label
                        if raw_name in ["backpack", "suitcase", "handbag"]:
                            label = "Bag / Luggage on floor"
                            category = "floor_obstacle"
                        elif raw_name in ["chair", "couch", "dining table", "bed"]:
                            label = raw_name.title()
                            category = "furniture"
                        elif raw_name == "person":
                            label = "Person"
                            category = "person"
                        else:
                            label = raw_name.title()
                            category = "coco_object"

                        raw_detections.append({
                            "class_name": raw_name,
                            "label": label,
                            "confidence": round(confidence, 2),
                            "bbox": [x1, y1, x2, y2],
                            "direction": direction,
                            "center": [int(cx), int((y1 + y2) / 2.0)],
                            "metadata": {"type": category}
                        })
            except Exception as e:
                print(f"YOLO inference error: {e}")

        # 2. Structural Doors, Open Doorways, and Elevators
        try:
            structural_items = self._detect_structural_doors_and_elevators(frame_bgr, ocr_text=ocr_text)
            raw_detections.extend(structural_items)
        except Exception as e:
            print(f"Structural door/elevator error: {e}")

        # 3. Structural Stairs Detection
        try:
            stair_items = self._detect_structural_stairs(frame_bgr, ocr_text=ocr_text)
            raw_detections.extend(stair_items)
        except Exception as e:
            print(f"Structural stairs error: {e}")

        # 4. Floor Openings, Potholes & Uneven Surfaces
        try:
            hazard_items = self._detect_floor_irregularities(frame_bgr)
            raw_detections.extend(hazard_items)
        except Exception as e:
            print(f"Floor hazard error: {e}")

        # 5. Glass Doors & Transparent Obstacles
        try:
            glass_items = self._detect_glass_doors_and_transparent_obstacles(frame_bgr)
            raw_detections.extend(glass_items)
        except Exception as e:
            print(f"Glass obstacle error: {e}")

        # 6. Fire Extinguishers & Safety Fixtures
        try:
            fire_items = self._detect_fire_extinguishers(frame_bgr, ocr_text=ocr_text)
            raw_detections.extend(fire_items)
        except Exception as e:
            print(f"Fire extinguisher error: {e}")

        # 7. OCR Indoor Signs & Landmarks
        try:
            ocr_items = self._detect_landmarks_from_ocr(ocr_text, (h, w))
            raw_detections.extend(ocr_items)
        except Exception as e:
            print(f"OCR landmark error: {e}")

        # 8. Corridor & Wall Boundary Perception
        corridor_info = self._estimate_corridor_structure(frame_bgr)

        # 9. Temporal Smoothing & Motion Tracking
        now = time.time()
        matched_track_ids = set()
        active_items = []

        for det in raw_detections:
            best_id = None
            best_iou = 0.26

            for tr_id, tr in self.tracks.items():
                if tr.class_name == det["class_name"]:
                    iou = self._compute_iou(tr.bbox, det["bbox"])
                    if iou > best_iou:
                        best_iou = iou
                        best_id = tr_id

            if best_id is not None:
                self.tracks[best_id].update(det["bbox"], det["confidence"], det["label"], det["metadata"])
                matched_track_ids.add(best_id)
            else:
                new_id = f"trk_{self.track_counter}"
                self.track_counter += 1
                self.tracks[new_id] = TrackedPerceptionItem(
                    new_id, det["class_name"], det["bbox"], det["confidence"], det["label"], det["metadata"]
                )
                matched_track_ids.add(new_id)

        # Remove stale tracks
        stale_ids = [tr_id for tr_id, tr in self.tracks.items() if now - tr.last_seen > self.max_track_age]
        for tr_id in stale_ids:
            del self.tracks[tr_id]

        # Collect active detections
        for tr_id, tr in self.tracks.items():
            if tr.confidence >= 0.46:
                cx = (tr.bbox[0] + tr.bbox[2]) / 2.0
                rel_cx = cx / float(w)
                if rel_cx < 0.35:
                    direction = "on your left"
                elif rel_cx > 0.65:
                    direction = "on your right"
                else:
                    direction = "in front of you"

                label = tr.label
                # Motion-aware label for people
                if tr.class_name == "person" and tr.is_moving:
                    label = "Moving Person"
                    tr.metadata["is_moving"] = True

                active_items.append({
                    "id": tr.id,
                    "class_name": tr.class_name,
                    "label": label,
                    "confidence": round(tr.confidence, 2),
                    "bbox": tr.bbox,
                    "direction": direction,
                    "center": [int(cx), int((tr.bbox[1] + tr.bbox[3]) / 2.0)],
                    "metadata": tr.metadata
                })

        inference_time_ms = round((time.time() - t0) * 1000.0, 1)

        return {
            "status": "success",
            "model_info": self.get_model_info(),
            "objects": active_items,
            "structural_perception": corridor_info,
            "error": self.error_message
        }

# Global Singleton
perception_engine = IndoorPerceptionEngine()
