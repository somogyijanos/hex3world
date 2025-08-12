import { World, AssetPack } from '../types/index';
import { AssetPackManager } from './AssetPackManager';
import { WorldManager } from './WorldManager';
import { EdgeValidator } from './EdgeValidator';
import { PlacementOptionsCalculator, PositionOptions } from './PlacementOptionsCalculator';
import { BaseLLMProvider, LLMProviderFactory } from '../services/LLMProvider';
import {
  LLMConfig,
  GenerationRequest,
  GenerationResult,
  GenerationEvent,
  GenerationEventHandler,
  LLMMessage
} from '../types/llm';
import {
  LLMPlacementDecision,
  WorldPlan
} from '../types/world-generation';
import { LLMPrompter } from './LLMPrompter';
import { WorldPlanner } from './WorldPlanner';
import { PlacementEngine } from './PlacementEngine';

export class SimpleWorldGenerator {
  private assetPackManager: AssetPackManager;
  private worldManager: WorldManager;
  private placementCalculator: PlacementOptionsCalculator;
  private llmProvider: BaseLLMProvider | null = null;
  private eventHandlers: GenerationEventHandler[] = [];
  private llmPrompter: LLMPrompter;
  private worldPlanner: WorldPlanner;
  private placementEngine: PlacementEngine;

  constructor(assetPackManager: AssetPackManager) {
    this.assetPackManager = assetPackManager;
    this.worldManager = new WorldManager(assetPackManager);
    this.placementCalculator = new PlacementOptionsCalculator(assetPackManager);
    this.llmPrompter = new LLMPrompter();
    this.worldPlanner = new WorldPlanner();
    this.placementEngine = new PlacementEngine(assetPackManager, this.worldManager);
  }

  /**
   * Configure the LLM provider
   */
  setLLMProvider(config: LLMConfig): void {
    this.llmProvider = LLMProviderFactory.create(config);
    this.worldPlanner.setLLMProvider(this.llmProvider);
  }

  /**
   * Get the current world generation plan
   */
  getCurrentPlan(): WorldPlan | null {
    return this.llmPrompter.getCurrentPlan();
  }

