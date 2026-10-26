const { BUILDINGS, getBuilding } = require("./sampleBuilding");
const { NIE_MYSORE_TEMPLATE } = require("./nieCollegeTemplate");

function normalizeText(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DEFAULT_ALIASES_BY_TYPE = {
  restroom: ["restroom", "toilet", "washroom", "nearest washroom", "nearest restroom", "nearest toilet", "bathrooms", "lavatory"],
  stairs: ["stairs", "staircase", "steps", "nearest stairs", "nearest staircase"],
  elevator: ["elevator", "lift", "nearest lift", "nearest elevator"],
  entrance: ["entrance", "main entrance", "entry", "front gate", "main gate"],
  exit: ["exit", "emergency exit", "nearest exit", "way out", "fire exit", "south exit", "east exit"],
  library: ["library", "central library", "reading room", "study area", "digital library"],
  reception: ["reception", "front desk", "help desk", "inquiry", "information desk", "lobby"],
  room: ["room", "classroom", "laboratory", "lab", "office", "hall", "seminar hall", "lecture hall"]
};

function aliasesForNode(node) {
  const list = new Set();
  const labelNorm = normalizeText(node.label);
  if (labelNorm) list.add(labelNorm);
  if (node.aliases && Array.isArray(node.aliases)) {
    node.aliases.forEach((a) => list.add(normalizeText(a)));
  }
  const typeAliases = DEFAULT_ALIASES_BY_TYPE[node.type] || [];
  typeAliases.forEach((a) => list.add(normalizeText(a)));
  return [...list];
}

function getRegisteredBuildings() {
  return [...BUILDINGS, NIE_MYSORE_TEMPLATE].filter((b) => b.nodes && b.nodes.length > 0);
}

function buildDestinationCatalog(buildings = getRegisteredBuildings()) {
  const destinations = [];
  for (const building of buildings) {
    if (building.isTemplate && !building.populated) continue;
    for (const node of building.nodes || []) {
      destinations.push({
        buildingId: building.id,
        buildingName: building.name,
        locationId: node.id,
        floorId: node.floorId,
        label: node.label,
        type: node.type,
        aliases: aliasesForNode(node),
        searchText: [node.label, ...(node.aliases || [])].join(" ")
      });
    }
  }
  return destinations;
}

function tokenOverlapScore(queryNorm, aliasNorm) {
  if (!queryNorm || !aliasNorm) return 0;
  const stopWords = new Set(["the", "a", "an", "to", "take", "me", "find", "guide"]);
  const cleanQuery = queryNorm.split(" ").filter((w) => !stopWords.has(w)).join(" ");
  if (aliasNorm === queryNorm || aliasNorm === cleanQuery) return 100;

  const qTokens = cleanQuery.split(" ").filter(Boolean);
  const aTokens = aliasNorm.split(" ").filter(Boolean);
  if (qTokens.length === 0 || aTokens.length === 0) return 0;

  let hits = 0;
  for (const t of aTokens) {
    if (qTokens.some((q) => q === t || (q.length >= 3 && t.length >= 3 && (q.startsWith(t) || t.startsWith(q))))) {
      hits += 1;
    }
  }

  if (hits === 0) return 0;
  if (hits === aTokens.length) {
    return aTokens.length > 1 ? 95 : 85;
  }
  return Math.min(80, 40 + hits * 15);
}

function scoreDestination(queryNorm, dest) {
  let best = 0;
  for (const alias of dest.aliases) {
    best = Math.max(best, tokenOverlapScore(queryNorm, alias));
  }
  return best;
}

function matchIndoorDestination(query, options = {}) {
  const queryNorm = normalizeText(query);
  if (!queryNorm) {
    return { status: "error", message: "Empty destination." };
  }

  let catalog = options.catalog || buildDestinationCatalog();
  if (options.buildingId) {
    const buildingSpecific = catalog.filter((d) => d.buildingId === options.buildingId);
    if (buildingSpecific.length > 0) {
      catalog = buildingSpecific;
    }
  }

  const scored = catalog
    .map((dest) => ({ dest, score: scoreDestination(queryNorm, dest) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    const suggestions = [...new Set(catalog.map((d) => d.label))].slice(0, 6);
    return {
      status: "not_found",
      message: `No mapped indoor destination matched "${query}".`,
      suggestions
    };
  }

  const topScore = scored[0].score;
  const top = scored.filter((s) => s.score >= topScore - 5);

  // If options specify a current location, check proximity to resolve nearest facility
  if (top.length > 1 && options.currentLocationId && options.buildingId) {
    const building = getBuilding(options.buildingId);
    if (building) {
      const currentNode = building.nodes.find((n) => n.id === options.currentLocationId);
      if (currentNode) {
        const candidatesWithDist = top.map((t) => {
          const destNode = building.nodes.find((n) => n.id === t.dest.locationId);
          if (!destNode) return { ...t, dist: Infinity };
          const sameFloor = destNode.floorId === currentNode.floorId;
          const eucDist = sameFloor
            ? Math.hypot(destNode.x - currentNode.x, destNode.y - currentNode.y)
            : 500 + Math.hypot(destNode.x - currentNode.x, destNode.y - currentNode.y);
          return { ...t, dist: eucDist };
        });

        candidatesWithDist.sort((a, b) => a.dist - b.dist);
        if (candidatesWithDist.length > 0 && candidatesWithDist[0].dist < Infinity) {
          const winner = candidatesWithDist[0].dest;
          return {
            status: "success",
            match: {
              buildingId: winner.buildingId,
              buildingName: winner.buildingName,
              locationId: winner.locationId,
              floorId: winner.floorId,
              label: winner.label,
              score: candidatesWithDist[0].score,
              nearestResolved: true
            }
          };
        }
      }
    }
  }

  if (top.length > 1) {
    const labels = top.map((t) => t.dest.label);
    const uniqueLabels = [...new Set(labels)];
    if (uniqueLabels.length > 1) {
      return {
        status: "ambiguous",
        message: "Multiple destinations match your request.",
        candidates: top.map((t) => ({
          buildingId: t.dest.buildingId,
          locationId: t.dest.locationId,
          label: t.dest.label,
          floorId: t.dest.floorId,
          score: t.score
        }))
      };
    }
  }

  const winner = top[0].dest;
  return {
    status: "success",
    match: {
      buildingId: winner.buildingId,
      buildingName: winner.buildingName,
      locationId: winner.locationId,
      floorId: winner.floorId,
      label: winner.label,
      score: top[0].score
    }
  };
}

function matchClarificationChoice(query, candidates) {
  const queryNorm = normalizeText(query);
  if (!queryNorm || !candidates?.length) return null;
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = Math.max(
      tokenOverlapScore(queryNorm, normalizeText(c.label)),
      tokenOverlapScore(queryNorm, normalizeText(String(c.locationId)))
    );
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 40 ? best : null;
}

module.exports = {
  normalizeText,
  tokenOverlapScore,
  buildDestinationCatalog,
  matchIndoorDestination,
  matchClarificationChoice,
  getRegisteredBuildings
};
