# 🌍 Hex3World - 3D Hexagonal World Generation System

A modular system for generating, representing, and visualizing procedurally generated 3D hex-based worlds using asset packs and semantic edge logic.

## ✨ Features

- **Asset Pack System**: JSON-based modular asset definitions with validation
- **Hex Coordinate Math**: Complete axial coordinate system with neighbor calculations  
- **Edge Compatibility Logic**: Semantic tile placement validation based on edge types
- **3D Model Support**: STL file loading and rendering with Three.js
- **World Generation**: JSON world format with tiles and addons
- **3D Visualization**: Real-time 3D rendering with orbit controls

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Compile TypeScript:**
   ```bash
   npx tsc
   ```

3. **Run tests:**
   ```bash
   node test-demo.js
   ```

4. **Start the demo server:**
   ```bash
   python3 serve.py
   ```

5. **Open the 3D demo:**
   Open http://localhost:8000/demo.html in your browser

## 📁 Project Structure

```
hex3world/
├── src/                    # TypeScript source code
│   ├── core/               # Core system components
│   │   ├── AssetPackManager.ts    # Asset pack loading & validation
│   │   ├── EdgeCompatibility.ts   # Tile compatibility logic
│   │   ├── HexCoordinates.ts      # Hex coordinate math
│   │   └── WorldManager.ts        # World creation & management
│   ├── renderer/           # 3D rendering
│   │   └── HexWorldRenderer.ts    # Three.js world renderer
│   └── types/              # TypeScript type definitions
│       └── index.ts        # Core interfaces
├── assets/                 # Demo assets
│   ├── models/             # 3D model files (.stl)
│   ├── demo-pack.json      # Demo asset pack
│   └── demo-world.json     # Demo world
├── scripts/                # Utility scripts
│   └── generate_models.py  # 3D model generation
└── demo.html              # Interactive 3D demo
```

## 🎮 Demo World

The demo includes:
- **5 tile types**: grass, water, sand, road, shore
- **2 addon types**: trees and rocks  
- **14 tiles** arranged in a small landscape
- **5 addons** placed on various tiles
- **Real STL models** generated procedurally

### Demo Controls
- **Mouse**: Orbit camera around the world
- **Wheel**: Zoom in/out
- **Right-click**: Pan view
- **Load Demo**: Reload the demo world
- **Center Camera**: Reset camera position
- **Toggle Grid**: Show/hide coordinate grid

## 🧩 Asset Pack Format

Asset packs define tiles, addons, materials, and edge types:

```json
{
  "id": "demo-pack",
  "name": "Simple Demo Pack", 
  "version": "1.0.0",
  "geometry_config": {
    "tile_up_axis": "z+",
    "parallel_edge_direction": "x+"
  },
  "materials": ["grass", "water", "sand", "stone", "road"],
  "edge_types": {
    "grass": { "materials": ["grass"] },
    "water": { "materials": ["water"] },
    "road": { "materials": ["road"], "compatible_with": ["road"] }
  },
  "tiles": [...],
  "addons": [...]
}
```

## 🌐 World Format

Worlds reference asset packs and define tile/addon placement:

```json
{
  "asset_pack": "demo-pack",
  "tiles": [
    {
      "tile_type": "grass-tile",
      "q": 0, "r": 0,
      "elevation": 0
    }
  ],
  "addons": [
    {
      "addon_id": "tree-simple",
      "q": 0, "r": 0,
      "local_position": [0.3, 0.2, 0],
      "local_rotation": 0,
      "local_scale": 1.0
    }
  ]
}
```

## 🔧 Development

### Available Scripts
- `npx tsc` - Compile TypeScript to JavaScript
- `node test-demo.js` - Run system tests
- `python3 serve.py` - Start development server
- `python3 scripts/generate_models.py` - Generate new 3D models

### Architecture
The system is built around these core concepts:
1. **Asset Packs** - Modular collections of tiles, addons, and rules
2. **Hex Coordinates** - Axial (q,r) coordinate system for hexagonal grids
3. **Edge Types** - Semantic edge matching for tile compatibility
4. **World Generation** - JSON-based world representation
5. **3D Rendering** - Three.js-based visualization

## 📋 Current Status

✅ **Completed Phases:**
- Phase 1: Core Data Structures
- Phase 2: Asset Pack System  
- Phase 3: Hex Coordinate System
- Phase 4: Edge Compatibility Logic
- Phase 5: World Generation Core
- Phase 7: 3D Renderer

🔄 **Future Phases:**
- Phase 6: LLM Integration for prompt-to-world generation

## 🎯 Next Steps

1. **LLM Integration**: Add natural language world generation
2. **Advanced Materials**: PBR materials and textures
3. **Animation**: Moving water, swaying trees, etc.
4. **Procedural Generation**: Algorithmic world creation
5. **Editor Tools**: Interactive world editing interface
6. **Performance**: LOD system for large worlds

## 📖 Documentation

- `PLAN.md` - Complete system architecture and design
- `SCHEMA_DRAFTS.md` - JSON schema definitions
- Demo includes inline code documentation

Built with TypeScript, Three.js, and modern ES modules.