/**
 * General-purpose indoor maps representing multi-floor academic, institutional, and office environments.
 * Nodes: walkable locations with floor coordinates for SVG rendering, node type, and aliases.
 * Edges: physical connections with distance (meters), accessibility, and floor transition metadata.
 */

const DEMO_CENTER = {
  id: "demo-center",
  name: "Dhristi Assistive Center",
  description: "General indoor navigation demonstration building with multiple destinations.",
  floors: [
    { id: "0", name: "Ground Floor", level: 0 },
    { id: "1", name: "First Floor", level: 1 }
  ],
  nodes: [
    {
      id: "main_entrance",
      floorId: "0",
      label: "Main Entrance",
      type: "entrance",
      x: 80,
      y: 300,
      aliases: ["entrance", "front entrance", "entry", "main gate", "exit"]
    },
    {
      id: "reception",
      floorId: "0",
      label: "Reception Desk",
      type: "reception",
      x: 200,
      y: 300,
      aliases: ["reception", "front desk", "help desk", "information counter", "lobby"]
    },
    {
      id: "central_library_g",
      floorId: "0",
      label: "Central Library",
      type: "library",
      x: 200,
      y: 180,
      aliases: ["library", "the library", "reading room", "study area", "digital library"]
    },
    {
      id: "corridor_a_g",
      floorId: "0",
      label: "Corridor Junction A",
      type: "junction",
      x: 340,
      y: 300,
      aliases: ["corridor a", "first junction", "junction a", "hallway a"]
    },
    {
      id: "corridor_b_g",
      floorId: "0",
      label: "Corridor Junction B",
      type: "junction",
      x: 480,
      y: 300,
      aliases: ["corridor b", "second junction", "junction b", "hallway b"]
    },
    {
      id: "restroom_g",
      floorId: "0",
      label: "Restroom (Ground Floor)",
      type: "restroom",
      x: 340,
      y: 180,
      aliases: ["restroom", "washroom", "toilet", "mens washroom", "ladies washroom", "accessible toilet"]
    },
    {
      id: "exit_east",
      floorId: "0",
      label: "East Emergency Exit",
      type: "exit",
      x: 480,
      y: 180,
      aliases: ["exit", "emergency exit", "east exit", "fire exit"]
    },
    {
      id: "staircase_g",
      floorId: "0",
      label: "North Staircase",
      type: "stairs",
      x: 620,
      y: 260,
      aliases: ["staircase", "stairs", "north stairs", "steps"]
    },
    {
      id: "elevator_g",
      floorId: "0",
      label: "Central Elevator",
      type: "elevator",
      x: 620,
      y: 340,
      aliases: ["elevator", "lift", "central elevator", "lift lobby"]
    },
    {
      id: "staircase_1",
      floorId: "1",
      label: "North Staircase (Floor 1)",
      type: "stairs",
      x: 620,
      y: 260,
      aliases: ["staircase", "stairs", "steps"]
    },
    {
      id: "elevator_1",
      floorId: "1",
      label: "Central Elevator (Floor 1)",
      type: "elevator",
      x: 620,
      y: 340,
      aliases: ["elevator", "lift"]
    },
    {
      id: "corridor_a_1",
      floorId: "1",
      label: "Corridor Junction 1",
      type: "junction",
      x: 480,
      y: 300,
      aliases: ["first floor corridor", "corridor a", "upper junction"]
    },
    {
      id: "lab_1",
      floorId: "1",
      label: "Laboratory 1",
      type: "room",
      x: 340,
      y: 300,
      aliases: ["computer lab", "lab 1", "laboratory one", "the lab", "software lab"]
    },
    {
      id: "lab_2",
      floorId: "1",
      label: "Laboratory 2",
      type: "room",
      x: 400,
      y: 240,
      aliases: ["lab 2", "laboratory two", "hardware lab", "ai lab"]
    },
    {
      id: "room_101",
      floorId: "1",
      label: "Room 101",
      type: "room",
      x: 340,
      y: 180,
      aliases: ["room 101", "classroom 101", "lecture hall 101", "class 101"]
    },
    {
      id: "room_102",
      floorId: "1",
      label: "Room 102",
      type: "room",
      x: 480,
      y: 180,
      aliases: ["room 102", "classroom 102", "lecture room 102"]
    },
    {
      id: "seminar_hall_1",
      floorId: "1",
      label: "Seminar Hall",
      type: "room",
      x: 200,
      y: 300,
      aliases: ["seminar hall", "conference room", "auditorium", "meeting room"]
    }
  ],
  edges: [
    { from: "main_entrance", to: "reception", distanceMeters: 12, accessible: true },
    { from: "reception", to: "central_library_g", distanceMeters: 10, accessible: true },
    { from: "reception", to: "corridor_a_g", distanceMeters: 14, accessible: true },
    { from: "corridor_a_g", to: "corridor_b_g", distanceMeters: 16, accessible: true },
    { from: "corridor_a_g", to: "restroom_g", distanceMeters: 10, accessible: true },
    { from: "corridor_b_g", to: "exit_east", distanceMeters: 10, accessible: true },
    { from: "corridor_b_g", to: "staircase_g", distanceMeters: 12, accessible: false },
    { from: "corridor_b_g", to: "elevator_g", distanceMeters: 12, accessible: true },
    {
      from: "staircase_g",
      to: "staircase_1",
      distanceMeters: 0,
      accessible: false,
      floorTransition: { fromFloor: "0", toFloor: "1", mode: "stairs" }
    },
    {
      from: "elevator_g",
      to: "elevator_1",
      distanceMeters: 0,
      accessible: true,
      floorTransition: { fromFloor: "0", toFloor: "1", mode: "elevator" }
    },
    { from: "staircase_1", to: "corridor_a_1", distanceMeters: 10, accessible: false },
    { from: "elevator_1", to: "corridor_a_1", distanceMeters: 10, accessible: true },
    { from: "corridor_a_1", to: "lab_1", distanceMeters: 14, accessible: true },
    { from: "corridor_a_1", to: "lab_2", distanceMeters: 12, accessible: true },
    { from: "lab_2", to: "room_102", distanceMeters: 10, accessible: true },
    { from: "corridor_a_1", to: "room_102", distanceMeters: 10, accessible: true },
    { from: "lab_1", to: "room_101", distanceMeters: 12, accessible: true },
    { from: "lab_1", to: "seminar_hall_1", distanceMeters: 14, accessible: true }
  ],
  markers: {
    "INDOOR:demo-center:0:main_entrance": "main_entrance",
    "INDOOR:demo-center:0:reception": "reception",
    "INDOOR:demo-center:0:RECEPTION": "reception",
    "INDOOR:demo-center:0:library": "central_library_g",
    "INDOOR:demo-center:0:corridor_a": "corridor_a_g",
    "INDOOR:demo-center:0:corridor_b": "corridor_b_g",
    "INDOOR:demo-center:0:restroom": "restroom_g",
    "INDOOR:demo-center:0:exit": "exit_east",
    "INDOOR:demo-center:0:staircase": "staircase_g",
    "INDOOR:demo-center:0:elevator": "elevator_g",
    "INDOOR:demo-center:1:staircase": "staircase_1",
    "INDOOR:demo-center:1:elevator": "elevator_1",
    "INDOOR:demo-center:1:corridor_a": "corridor_a_1",
    "INDOOR:demo-center:1:lab_1": "lab_1",
    "INDOOR:demo-center:1:lab_2": "lab_2",
    "INDOOR:demo-center:1:room_101": "room_101",
    "INDOOR:demo-center:1:room_102": "room_102",
    "INDOOR:demo-center:1:seminar": "seminar_hall_1"
  }
};

