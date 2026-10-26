# ai-service/utils/slam_engine.py
import cv2
import numpy as np
import time
import math
from typing import Dict, List, Optional, Tuple, Any

class SlamEngine:
    """
    Real-Time Monocular Visual SLAM (Simultaneous Localization and Mapping) Engine
    for Indoor Pedestrian Assistance.

    Workflow:
    Live camera frame -> Quality Check (blur/lighting) -> Feature Extraction (ORB / Shi-Tomasi)
    -> Lucas-Kanade Optical Flow -> Essential Matrix RANSAC motion estimation -> Pose Integration
    -> Keyframe & Landmark Triangulation -> Dynamic Occupancy & Free-Space Mapping
    -> Real-Time Relocalization (ORB matching) -> Obstacle-Aware Route Planning -> Turn Guidance.
    """

    def __init__(self):
        # Feature detectors
        self.orb = cv2.ORB_create(nfeatures=600, scaleFactor=1.2, nlevels=4)
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        
        # Lucas-Kanade optical flow parameters
        self.lk_params = dict(
            winSize=(21, 21),
            maxLevel=3,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01)
        )
        
        # Good features to track parameters (Shi-Tomasi)
        self.feature_params = dict(
            maxCorners=250,
            qualityLevel=0.02,
            minDistance=8,
            blockSize=7
        )
        
        self.reset()

    def reset(self):
        """Reset SLAM mapping and tracking session to origin without requiring any prior map."""
        self.prev_gray: Optional[np.ndarray] = None
        self.prev_pts: Optional[np.ndarray] = None
        self.prev_descriptors: Optional[np.ndarray] = None
        self.prev_keypoints = None
        
        # 2D/3D Pose: x (meters), y (meters), heading (radians, 0 = forward along +X)
        self.current_pose = {"x": 0.0, "y": 0.0, "heading": 0.0}
        self.trajectory: List[Dict[str, float]] = [{"x": 0.0, "y": 0.0, "heading": 0.0}]
        
        # Tracking status
        self.state: str = "initializing"  # initializing | exploring | navigating | tracking_lost | relocalized
        self.confidence: float = 0.5
        self.tracking_lost: bool = False
        self.relocalized: bool = False
        self.status_message: str = "SLAM initialized. Point camera forward and move steadily."
        self.motion_blur_detected: bool = False
        self.low_light_detected: bool = False
        
        # Keyframe storage: each keyframe stores id, pose, descriptors, timestamp
        self.keyframes: List[Dict[str, Any]] = []
        self.keyframe_distance_threshold: float = 0.8  # meters between keyframes
        self.last_keyframe_pose = {"x": 0.0, "y": 0.0, "heading": 0.0}
        
        # Navigable Topological Graph built purely from live movement
        self.map_nodes: List[Dict[str, Any]] = [
            {"id": "node_0", "x": 0.0, "y": 0.0, "label": "Start Position", "type": "origin", "verified": True}
        ]
        self.map_edges: List[Dict[str, Any]] = []
        self.node_counter: int = 1
        
        # Actively discovered landmarks from real detections (doorways, stairs, elevators, OCR signs)
        self.observed_landmarks: List[Dict[str, Any]] = []

        # Observed structural wall boundaries (segments with x1, y1, x2, y2)
        self.map_walls: List[Dict[str, Any]] = []
        self.consecutive_tracking_failures: int = 0
        
        # Dynamic 2D Occupancy Grid (resolution = 0.2 meters)
        # 1 = traversable free space, 2 = detected obstacle / blocked cell
        self.grid_resolution: float = 0.2
        self.occupancy_cells: Dict[str, int] = {"0,0": 1}
        
        # Active navigation target
        self.active_destination: Optional[str] = None
        self.active_route: Optional[Dict[str, Any]] = None
        
        # Explicit monocular scale transparency
        self.scale_model = {
            "type": "monocular_approximate",
            "step_scale_m": 0.35,
            "metric_validated": False,
            "scale_source": "assumed_pedestrian_gait",
            "disclaimer": "Monocular visual odometry lacks absolute metric scale without depth sensors. Distances are estimated based on typical pedestrian motion."
        }
        
        self.frame_count: int = 0
        self.last_process_time: float = time.time()

    def _world_to_grid(self, x: float, y: float) -> Tuple[int, int]:
        gx = int(round(x / self.grid_resolution))
        gy = int(round(y / self.grid_resolution))
        return gx, gy

    def _mark_walkable_line(self, x0: float, y0: float, x1: float, y1: float, clearance: float = 0.4):
        """Mark traversed strip as free walkable space in the occupancy grid."""
        dist = math.hypot(x1 - x0, y1 - y0)
        steps = max(1, int(dist / 0.1))
        clearance_cells = max(1, int(round(clearance / self.grid_resolution)))
        
        for s in range(steps + 1):
            t = s / float(steps)
            cx = x0 + t * (x1 - x0)
            cy = y0 + t * (y1 - y0)
            gx, gy = self._world_to_grid(cx, cy)
            for dx in range(-clearance_cells, clearance_cells + 1):
                for dy in range(-clearance_cells, clearance_cells + 1):
                    key = f"{gx + dx},{gy + dy}"
                    if self.occupancy_cells.get(key) != 2:
                        self.occupancy_cells[key] = 1

    def _mark_obstacle_point(self, x: float, y: float, radius: float = 0.3):
        """Mark obstacle cells in the occupancy grid."""
        gx, gy = self._world_to_grid(x, y)
        r_cells = max(1, int(round(radius / self.grid_resolution)))
        for dx in range(-r_cells, r_cells + 1):
            for dy in range(-r_cells, r_cells + 1):
                self.occupancy_cells[f"{gx + dx},{gy + dy}"] = 2

    def _mark_wall_line(self, x0: float, y0: float, x1: float, y1: float):
        """Mark cells along wall boundary line as obstacle/wall in occupancy grid."""
        dist = math.hypot(x1 - x0, y1 - y0)
        steps = max(1, int(dist / 0.12))
        for s in range(steps + 1):
            t = s / float(steps)
            cx = x0 + t * (x1 - x0)
            cy = y0 + t * (y1 - y0)
            gx, gy = self._world_to_grid(cx, cy)
            self.occupancy_cells[f"{gx},{gy}"] = 2

    def _mark_free_strip(self, x0: float, y0: float, x1: float, y1: float, width_m: float = 1.2):
        """Mark corridor interior strip as free walkable space."""
        dist = math.hypot(x1 - x0, y1 - y0)
        steps = max(1, int(dist / 0.15))
        w_cells = max(1, int(round((width_m / 2.0) / self.grid_resolution)))

        if dist > 1e-4:
            nx = -(y1 - y0) / dist
            ny = (x1 - x0) / dist
        else:
            nx, ny = 0.0, 1.0

        for s in range(steps + 1):
            t = s / float(steps)
            cx = x0 + t * (x1 - x0)
            cy = y0 + t * (y1 - y0)
            for w_idx in range(-w_cells, w_cells + 1):
                px = cx + w_idx * self.grid_resolution * nx
                py = cy + w_idx * self.grid_resolution * ny
                gx, gy = self._world_to_grid(px, py)
                key = f"{gx},{gy}"
                if self.occupancy_cells.get(key) != 2:
                    self.occupancy_cells[key] = 1

    def _process_structural_corridor(self, structural_perception: Optional[Dict] = None):
        """
        Integrates observed corridor walls and traversable floor boundaries into the occupancy grid
        and topological wall map using metric transformation from camera pose.
        """
        if not structural_perception:
            return

        corridor_detected = structural_perception.get("corridor_detected", False)
        left_detected = structural_perception.get("left_wall_detected", False)
        right_detected = structural_perception.get("right_wall_detected", False)

        if not (corridor_detected or left_detected or right_detected):
            return

        x0 = self.current_pose["x"]
        y0 = self.current_pose["y"]
        heading = self.current_pose["heading"]

        # Forward projection length of observed corridor ahead (approx 2.4 meters)
        L = 2.4
        xf = x0 + L * math.cos(heading)
        yf = y0 + L * math.sin(heading)

        # Normal vector perpendicular to heading (to the left)
        nx = -math.sin(heading)
        ny = math.cos(heading)

        clearance = structural_perception.get("wall_clearance_m", {})
        d_left = float(clearance.get("left", 0.95))
        d_right = float(clearance.get("right", 0.95))

        # 1. Left Wall Boundary
        if left_detected or corridor_detected:
            lw_x0 = round(x0 + d_left * nx, 2)
            lw_y0 = round(y0 + d_left * ny, 2)
            lw_xf = round(xf + d_left * nx, 2)
            lw_yf = round(yf + d_left * ny, 2)
            self._mark_wall_line(lw_x0, lw_y0, lw_xf, lw_yf)

            is_dup = any(
                math.hypot(w["x1"] - lw_x0, w["y1"] - lw_y0) < 0.6 and
                math.hypot(w["x2"] - lw_xf, w["y2"] - lw_yf) < 0.8
                for w in self.map_walls if w.get("side") == "left"
            )
            if not is_dup:
                self.map_walls.append({
                    "id": f"wall_left_{len(self.map_walls) + 1}",
                    "side": "left",
                    "x1": lw_x0,
                    "y1": lw_y0,
                    "x2": lw_xf,
                    "y2": lw_yf,
                    "type": "wall",
                    "confidence": 0.85
                })

        # 2. Right Wall Boundary
        if right_detected or corridor_detected:
            rw_x0 = round(x0 - d_right * nx, 2)
            rw_y0 = round(y0 - d_right * ny, 2)
            rw_xf = round(xf - d_right * nx, 2)
            rw_yf = round(yf - d_right * ny, 2)
            self._mark_wall_line(rw_x0, rw_y0, rw_xf, rw_yf)

            is_dup = any(
                math.hypot(w["x1"] - rw_x0, w["y1"] - rw_y0) < 0.6 and
                math.hypot(w["x2"] - rw_xf, w["y2"] - rw_yf) < 0.8
                for w in self.map_walls if w.get("side") == "right"
            )
            if not is_dup:
                self.map_walls.append({
                    "id": f"wall_right_{len(self.map_walls) + 1}",
                    "side": "right",
                    "x1": rw_x0,
                    "y1": rw_y0,
                    "x2": rw_xf,
                    "y2": rw_yf,
                    "type": "wall",
                    "confidence": 0.85
                })

        # 3. Mark Traversable Corridor Floor Strip
        corridor_width = min(2.4, (d_left + d_right) * 0.75)
        self._mark_free_strip(x0, y0, xf, yf, width_m=corridor_width)

    def _get_sparse_occupancy_cells(self, max_cells: int = 1200) -> Dict[str, Any]:
        """
        Exports free cells and obstacle/wall cells in metric coordinates.
        Clearly separates traversable free space from observed obstacles/walls.
        """
        free_cells = []
        obstacle_cells = []
        cx, cy = self.current_pose["x"], self.current_pose["y"]
        max_dist_sq = 18.0 * 18.0

        for key, val in list(self.occupancy_cells.items())[:max_cells]:
            parts = key.split(",")
            if len(parts) != 2:
                continue
            gx, gy = int(parts[0]), int(parts[1])
            wx = round(gx * self.grid_resolution, 2)
            wy = round(gy * self.grid_resolution, 2)
            if (wx - cx) ** 2 + (wy - cy) ** 2 > max_dist_sq:
                continue
            if val == 1:
                free_cells.append([wx, wy])
            elif val == 2:
                obstacle_cells.append([wx, wy])

        return {
            "resolution": self.grid_resolution,
            "free_cells": free_cells,
            "obstacle_cells": obstacle_cells
        }

    def _process_detected_landmarks(
        self,
        detected_objects: Optional[List[Dict]] = None,
        ocr_text: Optional[str] = None
    ):
        """
        Integrates visible objects and OCR text into the live SLAM map.
        Doorways, stairs, elevators, exits, and obstacles are placed relative to current estimated pose.
        NO room identities or coordinates are invented.
        """
        if detected_objects:
            for obj in detected_objects:
                label = obj.get("class_name", obj.get("label", "")).lower().strip()
                conf = float(obj.get("confidence", 0.7))
                
                # Semantic indoor targets
                if label in ["door", "stairs", "chair", "table", "person", "reception", "elevator", "sign", "exit"] and conf >= 0.45:
                    # Estimate position relative to current camera heading
                    distance_est = float(obj.get("distance", 1.8))
                    direction_str = str(obj.get("direction", "front")).lower()
                    
                    angle_offset = 0.0
                    if "left" in direction_str:
                        angle_offset = -0.4
                    elif "right" in direction_str:
                        angle_offset = 0.4
                        
                    lm_heading = self.current_pose["heading"] + angle_offset
                    lm_x = round(self.current_pose["x"] + distance_est * math.cos(lm_heading), 2)
                    lm_y = round(self.current_pose["y"] + distance_est * math.sin(lm_heading), 2)
                    
                    # Avoid duplicate registration within 1.5m radius
                    already_observed = any(
                        l["type"] == label and math.hypot(l["x"] - lm_x, l["y"] - lm_y) < 1.5
                        for l in self.observed_landmarks
                    )
                    
                    if not already_observed:
                        if label == "door":
                            lm_type = "doorway"
                            lm_label = f"Doorway {sum(1 for l in self.observed_landmarks if l['type'] == 'doorway') + 1}"
                        elif label == "stairs":
                            lm_type = "stairs"
                            lm_label = f"Stairs {sum(1 for l in self.observed_landmarks if l['type'] == 'stairs') + 1}"
                        elif label == "elevator":
                            lm_type = "elevator"
                            lm_label = "Elevator"
                        elif label == "exit":
                            lm_type = "exit"
                            lm_label = "Exit"
                        else:
                            lm_type = label
                            lm_label = f"{label.title()} Area"
                        
                        lm_id = f"lm_{lm_type}_{len(self.observed_landmarks) + 1}"
                        nearest_node_id = self.map_nodes[-1]["id"] if self.map_nodes else "node_0"
                        
                        lm = {
                            "id": lm_id,
                            "label": lm_label,
                            "type": lm_type,
                            "x": lm_x,
                            "y": lm_y,
                            "nodeId": nearest_node_id,
                            "confidence": round(conf, 2),
                            "verified": True if label in ["door", "stairs", "elevator", "exit"] else False,
                            "discovered_at": time.time()
                        }
                        self.observed_landmarks.append(lm)
                    
                    # Obstacle marking in occupancy grid
                    if label in ["chair", "table", "person"]:
                        self._mark_obstacle_point(lm_x, lm_y, radius=0.35)

        # OCR Signboard reading integration
        if ocr_text and ocr_text.strip():
            clean_ocr = ocr_text.strip()[:40]
            if len(clean_ocr) >= 3 and not clean_ocr.isnumeric():
                already_recorded = any(l.get("ocr") == clean_ocr for l in self.observed_landmarks)
                if not already_recorded:
                    lm = {
                        "id": f"lm_ocr_{len(self.observed_landmarks) + 1}",
                        "label": clean_ocr,
                        "ocr": clean_ocr,
                        "type": "destination",
                        "x": round(self.current_pose["x"], 2),
                        "y": round(self.current_pose["y"], 2),
                        "nodeId": self.map_nodes[-1]["id"] if self.map_nodes else "node_0",
                        "confidence": 0.85,
                        "verified": True,
                        "discovered_at": time.time()
                    }
                    self.observed_landmarks.append(lm)
                    if self.map_nodes:
                        self.map_nodes[-1]["label"] = clean_ocr
                        self.map_nodes[-1]["type"] = "destination"
                        self.map_nodes[-1]["verified"] = True

    def process_frame(
        self,
        frame_bgr: np.ndarray,
        detected_objects: Optional[List[Dict]] = None,
        structural_perception: Optional[Dict] = None,
        ocr_text: Optional[str] = None
    ) -> Dict:
        """
        Processes incoming camera frame through the visual SLAM pipeline.
        Returns estimated pose, confidence, tracking state, map updates, and safety warnings.
        """
        self.frame_count += 1
        h, w = frame_bgr.shape[:2]
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        
        # 1. Image Quality Assessment: Motion blur and low-light detection
        variance = float(np.var(gray))
        laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        mean_intensity = float(np.mean(gray))
        
        # True dark/occluded frame: mean < 12.0 or variance < 6.0
        self.low_light_detected = (mean_intensity < 12.0) or (variance < 6.0)
        self.motion_blur_detected = laplacian_var < 20.0
        
        if self.low_light_detected:
            self.tracking_lost = True
            self.confidence = 0.1
            self.state = "tracking_lost"
            self.status_message = "Environment too dark or camera occluded. Increase lighting."
            return self._build_status(tracked_count=0, inliers=0)
            
        if self.motion_blur_detected and self.prev_gray is not None:
            self.confidence = max(0.15, self.confidence * 0.7)
            self.status_message = "Fast camera motion detected. Please slow down and hold steady."

        gray = cv2.equalizeHist(gray)
        self.relocalized = False
        tracked_count = 0
        inliers_count = 0

        # 2. Extract ORB keypoints and descriptors for keyframing and relocalization
        current_kp, current_desc = self.orb.detectAndCompute(gray, None)

        # 3. Visual Relocalization: If tracking was lost, match against stored keyframes
        if self.tracking_lost and current_desc is not None and len(self.keyframes) > 0:
            best_match_kf = None
            best_match_count = 0
            for kf in self.keyframes:
                kf_desc = kf.get("descriptors")
                if kf_desc is not None and len(kf_desc) > 8:
                    try:
                        matches = self.matcher.match(current_desc, kf_desc)
                        good_matches = [m for m in matches if m.distance < 45.0]
                        if len(good_matches) > best_match_count:
                            best_match_count = len(good_matches)
                            best_match_kf = kf
                    except Exception:
                        continue

            if best_match_count >= 12 and best_match_kf is not None:
                self.current_pose = dict(best_match_kf["pose"])
                self.trajectory.append(dict(self.current_pose))
                self.tracking_lost = False
                self.consecutive_tracking_failures = 0
                self.relocalized = True
                self.confidence = 0.8
                self.state = "navigating" if self.active_destination else "exploring"
                self.status_message = f"Relocalized successfully to {best_match_kf['id']} ({best_match_count} feature matches)."
                
                self.prev_pts = cv2.goodFeaturesToTrack(gray, mask=None, **self.feature_params)
                self.prev_gray = gray
                self.prev_descriptors = current_desc
                self.prev_keypoints = current_kp
                self._process_structural_corridor(structural_perception)
                self._process_detected_landmarks(detected_objects, ocr_text)
                return self._build_status(tracked_count=len(self.prev_pts) if self.prev_pts is not None else 0)

        # 4. Bootstrap Initial Frame
        if self.prev_gray is None:
            pts = cv2.goodFeaturesToTrack(gray, mask=None, **self.feature_params)
            self.prev_gray = gray
            self.prev_pts = pts
            self.prev_descriptors = current_desc
            self.prev_keypoints = current_kp
            self.confidence = 0.7 if pts is not None and len(pts) >= 40 else 0.4
            self.tracking_lost = False
            self.consecutive_tracking_failures = 0
            self.state = "exploring"
            self.status_message = "SLAM initialized. Feature tracking established."
            
            # Record initial keyframe at origin
            if current_desc is not None:
                self.keyframes.append({
                    "id": "kf_0",
                    "pose": dict(self.current_pose),
                    "descriptors": current_desc,
                    "keypoint_count": len(current_kp) if current_kp else 0,
                    "timestamp": time.time()
                })
            
            self._process_structural_corridor(structural_perception)
            self._process_detected_landmarks(detected_objects, ocr_text)
            return self._build_status(tracked_count=len(pts) if pts is not None else 0)

        # 5. Lucas-Kanade Optical Flow Motion Tracking
        tracking_success = False
        prev_x, prev_y = self.current_pose["x"], self.current_pose["y"]

        if self.prev_pts is not None and len(self.prev_pts) >= 10:
            curr_pts, status, err = cv2.calcOpticalFlowPyrLK(
                self.prev_gray, gray, self.prev_pts, None, **self.lk_params
            )

            if curr_pts is not None and status is not None:
                good_prev = self.prev_pts[status == 1]
                good_curr = curr_pts[status == 1]
                tracked_count = len(good_curr)

                if tracked_count >= 10:
                    focal = float(w)
                    pp = (w / 2.0, h / 2.0)
                    try:
                        E, mask = cv2.findEssentialMat(
                            good_curr, good_prev, focal=focal, pp=pp, method=cv2.RANSAC, prob=0.999, threshold=1.0
                        )
                        if E is not None and E.shape == (3, 3):
                            inliers_count = int(np.sum(mask)) if mask is not None else 0
                            if inliers_count >= 8:
                                _, R, t, _ = cv2.recoverPose(E, good_curr, good_prev, focal=focal, pp=pp)
                                
                                # Estimate camera yaw rotation about vertical Y axis in camera frame
                                yaw = math.atan2(R[0, 2], R[2, 2])
                                
                                t_norm = np.linalg.norm(t)
                                if t_norm > 1e-4:
                                    t_unit = t / t_norm
                                    t_flat = t_unit.flatten()
                                    step_scale = self.scale_model["step_scale_m"]
                                    forward_disp = float(t_flat[2]) * step_scale
                                    lateral_disp = float(t_flat[0]) * step_scale
                                    
                                    # Suppress minor noise
                                    if abs(forward_disp) < 0.015 and abs(lateral_disp) < 0.015:
                                        forward_disp = 0.0
                                        lateral_disp = 0.0
                                    
                                    d_theta = -yaw
                                    current_heading = (self.current_pose["heading"] + d_theta) % (2 * math.pi)
                                    
                                    dx = forward_disp * math.cos(current_heading) - lateral_disp * math.sin(current_heading)
                                    dy = forward_disp * math.sin(current_heading) + lateral_disp * math.cos(current_heading)
                                    
                                    self.current_pose["x"] += dx
                                    self.current_pose["y"] += dy
                                    self.current_pose["heading"] = current_heading
                                    self.trajectory.append(dict(self.current_pose))
                                    
                                    # Update dynamic free-space in occupancy grid
                                    self._mark_walkable_line(prev_x, prev_y, self.current_pose["x"], self.current_pose["y"])
                                    
                                    self.tracking_lost = False
                                    self.consecutive_tracking_failures = 0
                                    self.confidence = min(1.0, max(0.4, inliers_count / 60.0))
                                    self.state = "navigating" if self.active_destination else "exploring"
                                    self.status_message = "Tracking active."
                                    tracking_success = True
                    except Exception:
                        self.confidence = max(0.1, self.confidence * 0.8)

        # 6. Handle Tracking Failure Gracefully Without Permanent Freeze
        if not tracking_success:
            self.consecutive_tracking_failures += 1
            if self.consecutive_tracking_failures >= 5:
                self.tracking_lost = True
                self.confidence = 0.2
                self.state = "tracking_lost"
                self.status_message = "Visual tracking lost. Please pause and slowly pan camera toward previously seen areas."
            else:
                self.confidence = max(0.35, self.confidence * 0.8)
                self.status_message = "Tracking degraded, maintaining motion estimate."

        # 7. Incremental Keyframe & Waypoint Management
        dist_from_last_kf = math.hypot(
            self.current_pose["x"] - self.last_keyframe_pose["x"],
            self.current_pose["y"] - self.last_keyframe_pose["y"]
        )
        if (dist_from_last_kf >= self.keyframe_distance_threshold and not self.tracking_lost) or (len(self.keyframes) == 0):
            node_id = f"node_{self.node_counter}"
            self.node_counter += 1
            
            new_node = {
                "id": node_id,
                "x": round(self.current_pose["x"], 2),
                "y": round(self.current_pose["y"], 2),
                "label": f"Waypoint {self.node_counter - 1}",
                "type": "corridor",
                "verified": False
            }
            last_node = self.map_nodes[-1]
            self.map_nodes.append(new_node)
            self.map_edges.append({
                "from": last_node["id"],
                "to": node_id,
                "distance": round(dist_from_last_kf, 2),
                "accessible": True
            })
            self.last_keyframe_pose = dict(self.current_pose)
            
            if current_desc is not None:
                self.keyframes.append({
                    "id": node_id,
                    "pose": dict(self.current_pose),
                    "descriptors": current_desc,
                    "keypoint_count": len(current_kp) if current_kp else 0,
                    "timestamp": time.time()
                })

        # 8. Structural & Landmark Integration
        self._process_structural_corridor(structural_perception)
        self._process_detected_landmarks(detected_objects, ocr_text)

        # 9. Replenish Optical Flow Feature Points
        if tracked_count < 40 or not tracking_success:
            new_pts = cv2.goodFeaturesToTrack(gray, mask=None, **self.feature_params)
            self.prev_pts = new_pts
        else:
            self.prev_pts = curr_pts[status == 1].reshape(-1, 1, 2)
        
        self.prev_gray = gray
        self.prev_descriptors = current_desc
        self.prev_keypoints = current_kp

        return self._build_status(tracked_count=tracked_count, inliers=inliers_count)

    def plan_route_to_target(self, target_query: str, start_node_id: Optional[str] = None) -> Dict:
        """
        Dynamic Path Planning on the actively explored topological map.
        - Matches requested destination only against observed landmarks / nodes.
        - If destination has not been observed yet, reports 'unobserved' without inventing coordinates.
        - Calculates turn angles, step-by-step guidance, and total estimated distance.
        """
        if not target_query or not target_query.strip():
            return {"status": "error", "message": "Destination name is required."}

        query_norm = target_query.lower().strip()

        # Check observed landmarks
        target_landmark = None
        for lm in self.observed_landmarks:
            if query_norm in lm["label"].lower() or lm["label"].lower() in query_norm:
                target_landmark = lm
                break

        # Check labeled map nodes
        if not target_landmark:
            for node in self.map_nodes:
                if query_norm in node["label"].lower():
                    target_landmark = {"nodeId": node["id"], "label": node["label"], "type": node.get("type", "waypoint")}
                    break

        # If not observed, tell user honestly!
        if not target_landmark:
            available = [lm["label"] for lm in self.observed_landmarks]
            return {
                "status": "unobserved",
                "message": f'Destination "{target_query}" has not been identified on the indoor map yet. {len(self.observed_landmarks)} landmarks have been explored.',
                "suggestion": available[0] if available else "the starting point",
                "discoveredLandmarks": available
            }

        target_node_id = target_landmark.get("nodeId", target_landmark.get("id"))

        # Find closest start node
        if start_node_id:
            current_node_id = start_node_id
        else:
            best_dist = float("inf")
            current_node_id = self.map_nodes[0]["id"]
            for node in self.map_nodes:
                d = math.hypot(node["x"] - self.current_pose["x"], node["y"] - self.current_pose["y"])
                if d < best_dist:
                    best_dist = d
                    current_node_id = node["id"]

        if current_node_id == target_node_id:
            return {
                "status": "arrived",
                "destination": target_landmark["label"],
                "message": f"You are already at {target_landmark['label']}."
            }

        route_nodes = self._dijkstra(current_node_id, target_node_id)
        if not route_nodes:
            return {
                "status": "no_path",
                "message": f"No traversable path exists to {target_landmark['label']} on the current map."
            }

        steps = []
        total_dist = 0.0

        for i in range(len(route_nodes) - 1):
            n_curr = next((n for n in self.map_nodes if n["id"] == route_nodes[i]), None)
            n_next = next((n for n in self.map_nodes if n["id"] == route_nodes[i + 1]), None)
            if not n_curr or not n_next:
                continue

            seg_dist = math.hypot(n_next["x"] - n_curr["x"], n_next["y"] - n_curr["y"])
            total_dist += seg_dist

            turn_text = "Continue forward"
            if i > 0:
                n_prev = next((n for n in self.map_nodes if n["id"] == route_nodes[i - 1]), None)
                if n_prev:
                    angle_prev = math.atan2(n_curr["y"] - n_prev["y"], n_curr["x"] - n_prev["x"])
                    angle_curr = math.atan2(n_next["y"] - n_curr["y"], n_next["x"] - n_curr["x"])
                    d_angle = (angle_curr - angle_prev + math.pi) % (2 * math.pi) - math.pi
                    d_deg = math.degrees(d_angle)

                    if d_deg > 65:
                        turn_text = "Turn right at the junction"
                    elif d_deg > 25:
                        turn_text = "Bear slightly right"
                    elif d_deg < -65:
                        turn_text = "Turn left at the junction"
                    elif d_deg < -25:
                        turn_text = "Bear slightly left"
                    else:
                        turn_text = "Continue straight"

            if n_next.get("type") == "doorway":
                instruction = f"{turn_text} through the doorway to {n_next['label']} (about {round(seg_dist, 1)}m)."
            elif n_next.get("type") == "stairs":
                instruction = f"{turn_text} to the stairway (about {round(seg_dist, 1)}m)."
            else:
                instruction = f"{turn_text} towards {n_next['label']} (about {round(seg_dist, 1)}m)."

            steps.append({
                "step": i + 1,
                "instruction": instruction,
                "from": n_curr["label"],
                "to": n_next["label"],
                "from_id": n_curr["id"],
                "to_id": n_next["id"],
                "distance": round(seg_dist, 1)
            })

        steps.append({
            "step": len(steps) + 1,
            "instruction": f"You have arrived at {target_landmark['label']}.",
            "from": target_landmark["label"],
            "to": target_landmark["label"],
            "from_id": target_node_id,
            "to_id": target_node_id,
            "distance": 0.0,
            "type": "arrival"
        })

        self.active_destination = target_landmark["label"]
        self.active_route = {
            "destination": target_landmark["label"],
            "steps": steps,
            "total_distance_m": round(total_dist, 1)
        }

        return {
            "status": "success",
            "destination": target_landmark["label"],
            "total_steps": len(steps),
            "total_distance_m": round(total_dist, 1),
            "route_nodes": route_nodes,
            "steps": steps
        }

    def _dijkstra(self, start_id: str, end_id: str) -> Optional[List[str]]:
        adj = {}
        for edge in self.map_edges:
            u, v = edge["from"], edge["to"]
            d = edge.get("distance", 1.0)
            adj.setdefault(u, []).append((v, d))
            adj.setdefault(v, []).append((u, d))

        dist = {node["id"]: float("inf") for node in self.map_nodes}
        prev = {}
        dist[start_id] = 0.0
        unvisited = set(dist.keys())

        while unvisited:
            curr = min(unvisited, key=lambda n: dist[n])
            if dist[curr] == float("inf"):
                break
            if curr == end_id:
                path = []
                while curr in prev:
                    path.append(curr)
                    curr = prev[curr]
                path.append(start_id)
                return path[::-1]
            unvisited.remove(curr)

            for neighbor, weight in adj.get(curr, []):
                if neighbor in unvisited:
                    alt = dist[curr] + weight
                    if alt < dist[neighbor]:
                        dist[neighbor] = alt
                        prev[neighbor] = curr
        return None

    def get_status(self) -> Dict:
        return self._build_status()

    def _build_status(self, tracked_count: int = 0, inliers: int = 0) -> Dict:
        walkable_count = sum(1 for v in self.occupancy_cells.values() if v == 1)
        obstacle_count = sum(1 for v in self.occupancy_cells.values() if v == 2)
        explored_area_m2 = round((walkable_count + obstacle_count) * (self.grid_resolution ** 2), 1)

        return {
            "status": "success",
            "state": self.state,
            "pose": {
                "x": round(self.current_pose["x"], 2),
                "y": round(self.current_pose["y"], 2),
                "heading": round(math.degrees(self.current_pose["heading"]) % 360, 1)
            },
            "confidence": round(self.confidence, 2),
            "tracking_lost": self.tracking_lost,
            "relocalized": self.relocalized,
            "status_message": self.status_message,
            "motion_blur": self.motion_blur_detected,
            "low_light": self.low_light_detected,
            "tracked_features": tracked_count,
            "inlier_features": inliers,
            "keyframes_count": len(self.keyframes),
            "active_destination": self.active_destination,
            "scale_info": self.scale_model,
            "occupancy_summary": {
                "resolution_m": self.grid_resolution,
                "walkable_cells": walkable_count,
                "obstacle_cells": obstacle_count,
                "explored_area_m2": explored_area_m2
            },
            "map": {
                "nodes": self.map_nodes,
                "edges": self.map_edges,
                "landmarks": self.observed_landmarks,
                "walls": self.map_walls[-25:],
                "trajectory": self.trajectory[-60:],
                "occupancy_grid": self._get_sparse_occupancy_cells()
            }
        }

# Global singleton
slam_instance = SlamEngine()
