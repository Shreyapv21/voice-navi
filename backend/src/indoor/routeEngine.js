/**
 * Weighted shortest-path routing on indoor walk graphs (Dijkstra).
 * Supports floor transitions, accessible routes, turn geometry, and deviation detection.
 */

function buildAdjacency(building, preferAccessible) {
  const adj = new Map();
  const addEdge = (from, to, edge, reversed) => {
    if (!adj.has(from)) adj.set(from, []);
    let weight = edge.distanceMeters ?? 1;
    if (preferAccessible && edge.accessible === false) {
      weight += 1000;
    }
    adj.get(from).push({
      to,
      weight,
      edge,
      reversed
    });
  };

  for (const edge of building.edges) {
    addEdge(edge.from, edge.to, edge, false);
    addEdge(edge.to, edge.from, edge, true);
  }
  return adj;
}

function dijkstra(building, startId, endId, preferAccessible) {
  if (startId === endId) {
    return { status: "error", code: "SAME_LOCATION", message: "Starting point and destination are the same." };
  }

  const startNode = building.nodes.find((n) => n.id === startId);
  const endNode = building.nodes.find((n) => n.id === endId);
  if (!startNode) {
    return { status: "error", code: "INVALID_START", message: "Unknown starting location." };
  }
  if (!endNode) {
    return { status: "error", code: "INVALID_DESTINATION", message: "Unknown destination." };
  }

  const adj = buildAdjacency(building, preferAccessible);
  const dist = new Map();
  const prev = new Map();
  const visited = new Set();

  for (const node of building.nodes) {
    dist.set(node.id, Infinity);
  }
  dist.set(startId, 0);

  while (true) {
    let u = null;
    let best = Infinity;
    for (const [id, d] of dist.entries()) {
      if (!visited.has(id) && d < best) {
        best = d;
        u = id;
      }
    }
    if (u === null || best === Infinity) break;
    if (u === endId) break;
    visited.add(u);

    const neighbors = adj.get(u) || [];
    for (const { to, weight, edge, reversed } of neighbors) {
      const alt = dist.get(u) + weight;
      if (alt < dist.get(to)) {
        dist.set(to, alt);
        prev.set(to, { from: u, edge, reversed });
      }
    }
  }

  if (!prev.has(endId) && startId !== endId) {
    return {
      status: "error",
      code: "NO_ROUTE",
      message: "No walkable route exists between the selected locations."
    };
  }

  const pathNodeIds = [];
  const pathEdges = [];
  let cur = endId;
  while (cur !== startId) {
    pathNodeIds.unshift(cur);
    const step = prev.get(cur);
    if (!step) {
      return {
        status: "error",
        code: "NO_ROUTE",
        message: "No walkable route exists between the selected locations."
      };
    }
    pathEdges.unshift({ ...step.edge, reversed: step.reversed, from: step.from, to: cur });
    cur = step.from;
  }
  pathNodeIds.unshift(startId);

  const nodes = pathNodeIds.map((id) => building.nodes.find((n) => n.id === id));
  const totalCost = dist.get(endId);

  return {
    status: "success",
    startId,
    endId,
    totalCostMeters: Math.round(totalCost),
    nodeIds: pathNodeIds,
    nodes,
    edges: pathEdges
  };
}

function describeTransition(edge, reversed) {
  const t = edge.floorTransition;
  if (!t) return null;
  const fromFloor = reversed ? t.toFloor : t.fromFloor;
  const toFloor = reversed ? t.fromFloor : t.toFloor;
  const fromLevel = parseInt(fromFloor, 10);
  const toLevel = parseInt(toFloor, 10);
  const goingUp = toLevel > fromLevel;

  if (t.mode === "elevator") {
    return `Take the elevator to ${toFloor === "0" ? "Ground Floor" : `Floor ${toFloor}`}. Step out when doors open.`;
  }
  if (t.mode === "stairs") {
    return goingUp
      ? `Take the stairs up to ${toFloor === "1" ? "First Floor" : `Floor ${toFloor}`}. When you reach the floor landing, confirm your floor.`
      : `Take the stairs down to ${toFloor === "0" ? "Ground Floor" : `Floor ${toFloor}`}. When you reach the floor landing, confirm your floor.`;
  }
  return `Change to floor ${toFloor}.`;
}