/**
 * General Academic & Science Complex
 * Demonstrates arbitrary destination navigation across classrooms, departments,
 * research labs, offices, washrooms, corridors, and stairs.
 */
const ACADEMIC_COMPLEX = {
  id: "academic-complex",
  name: "Campus Academic Complex",
  description: "General multi-department building with classrooms, research labs, offices, library, and washrooms.",
  floors: [
    { id: "0", name: "Ground Floor", level: 0 },
    { id: "1", name: "First Floor", level: 1 }
  ],
  nodes: [
    { id: "ac_main_gate", floorId: "0", label: "Campus Main Gate", type: "entrance", x: 60, y: 300, aliases: ["gate", "entrance", "exit", "main gate", "entry"] },
    { id: "ac_reception", floorId: "0", label: "Visitor Reception", type: "reception", x: 180, y: 300, aliases: ["reception", "help desk", "inquiry", "front desk"] },
    { id: "ac_library", floorId: "0", label: "Academic Library", type: "library", x: 180, y: 160, aliases: ["library", "reading hall", "books", "study room"] },
    { id: "ac_junction_g", floorId: "0", label: "Central Hallway Junction", type: "junction", x: 320, y: 300, aliases: ["junction", "central corridor", "crossway"] },
    { id: "ac_classroom_101", floorId: "0", label: "Classroom 101", type: "room", x: 320, y: 160, aliases: ["classroom 101", "room 101", "class 101", "lecture hall 1"] },
    { id: "ac_classroom_102", floorId: "0", label: "Classroom 102", type: "room", x: 460, y: 160, aliases: ["classroom 102", "room 102", "class 102", "lecture hall 2"] },
    { id: "ac_restroom_g", floorId: "0", label: "Ground Floor Washroom", type: "restroom", x: 460, y: 300, aliases: ["washroom", "restroom", "toilet", "bathrooms"] },
    { id: "ac_exit_south", floorId: "0", label: "South Exit", type: "exit", x: 460, y: 380, aliases: ["exit", "south exit", "emergency door"] },
    { id: "ac_stair_g", floorId: "0", label: "West Staircase", type: "stairs", x: 580, y: 240, aliases: ["stairs", "staircase", "steps"] },
    { id: "ac_lift_g", floorId: "0", label: "Main Elevator", type: "elevator", x: 580, y: 320, aliases: ["elevator", "lift", "elevator lobby"] },
    
    // First Floor
    { id: "ac_stair_1", floorId: "1", label: "West Staircase (Floor 1)", type: "stairs", x: 580, y: 240, aliases: ["stairs", "staircase"] },
    { id: "ac_lift_1", floorId: "1", label: "Main Elevator (Floor 1)", type: "elevator", x: 580, y: 320, aliases: ["elevator", "lift"] },
    { id: "ac_junction_1", floorId: "1", label: "Upper Department Junction", type: "junction", x: 440, y: 280, aliases: ["upper junction", "first floor corridor"] },
    { id: "ac_robotics_lab", floorId: "1", label: "Robotics Laboratory", type: "room", x: 440, y: 160, aliases: ["robotics lab", "robotics", "automation lab", "hardware lab"] },
    { id: "ac_ai_lab", floorId: "1", label: "AI Research Lab", type: "room", x: 300, y: 160, aliases: ["ai lab", "artificial intelligence lab", "research lab", "data science lab"] },
    { id: "ac_dean_office", floorId: "1", label: "Dean's Office", type: "room", x: 300, y: 280, aliases: ["deans office", "dean office", "principal cabin", "director room", "admin office"] },
    { id: "ac_faculty_lounge", floorId: "1", label: "Faculty Lounge", type: "room", x: 180, y: 280, aliases: ["faculty room", "staff room", "professors room", "lounge"] },
    { id: "ac_restroom_1", floorId: "1", label: "First Floor Washroom", type: "restroom", x: 180, y: 160, aliases: ["washroom", "restroom", "toilet", "upper toilet"] }
  ],
  edges: [
    { from: "ac_main_gate", to: "ac_reception", distanceMeters: 14, accessible: true },
    { from: "ac_reception", to: "ac_library", distanceMeters: 12, accessible: true },
    { from: "ac_reception", to: "ac_junction_g", distanceMeters: 15, accessible: true },
    { from: "ac_junction_g", to: "ac_classroom_101", distanceMeters: 12, accessible: true },
    { from: "ac_classroom_101", to: "ac_classroom_102", distanceMeters: 14, accessible: true },
    { from: "ac_junction_g", to: "ac_restroom_g", distanceMeters: 14, accessible: true },
    { from: "ac_restroom_g", to: "ac_exit_south", distanceMeters: 8, accessible: true },
    { from: "ac_restroom_g", to: "ac_stair_g", distanceMeters: 12, accessible: false },
    { from: "ac_restroom_g", to: "ac_lift_g", distanceMeters: 12, accessible: true },
    {
      from: "ac_stair_g",
      to: "ac_stair_1",
      distanceMeters: 0,
      accessible: false,
      floorTransition: { fromFloor: "0", toFloor: "1", mode: "stairs" }
    },
    {
      from: "ac_lift_g",
      to: "ac_lift_1",
      distanceMeters: 0,
      accessible: true,
      floorTransition: { fromFloor: "0", toFloor: "1", mode: "elevator" }
    },
    { from: "ac_stair_1", to: "ac_junction_1", distanceMeters: 12, accessible: false },
    { from: "ac_lift_1", to: "ac_junction_1", distanceMeters: 12, accessible: true },
    { from: "ac_junction_1", to: "ac_robotics_lab", distanceMeters: 12, accessible: true },
    { from: "ac_robotics_lab", to: "ac_ai_lab", distanceMeters: 14, accessible: true },
    { from: "ac_junction_1", to: "ac_dean_office", distanceMeters: 14, accessible: true },
    { from: "ac_dean_office", to: "ac_faculty_lounge", distanceMeters: 12, accessible: true },
    { from: "ac_faculty_lounge", to: "ac_restroom_1", distanceMeters: 12, accessible: true },
    { from: "ac_ai_lab", to: "ac_restroom_1", distanceMeters: 12, accessible: true }
  ],
  markers: {
    "INDOOR:academic-complex:0:gate": "ac_main_gate",
    "INDOOR:academic-complex:0:reception": "ac_reception",
    "INDOOR:academic-complex:0:library": "ac_library",
    "INDOOR:academic-complex:0:junction": "ac_junction_g",
    "INDOOR:academic-complex:0:room101": "ac_classroom_101",
    "INDOOR:academic-complex:0:room102": "ac_classroom_102",
    "INDOOR:academic-complex:0:restroom": "ac_restroom_g",
    "INDOOR:academic-complex:0:exit": "ac_exit_south",
    "INDOOR:academic-complex:0:stairs": "ac_stair_g",
    "INDOOR:academic-complex:0:elevator": "ac_lift_g",
    "INDOOR:academic-complex:1:stairs": "ac_stair_1",
    "INDOOR:academic-complex:1:elevator": "ac_lift_1",
    "INDOOR:academic-complex:1:robotics": "ac_robotics_lab",
    "INDOOR:academic-complex:1:ai_lab": "ac_ai_lab",
    "INDOOR:academic-complex:1:dean": "ac_dean_office",
    "INDOOR:academic-complex:1:faculty": "ac_faculty_lounge",
    "INDOOR:academic-complex:1:restroom": "ac_restroom_1"
  }
};

