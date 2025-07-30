// Core type definitions for the 3D Hex World Generation system

// Geometry Configuration
export interface GeometryConfig {
  tile_up_axis: string;
  parallel_edge_direction: string;
  tile_circumradius: number; // Distance from center to vertex (defines hex size)
  edge_indexing_offset?: number; // How many steps to rotate logical edge indices to match model orientation (0-5)
  edge_indexing_direction?: 'clockwise' | 'counterclockwise'; // Direction of edge indexing in the model
}

// Placement configuration for add-ons
export type PlacementMethod = 'bounding_box' | 'model_coordinates';

export interface PlacementConfig {
  default_addon_placement_method?: PlacementMethod;
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
export interface TileDefinition {
  id: string;
  model: string;
  base_material: string;
  tags: string[];
  edges: [string, string, string, string, string, string]; // 6 edge types (clockwise from top-right)
  vertices: [string[], string[], string[], string[], string[], string[]]; // 6 vertex material arrays
}

// Add-on Definition
export interface AddOnPlacement {
  tile_tags: string[];
  local_position: [number, number, number]; // [x, y, z] offset from tile center
  local_rotation: number; // degrees
  local_scale: number;
  placement_method?: PlacementMethod; // Override pack default
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
  placement_config?: PlacementConfig;
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
  rotation?: number; // rotation in 60-degree steps (0-5), defaults to 0. 0=0°, 1=60°, 2=120°, etc.
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

// Hex Coordinate System (simplified)
export interface AxialCoordinate {
  q: number;
  r: number;
}