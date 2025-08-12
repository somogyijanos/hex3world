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

// Generation metadata for tracking world creation
export interface GenerationMetadata {
  // Basic generation info
  generated_at: string; // ISO timestamp
  generated_by: string; // generator type (e.g., 'llm-world-generator', 'simple-world-generator')
  
  // Request information
  original_description: string; // User's original description
  asset_pack_used: string; // Asset pack ID used
  constraints?: {
    max_tiles?: number;
    min_tiles?: number;
    preferred_tile_types?: string[];
    forbidden_tile_types?: string[];
    theme?: string;
    center_position?: { q: number; r: number };
    max_radius?: number;
    include_addons?: boolean;
  };
  
  // Planning information (if available)
  plan?: {
    theme: string;
    detailed_description: string;
    reasoning: string;
    todos: Array<{
      id: string;
      description: string;
      status: 'pending' | 'in_progress' | 'completed';
      suggested_tiles?: string[];
      completion_criteria: string;
    }>;
  };
  
  // Generation process information
  generation_stats: {
    total_iterations: number;
    tiles_placed: number;
    tiles_removed: number;
    addons_placed: number;
    placement_failures: number;
    removal_failures: number;
    addon_failures: number;
    validation_errors: number;
    generation_time_ms: number; // Total time taken
  };
  
  // Final world composition
  composition: {
    tile_counts: Record<string, number>; // tile_type -> count
    addon_counts: Record<string, number>; // addon_id -> count
    total_tiles: number;
    total_addons: number;
    unique_tile_types: number;
    unique_addon_types: number;
  };
  
  // LLM specific metadata (if applicable)
  llm_metadata?: {
    model_used?: string;
    total_llm_calls: number;
    total_tokens_used?: number;
    average_response_time_ms?: number;
    prompts_used: string[]; // List of prompt types used (e.g., 'planning', 'tile-placement', 'hole-filling')
  };
}

export interface World {
  asset_pack: string; // references AssetPack.id
  tiles: WorldTile[];
  addons: WorldAddOn[];
  
  // Comprehensive generation metadata
  generation_metadata?: GenerationMetadata;
}

// Hex Coordinate System (simplified)
export interface AxialCoordinate {
  q: number;
  r: number;
}