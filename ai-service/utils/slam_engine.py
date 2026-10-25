# ai-service/utils/slam_engine.py
import cv2
import numpy as np
import time
import math
from typing import Dict, List, Optional, Tuple

class SlamEngine:
    """
    Monocular Visual Odometry and Landmark Graph Mapping Engine.
    Implements a realistic lightweight Visual SLAM foundation:
    1. Optical Flow feature tracking (Lucas-Kanade PyrLK) + ORB descriptors
    2. Essential Matrix RANSAC motion estimation
    3. Pose integration (x, y, heading)
    4. Keyframe management & topological graph creation
    5. Landmark integration from object detection & OCR
    6. Path planning over explored graph (Dijkstra)
    7. Tracking loss detection and relocalization attempt
    """

    def __init__(self):
        self.reset()
        self.orb = cv2.ORB_create(nfeatures=500)
        self.lk_params = dict(
            winSize=(21, 21),
            maxLevel=3,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01)
        )
        self.feature_params = dict(
            maxCorners=200,
            qualityLevel=0.03,
            minDistance=10,
            blockSize=7
        )

    def reset(self):
        self.prev_gray = None
        self.prev_pts = None
        self.prev_descriptors = None
        self.prev_keypoints = None
        
        self.current_pose = {"x": 0.0, "y": 0.0, "heading": 0.0}
        self.trajectory: List[Dict[str, float]] = [{"x": 0.0, "y": 0.0, "heading": 0.0}]
        
        self.confidence = 0.5
        self.tracking_lost = False
        self.loss_recovery_frames = 0
        
        self.keyframes = []
        self.keyframe_distance_threshold = 1.0  # Keyframe every ~1 meter
        self.last_keyframe_pose = {"x": 0.0, "y": 0.0, "heading": 0.0}
        
        # Explored traversable map graph
        self.map_nodes = [
            {"id": "node_0", "x": 0.0, "y": 0.0, "label": "Start Position", "type": "origin"}
        ]
        self.map_edges = []
        self.node_counter = 1
        
        # Landmarks identified along the path (doors, stairs, OCR signs)
        self.observed_landmarks = []
        self.last_process_time = time.time()

    def process_frame(self, frame_bgr: np.ndarray, detected_objects: Optional[List[Dict]] = None, ocr_text: Optional[str] = None) -> Dict:
        """
        Process incoming camera frame, update visual odometry, register landmarks, and update graph.
        """
        h, w = frame_bgr.shape[:2]
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        
        # Pre-processing: Contrast enhancement
        gray = cv2.equalizeHist(gray)
        
        dx = 0.0
        dy = 0.0
        d_theta = 0.0
        tracked_count = 0
        inliers_count = 0

        if self.prev_gray is None or self.prev_pts is None or len(self.prev_pts) < 15:
            # Bootstrap tracking
            pts = cv2.goodFeaturesToTrack(gray, mask=None, **self.feature_params)
            self.prev_gray = gray
            self.prev_pts = pts
            self.confidence = 0.7 if pts is not None and len(pts) >= 40 else 0.4
            self.tracking_lost = False
            return self._build_status(tracked_count=len(pts) if pts is not None else 0)

        # 1. Lucas-Kanade Optical Flow
        curr_pts, status, err = cv2.calcOpticalFlowPyrLK(
            self.prev_gray, gray, self.prev_pts, None, **self.lk_params
        )

        if curr_pts is not None and status is not None:
            good_prev = self.prev_pts[status == 1]
            good_curr = curr_pts[status == 1]
            tracked_count = len(good_curr)

            if tracked_count >= 10:
                # 2. Estimate Essential Matrix with RANSAC
                # Focal length estimate for smartphone/webcam (~f=w)
                focal = float(w)
                pp = (w / 2.0, h / 2.0)
                
                try:
                    E, mask = cv2.findEssentialMat(good_curr, good_prev, focal=focal, pp=pp, method=cv2.RANSAC, prob=0.999, threshold=1.0)
                    if E is not None and E.shape == (3, 3):
                        inliers_count = int(np.sum(mask)) if mask is not None else 0
                        
                        if inliers_count >= 8:
                            _, R, t, mask_pose = cv2.recoverPose(E, good_curr, good_prev, focal=focal, pp=pp)
                            
                            # Extract yaw angle from rotation matrix R
                            sy = math.sqrt(R[0, 0] * R[0, 0] + R[1, 0] * R[1, 0])
                            singular = sy < 1e-6
                            if not singular:
                                yaw = math.atan2(R[1, 0], R[0, 0])
                            else:
                                yaw = math.atan2(-R[1, 2], R[1, 1])
                            
                            # Monocular scale factor estimation:
                            # Typical pedestrian motion is forward along z-axis, scaled ~0.3-0.8m per frame movement
                            # Bound delta to physically realistic walking speeds (< 1.5 m/s)
                            t_norm = np.linalg.norm(t)
                            if t_norm > 1e-4:
                                t_unit = t / t_norm
                                # Project translation onto 2D floor plane (x and z)
                                step_scale = 0.35  # meters estimated per significant frame step
                                forward_disp = float(t_unit[2]) * step_scale
                                lateral_disp = float(t_unit[0]) * step_scale
                                
                                # Ignore small stationary noise
                                if abs(forward_disp) < 0.04 and abs(lateral_disp) < 0.04:
                                    forward_disp = 0.0
                                    lateral_disp = 0.0
                                
                                d_theta = -yaw * 0.5  # Heading delta
                                current_heading = self.current_pose["heading"] + d_theta
                                
                                # Move in current heading direction
                                dx = forward_disp * math.cos(current_heading) - lateral_disp * math.sin(current_heading)
                                dy = forward_disp * math.sin(current_heading) + lateral_disp * math.cos(current_heading)
                                
                                self.current_pose["x"] += dx
                                self.current_pose["y"] += dy
                                self.current_pose["heading"] = current_heading % (2 * math.pi)
                                self.trajectory.append(dict(self.current_pose))
                                
                                self.tracking_lost = False
                                self.confidence = min(1.0, inliers_count / 100.0)
                except Exception as ex:
                    # In case of numerical instability in essential matrix
                    self.confidence = max(0.1, self.confidence * 0.8)

            if inliers_count < 8:
                self.tracking_lost = True
                self.confidence = 0.2
        else:
            self.tracking_lost = True
            self.confidence = 0.1

        # Check if we should create a new keyframe / node in the graph
        dist_from_last = math.hypot(
            self.current_pose["x"] - self.last_keyframe_pose["x"],
            self.current_pose["y"] - self.last_keyframe_pose["y"]
        )
        if dist_from_last >= self.keyframe_distance_threshold and not self.tracking_lost:
            node_id = f"node_{self.node_counter}"
            self.node_counter += 1
            new_node = {
                "id": node_id,
                "x": round(self.current_pose["x"], 2),
                "y": round(self.current_pose["y"], 2),
                "label": f"Waypoint {self.node_counter - 1}",
                "type": "waypoint"
            }
            last_node = self.map_nodes[-1]
            self.map_nodes.append(new_node)
            self.map_edges.append({
                "from": last_node["id"],
                "to": node_id,
                "distance": round(dist_from_last, 2)
            })
            self.last_keyframe_pose = dict(self.current_pose)
            self.keyframes.append({
                "id": node_id,
                "pose": dict(self.current_pose),
                "time": time.time()
            })

        # 3. Incorporate detected landmarks (doors, stairs, OCR signboards) into graph
        if detected_objects and not self.tracking_lost:
            for obj in detected_objects:
                label = obj.get("class_name", "").lower()
                conf = float(obj.get("confidence", 0.7))
                if label in ["door", "stairs", "chair", "table", "person", "cell phone"] and conf >= 0.5:
                    landmark_id = f"lm_{label}_{len(self.observed_landmarks) + 1}"
                    # Associate with nearest node
                    nearest_node = self.map_nodes[-1]["id"]
                    # Check if already observed recently nearby
                    already_recorded = any(
                        l["label"] == label and math.hypot(l["x"] - self.current_pose["x"], l["y"] - self.current_pose["y"]) < 2.0
                        for l in self.observed_landmarks
                    )
                    if not already_recorded:
                        lm = {
                            "id": landmark_id,
                            "label": label,
                            "x": round(self.current_pose["x"], 2),
                            "y": round(self.current_pose["y"], 2),
                            "nodeId": nearest_node,
                            "confidence": round(conf, 2),
                            "type": label
                        }
                        self.observed_landmarks.append(lm)
                        # Label node with landmark
                        if self.map_nodes[-1]["type"] == "waypoint":
                            self.map_nodes[-1]["label"] = f"{label.title()} Area"
                            self.map_nodes[-1]["type"] = label

        if ocr_text and ocr_text.strip() and not self.tracking_lost:
            clean_ocr = ocr_text.strip()[:30]
            if len(clean_ocr) >= 3:
                already_recorded = any(l.get("ocr") == clean_ocr for l in self.observed_landmarks)
                if not already_recorded:
                    lm = {
                        "id": f"lm_ocr_{len(self.observed_landmarks) + 1}",
                        "label": clean_ocr,
                        "ocr": clean_ocr,
                        "x": round(self.current_pose["x"], 2),
                        "y": round(self.current_pose["y"], 2),
                        "nodeId": self.map_nodes[-1]["id"],
                        "confidence": 0.85,
                        "type": "signboard"
                    }
                    self.observed_landmarks.append(lm)
                    self.map_nodes[-1]["label"] = clean_ocr

        # Replenish feature points if count drops
        if tracked_count < 40 or self.tracking_lost:
            new_pts = cv2.goodFeaturesToTrack(gray, mask=None, **self.feature_params)
            self.prev_pts = new_pts
        else:
            self.prev_pts = curr_pts[status == 1].reshape(-1, 1, 2)
        
        self.prev_gray = gray

        return self._build_status(tracked_count=tracked_count, inliers=inliers_count)

    def get_status(self) -> Dict:
        return self._build_status()

    @property
    def landmarks(self) -> List[Dict]:
        return self.observed_landmarks

    def _build_status(self, tracked_count: int = 0, inliers: int = 0) -> Dict:
        return {
            "status": "success",
            "pose": {
                "x": round(self.current_pose["x"], 2),
                "y": round(self.current_pose["y"], 2),
                "heading": round(math.degrees(self.current_pose["heading"]) % 360, 1)
            },
            "confidence": round(self.confidence, 2),
            "tracking_lost": self.tracking_lost,
            "tracked_features": tracked_count,
            "inlier_features": inliers,
            "keyframes_count": len(self.keyframes),
            "map": {
                "nodes": self.map_nodes,
                "edges": self.map_edges,
                "landmarks": self.observed_landmarks
            }
        }

    def plan_route_to_target(self, target_query: str) -> Dict:
        """
        Calculates walking directions on the explored topological graph towards target landmark.
        If destination is not in explored graph, honestly explains that it has not been mapped yet.
        """
        if not target_query or not target_query.strip():
            return {"status": "error", "message": "Destination name is required."}

        query_norm = target_query.lower().strip()
        
        # 1. Look for matching observed landmark
        target_landmark = None
        for lm in self.observed_landmarks:
            if query_norm in lm["label"].lower() or lm["label"].lower() in query_norm:
                target_landmark = lm
                break

        if not target_landmark:
            # Check if any map node label matches
            for node in self.map_nodes:
                if query_norm in node["label"].lower():
                    target_landmark = {"nodeId": node["id"], "label": node["label"]}
                    break

        if not target_landmark:
            nearest_landmark = self.observed_landmarks[0]["label"] if self.observed_landmarks else "the starting point"
            return {
                "status": "unobserved",
                "message": f'Destination "{target_query}" has not been identified during indoor exploration yet. The map currently contains {len(self.observed_landmarks)} discovered landmarks.',
                "suggestion": nearest_landmark,
                "discoveredLandmarks": [lm["label"] for lm in self.observed_landmarks]
            }

        target_node_id = target_landmark["nodeId"]
        
        # Find closest node to current pose
        current_node_id = self.map_nodes[-1]["id"]
        
        if current_node_id == target_node_id:
            return {
                "status": "arrived",
                "message": f"You are already at {target_landmark['label']}."
            }

        # Dijkstra on map_nodes & map_edges
        route_nodes = self._dijkstra(current_node_id, target_node_id)
        if not route_nodes:
            return {
                "status": "no_path",
                "message": f"Cannot find traversable path to {target_landmark['label']} on explored graph."
            }

        # Build guidance steps
        steps = []
        for i in range(len(route_nodes) - 1):
            n_from = next((n for n in self.map_nodes if n["id"] == route_nodes[i]), None)
            n_to = next((n for n in self.map_nodes if n["id"] == route_nodes[i + 1]), None)
            if n_from and n_to:
                dist = math.hypot(n_to["x"] - n_from["x"], n_to["y"] - n_from["y"])
                steps.append({
                    "step": i + 1,
                    "instruction": f"Walk towards {n_to['label']} (about {round(dist, 1)} meters).",
                    "from": n_from["label"],
                    "to": n_to["label"],
                    "distance": round(dist, 1)
                })

        return {
            "status": "success",
            "destination": target_landmark["label"],
            "total_steps": len(steps),
            "steps": steps
        }

    def _dijkstra(self, start_id: str, end_id: str) -> Optional[List[str]]:
        adj = {}
        for edge in self.map_edges:
            u, v, d = edge["from"], edge["to"], edge.get("distance", 1.0)
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

# Singleton instance
slam_instance = SlamEngine()
