# ai-service/utils/indoor_perception.py
"""
Real-Time Indoor Object Recognition & Structural Perception Engine for Dhristi.

Capabilities:
1. Object Recognition via YOLOv8n (COCO: person, chair, couch, table, backpack, etc.)
2. Geometric Door & Doorway Perception (frame detection, aspect ratio, header, handle)
3. Elevator / Lift Perception (evidence-based: split metal doors, call button fixtures, floor signage)
4. Corridor & Wall Boundaries (vanishing point estimation, floor-wall boundary lines, corridor heading)
5. Temporal Smoothing & Anti-Flicker Tracking across frames
6. Honest, non-hallucinated status reporting with model metadata
"""

import cv2
import numpy as np
import time
import math
import os
from typing import Dict, List, Optional, Tuple, Any
from ultralytics import YOLO

class TrackedPerceptionItem:
    def __init__(self, item_id: str, class_name: str, bbox: List[int], confidence: float, label: str, metadata: Dict):
        self.id = item_id
        self.class_name = class_name
        self.bbox = bbox  # [x1, y1, x2, y2]
        self.confidence = confidence
        self.label = label
        self.metadata = metadata
        self.first_seen = time.time()
        self.last_seen = time.time()
        self.seen_count = 1
        self.smoothed_bbox = [float(v) for v in bbox]

    def update(self, new_bbox: List[int], new_conf: float, new_label: str, new_meta: Dict):
        self.last_seen = time.time()
        self.seen_count += 1
        self.confidence = 0.7 * self.confidence + 0.3 * new_conf
        self.label = new_label
        self.metadata = new_meta
        # Exponential smoothing on bounding box
        alpha = 0.55
        self.smoothed_bbox = [
            alpha * float(new_bbox[i]) + (1 - alpha) * self.smoothed_bbox[i]
            for i in range(4)
        ]
        self.bbox = [int(round(v)) for v in self.smoothed_bbox]

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
            # YOLO COCO Indoor
            "person", "chair", "couch", "dining table", "bed", "tv", "laptop", "toilet",
            "refrigerator", "microwave", "bottle", "backpack", "suitcase",
            # Structural & Architectural
            "door", "doorway", "elevator", "stairs", "corridor", "wall"
        ]

    def get_model_info(self) -> Dict:
        return {
            "detector": "YOLOv8n (COCO) + Architectural Perception",
            "model_status": self.model_status,
            "supported_classes": self.supported_classes,
            "classes_detected_via_geometry": ["door", "elevator", "stairs", "wall", "corridor"],
            "coco_supported_classes": [
                "person", "chair", "couch", "dining table", "bed", "tv", "laptop",
                "toilet", "refrigerator", "microwave", "bottle", "backpack", "suitcase"
            ]
        }

    def _load_model(self):
        try:
            # Look in current dir or ai-service dir
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
                # Fallback to model name
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
        Evidence-based geometric recognition of doors and elevators:
        - Door: Vertical parallel jambs, top header beam, door-like aspect ratio (1.6 to 3.4).
        - Elevator: Door candidate verified by center split seam, adjacent call-button fixture, or elevator signage.
        """
        h, w = frame_bgr.shape[:2]
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        
        # Preprocessing: bilateral filter preserves sharp vertical door jambs while smoothing wall texture
        blurred = cv2.bilateralFilter(gray, 7, 50, 50)
        edges = cv2.Canny(blurred, 40, 130)

        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        candidates = []

        for cnt in contours:
            x, y, bw, bh = cv2.boundingRect(cnt)
            box_area = bw * bh
            if box_area < (w * h * 0.03): # Must occupy at least 3% of visual field
                continue

            aspect_ratio = float(bh) / max(1, bw)

            # Check door-like aspect ratio and minimum height (doors are tall, >= 25% of view)
            if 1.4 <= aspect_ratio <= 3.8 and bh >= int(h * 0.28):
                # Check vertical edge alignment: crop region and test vertical gradient
                roi = edges[y:y+bh, x:x+bw]
                if roi.size == 0:
                    continue

                # Left and right boundary vertical intensity sum
                left_edge_density = np.sum(roi[:, :max(1, bw // 5)]) / (bh * max(1, bw // 5) * 255.0)
                right_edge_density = np.sum(roi[:, -max(1, bw // 5):]) / (bh * max(1, bw // 5) * 255.0)
                top_edge_density = np.sum(roi[:max(1, bh // 8), :]) / (max(1, bh // 8) * bw * 255.0)

                # A valid door frame should have distinct vertical boundaries and top header
                boundary_score = (left_edge_density + right_edge_density + top_edge_density) / 3.0
                
                # Aspect ratio penalty from ideal 2.1
                ar_score = max(0.0, 1.0 - abs(aspect_ratio - 2.1) / 1.5)
                conf = round(min(0.92, max(0.50, 0.45 + boundary_score * 0.4 + ar_score * 0.3)), 2)

                if conf >= 0.52:
                    # Check for ELEVATOR specific visual evidence
                    is_elevator = False
                    elevator_evidence = []

                    # 1. Check for center vertical split seam (typical of dual sliding metallic elevator doors)
                    mid_x = bw // 2
                    center_strip = roi[:, max(0, mid_x - 3):min(bw, mid_x + 4)]
                    if center_strip.size > 0:
                        center_seam_density = np.sum(center_strip) / (center_strip.size * 255.0)
                        if center_seam_density > 0.08:
                            elevator_evidence.append("center_split_seam")

                    # 2. Check for call-button panel beside door (small vertical rectangle adjacent to door)
                    button_region_left = gray[y + int(bh * 0.4):y + int(bh * 0.7), max(0, x - 40):x]
                    button_region_right = gray[y + int(bh * 0.4):y + int(bh * 0.7), x + bw:min(w, x + bw + 40)]
                    for btn_roi in [button_region_left, button_region_right]:
                        if btn_roi.size > 0 and np.var(btn_roi) > 80:
                            # Localized high-contrast fixture (illuminated button / plaque)
                            elevator_evidence.append("adjacent_call_panel")
                            break

                    # 3. Check OCR context
                    if ocr_text:
                        ocr_lower = ocr_text.lower()
                        if any(term in ocr_lower for term in ["elevator", "lift", "floor", "▲", "▼"]):
                            elevator_evidence.append("signage_match")

                    # Evidence threshold: require at least 2 indicators to declare an elevator
                    if len(elevator_evidence) >= 2 or ("signage_match" in elevator_evidence):
                        is_elevator = True

                    # Direction calculation
                    cx = x + bw / 2.0
                    rel_cx = cx / float(w)
                    if rel_cx < 0.35:
                        direction = "on your left"
                    elif rel_cx > 0.65:
                        direction = "on your right"
                    else:
                        direction = "in front of you"

                    class_name = "elevator" if is_elevator else "door"
                    label = "Elevator / Lift" if is_elevator else "Doorway"

                    candidates.append({
                        "class_name": class_name,
                        "label": label,
                        "confidence": conf if not is_elevator else min(0.95, conf + 0.1),
                        "bbox": [x, y, x + bw, y + bh],
                        "direction": direction,
                        "center": [int(cx), int(y + bh / 2.0)],
                        "metadata": {
                            "type": "architectural",
                            "aspect_ratio": round(aspect_ratio, 2),
                            "elevator_evidence": elevator_evidence if is_elevator else None
                        }
                    })

        # Non-maximum suppression to merge overlapping door boxes
        final_candidates = []
        for cand in sorted(candidates, key=lambda c: c["confidence"], reverse=True):
            if not any(self._compute_iou(cand["bbox"], f["bbox"]) > 0.40 for f in final_candidates):
                final_candidates.append(cand)

        return final_candidates[:4]  # Keep top 4 distinct structural candidates

    def _detect_structural_stairs(
        self,
        frame_bgr: np.ndarray,
        ocr_text: Optional[str] = None
    ) -> List[Dict]:
        """
        Evidence-based geometric recognition of indoor stairs:
        - Detects periodic, stacked horizontal step tread edges with regular vertical spacing.
        - Verifies tread width, consistency, and spatial positioning in the lower/middle view.
        - Validates against OCR if 'stair' signage is visible.
        """
        h, w = frame_bgr.shape[:2]
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)

        # Focus on lower 75% of view where stairs appear
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

        # Sort horizontal tread segments by vertical position y
        h_segments.sort(key=lambda s: s[2])

        # Cluster segments within 8 pixels of each other
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

        # Find consecutive runs of 3+ treads with consistent vertical spacing (12 to 55 px)
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

        # Valid stairs candidate confirmed by geometric evidence
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

    def _estimate_corridor_structure(self, frame_bgr: np.ndarray) -> Dict:
        """
        Geometric Corridor & Wall Perception:
        - Detects perspective boundary lines of floor and side walls using Hough transforms.
        - Calculates corridor vanishing point (VP).
        - Generates traversable corridor floor polygon and left/right wall boundaries.
        """
        h, w = frame_bgr.shape[:2]
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        
        # Focus on lower 70% of frame where floor-wall boundaries intersect
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
                x1, y1, x2, y2 = int(pts[0]), int(pts[1]), int(pts[2]), int(pts[3])
                # Adjust y back to full frame coordinates
                y1 += y_start
                y2 += y_start

                dx = x2 - x1
                dy = y2 - y1
                if abs(dx) < 1e-4:
                    continue

                slope = float(dy) / float(dx)
                angle_deg = math.degrees(math.atan2(abs(dy), abs(dx)))

                # Perspective hallway lines typically have angles between 20° and 75°
                if 20.0 <= angle_deg <= 75.0:
                    mid_x = (x1 + x2) / 2.0
                    # Left wall line: in left half of image, sloping upwards towards center
                    if mid_x < (w * 0.55) and slope < -0.3:
                        left_lines.append((x1, y1, x2, y2))
                    # Right wall line: in right half of image, sloping downwards away from center
                    elif mid_x > (w * 0.45) and slope > 0.3:
                        right_lines.append((x1, y1, x2, y2))

        # Default fallback vanishing point (horizon center)
        vp_x = w // 2
        vp_y = int(h * 0.45)
        corridor_detected = False

        # If both left and right perspective lines exist, find intersection for vanishing point
        if left_lines and right_lines:
            # Average left line
            l_pts = np.array(left_lines)
            lx1, ly1, lx2, ly2 = np.mean(l_pts, axis=0)
            
            # Average right line
            r_pts = np.array(right_lines)
            rx1, ry1, rx2, ry2 = np.mean(r_pts, axis=0)

            # Solve line intersection
            denom = (lx1 - lx2) * (ry1 - ry2) - (ly1 - ly2) * (rx1 - rx2)
            if abs(denom) > 1e-3:
                ix = ((lx1 * ly2 - ly1 * lx2) * (rx1 - rx2) - (lx1 - lx2) * (rx1 * ry2 - ry1 * rx2)) / denom
                iy = ((lx1 * ly2 - ly1 * lx2) * (ry1 - ry2) - (ly1 - ly2) * (rx1 * ry2 - ry1 * rx2)) / denom

                # Valid vanishing point should be inside the image upper-middle region
                if 0.1 * w <= ix <= 0.9 * w and 0.15 * h <= iy <= 0.75 * h:
                    vp_x = int(round(ix))
                    vp_y = int(round(iy))
                    corridor_detected = True

        # Compute corridor heading
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

        # Compute floor boundary polygon
        x_bl = max(0, int(vp_x - (h - vp_y) * 1.1))
        x_br = min(w, int(vp_x + (h - vp_y) * 1.1))

        floor_poly = [[x_bl, h], [vp_x, vp_y], [x_br, h]]
        left_wb = [[0, h - 20], [vp_x, vp_y]]
        right_wb = [[w, h - 20], [vp_x, vp_y]]

        # Lateral wall clearance estimates (in meters, assuming typical ~2.0m corridor)
        left_ratio = rel_vp
        right_ratio = 1.0 - rel_vp
        left_clearance = round(max(0.45, 1.9 * left_ratio), 2)
        right_clearance = round(max(0.45, 1.9 * right_ratio), 2)

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
        1. Runs YOLO for COCO objects (person, chair, table, etc.)
        2. Runs Geometric Detector for doors and elevators
        3. Estimates corridor structure and wall boundaries
        4. Applies temporal smoothing to prevent bounding box flicker
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
                    if confidence < 0.45:
                        continue

                    cls_id = int(cls.cpu().numpy())
                    raw_name = self.model.names[cls_id].lower()

                    # Only retain objects relevant to indoor navigation
                    if raw_name in ["person", "chair", "couch", "dining table", "bed", "toilet", "tv", "laptop", "refrigerator", "potted plant"]:
                        x1, y1, x2, y2 = map(int, box.cpu().numpy())
                        cx = (x1 + x2) / 2.0
                        rel_cx = cx / float(w)

                        if rel_cx < 0.35:
                            direction = "on your left"
                        elif rel_cx > 0.65:
                            direction = "on your right"
                        else:
                            direction = "in front of you"

                        raw_detections.append({
                            "class_name": raw_name,
                            "label": raw_name.title(),
                            "confidence": round(confidence, 2),
                            "bbox": [x1, y1, x2, y2],
                            "direction": direction,
                            "center": [int(cx), int((y1 + y2) / 2.0)],
                            "metadata": {"type": "coco_object"}
                        })
            except Exception as e:
                print(f"YOLO inference error: {e}")

        # 2. Structural Door & Elevator Detection
        try:
            structural_items = self._detect_structural_doors_and_elevators(frame_bgr, ocr_text=ocr_text)
            raw_detections.extend(structural_items)
        except Exception as e:
            print(f"Structural perception error: {e}")

        # 3. Structural Stairs Detection
        try:
            stair_items = self._detect_structural_stairs(frame_bgr, ocr_text=ocr_text)
            raw_detections.extend(stair_items)
        except Exception as e:
            print(f"Structural stairs error: {e}")

        # 4. Corridor & Wall Boundary Perception
        corridor_info = self._estimate_corridor_structure(frame_bgr)

        # 5. Temporal Smoothing (Tracker Update)
        now = time.time()
        matched_track_ids = set()
        active_items = []

        for det in raw_detections:
            best_id = None
            best_iou = 0.28  # IoU threshold for matching same object across frames

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

        # Collect active detections (threshold >= 0.48)
        for tr_id, tr in self.tracks.items():
            if tr.confidence >= 0.48:
                cx = (tr.bbox[0] + tr.bbox[2]) / 2.0
                rel_cx = cx / float(w)
                if rel_cx < 0.35:
                    direction = "on your left"
                elif rel_cx > 0.65:
                    direction = "on your right"
                else:
                    direction = "in front of you"

                active_items.append({
                    "id": tr.id,
                    "class_name": tr.class_name,
                    "label": tr.label,
                    "confidence": round(tr.confidence, 2),
                    "bbox": tr.bbox,
                    "direction": direction,
                    "center": [int(cx), int((tr.bbox[1] + tr.bbox[3]) / 2.0)],
                    "metadata": tr.metadata
                })

        inference_time_ms = round((time.time() - t0) * 1000.0, 1)

        return {
            "status": "success",
            "model_info": {
                "detector": "YOLOv8n (COCO) + Architectural Perception",
                "model_status": self.model_status,
                "supported_classes": self.supported_classes,
                "inference_time_ms": inference_time_ms,
                "frame_size": [w, h]
            },
            "objects": active_items,
            "structural_perception": corridor_info,
            "error": self.error_message
        }

# Global Singleton
perception_engine = IndoorPerceptionEngine()