function calculateTurnManeuver(prevNode, currNode, nextNode) {
  if (!prevNode || !currNode || !nextNode) return "Continue forward";
  if (prevNode.floorId !== currNode.floorId || currNode.floorId !== nextNode.floorId) return "Continue forward";
  if (prevNode.x == null || currNode.x == null || nextNode.x == null) return "Continue forward";

  const theta1 = Math.atan2(currNode.y - prevNode.y, currNode.x - prevNode.x);
  const theta2 = Math.atan2(nextNode.y - currNode.y, nextNode.x - currNode.x);
  let dTheta = ((theta2 - theta1 + Math.PI) % (2 * Math.PI)) - Math.PI;
  const dDeg = (dTheta * 180) / Math.PI;

  if (dDeg > 65) return "Turn right";
  if (dDeg > 25) return "Bear slightly right";
  if (dDeg < -65) return "Turn left";
  if (dDeg < -25) return "Bear slightly left";
  return "Continue straight";
}

function buildInstructions(routeResult, building) {
  if (routeResult.status !== "success") return [];

  const steps = [];
  const { nodes, edges } = routeResult;

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const fromNode = nodes[i];
    const toNode = nodes[i + 1];
    const transitionText = describeTransition(edge, edge.reversed);

    if (transitionText) {
      steps.push({
        stepIndex: steps.length,
        type: "floor_transition",
        instruction: transitionText,
        floorId: toNode.floorId,
        fromLocationId: fromNode.id,
        toLocationId: toNode.id,
        distanceMeters: edge.distanceMeters || 0,
        mode: edge.floorTransition?.mode || "stairs",
        requiresConfirmation: true
      });
      continue;
    }

    const dist = edge.distanceMeters || 0;
    const distText = dist ? ` (about ${dist} meters)` : "";

    // Calculate turn geometry
    let maneuver = "walk";
    let maneuverText = "";

    if (i === 0) {
      maneuverText = `From ${fromNode.label}, walk straight to ${toNode.label}`;
    } else {
      const prevNode = nodes[i - 1];
      const turnAction = calculateTurnManeuver(prevNode, fromNode, toNode);
      const isJunction = fromNode.type === "junction" || building.edges.filter((e) => e.from === fromNode.id || e.to === fromNode.id).length > 2;

      if (isJunction) {
        maneuver = "turn";
        maneuverText = `At ${fromNode.label}, ${turnAction.toLowerCase()} towards ${toNode.label}`;
      } else if (turnAction !== "Continue straight") {
        maneuver = "turn";
        maneuverText = `${turnAction} towards ${toNode.label}`;
      } else {
        maneuverText = `Continue straight towards ${toNode.label}`;
      }
    }

    // Doorway notification
    if (toNode.type === "room" || toNode.type === "library" || toNode.type === "restroom") {
      maneuverText += ` through the doorway`;
    }

    steps.push({
      stepIndex: steps.length,
      type: maneuver,
      instruction: `${maneuverText}${distText}.`,
      floorId: toNode.floorId,
      fromLocationId: fromNode.id,
      toLocationId: toNode.id,
      distanceMeters: dist
    });
  }

  const dest = nodes[nodes.length - 1];
  steps.push({
    stepIndex: steps.length,
    type: "arrival",
    instruction: `You have arrived at ${dest.label}.`,
    floorId: dest.floorId,
    fromLocationId: dest.id,
    toLocationId: dest.id,
    distanceMeters: 0
  });

  return steps;
}

function calculateIndoorRoute(building, startId, endId, options = {}) {
  const preferAccessible = options.preferAccessible === true;
  const path = dijkstra(building, startId, endId, preferAccessible);
  if (path.status !== "success") {
    return path;
  }
  const steps = buildInstructions(path, building);
  return {
    ...path,
    steps,
    buildingId: building.id,
    buildingName: building.name
  };
}

/**
 * Checks if the user's estimated location has deviated from the planned route path.
 */
function detectRouteDeviation(route, currentLocationId) {
  if (!route || !route.nodeIds || !currentLocationId) {
    return { deviated: false };
  }
  const onRoute = route.nodeIds.includes(currentLocationId);
  return {
    deviated: !onRoute,
    onRoute,
    currentLocationId
  };
}

/**
 * Recalculate route if user deviates or updates position.
 */
function recalculateIndoorRoute(building, currentLocationId, destinationLocationId, options = {}) {
  return calculateIndoorRoute(building, currentLocationId, destinationLocationId, options);
}

module.exports = {
  calculateIndoorRoute,
  dijkstra,
  buildInstructions,
  detectRouteDeviation,
  recalculateIndoorRoute
};
