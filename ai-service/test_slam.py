# ai-service/test_slam.py
import unittest
import numpy as np
import cv2
from utils.slam_engine import SlamEngine

class TestSlamEngine(unittest.TestCase):
    def setUp(self):
        self.engine = SlamEngine()

    def test_initial_state(self):
        status = self.engine.get_status()
        self.assertEqual(status["status"], "success")
        self.assertEqual(status["pose"]["x"], 0.0)
        self.assertEqual(status["pose"]["y"], 0.0)
        self.assertEqual(status["pose"]["heading"], 0.0)
        self.assertEqual(status["tracking_lost"], False)
        self.assertGreaterEqual(len(status["map"]["nodes"]), 1)

    def test_process_frame_synthetic(self):
        # Create a synthetic image with high-contrast corner patterns
        img1 = np.zeros((480, 640, 3), dtype=np.uint8)
        # Draw some circles and rectangles for feature detection
        cv2.circle(img1, (200, 200), 50, (255, 255, 255), -1)
        cv2.rectangle(img1, (300, 100), (450, 250), (200, 200, 200), -1)
        cv2.putText(img1, "ROOM 101", (100, 400), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 2)

        detections = [{"label": "door", "class": "door", "confidence": 0.88}]
        res1 = self.engine.process_frame(img1, detected_objects=detections, ocr_text="Room 101")

        self.assertIn("pose", res1)
        self.assertIn("tracked_features", res1)
        self.assertIn("map", res1)
        self.assertEqual(res1["status"], "success")

        # Shift image slightly to simulate forward motion
        img2 = np.roll(img1, shift=-5, axis=0) # shifted 5 pixels vertically
        res2 = self.engine.process_frame(img2)
        self.assertIn("pose", res2)
        self.assertFalse(res2["tracking_lost"])

    def test_landmark_association_and_routing(self):
        # Insert keyframe nodes and landmarks into the engine graph to test Dijkstra pathfinder
        self.engine.map_nodes.append({"id": "node_1", "x": 1.5, "y": 0.0, "label": "Way 1", "type": "keyframe"})
        self.engine.map_nodes.append({"id": "node_2", "x": 3.0, "y": 0.0, "label": "Way 2", "type": "keyframe"})
        self.engine.map_edges.append({"from": "node_0", "to": "node_1", "weight": 1.5})
        self.engine.map_edges.append({"from": "node_1", "to": "node_2", "weight": 1.5})

        self.engine.observed_landmarks.append({
            "id": "lm_room_204",
            "label": "Room 204",
            "type": "door",
            "x": 3.0,
            "y": 0.0,
            "nodeId": "node_2",
            "confidence": 0.95
        })

        # Test route to "Room 204"
        route = self.engine.plan_route_to_target("Room 204")
        self.assertIsNotNone(route)
        self.assertEqual(route["status"], "found")
        self.assertGreater(len(route["steps"]), 0)
        self.assertAlmostEqual(route["total_distance_m"], 3.0, delta=0.5)

    def test_reset(self):
        self.engine.current_pose = {"x": 10.0, "y": 5.0, "heading": 90.0}
        self.engine.reset()
        status = self.engine.get_status()
        self.assertEqual(status["pose"]["x"], 0.0)
        self.assertEqual(status["pose"]["y"], 0.0)
        self.assertEqual(status["keyframes_count"], 0)

if __name__ == "__main__":
    unittest.main()
