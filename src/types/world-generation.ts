/**
 * Types and interfaces for world generation
 */

export interface TilePlacement {
  position: { q: number; r: number };
  tileId: string;
  rotation: number;
}

export interface TileRemoval {
  position: { q: number; r: number };
}

export interface AddonPlacement {
  position: { q: number; r: number };
  addonId: string;
  localRotation?: number;
  localScale?: number;
}

export interface LLMPlacementDecision {
  placements: TilePlacement[];
  removals: TileRemoval[];
  addonPlacements: AddonPlacement[];
  reasoning: string;
  todoProgress?: string | null;
  originallyIntendedActions?: boolean; // Track if LLM originally intended to make actions before filtering
}

// World planning interfaces
export interface TodoItem {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  suggestedTiles?: string[]; // Optional: suggested tiles for this todo (guidance only)
  completionCriteria: string; // Detailed description of when this TODO can be considered completed
}

export interface WorldPlan {
  theme: string;
  detailedDescription: string; // Highly detailed description of the world (enhanced version of user description)
  todos: TodoItem[];
  reasoning: string;
}

// Helper interface for tracking generation progress
export interface GenerationTracker {
  start_time: number; // timestamp when generation started
  iterations: number;
  tiles_placed: number;
  tiles_removed: number;
  addons_placed: number;
  placement_failures: number;
  removal_failures: number;
  addon_failures: number;
  llm_calls: number;
  total_tokens?: number;
  prompts_used: Set<string>; // Track which prompt types were used
}

// Result interface for tracking placement outcomes
export interface PlacementResult {
  tilesPlaced: number;
  tilesRemoved: number;
  addonsPlaced: number;
  placementFailures: string[];
  removalFailures: string[];
  addonFailures: string[];
}