const BUILDINGS = [DEMO_CENTER, ACADEMIC_COMPLEX];

function getBuilding(buildingId) {
  return BUILDINGS.find((b) => b.id === buildingId) || null;
}

function listBuildings() {
  return BUILDINGS.map(({ id, name, description, floors, isTemplate }) => ({
    id,
    name,
    description,
    floors,
    isTemplate: !!isTemplate
  }));
}

function getBuildingMap(buildingId) {
  const building = getBuilding(buildingId);
  if (!building) return null;
  return {
    id: building.id,
    name: building.name,
    floors: building.floors,
    nodes: building.nodes,
    edges: building.edges
  };
}

function resolveMarker(markerText, buildingId = null) {
  const trimmed = (markerText || "").trim();
  if (!trimmed) {
    return { status: "error", message: "Marker text is empty." };
  }

  const upper = trimmed.toUpperCase();
  if (!upper.startsWith("INDOOR:")) {
    return {
      status: "error",
      message: "Invalid marker format. Expected INDOOR:buildingId:floorId:locationKey"
    };
  }

  const parts = trimmed.split(":");
  if (parts.length !== 4) {
    return {
      status: "error",
      message: "Invalid marker format. Use INDOOR:buildingId:floorId:locationKey"
    };
  }

  const [, bId, floorId] = parts;
  if (buildingId && buildingId !== bId) {
    return {
      status: "error",
      message: "This marker belongs to a different building than the one selected."
    };
  }

  const building = getBuilding(bId);
  if (!building) {
    return { status: "error", message: `Unknown building "${bId}".` };
  }

  const floor = building.floors.find((f) => f.id === floorId);
  if (!floor) {
    return { status: "error", message: `Unknown floor "${floorId}" in building ${building.name}.` };
  }

  const locationId = building.markers[upper] || building.markers[trimmed];
  if (!locationId) {
    return { status: "error", message: "Unknown location marker for this building and floor." };
  }

  const node = building.nodes.find((n) => n.id === locationId);
  if (!node) {
    return { status: "error", message: "Marker maps to a missing location in the building data." };
  }

  return {
    status: "success",
    buildingId: bId,
    buildingName: building.name,
    floorId: node.floorId,
    locationId: node.id,
    label: node.label
  };
}

module.exports = {
  BUILDINGS,
  DEMO_CENTER,
  ACADEMIC_COMPLEX,
  getBuilding,
  listBuildings,
  getBuildingMap,
  resolveMarker
};
