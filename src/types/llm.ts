// LLM type definitions for world generation system

import { World, WorldTile, AssetPack, TileDefinition, AddOnDefinition } from './index';
import { EdgeValidationResult, ValidationSummary } from '../core/EdgeValidator';

// LLM Provider Types
export type LLMProvider = 'openai' | 'claude' | 'local';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string; // For local models
  temperature?: number;
  maxTokens?: number;
}

// Tool Call Types
export interface LLMToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  properties?: Record<string, LLMToolParameter>;
  items?: LLMToolParameter;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, LLMToolParameter>;
    required: string[];
  };
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

// Generation Types
export interface GenerationRequest {
  assetPackId: string;
  description: string;
  constraints?: GenerationConstraints;
  existingWorld?: World;
  stream?: boolean; // For streaming real-time updates
  action?: 'generate' | 'cancel'; // For controlling generation
  sessionId?: string; // For tracking sessions
}

export interface GenerationConstraints {
  maxTiles?: number;
  preferredTileTypes?: string[];
  forbiddenTileTypes?: string[];
  centerPosition?: { q: number; r: number };
  maxRadius?: number;
  theme?: string;
  includeAddons?: boolean;
}

export interface GenerationProgress {
  stage: 'planning' | 'generating' | 'filling_holes' | 'placing_tiles' | 'adding_addons' | 'validating' | 'complete' | 'error';
  currentStep: number;
  totalSteps: number;
  message: string;
  placedTiles: number;
  validationErrors: number;
  currentWorld: World;
}

export interface GenerationResult {
  success: boolean;
  world?: World;
  error?: string;
  validationSummary?: ValidationSummary;
  progress?: GenerationProgress[];
}

// World State Types for LLM Context
export interface WorldSnapshot {
  assetPack: AssetPack;
  currentTiles: WorldTile[];
  totalTiles: number;
  occupiedPositions: Array<{ q: number; r: number }>;
  availablePositions: Array<{ q: number; r: number }>;
  worldBounds: {
    minQ: number;
    maxQ: number;
    minR: number;
    maxR: number;
  };
}

export interface NeighborInfo {
  position: { q: number; r: number };
  tileType?: string;
  isEmpty: boolean;
  edgeIndex: number; // Which edge connects to this neighbor
}

export interface TilePlacementSuggestion {
  tileType: string;
  position: { q: number; r: number };
  rotation: number;
  compatibility: 'perfect' | 'good' | 'possible' | 'incompatible';
  reasons: string[];
}

// LLM Response Types
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: LLMToolCall[];
  toolCallId?: string; // For tool result messages
}

export interface LLMToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
}

export interface LLMToolResult {
  toolCallId: string;
  result: unknown;
  error?: string;
}

export interface LLMResponse {
  message: LLMMessage;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// Generation Events for Real-time Updates
export type GenerationEventType = 
  | 'started' 
  | 'progress' 
  | 'tile_placed' 
  | 'validation_run' 
  | 'error' 
  | 'completed';

export interface GenerationEvent {
  type: GenerationEventType;
  data: unknown;
  timestamp: number;
}

export type GenerationEventHandler = (event: GenerationEvent) => void; 