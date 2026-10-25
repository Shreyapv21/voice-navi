import React, { useMemo } from "react";
import { useLanguage } from "../utils/LanguageContext.jsx";

const TYPE_COLORS = {
  entrance: "#4facfe",
  reception: "#667eea",
  corridor: "#8892b0",
  room: "#38bdf8",
  restroom: "#a78bfa",
  stairs: "#fbbf24",
  elevator: "#34d399"
};

function edgeKey(a, b) {
  return [a, b].sort().join("--");
}

export function IndoorFloorMap({
  buildingName,
  floor,
  nodes,
  edges,
  routeNodeIds = [],
  currentLocationId,
  destinationLocationId,
  selectedFloorId
}) {
  const { t } = useLanguage();
  const floorNodes = useMemo(
    () => (nodes || []).filter((n) => n.floorId === selectedFloorId),
    [nodes, selectedFloorId]
  );

  const routeSet = useMemo(() => new Set(routeNodeIds || []), [routeNodeIds]);

  const routeEdgeSet = useMemo(() => {
    const set = new Set();
    for (let i = 0; i < routeNodeIds.length - 1; i++) {
      set.add(edgeKey(routeNodeIds[i], routeNodeIds[i + 1]));
    }
    return set;
  }, [routeNodeIds]);

  const floorEdges = useMemo(() => {
    const idsOnFloor = new Set(floorNodes.map((n) => n.id));
    return (edges || []).filter((e) => idsOnFloor.has(e.from) && idsOnFloor.has(e.to));
  }, [edges, floorNodes]);

  if (!floor) {
    return (
      <div className="indoor-map-empty" role="status">
        {t("select_locations_prompt")}
      </div>
    );
  }

  return (
    <div className="indoor-map-wrap" role="img" aria-label={`Floor map for ${buildingName}, ${floor.name}`}>
      <div className="indoor-map-header">
        <strong>{buildingName}</strong>
        <span>{floor.name}</span>
      </div>
      <svg viewBox="0 0 720 420" className="indoor-map-svg" aria-hidden="true">
        {floorEdges.map((edge) => {
          const from = floorNodes.find((n) => n.id === edge.from);
          const to = floorNodes.find((n) => n.id === edge.to);
          if (!from || !to) return null;
          const isRoute = routeEdgeSet.has(edgeKey(edge.from, edge.to));
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={isRoute ? "indoor-edge-route" : "indoor-edge"}
            />
          );
        })}

        {floorNodes.map((node) => {
          const isCurrent = node.id === currentLocationId;
          const isDest = node.id === destinationLocationId;
          const onRoute = routeSet.has(node.id);
          const fill = TYPE_COLORS[node.type] || "#94a3b8";
          return (
            <g key={node.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r={isCurrent || isDest ? 22 : 16}
                fill={fill}
                className={
                  isCurrent ? "indoor-node-current" : isDest ? "indoor-node-dest" : onRoute ? "indoor-node-route" : ""
                }
              />
              <text x={node.x} y={node.y - 28} textAnchor="middle" className="indoor-node-label">
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="indoor-map-legend" aria-label="Map legend">
        <li><span className="legend-dot legend-current" /> {t("current_location")}</li>
        <li><span className="legend-dot legend-dest" /> {t("destination")}</li>
        <li><span className="legend-line legend-route" /> {t("btn_preview_route")}</li>
        <li><span className="legend-line legend-walk" /> {t("building")}</li>
      </ul>
    </div>
  );
}

export default IndoorFloorMap;
