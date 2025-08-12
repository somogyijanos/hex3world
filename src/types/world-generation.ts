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
