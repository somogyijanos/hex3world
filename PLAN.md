# 🌍 3D Hex World Generation – Master Plan

⸻

## 🧩 1. Overview

Goal: Build a modular, standardized system for generating, representing, and visualizing procedurally generated 3D hex-based worlds using natural language, asset packs, and semantic edge logic.

⸻

## 📦 2. Asset Pack Structure

Each asset pack includes all information needed to use tiles, add-ons, and visual assets in a coherent semantic world.

{
  "id": "forest-pack",
  "name": "Enchanted Forest Pack",
  "version": "1.0",
  "description": "Assets for a lush forest environment"
}

A schema draft for asset packs is available in [SCHEMA_DRAFTS.md](SCHEMA_DRAFTS.md).


⸻

### 🔧 2.1 Geometry Configuration

"geometry_config": {
  "tile_up_axis": "z+",
  "parallel_edge_direction": "x+"
}

	•	tile_up_axis: Which world-space direction the tile is extruded in (upward)
	•	parallel_edge_direction: Direction in world-space parallel to one of the edges (there can be only two such parallel edges, on the opposite sides of the tile)

✅ These two settings fully determine tile orientation, including “pointy-top” vs “flat-top” without needing to declare it separately.

⸻

### 🎨 2.2 Materials

"materials": ["grass", "sand", "water", "rock", "road", "snow"]

	•	Purely visual tags
	•	Used by edges, vertices, tiles, add-ons for rendering & transitions
	•	Referenced by edge_types

⸻

### 🔁 2.3 Edge Types

"edge_types": {
  "grass": {
    "materials": ["grass"]
  },
  "sand": {
    "materials": ["sand"]
  },
  "water": {
    "materials": ["water"]
  },
  "transition-grass-water": {
    "materials": ["grass", "water"]
  },
  "road-straight": {
    "materials": ["road"],
    "compatible_with": ["road-junction", "road-straight"]
  },
  "road-junction": {
    "materials": ["road"],
    "compatible_with": ["road-straight", "road-junction"]
  }
}

✅ Benefits
	•	Edge-to-edge matching is declarative and modular
	•	Materials are used for visuals
	•	Compatibility logic is reusable and asset-driven

⸻

## 🧱 3. Tiles

Each tile defines its geometry and semantic edge behavior.

{
  "id": "forest-road-curve",
  "model": "models/forest_road_curve.glb",
  "base_material": "grass",
  "tags": ["walkable", "natural"],

  "edges": [
    "grass", "grass", "road-straight", 
    "road-junction", "grass", "sand"
  ],

  "vertices": [
    ["grass"], ["grass"], 
    ["grass", "sand"], ["water"], 
    ["sand"], ["grass"]
  ],

  "placement_rules": {
    "incompatible_neighbors": ["lava-tile"]
  }
}

	•	edges: references edge_types (by ID)
	•	vertices: lists materials at each corner (indexed 0–5 clockwise)
	•	tags: used for LLM and editor filtering
	•	placement_rules: optional additional constraints

⸻

## 🎯 4. Add-ons

3D models that decorate tiles (e.g., trees, rocks, houses, vehicles).

{
  "id": "tree-oak-01",
  "model": "models/tree_oak_01.glb",
  "tags": ["tree", "natural"],

  "placement": {
    "tile_tags": ["walkable"],
    "local_position": [0.2, 0.0, -0.1],
    "local_rotation": 45,
    "local_scale": 1.2
  }
}

	•	Placed relative to tile center
	•	Placement depends on tile tags and elevation

⸻

## 🌐 5. World Format

World JSON

{
  "asset_pack": "forest-pack",
  "tiles": [
    {
      "tile_type": "forest-road-curve",
      "q": 0,
      "r": 0,
      "elevation": 0
    },
    {
      "tile_type": "water-tile-01",
      "q": 1,
      "r": 0,
      "elevation": -1
    }
  ],
  "addons": [
    {
      "addon_id": "tree-oak-01",
      "q": 0,
      "r": 0,
      "local_position": [0.3, 0.0, 0.1],
      "local_rotation": 15,
      "local_scale": 1.0
    }
  ]
}

	•	Uses axial coordinates (q, r) for hex grid
	•	elevation is vertical shift (not scale)
	•	Add-ons can be offset and rotated locally

A schema draft for world format is available in [SCHEMA_DRAFTS.md](SCHEMA_DRAFTS.md).

⸻

## 🧠 6. LLM-Driven World Generation

Input:
	•	Prompt (e.g., “A village near a river, surrounded by pine forest”)
	•	Chosen asset pack

Output:
	•	World JSON matching terrain/topology themes
	•	Procedural constraints (roads, rivers, elevation, etc.)

LLM uses:
	•	Tile tags
	•	Edge types & compatibility
	•	World context

⸻

## 🔍 7. Visualization Tools

### 🗺️ 2D Editor
	•	View/edit tile grid
	•	Place tiles & add-ons
	•	Modify elevations
	•	Export world JSON

### 🌐 3D Renderer (Three.js or Babylon.js)
	•	Visualize full scene
	•	Load models based on geometry_config
	•	Animate add-ons / overlays

⸻

## 📐 8. Coordinate & Indexing Standards

Hex Orientation
	•	Internally assumes pointy-top axial layout
	•	For rendering, orientation is derived from:
	•	tile_up_axis
	•	parallel_edge_direction

Edge & Vertex Indexing

     0
   /   \
 5       1
 |       |
 4       2
   \   /
     3

	•	Vertex i = corner clockwise from top-right (0 to 5)
	•	Edge i = between vertex i and (i+1) % 6
	•	Edges reference edge_types
	•	Vertices reference materials

⸻

## 🧠 9. Placement Logic (Procedural)
	•	For each empty hex:
	1.	Gather neighbors with known edge types
	2.	Determine required edge types at shared borders
	3.	Filter tiles that match edge types at those positions
	4.	Randomly or intelligently pick one
	•	Edge matching uses:
	•	edge_type == neighbor_edge_type
	•	OR: compatible_with logic

⸻

## ✅ Final Summary

| Component | Purpose |
|-----------|---------|
| geometry_config | Defines 3D alignment/orientation of tiles |
| materials | Visual surface types (for rendering) |
| edge_types | Semantic edge logic, used for tile compatibility |
| Tile definitions | Tile shape, edge layout, vertex decorations |
| Add-ons | Local 3D props with offsets, scale, rotation |
| World format | Standardized JSON for generated or edited maps |
| LLM generation | Turn user intent + asset pack → valid JSON world |
| Editors / Renderers | Visual and interactive 2D/3D tools |