# ai-service/test_slam.py
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import unittest
import numpy as np
import cv2
from utils.slam_engine import SlamEngine
from utils.indoor_perception import IndoorPerceptionEngine

class TestSlamEngine(unittest.TestCase):
    def setUp(self):
        self.engine = SlamEngine()

    def _create_rich_frame(self):
        """Create a synthetic image with rich corners and textures for robust ORB/Optical Flow."""
        img = np.zeros((480, 640, 3), dtype=np.uint8)
        for i in range(8):
            cv2.circle(img, (60 + i * 65, 100), 22, (255, 255, 255), -1)
            cv2.rectangle(img, (50 + i * 65, 180), (85 + i * 65, 230), (200, 200, 200), -1)
            cv2.putText(img, f"CORRIDOR_{i}", (50 + i * 65, 300), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        return img

    def test_initial_state(self):
        status = self.engine.get_status()
        self.assertEqual(status["status"], "success")
        self.assertEqual(status["pose"]["x"], 0.0)
        self.assertEqual(status["pose"]["y"], 0.0)
        self.assertEqual(status["pose"]["heading"], 0.0)
        self.assertEqual(status["tracking_lost"], False)
        self.assertGreaterEqual(len(status["map"]["nodes"]), 1)
        self.assertIn("scale_info", status)
        self.assertFalse(status["scale_info"]["metric_validated"])
        self.assertIn("occupancy_summary", status)

    def test_process_frame_synthetic(self):
        img1 = self._create_rich_frame()
        detections = [{"class_name": "door", "confidence": 0.88, "distance": 2.0, "direction": "front"}]
        res1 = self.engine.process_frame(img1, detected_objects=detections, ocr_text="Room 101")

        self.assertIn("pose", res1)
        self.assertIn("tracked_features", res1)
        self.assertIn("map", res1)
        self.assertEqual(res1["status"], "success")
        
        # Verify doorway landmark is discovered
        doorway_lm = next((lm for lm in self.engine.observed_landmarks if lm["type"] == "doorway"), None)
        self.assertIsNotNone(doorway_lm)
        self.assertTrue("Doorway" in doorway_lm["label"])

        # Shift image slightly to simulate forward motion
        img2 = np.roll(img1, shift=-5, axis=0)
        res2 = self.engine.process_frame(img2)
        self.assertIn("pose", res2)
        self.assertFalse(res2["tracking_lost"])

    def test_dark_frame_detection(self):
        dark_img = np.zeros((480, 640, 3), dtype=np.uint8)
        res = self.engine.process_frame(dark_img)
        self.assertTrue(res["tracking_lost"])
        self.assertTrue(res["low_light"])
        self.assertEqual(res["state"], "tracking_lost")

    def test_routing_and_unobserved_handling(self):
        # Insert keyframe nodes and landmarks into the engine graph
        self.engine.map_nodes = [
            {"id": "node_0", "x": 0.0, "y": 0.0, "label": "Start Position", "type": "origin"},
            {"id": "node_1", "x": 2.0, "y": 0.0, "label": "Waypoint 1", "type": "corridor"},
            {"id": "node_2", "x": 2.0, "y": 3.0, "label": "Waypoint 2", "type": "corridor"}
        ]
        self.engine.map_edges = [
            {"from": "node_0", "to": "node_1", "distance": 2.0},
            {"from": "node_1", "to": "node_2", "distance": 3.0}
        ]

        # Add landmark for Exit
        self.engine.observed_landmarks.append({
            "id": "lm_exit_1",
            "label": "Exit",
            "type": "exit",
            "x": 2.0,
            "y": 3.0,
            "nodeId": "node_2",
            "confidence": 0.95
        })

        # Test route to "Exit" from node_0
        route = self.engine.plan_route_to_target("Exit", start_node_id="node_0")
        self.assertIsNotNone(route)
        self.assertEqual(route["status"], "success")
        self.assertGreater(len(route["steps"]), 0)
        self.assertAlmostEqual(route["total_distance_m"], 5.0, delta=0.5)

        # Check turn geometry in instructions: (0,0) -> (2,0) -> (2,3) involves a 90 degree turn
        has_turn_or_forward = any("turn" in s["instruction"].lower() or "continue" in s["instruction"].lower() for s in route["steps"])
        self.assertTrue(has_turn_or_forward)

        # Test arrival when already at target
        arrival_route = self.engine.plan_route_to_target("Exit", start_node_id="node_2")
        self.assertEqual(arrival_route["status"], "arrived")

    def test_semantic_destination_requests(self):
        """Test voice destination queries: nearest exit, find lift, stairs, door, reception, restroom."""
        self.engine.map_nodes = [
            {"id": "node_0", "x": 0.0, "y": 0.0, "label": "Start Position", "type": "origin"},
            {"id": "node_1", "x": 2.0, "y": 0.0, "label": "Corridor 1", "type": "corridor"},
            {"id": "node_2", "x": 4.0, "y": 0.0, "label": "Corridor 2", "type": "corridor"}
        ]
        self.engine.map_edges = [
            {"from": "node_0", "to": "node_1", "distance": 2.0},
            {"from": "node_1", "to": "node_2", "distance": 2.0}
        ]
        self.engine.observed_landmarks = [
            {"id": "lm_exit_1", "label": "Exit", "type": "exit", "x": 4.0, "y": 0.0, "nodeId": "node_2"},
            {"id": "lm_lift_1", "label": "Elevator", "type": "elevator", "x": 2.0, "y": 0.0, "nodeId": "node_1"},
            {"id": "lm_stairs_1", "label": "Stairs 1", "type": "stairs", "x": 4.0, "y": 0.0, "nodeId": "node_2"},
            {"id": "lm_door_1", "label": "Doorway 1", "type": "doorway", "x": 2.0, "y": 0.0, "nodeId": "node_1"},
            {"id": "lm_rec_1", "label": "Reception Desk", "type": "reception", "x": 2.0, "y": 0.0, "nodeId": "node_1"},
            {"id": "lm_rest_1", "label": "Restroom", "type": "restroom", "x": 4.0, "y": 0.0, "nodeId": "node_2"}
        ]

        # 1. "Take me to the nearest exit."
        res_exit = self.engine.plan_route_to_target("Take me to the nearest exit", start_node_id="node_0")
        self.assertEqual(res_exit["status"], "success")
        self.assertEqual(res_exit["destination"], "Exit")

        # 2. "Find the lift."
        res_lift = self.engine.plan_route_to_target("Find the lift", start_node_id="node_0")
        self.assertEqual(res_lift["status"], "success")
        self.assertEqual(res_lift["destination"], "Elevator")

        # 3. "Take me to the stairs."
        res_stairs = self.engine.plan_route_to_target("Take me to the stairs", start_node_id="node_0")
        self.assertEqual(res_stairs["status"], "success")
        self.assertEqual(res_stairs["destination"], "Stairs 1")

        # 4. "Find the nearest door."
        res_door = self.engine.plan_route_to_target("Find the nearest door", start_node_id="node_0")
        self.assertEqual(res_door["status"], "success")
        self.assertEqual(res_door["destination"], "Doorway 1")

        # 5. "Guide me to the reception."
        res_rec = self.engine.plan_route_to_target("Guide me to the reception", start_node_id="node_0")
        self.assertEqual(res_rec["status"], "success")
        self.assertEqual(res_rec["destination"], "Reception Desk")

        # 6. "Find the restroom."
        res_rest = self.engine.plan_route_to_target("Find the restroom", start_node_id="node_0")
        self.assertEqual(res_rest["status"], "success")
        self.assertEqual(res_rest["destination"], "Restroom")

    def test_unobserved_destination_does_not_invent_coordinates(self):
        """Unobserved destinations must be reported honestly without inventing coordinates."""
        res = self.engine.plan_route_to_target("Nonexistent Library")
        self.assertEqual(res["status"], "unobserved")
        self.assertIn("Nonexistent Library", res["message"])
        self.assertIn("discoveredLandmarks", res)

    def test_relocalization_simulation(self):
        img1 = self._create_rich_frame()
        self.engine.process_frame(img1)
        self.assertEqual(len(self.engine.keyframes), 1)

        # Force tracking lost
        self.engine.tracking_lost = True
        self.engine.state = "tracking_lost"

        # Present identical frame -> Should relocalize via ORB matching
        res = self.engine.process_frame(img1)
        self.assertTrue(res["relocalized"])
        self.assertFalse(res["tracking_lost"])

class TestIndoorPerceptionEngine(unittest.TestCase):
    def setUp(self):
        self.engine = IndoorPerceptionEngine()

    def _create_corridor_door_frame(self):
        """Synthetic frame with corridor perspective lines and a door frame."""
        img = np.full((480, 640, 3), 180, dtype=np.uint8)
        # Perspective floor/wall lines converging near center (320, 200)
        cv2.line(img, (20, 480), (280, 220), (50, 50, 50), 4)
        cv2.line(img, (620, 480), (360, 220), (50, 50, 50), 4)
        # Draw a high-contrast doorway rectangle on the left
        cv2.rectangle(img, (100, 150), (220, 440), (20, 20, 20), 4)
        # Add door handle
        cv2.circle(img, (205, 300), 5, (10, 10, 10), -1)
        return img

    def test_perception_model_classes(self):
        info = self.engine.get_model_info()
        self.assertIn("classes_detected_via_geometry", info)
        self.assertIn("door", info["classes_detected_via_geometry"])
        self.assertIn("elevator", info["classes_detected_via_geometry"])
        self.assertIn("wall", info["classes_detected_via_geometry"])
        self.assertIn("corridor", info["classes_detected_via_geometry"])
        self.assertIn("coco_supported_classes", info)

    def test_perception_process_corridor_door(self):
        frame = self._create_corridor_door_frame()
        res = self.engine.process(frame, frame_idx=1)
        
        self.assertIn("objects", res)
        self.assertIn("structural_perception", res)
        self.assertIn("model_info", res)
        
        # Verify structural perception fields
        struct = res["structural_perception"]
        self.assertIn("corridor_detected", struct)
        self.assertIn("corridor_alignment", struct)
        self.assertIn("wall_boundaries", struct)
        self.assertIn("traversable_floor_polygon", struct)

        # Check detected objects include doorway
        door_objs = [o for o in res["objects"] if o["class_name"] == "door"]
        self.assertGreaterEqual(len(door_objs), 1)
        self.assertIn("bbox", door_objs[0])
        self.assertIn("confidence", door_objs[0])
        self.assertIn("direction", door_objs[0])

    def test_elevator_distinction_requires_evidence(self):
        """Verify an elevator is NOT falsely reported on a generic doorway without elevator evidence."""
        frame = self._create_corridor_door_frame()
        res = self.engine.process(frame, frame_idx=1)
        elevator_objs = [o for o in res["objects"] if o["class_name"] == "elevator"]
        self.assertEqual(len(elevator_objs), 0)

    def test_stairs_perception(self):
        """Verify geometric detection of stairs via periodic horizontal treads."""
        frame = np.full((360, 480, 3), 160, dtype=np.uint8)
        for i in range(5):
            y = 160 + i * 32
            cv2.line(frame, (100, y), (380, y), (30, 30, 30), 3)
            cv2.rectangle(frame, (100, y), (380, y + 16), (190, 190, 190), -1)
            cv2.rectangle(frame, (100, y + 16), (380, y + 32), (120, 120, 120), -1)

        res = self.engine.process(frame)
        stair_objs = [o for o in res["objects"] if o["class_name"] == "stairs"]
        self.assertGreaterEqual(len(stair_objs), 1)
        self.assertIn("steps", stair_objs[0]["label"].lower())
        self.assertIn("direction", stair_objs[0])

    def test_corridor_wall_mapping_into_slam(self):
        """Verify that corridor perception updates the SLAM occupancy grid and walls."""
        slam = SlamEngine()
        frame = self._create_corridor_door_frame()
        perc = self.engine.process(frame)
        
        status = slam.process_frame(
            frame,
            detected_objects=perc["objects"],
            structural_perception=perc["structural_perception"]
        )

        slam_map = status["map"]
        self.assertIn("walls", slam_map)
        self.assertGreaterEqual(len(slam_map["walls"]), 1)
        self.assertIn("occupancy_grid", slam_map)
        
        occ = slam_map["occupancy_grid"]
        self.assertIn("free_cells", occ)
        self.assertIn("obstacle_cells", occ)
        self.assertGreater(len(occ["free_cells"]), 0)
        self.assertGreater(len(occ["obstacle_cells"]), 0)

    def test_fire_extinguisher_and_ocr_landmarks(self):
        """Verify recognition of fire extinguisher and OCR indoor landmarks."""
        # 1. Fire extinguisher red canister synthetic frame
        frame = np.full((360, 480, 3), 200, dtype=np.uint8)
        # Draw red cylinder on wall (x=200, y=80, w=40, h=100) -> BGR: (30, 30, 220)
        cv2.rectangle(frame, (200, 80), (240, 180), (30, 30, 220), -1)

        res = self.engine.process(frame)
        fire_objs = [o for o in res["objects"] if o["class_name"] == "fire_extinguisher"]
        self.assertGreaterEqual(len(fire_objs), 1)
        self.assertEqual(fire_objs[0]["label"], "Fire Extinguisher")

        # 2. OCR Landmark extraction
        res_ocr = self.engine.process(frame, ocr_text="EMERGENCY EXIT ROOM 204")
        exit_objs = [o for o in res_ocr["objects"] if o["class_name"] == "exit"]
        self.assertGreaterEqual(len(exit_objs), 1)
        room_objs = [o for o in res_ocr["objects"] if o["class_name"] == "room"]
        self.assertGreaterEqual(len(room_objs), 1)

if __name__ == "__main__":
    unittest.main()