  /**
   * Add event handler for generation progress
   */
  addEventListener(handler: GenerationEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Remove event handler
   */
  removeEventListener(handler: GenerationEventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index > -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  /**
   * Emit event to all handlers
   */
  private emitEvent(type: GenerationEvent['type'], data: unknown): void {
    const event: GenerationEvent = { type, data, timestamp: Date.now() };
    this.eventHandlers.forEach(handler => {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in event handler:', error);
      }
    });
  }

  /**
   * Generate a world using the new iterative approach
   */
  async generateWorld(request: GenerationRequest): Promise<GenerationResult> {
    if (!this.llmProvider) {
      return {
        success: false,
        error: 'LLM provider not configured'
      };
    }

    try {
      this.emitEvent('started', { request });

      // Log initial generation parameters
      console.log(`\n🎯 WORLD GENERATION STARTED`);
      console.log(`   Description: "${request.description}"`);
      console.log(`   Asset Pack: ${request.assetPackId}`);
      console.log(`   Max Tiles: ${request.constraints?.maxTiles || 20}`);
      console.log(`   Existing World: ${request.existingWorld ? `${request.existingWorld.tiles.length} tiles` : 'none'}`);

      // Validate asset pack
      const assetPack = this.assetPackManager.getAssetPack(request.assetPackId);
      if (!assetPack) {
        throw new Error(`Asset pack '${request.assetPackId}' not found`);
      }

      // Create initial world or use existing
      const currentWorld = request.existingWorld || this.worldManager.createWorld(request.assetPackId);

      // Reset progress tracking for new generation
      this.llmPrompter.setLastTodoProgress(null);

      const maxTiles = request.constraints?.maxTiles || 20;

      // PLANNING PHASE: Create initial plan if starting from empty world
      if (currentWorld.tiles.length === 0) {
        console.log(`\n📋 PLANNING PHASE: Creating strategic plan...`);
        
        this.emitEvent('progress', {
          stage: 'planning',
          currentStep: 1,
          totalSteps: 1,
          message: 'Creating strategic world plan...',
          placedTiles: 0,
          validationErrors: 0,
          currentWorld
        });

        const currentPlan = await this.worldPlanner.createWorldPlan(request, assetPack, maxTiles);
        this.llmPrompter.setCurrentPlan(currentPlan);
        
        if (currentPlan) {
          console.log(`✅ TODO-BASED PLAN CREATED:`);
          console.log(`   Theme: ${currentPlan.theme}`);
          console.log(`   Description: ${currentPlan.detailedDescription}`);
          console.log(`   Total Tasks: ${currentPlan.todos.length}`);
          console.log(`   TODO List:`);
          currentPlan.todos.forEach((todo, i) => {
            console.log(`     ${i+1}. ${todo.description}`);
            console.log(`        - complete when: ${todo.completionCriteria}`);
            console.log(`        - suggested tiles: ${todo.suggestedTiles?.join(', ')}`);
          });
        } else {
          console.log(`⚠️  Failed to create plan, proceeding without one`);
        }
      } else {
        console.log(`ℹ️ Continuing with existing world, skipping planning phase`);
      }

      const maxIterations = 50; // Prevent infinite loops
      let iteration = 0;

      // Iterative generation loop
      while (currentWorld.tiles.length < maxTiles && iteration < maxIterations) {
        iteration++;

        console.log(`\n🔄 ITERATION ${iteration}: ${currentWorld.tiles.length}/${maxTiles} tiles`);

        this.emitEvent('progress', {
          stage: 'expanding',
          currentStep: iteration,
          totalSteps: maxTiles,
          message: `Iteration ${iteration}: Finding placement options...`,
          placedTiles: currentWorld.tiles.length,
          validationErrors: 0,
          currentWorld
        });

        // Calculate all valid placement options
        const placementOptions = await this.placementCalculator.calculatePlacementOptions(currentWorld);
        
        const totalValidOptions = placementOptions.reduce((sum, pos) => sum + pos.validOptions.length, 0);
        console.log(`📋 Found ${placementOptions.length} positions with ${totalValidOptions} total valid options`);

        // If no valid options, we're done
        if (placementOptions.length === 0 || placementOptions.every(pos => pos.validOptions.length === 0)) {
          console.log('❌ STOPPING: No more valid placement options available');
          break;
        }

        // Ask LLM to make placement decisions
        const llmDecision = await this.getLLMPlacementDecision(request, currentWorld, placementOptions, assetPack, maxTiles);

        if (!llmDecision) {
          console.log(`❌ STOPPING: Failed to get LLM decision`);
          break;
        }

        // Check if LLM chose no actions at all (including addons)
        const hasAnyValidActions = llmDecision.placements.length > 0 || 
                                  llmDecision.removals.length > 0 || 
                                  llmDecision.addonPlacements.length > 0;

        if (!hasAnyValidActions) {
          const reasoningMsg = llmDecision.reasoning ? ` - Reasoning: "${llmDecision.reasoning}"` : '';
          
          // Only stop if LLM genuinely chose no actions, not if actions were filtered out
          if (llmDecision.originallyIntendedActions) {
            console.log(`⚠️ LLM made choices but they were all invalid, continuing for another iteration${reasoningMsg}`);
            continue; // Don't break, try another iteration
          } else {
            console.log(`❌ STOPPING: LLM chose no actions (no tiles to place, remove, or addons to add)${reasoningMsg}`);
            break;
          }
        }

        console.log(`🤖 LLM chose ${llmDecision.removals.length} removals, ${llmDecision.placements.length} placements, ${llmDecision.addonPlacements.length} addons`);
        if (llmDecision.removals.length > 0) {
          console.log(`   Removals: ${llmDecision.removals.map(r => `(${r.position.q},${r.position.r})`).join(', ')}`);
        }
        if (llmDecision.placements.length > 0) {
          console.log(`   Placements: ${llmDecision.placements.map(p => `${p.tileId}@(${p.position.q},${p.position.r}):r${p.rotation}`).join(', ')}`);
        }
        if (llmDecision.addonPlacements.length > 0) {
          console.log(`   Addons: ${llmDecision.addonPlacements.map(a => `${a.addonId}@(${a.position.q},${a.position.r})`).join(', ')}`);
        }

        // Apply the LLM's decisions using PlacementEngine
        const result = this.placementEngine.applyPlacementDecisions(
          currentWorld, 
          llmDecision, 
          assetPack, 
          maxTiles,
          this.emitEvent.bind(this)
        );

        if (result.removalFailures.length > 0) {
          console.log(`❌ Tile removal failures: ${result.removalFailures.join(', ')}`);
        }

        if (result.tilesRemoved > 0) {
          console.log(`🗑️  Removed ${result.tilesRemoved} tiles, world now: ${currentWorld.tiles.length}/${maxTiles}`);
        }

        if (result.placementFailures.length > 0) {
          console.log(`❌ Tile placement failures: ${result.placementFailures.join(', ')}`);
        }

        if (result.addonFailures.length > 0) {
          console.log(`❌ Addon placement failures: ${result.addonFailures.join(', ')}`);
        }

        if (result.tilesPlaced === 0 && result.tilesRemoved === 0) {
          console.log('❌ STOPPING: No meaningful changes made (no tiles placed or removed successfully)');
          break;
        }

        console.log(`✅ Applied ${result.tilesRemoved} removals, ${result.tilesPlaced}/${llmDecision.placements.length} placements, ${currentWorld.addons.length} total addons, world: ${currentWorld.tiles.length}/${maxTiles}`);
        
        // Store progress for next iteration
        if (llmDecision.todoProgress) {
          this.llmPrompter.setLastTodoProgress(llmDecision.todoProgress);
        }
        
        // Report general progress
        const currentPlan = this.llmPrompter.getCurrentPlan();
        if (currentPlan) {
          console.log(`📊 World Progress: Theme "${currentPlan.theme}", ${currentWorld.tiles.length}/${maxTiles} tiles`);
          
          if (llmDecision.todoProgress) {
            console.log(`   Progress: ${llmDecision.todoProgress}`);
          }
          
          // Show tile variety
          const tileTypes = new Set(currentWorld.tiles.map(t => t.tile_type));
          if (tileTypes.size > 0) {
            console.log(`   Tile Types: ${Array.from(tileTypes).join(', ')}`);
          }
        }
      }

      // Fill holes iteration - one final pass to identify and fill gaps
      console.log(`\n🕳️ FILL HOLES PHASE: Looking for interior gaps to fill...`);
      
      this.emitEvent('progress', {
        stage: 'filling_holes',
        currentStep: currentWorld.tiles.length,
        totalSteps: maxTiles,
        message: 'Analyzing world for interior holes to fill...',
        placedTiles: currentWorld.tiles.length,
        validationErrors: 0,
        currentWorld
      });

      // Calculate placement options and filter for holes with 4+ neighbors
      const allFillOptions = await this.placementCalculator.calculatePlacementOptions(currentWorld);
      const fillHolesOptions = allFillOptions.filter(posOption => posOption.adjacentNeighbors.length >= 4);
      const populatableHoles = fillHolesOptions.filter(posOption => posOption.validOptions.length > 0);
      const unpopulatableHoles = fillHolesOptions.filter(posOption => posOption.validOptions.length === 0);
      const totalFillOptions = populatableHoles.reduce((sum, pos) => sum + pos.validOptions.length, 0);
      
      console.log(`🔍 Found ${fillHolesOptions.length} interior holes (4+ neighbors), ${populatableHoles.length} populatable, ${unpopulatableHoles.length} blocked by edge constraints`);
      
      if ((populatableHoles.length > 0 && currentWorld.tiles.length < maxTiles) || unpopulatableHoles.length > 0) {
        // Ask LLM to identify and fill holes or remove tiles to resolve impossible holes
        const fillHolesDecision = await this.getLLMFillHolesDecision(request, currentWorld, populatableHoles, unpopulatableHoles, assetPack, maxTiles);
        
        // Check if hole filling decision has any valid actions (including addons)
        const hasAnyHoleFillingActions = fillHolesDecision && 
                                       (fillHolesDecision.placements.length > 0 || 
                                        fillHolesDecision.removals.length > 0 || 
                                        fillHolesDecision.addonPlacements.length > 0);

        if (hasAnyHoleFillingActions) {
          console.log(`🤖 LLM chose ${fillHolesDecision.removals.length} removals and ${fillHolesDecision.placements.length} hole fills`);
          
          // Apply hole-filling decisions using PlacementEngine
          const fillResult = this.placementEngine.applyPlacementDecisions(
            currentWorld, 
            fillHolesDecision, 
            assetPack, 
            maxTiles,
            this.emitEvent.bind(this)
          );
          
          if (fillResult.removalFailures.length > 0) {
            console.log(`❌ Hole-filling removal failures: ${fillResult.removalFailures.join(', ')}`);
          }

          if (fillResult.tilesRemoved > 0) {
            console.log(`🗑️  Removed ${fillResult.tilesRemoved} tiles during hole-filling, world now: ${currentWorld.tiles.length}/${maxTiles}`);
          }
          
          if (fillResult.placementFailures.length > 0) {
            console.log(`❌ Hole-filling failures: ${fillResult.placementFailures.join(', ')}`);
          }
          
          if (fillResult.addonFailures.length > 0) {
            console.log(`❌ Hole-filling addon failures: ${fillResult.addonFailures.join(', ')}`);
          }
          
          console.log(`✅ Applied ${fillResult.tilesRemoved} removals, filled ${fillResult.tilesPlaced}/${fillHolesDecision.placements.length} holes, final world: ${currentWorld.tiles.length}/${maxTiles}`);
        } else {
          const reasoningMsg = fillHolesDecision?.reasoning ? ` - Reasoning: "${fillHolesDecision.reasoning}"` : '';
          
          // Check if LLM originally intended hole-filling actions but they were filtered out
          if (fillHolesDecision?.originallyIntendedActions) {
            console.log(`⚠️ LLM made hole-filling choices but they were all invalid${reasoningMsg}`);
          } else {
            console.log(`ℹ️ No holes selected by LLM for filling${reasoningMsg}`);
          }
        }
      } else if (fillHolesOptions.length === 0) {
        console.log(`ℹ️ No interior holes found`);
      } else if (populatableHoles.length === 0) {
        console.log(`ℹ️ ${fillHolesOptions.length} holes found but all are blocked by edge validation constraints`);
      } else {
        console.log(`ℹ️ ${populatableHoles.length} holes could be filled but world is at max tiles (${currentWorld.tiles.length}/${maxTiles})`);
      }

      // Validate final world using EdgeValidator
      const edgeValidator = new EdgeValidator(this.assetPackManager);
      const validationSummary = edgeValidator.validateWorld(currentWorld);

      this.emitEvent('completed', {
        stage: 'complete',
        currentStep: maxTiles,
        totalSteps: maxTiles,
        message: 'World generation completed!',
        placedTiles: currentWorld.tiles.length,
        validationErrors: validationSummary.invalidEdges,
        currentWorld
      });

      // Log final world statistics
      console.log(`\n🏁 WORLD GENERATION COMPLETED`);
      console.log(`   Target: "${request.description}"`);
      console.log(`   Final Size: ${currentWorld.tiles.length}/${maxTiles} tiles (${((currentWorld.tiles.length / maxTiles) * 100).toFixed(1)}%)`);
      console.log(`   Iterations Used: ${iteration}`);
      console.log(`   Total Addons: ${currentWorld.addons.length}`);
      console.log(`   Validation: ${validationSummary.invalidEdges} invalid edges${validationSummary.invalidEdges === 0 ? ' ✅' : ' ⚠️'}`);
      
      // Tile composition breakdown
      const tileComposition = new Map<string, number>();
      currentWorld.tiles.forEach(tile => {
        const count = tileComposition.get(tile.tile_type) || 0;
        tileComposition.set(tile.tile_type, count + 1);
      });
      const sortedTiles = Array.from(tileComposition.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5); // Show top 5 tile types
      console.log(`   Top Tiles: ${sortedTiles.map(([type, count]) => `${type}(${count})`).join(', ')}`);
      
      // Addon composition breakdown
      if (currentWorld.addons.length > 0) {
        const addonComposition = new Map<string, number>();
        currentWorld.addons.forEach(addon => {
          const count = addonComposition.get(addon.addon_id) || 0;
          addonComposition.set(addon.addon_id, count + 1);
        });
        const sortedAddons = Array.from(addonComposition.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3); // Show top 3 addon types
        console.log(`   Top Addons: ${sortedAddons.map(([type, count]) => `${type}(${count})`).join(', ')}`);
      }

      return {
        success: true,
        world: currentWorld,
        validationSummary
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emitEvent('error', { error: errorMessage });
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Ask LLM to make placement decisions from valid options
   */
  private async getLLMPlacementDecision(
    request: GenerationRequest,
    currentWorld: World,
    placementOptions: PositionOptions[],
    assetPack: AssetPack,
    maxTiles: number
  ): Promise<LLMPlacementDecision | null> {
    
    const systemPrompt = this.llmPrompter.createPlacementSystemPrompt();
    const userPrompt = this.llmPrompter.createPlacementUserPrompt(request, currentWorld, placementOptions, assetPack, maxTiles);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    try {
      const response = await this.llmProvider!.generateResponse(messages, []);
      
      if (!response.message.content) {
        return null;
      }

      // Parse LLM response and apply conflict resolution
      const decision = this.llmPrompter.parsePlacementResponse(response.message.content, placementOptions, assetPack, currentWorld);
      
      if (!decision) {
        return null;
      }

      // Apply conflict resolution to placements
      if (decision.placements.length > 1) {
        const resolvedPlacements = this.placementEngine.resolveInterPlacementConflicts(decision.placements, assetPack);
        
        if (resolvedPlacements.length < decision.placements.length) {
          console.log(`🔧 Conflict resolution: ${decision.placements.length} → ${resolvedPlacements.length} tiles (removed ${decision.placements.length - resolvedPlacements.length} conflicting)`);
        }
        
        decision.placements = resolvedPlacements;
      }

      return decision;

    } catch (error) {
      console.error('Error getting LLM placement decision:', error);
      return null;
    }
  }

  /**
   * Ask LLM to identify and fill holes in the world or remove tiles to resolve impossible holes
   */
  private async getLLMFillHolesDecision(
    request: GenerationRequest,
    currentWorld: World,
    placementOptions: PositionOptions[],
    unpopulatableHoles: PositionOptions[],
    assetPack: AssetPack,
    maxTiles: number
  ): Promise<LLMPlacementDecision | null> {
    
    const systemPrompt = this.llmPrompter.createFillHolesSystemPrompt(request, assetPack);
    const userPrompt = this.llmPrompter.createFillHolesUserPrompt(request, currentWorld, placementOptions, unpopulatableHoles, assetPack, maxTiles);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    try {
      const response = await this.llmProvider!.generateResponse(messages, []);
      
      if (!response.message.content) {
        return null;
      }

      // Parse LLM response
      return this.llmPrompter.parsePlacementResponse(response.message.content, placementOptions, assetPack, currentWorld);

    } catch (error) {
      console.error('Error getting LLM fill holes decision:', error);
      return null;
    }
  }
}