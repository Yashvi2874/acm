"""Conjunction detection using Octree spatial partitioning + TCA estimation."""
import numpy as np
from typing import Any

CONJUNCTION_THRESHOLD_M = 5000.0  # 5 km miss distance threshold


class OctreeNode:
    def __init__(self, center: np.ndarray, half_size: float):
        self.center = center
        self.half_size = half_size
        self.bodies: list[dict] = []
        self.children: list["OctreeNode"] = []

    def insert(self, body: dict, max_depth: int = 8, depth: int = 0):
        pos = np.array(body["position"])
        if not self._contains(pos):
            return False
        if depth >= max_depth or len(self.bodies) < 4:
            self.bodies.append(body)
            return True
        if not self.children:
            self._subdivide()
        for child in self.children:
            if child.insert(body, max_depth, depth + 1):
                return True
        self.bodies.append(body)
        return True

    def _contains(self, pos: np.ndarray) -> bool:
        return np.all(np.abs(pos - self.center) <= self.half_size)

    def _subdivide(self):
        hs = self.half_size / 2
        offsets = [np.array([dx, dy, dz]) * hs
                   for dx in [-1, 1] for dy in [-1, 1] for dz in [-1, 1]]
        self.children = [OctreeNode(self.center + o, hs) for o in offsets]

    def query_near(self, pos: np.ndarray, radius: float) -> list[dict]:
        if np.any(np.abs(pos - self.center) > self.half_size + radius):
            return []
        results = [b for b in self.bodies
                   if np.linalg.norm(np.array(b["position"]) - pos) <= radius]
        for child in self.children:
            results.extend(child.query_near(pos, radius))
        return results


def _estimate_tca(b1: dict, b2: dict) -> tuple[float, float]:
    """Linear TCA estimate. Returns (tca_seconds, miss_distance_m)."""
    r1, v1 = np.array(b1["position"]), np.array(b1["velocity"])
    r2, v2 = np.array(b2["position"]), np.array(b2["velocity"])
    dr = r1 - r2
    dv = v1 - v2
    dv2 = np.dot(dv, dv)
    if dv2 < 1e-12:
        return 0.0, float(np.linalg.norm(dr))
    tca = -np.dot(dr, dv) / dv2
    miss = np.linalg.norm(dr + tca * dv)
    return float(tca), float(miss)


def check_conjunctions(bodies: list[dict[str, Any]]) -> list[dict]:
    """
    bodies: list of {"id": str, "position": [x,y,z] m, "velocity": [vx,vy,vz] m/s}
    Returns list of conjunction events.
    """
    if not bodies:
        return []

    positions = np.array([b["position"] for b in bodies])
    center = positions.mean(axis=0)
    half_size = float(np.max(np.abs(positions - center))) + 1.0

    tree = OctreeNode(center, half_size)
    for body in bodies:
        tree.insert(body)

    conjunctions = []
    checked = set()
    for body in bodies:
        pos = np.array(body["position"])
        candidates = tree.query_near(pos, CONJUNCTION_THRESHOLD_M * 2)
        for other in candidates:
            if other["id"] == body["id"]:
                continue
            pair = tuple(sorted([body["id"], other["id"]]))
            if pair in checked:
                continue
            checked.add(pair)
            tca, miss = _estimate_tca(body, other)
            if miss <= CONJUNCTION_THRESHOLD_M:
                conjunctions.append({
                    "sat1": pair[0],
                    "sat2": pair[1],
                    "tca_seconds": tca,
                    "miss_distance_m": miss,
                })
    return conjunctions
