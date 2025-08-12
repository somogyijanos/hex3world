import { World, GenerationMetadata } from '../types/index';
import { GenerationRequest, LLMConfig } from '../types/llm';
import { WorldPlan, GenerationTracker } from '../types/world-generation';
import { BaseLLMProvider } from '../services/LLMProvider';
import { ValidationSummary } from './EdgeValidator';

/**
 * Handles creation of comprehensive generation metadata for world files
 */
export class GenerationMetadataCreator {
  /**
   * Create comprehensive generation metadata from generation context
   */
  static createMetadata(
    request: GenerationRequest,
    currentWorld: World,
    validationSummary: ValidationSummary,
    generationTracker: GenerationTracker,
    currentPlan: WorldPlan | null,
    llmProvider: BaseLLMProvider | null
  ): GenerationMetadata {
    const generationTimeMs = Date.now() - generationTracker.start_time;
    
    // Calculate composition statistics
    const { tileComposition, addonComposition } = this.calculateComposition(currentWorld);

    return {
      generated_at: new Date().toISOString(),
      generated_by: 'simple-world-generator',
      original_description: request.description,
      asset_pack_used: request.assetPackId,
      constraints: this.mapConstraints(request),
      plan: this.mapPlan(currentPlan),
      generation_stats: this.createGenerationStats(generationTracker, validationSummary, generationTimeMs),
      composition: this.createComposition(currentWorld, tileComposition, addonComposition),
      llm_metadata: this.createLLMMetadata(llmProvider, generationTracker)
    };
  }

  /**
   * Calculate tile and addon composition statistics
   */
  private static calculateComposition(currentWorld: World): {
    tileComposition: Map<string, number>;
    addonComposition: Map<string, number>;
  } {
    const tileComposition = new Map<string, number>();
    currentWorld.tiles.forEach(tile => {
      const count = tileComposition.get(tile.tile_type) || 0;
      tileComposition.set(tile.tile_type, count + 1);
    });

    const addonComposition = new Map<string, number>();
    currentWorld.addons.forEach(addon => {
      const count = addonComposition.get(addon.addon_id) || 0;
      addonComposition.set(addon.addon_id, count + 1);
    });

    return { tileComposition, addonComposition };
  }

  /**
   * Map request constraints to metadata format
   */
  private static mapConstraints(request: GenerationRequest): GenerationMetadata['constraints'] {
    if (!request.constraints) return undefined;

    return {
      max_tiles: request.constraints.maxTiles,
      preferred_tile_types: request.constraints.preferredTileTypes,
      forbidden_tile_types: request.constraints.forbiddenTileTypes,
      theme: request.constraints.theme,
      center_position: request.constraints.centerPosition,
      max_radius: request.constraints.maxRadius,
      include_addons: request.constraints.includeAddons
    };
  }

  /**
   * Map world plan to metadata format
   */
  private static mapPlan(currentPlan: WorldPlan | null): GenerationMetadata['plan'] {
    if (!currentPlan) return undefined;

    return {
      theme: currentPlan.theme,
      detailed_description: currentPlan.detailedDescription,
      reasoning: currentPlan.reasoning,
      todos: currentPlan.todos.map(todo => ({
        id: todo.id,
        description: todo.description,
        status: todo.status,
        suggested_tiles: todo.suggestedTiles,
        completion_criteria: todo.completionCriteria
      }))
    };
  }

  /**
   * Create generation statistics
   */
  private static createGenerationStats(
    generationTracker: GenerationTracker,
    validationSummary: ValidationSummary,
    generationTimeMs: number
  ): GenerationMetadata['generation_stats'] {
    return {
      total_iterations: generationTracker.iterations,
      tiles_placed: generationTracker.tiles_placed,
      tiles_removed: generationTracker.tiles_removed,
      addons_placed: generationTracker.addons_placed,
      placement_failures: generationTracker.placement_failures,
      removal_failures: generationTracker.removal_failures,
      addon_failures: generationTracker.addon_failures,
      validation_errors: validationSummary.invalidEdges || 0,
      generation_time_ms: generationTimeMs
    };
  }

  /**
   * Create world composition statistics
   */
  private static createComposition(
    currentWorld: World,
    tileComposition: Map<string, number>,
    addonComposition: Map<string, number>
  ): GenerationMetadata['composition'] {
    return {
      tile_counts: Object.fromEntries(tileComposition),
      addon_counts: Object.fromEntries(addonComposition),
      total_tiles: currentWorld.tiles.length,
      total_addons: currentWorld.addons.length,
      unique_tile_types: tileComposition.size,
      unique_addon_types: addonComposition.size
    };
  }

  /**
   * Create LLM-specific metadata
   */
  private static createLLMMetadata(
    llmProvider: BaseLLMProvider | null,
    generationTracker: GenerationTracker
  ): GenerationMetadata['llm_metadata'] {
    if (!llmProvider) return undefined;

    // Access the protected config property through proper type casting
    const config = (llmProvider as unknown as { config: LLMConfig }).config;

    return {
      model_used: config?.model || 'unknown',
      total_llm_calls: generationTracker.llm_calls,
      total_tokens_used: generationTracker.total_tokens,
      prompts_used: Array.from(generationTracker.prompts_used)
    };
  }
}
