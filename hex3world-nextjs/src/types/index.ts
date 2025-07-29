// Core type definitions for the 3D Hex World Generation system

// Geometry Configuration
export interface GeometryConfig {
  tile_up_axis: 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-';
  parallel_edge_direction: 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-';
}

// Edge Types
export interface EdgeType {
  materials: string[];
  compatible_with?: string[];
}

export interface EdgeTypes {
  [edgeTypeId: string]: EdgeType;
}

// Tile Definition
export interface PlacementRules {
  incompatible_neighbors?: string[];
  required_elevation_range?: [number, number];
  required_tile_tags?: string[];
}

export interface TileDefinition {
  id: string;
  model: string;
  base_material: string;
  tags: string[];
  edges: [string, string, string, string, string, string]; // 6 edge types (clockwise from top-right)
  vertices: [string[], string[], string[], string[], string[], string[]]; // 6 vertex material arrays
  placement_rules?: PlacementRules;
}

// Add-on Definition
export interface AddOnPlacement {
  tile_tags: string[];
  local_position: [number, number, number]; // [x, y, z] offset from tile center
  local_rotation: number; // degrees
  local_scale: number;
}

export interface AddOnDefinition {
  id: string;
  model: string;
  tags: string[];
  placement: AddOnPlacement;
}

// Asset Pack
export interface AssetPack {
  id: string;
  name: string;
  version: string;
  description: string;
  geometry_config: GeometryConfig;
  materials: string[];
  edge_types: EdgeTypes;
  tiles: TileDefinition[];
  addons: AddOnDefinition[];
}

// World Format
export interface WorldTile {
  tile_type: string; // references TileDefinition.id
  q: number; // axial coordinate
  r: number; // axial coordinate  
  elevation: number;
}

export interface WorldAddOn {
  addon_id: string; // references AddOnDefinition.id
  q: number; // axial coordinate
  r: number; // axial coordinate
  local_position: [number, number, number];
  local_rotation: number;
  local_scale: number;
}

export interface World {
  asset_pack: string; // references AssetPack.id
  tiles: WorldTile[];
  addons: WorldAddOn[];
}

// Hex Coordinate System
export interface AxialCoordinate {
  q: number;
  r: number;
}

export interface CubeCoordinate {
  x: number;
  y: number;
  z: number;
}

// Utility types
export type EdgeIndex = 0 | 1 | 2 | 3 | 4 | 5;
export type VertexIndex = 0 | 1 | 2 | 3 | 4 | 5;