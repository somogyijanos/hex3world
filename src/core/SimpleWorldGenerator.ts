import { World, WorldTile, AssetPack, WorldAddOn } from '../types/index';
import { AssetPackManager } from './AssetPackManager';
import { WorldManager } from './WorldManager';
import { EdgeValidator } from './EdgeValidator';
import { PlacementOptionsCalculator, PositionOptions, PlacementOption } from './PlacementOptionsCalculator';
import { HexCoordinates } from './HexCoordinates';
import { BaseLLMProvider, LLMProviderFactory } from '../services/LLMProvider';
import {
  LLMConfig,
  GenerationRequest,
  GenerationResult,
  GenerationProgress,
  GenerationEvent,
  GenerationEventHandler,
  LLMMessage
} from '../types/llm';

export interface TilePlacement {
  position: { q: number; r: number };
  tileId: string;
  rotation: number;
}

export interface TileRemoval {
  position: { q: number; r: number };
}

export interface AddOnPlacement {
  position: { q: number; r: number };
  addonId: string;
  localRotation?: number;
  localScale?: number;
}

export interface LLMPlacementDecision {
  placements: TilePlacement[];
  removals: TileRemoval[];
  addonPlacements: AddOnPlacement[];
  reasoning: string;
  todoProgress?: string | null;
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

export class SimpleWorldGenerator {
  private assetPackManager: AssetPackManager;
  private worldManager: WorldManager;
  private placementCalculator: PlacementOptionsCalculator;
  private llmProvider: BaseLLMProvider | null = null;
  private eventHandlers: GenerationEventHandler[] = [];
  private currentPlan: WorldPlan | null = null; // Store the generation plan
  private lastTodoProgress: string | null = null; // Store last iteration's progress

  constructor(assetPackManager: AssetPackManager) {
    this.assetPackManager = assetPackManager;
    this.worldManager = new WorldManager(assetPackManager);
    this.placementCalculator = new PlacementOptionsCalculator(assetPackManager);
  }

  /**
   * Configure the LLM provider
   */
  setLLMProvider(config: LLMConfig): void {
    this.llmProvider = LLMProviderFactory.create(config);
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
      this.lastTodoProgress = null;

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

        this.currentPlan = await this.createWorldPlan(request, assetPack, maxTiles);
        
        if (this.currentPlan) {
          console.log(`✅ TODO-BASED PLAN CREATED:`);
          console.log(`   Theme: ${this.currentPlan.theme}`);
          console.log(`   Description: ${this.currentPlan.detailedDescription}`);
          console.log(`   Total Tasks: ${this.currentPlan.todos.length}`);
          console.log(`   TODO List:`);
          this.currentPlan.todos.forEach((todo, i) => {
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

        if (!llmDecision || (llmDecision.placements.length === 0 && llmDecision.removals.length === 0)) {
          const reasoningMsg = llmDecision?.reasoning ? ` - Reasoning: "${llmDecision.reasoning}"` : '';
          console.log(`❌ STOPPING: LLM chose no actions (no tiles to place or remove)${reasoningMsg}`);
          break;
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

        // Apply the LLM's decisions: removals first, then placements
        
        // Safety constraint: prevent removing more than 25% of current tiles in one iteration
        const maxRemovalsAllowed = Math.max(1, Math.floor(currentWorld.tiles.length * 0.25));
        const actualRemovals = Math.min(llmDecision.removals.length, maxRemovalsAllowed);
        
        if (llmDecision.removals.length > maxRemovalsAllowed) {
          console.log(`⚠️  Safety constraint: limiting removals from ${llmDecision.removals.length} to ${maxRemovalsAllowed} (25% max)`);
        }

        // Apply tile removals first
        let tilesRemoved = 0;
        const removalFailures: string[] = [];
        
        for (let i = 0; i < actualRemovals; i++) {
          const removal = llmDecision.removals[i];
          try {
            // Find and remove the tile (only check position)
            const tileIndex = currentWorld.tiles.findIndex(t => 
              t.q === removal.position.q && t.r === removal.position.r
            );
            
            if (tileIndex === -1) {
              removalFailures.push(`(${removal.position.q},${removal.position.r}) - no tile found at position`);
              continue;
            }

            // Get the tile type before removing for logging
            const removedTile = currentWorld.tiles[tileIndex];
            const removedTileType = removedTile.tile_type;

            // Remove the tile
            currentWorld.tiles.splice(tileIndex, 1);
            tilesRemoved++;

            // Also remove any addons at this position
            const addonIndices = [];
            for (let j = currentWorld.addons.length - 1; j >= 0; j--) {
              if (currentWorld.addons[j].q === removal.position.q && currentWorld.addons[j].r === removal.position.r) {
                addonIndices.push(j);
              }
            }
            addonIndices.forEach(index => currentWorld.addons.splice(index, 1));

            this.emitEvent('progress', {
              stage: 'removing',
              currentStep: currentWorld.tiles.length,
              totalSteps: maxTiles,
              message: `Removed ${removedTileType} at (${removal.position.q}, ${removal.position.r})`,
              placedTiles: currentWorld.tiles.length,
              validationErrors: 0,
              currentWorld
            });

          } catch (error) {
            removalFailures.push(`(${removal.position.q},${removal.position.r}): ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }

        if (removalFailures.length > 0) {
          console.log(`❌ Tile removal failures: ${removalFailures.join(', ')}`);
        }

        if (tilesRemoved > 0) {
          console.log(`🗑️  Removed ${tilesRemoved} tiles, world now: ${currentWorld.tiles.length}/${maxTiles}`);
        }

        // Apply tile placements
        let tilesPlaced = 0;
        const failures: string[] = [];
        
        for (const placement of llmDecision.placements) {
          // Check if we've reached the max tiles limit
          if (currentWorld.tiles.length >= maxTiles) {
            console.log(`🛑 Reached max tiles limit (${maxTiles}), stopping placement`);
            break;
          }
          try {
            const newTile: WorldTile = {
              tile_type: placement.tileId,
              q: placement.position.q,
              r: placement.position.r,
              elevation: 0,
              rotation: placement.rotation
            };

            this.worldManager.addTile(currentWorld, newTile);
            tilesPlaced++;

            this.emitEvent('progress', {
              stage: 'placing',
              currentStep: currentWorld.tiles.length,
              totalSteps: maxTiles,
              message: `Placed ${placement.tileId} at (${placement.position.q}, ${placement.position.r})`,
              placedTiles: currentWorld.tiles.length,
              validationErrors: 0,
              currentWorld
            });

          } catch (error) {
            failures.push(`${placement.tileId}@(${placement.position.q},${placement.position.r}): ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }

        if (failures.length > 0) {
          console.log(`❌ Tile placement failures: ${failures.join(', ')}`);
        }

        // Apply addon placements
        if (llmDecision.addonPlacements.length > 0) {
          const addonFailures = this.applyAddonPlacements(currentWorld, llmDecision.addonPlacements, assetPack);
          if (addonFailures.length > 0) {
            console.log(`❌ Addon placement failures: ${addonFailures.join(', ')}`);
          }
        }

        if (tilesPlaced === 0 && tilesRemoved === 0) {
          console.log('❌ STOPPING: No meaningful changes made (no tiles placed or removed successfully)');
          break;
        }

        console.log(`✅ Applied ${tilesRemoved} removals, ${tilesPlaced}/${llmDecision.placements.length} placements, ${currentWorld.addons.length} total addons, world: ${currentWorld.tiles.length}/${maxTiles}`);
        
        // Store progress for next iteration
        if (llmDecision.todoProgress) {
          this.lastTodoProgress = llmDecision.todoProgress;
        }
        
        // Report general progress
        if (this.currentPlan) {
          console.log(`📊 World Progress: Theme "${this.currentPlan.theme}", ${currentWorld.tiles.length}/${maxTiles} tiles`);
          
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
        
        if (fillHolesDecision && (fillHolesDecision.placements.length > 0 || fillHolesDecision.removals.length > 0)) {
          console.log(`🤖 LLM chose ${fillHolesDecision.removals.length} removals and ${fillHolesDecision.placements.length} hole fills`);
          
          // Apply hole-filling removals first (with same safety constraints)
          const maxHoleRemovalsAllowed = Math.max(1, Math.floor(currentWorld.tiles.length * 0.25));
          const actualHoleRemovals = Math.min(fillHolesDecision.removals.length, maxHoleRemovalsAllowed);
          
          if (fillHolesDecision.removals.length > maxHoleRemovalsAllowed) {
            console.log(`⚠️  Safety constraint during hole-filling: limiting removals from ${fillHolesDecision.removals.length} to ${maxHoleRemovalsAllowed} (25% max)`);
          }

          let holesRemoved = 0;
          const holeRemovalFailures: string[] = [];
          
          for (let i = 0; i < actualHoleRemovals; i++) {
            const removal = fillHolesDecision.removals[i];
            try {
              // Find and remove the tile (only check position)
              const tileIndex = currentWorld.tiles.findIndex(t => 
                t.q === removal.position.q && t.r === removal.position.r
              );
              
              if (tileIndex === -1) {
                holeRemovalFailures.push(`(${removal.position.q},${removal.position.r}) - no tile found at position`);
                continue;
              }

              // Get the tile type before removing for logging
              const removedTile = currentWorld.tiles[tileIndex];
              const removedTileType = removedTile.tile_type;

              // Remove the tile
              currentWorld.tiles.splice(tileIndex, 1);
              holesRemoved++;

              // Also remove any addons at this position
              const addonIndices = [];
              for (let j = currentWorld.addons.length - 1; j >= 0; j--) {
                if (currentWorld.addons[j].q === removal.position.q && currentWorld.addons[j].r === removal.position.r) {
                  addonIndices.push(j);
                }
              }
              addonIndices.forEach(index => currentWorld.addons.splice(index, 1));

              this.emitEvent('progress', {
                stage: 'filling_holes',
                currentStep: currentWorld.tiles.length,
                totalSteps: maxTiles,
                message: `Removed ${removedTileType} to resolve holes at (${removal.position.q}, ${removal.position.r})`,
                placedTiles: currentWorld.tiles.length,
                validationErrors: 0,
                currentWorld
              });

            } catch (error) {
              holeRemovalFailures.push(`(${removal.position.q},${removal.position.r}): ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }

          if (holeRemovalFailures.length > 0) {
            console.log(`❌ Hole-filling removal failures: ${holeRemovalFailures.join(', ')}`);
          }

          if (holesRemoved > 0) {
            console.log(`🗑️  Removed ${holesRemoved} tiles during hole-filling, world now: ${currentWorld.tiles.length}/${maxTiles}`);
          }
          
          // Apply hole-filling placements
          let holesFilled = 0;
          const fillFailures: string[] = [];
          
          for (const placement of fillHolesDecision.placements) {
            if (currentWorld.tiles.length >= maxTiles) {
              console.log(`🛑 Reached max tiles limit during hole filling`);
              break;
            }
            
            try {
              const newTile: WorldTile = {
                tile_type: placement.tileId,
                q: placement.position.q,
                r: placement.position.r,
                elevation: 0,
                rotation: placement.rotation
              };

              this.worldManager.addTile(currentWorld, newTile);
              holesFilled++;

              this.emitEvent('progress', {
                stage: 'filling_holes',
                currentStep: currentWorld.tiles.length,
                totalSteps: maxTiles,
                message: `Filled hole with ${placement.tileId} at (${placement.position.q}, ${placement.position.r})`,
                placedTiles: currentWorld.tiles.length,
                validationErrors: 0,
                currentWorld
              });

            } catch (error) {
              fillFailures.push(`${placement.tileId}@(${placement.position.q},${placement.position.r}): ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }
          
          if (fillFailures.length > 0) {
            console.log(`❌ Hole-filling failures: ${fillFailures.join(', ')}`);
          }
          
          // Apply addon placements for hole filling
          if (fillHolesDecision.addonPlacements.length > 0) {
            const fillAddonFailures = this.applyAddonPlacements(currentWorld, fillHolesDecision.addonPlacements, assetPack);
            if (fillAddonFailures.length > 0) {
              console.log(`❌ Hole-filling addon failures: ${fillAddonFailures.join(', ')}`);
            }
          }
          
          console.log(`✅ Applied ${holesRemoved} removals, filled ${holesFilled}/${fillHolesDecision.placements.length} holes, final world: ${currentWorld.tiles.length}/${maxTiles}`);
        } else {
          const reasoningMsg = fillHolesDecision?.reasoning ? ` - Reasoning: "${fillHolesDecision.reasoning}"` : '';
          console.log(`ℹ️ No holes selected by LLM for filling${reasoningMsg}`);
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
    
    const systemPrompt = this.createSystemPrompt();
    const userPrompt = this.createUserPrompt(request, currentWorld, placementOptions, assetPack, maxTiles);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    // console.log('🤖 LLM System Prompt:', systemPrompt);
    // console.log('🤖 LLM User Prompt:', userPrompt);

    try {
      const response = await this.llmProvider!.generateResponse(messages, []);
      
      if (!response.message.content) {
        return null;
      }

      // console.log('🤖 LLM Response:', response.message.content);

      // Parse LLM response
      return this.parseLLMPlacementResponse(response.message.content, placementOptions, assetPack, currentWorld);

    } catch (error) {
      console.error('Error getting LLM placement decision:', error);
      return null;
    }
  }

  /**
   * Create initial world plan using LLM
   */
  private async createWorldPlan(
    request: GenerationRequest,
    assetPack: AssetPack,
    maxTiles: number
  ): Promise<WorldPlan | null> {
    
    const systemPrompt = this.createPlanningSystemPrompt();
    const userPrompt = this.createPlanningUserPrompt(request, assetPack, maxTiles);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    // console.log('🤖 LLM Planning System Prompt:', systemPrompt);
    // console.log('🤖 LLM Planning User Prompt:', userPrompt);

    try {
      const response = await this.llmProvider!.generateResponse(messages, []);
      
      if (!response.message.content) {
        return null;
      }

      // console.log('🤖 LLM Planning Response:', response.message.content);

      // Parse LLM response
      return this.parsePlanningResponse(response.message.content, assetPack, maxTiles);

    } catch (error) {
      console.error('Error getting LLM world plan:', error);
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
    
    const systemPrompt = this.createFillHolesSystemPrompt(request, assetPack);
    const userPrompt = this.createFillHolesUserPrompt(request, currentWorld, placementOptions, unpopulatableHoles, assetPack, maxTiles);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    // console.log('🤖 LLM Fill Holes System Prompt:', systemPrompt);
    // console.log('🤖 LLM Fill Holes User Prompt:', userPrompt);

    try {
      const response = await this.llmProvider!.generateResponse(messages, []);
      
      if (!response.message.content) {
        return null;
      }

      // console.log('🤖 LLM Fill Holes Response:', response.message.content);

      // Parse LLM response
      return this.parseLLMPlacementResponse(response.message.content, placementOptions, assetPack, currentWorld);

    } catch (error) {
      console.error('Error getting LLM fill holes decision:', error);
      return null;
    }
  }

     /**
    * Create system prompt for the simplified LLM interface
    */
   private createSystemPrompt(): string {
     return `You are a 3D world generator. You generate 3D worlds based on a user description, a world generation plan, and a set of hexagonal tiles on which you can place add-ons.

TILES:
You can imagine a tile as a hexagon with a center and 6 sides.
The tiles when placed have an id, a position and a rotation.
Valid tiles provided consist of the tile id and the rotation.
The position is defined by a q and r coordinate in the hexagon grid.
The rotation is defined by an integer between 0 and 5 meaning the number of 60 degree steps around the center in clockwise direction.
For valid tiles a compact notation "tile-id:rotation" is used in the following format:
- "tile-id" is the id of the tile, e.g. "my-tile-c"
- "rotation" is the allowed rotation(s) of the tile
    - if a single rotation is allowed, it is specified as "r0", "r1", "r2", "r3", "r4" or "r5"
    - if multiple rotations are allowed, they are specified as "r0,2,4" (meaning rotations 0, 2 and 4 are allowed)
    - if all rotations are allowed, it is specified as "r*"
- so a valid tile is specified e.g. "my-tile-c:r1,5" or "my-tile-c:r*" or "my-tile-c:r3"

HEXAGONAL COORDINATE SYSTEM:
Understanding the hexagonal grid is crucial for making spatial decisions. The coordinate system uses axial coordinates (q, r):

Coordinate layout:
Imagine looking down at a hexagonal grid. The coordinates work as follows:
- q increases horizontally to the right
- r increases diagonally down-left
- The third implicit coordinate s = -q-r increases diagonally down-right

Neighbor relationships:
Every hexagon at position (q, r) has exactly 6 neighbors. The neighbors are indexed 0-5 in clockwise order:
- Edge 0 neighbor: (q, r+1) - bottom-right direction
- Edge 1 neighbor: (q-1, r+1) - bottom-left direction  
- Edge 2 neighbor: (q-1, r) - left direction
- Edge 3 neighbor: (q, r-1) - top-left direction
- Edge 4 neighbor: (q+1, r-1) - top-right direction
- Edge 5 neighbor: (q+1, r) - right direction

Edge-neighbor mapping:
Each tile has 6 edges numbered 0-5. When two tiles are adjacent:
- Tile A's edge N connects to Tile B's edge (N+3)%6
- For example: if tile at (0,0) has edge 0 facing right toward (1,0), then tile at (1,0) has edge 3 facing left toward (0,0)

Spatial examples:
If you place a tile at (0,0):
- Position (1,0) is to the RIGHT (edge 5 connection)
- Position (0,1) is to the BOTTOM-RIGHT (edge 0 connection)
- Position (-1,1) is to the BOTTOM-LEFT (edge 1 connection)
- Position (-1,0) is to the LEFT (edge 2 connection)
- Position (0,-1) is to the TOP-LEFT (edge 3 connection)
- Position (1,-1) is to the TOP-RIGHT (edge 4 connection)

Distance calculation:
The distance between two hexagons (q1,r1) and (q2,r2) is:
distance = (|q1-q2| + |q1+r1-q2-r2| + |r1-r2|) / 2

Understanding rotations:
When a tile rotates by N steps (60° each), its edge array shifts:
- Rotation 0: edges remain [e0,e1,e2,e3,e4,e5]
- Rotation 1: edges become [e5,e0,e1,e2,e3,e4] (each edge shifts one position right)
- This means what was edge 0 is now at edge 1, what was edge 1 is now at edge 2, etc.

Practical spatial reasoning:
When making placement decisions, consider:
1. Which existing tiles are neighbors of the position you're considering
2. How the edges of your chosen tile (with its rotation) will connect to neighbor edges
3. Whether multiple new tiles you place will be compatible with each other
4. The overall spatial pattern and flow of your world design
5. How the spatial layout supports the user's description (e.g., roads should connect, buildings should be accessible)

ADD-ONS:
You can imagine the add-ons as decorations that can be placed on the tiles, they are 3D objects.
The add-ons when placed have an id and a position (determining which tile they are placed on).
The position is defined by a q and r coordinate in the hexagon grid.
Valid add-ons provided consist of the add-on id.
For valid add-ons a compact notation is used in the following format:
- "tile-id: addon1, addon2" (shows which add-on(s) can be placed on specific tile type)

ASSET PACK:
The asset pack is a set of tiles and add-ons and some meta data.
Existing tiles and existing add-ons in the world, as well as valid tiles and valid add-ons in the current iteration step,
are all originating from the asset pack the user has chosen to build the world from.
The asset pack information will be provided in compact notation:
- Edge Types: "type[materials] → compatible_types" (e.g., "road[road] → road" means road edges connect to road edges)
- Tiles: "id[edge0,edge1,edge2,edge3,edge4,edge5] #tag1,tag2" (6 edges clockwise from top-right, with tags)
- Add-ons: "id(required_tile_tags) #addon_tags" (parentheses show which tile tags are required for placement)

USER DESCRIPTION:
The user description is a text that describes the world you should generate.
Follow this description as a guideline to generate the world at every iteration step.

WORLD GENERATION PLAN:
The world generation plan aims to provide a detailed plan for the world generation process.
It should provide:
- overall theme for the world
- a highly detailed description of the world which is basically an enhanced version of the user description
- ordered list of specific tasks to complete in order to build the world
- each todo item consists mainly in:
- a description of the task
- a list of suggested tiles that can be used to complete the task (not a strict list but probably worth considering)
- the order of the todo items is the order in which the tasks should be completed in order to build the world

Try to stick to this plan as much as possible when making placement decisions but keep in mind:
the plan doesn't follow edge type constraints as much, you have much more information about compatibility than the plan does
because you are provided with valid choices for each position. So even if the plan suggests something, keep that in mind
and try to follow it but you still have to choose from the valid tile choices for each position even if this means contradicting the plan.

WORLD:
A world is a set of tiles and add-ons.
Current world state will be shown using this notation:
- Existing tiles: "tile-type@(q,r):r#" (e.g., "grass-tile@(0,0):r2" means grass-tile at position q=0,r=0 with rotation 2)
- Existing add-ons: "addon-id@(q,r)" (e.g., "tree-simple@(1,0)" means tree-simple add-on at position q=1,r=0)
- Positions: "(q,r)" coordinates in the hexagonal grid system

VALID TILE OPTIONS WITH NEIGHBOR CONTEXT:
Each empty position will be shown with detailed neighbor context to help you understand connectivity:
- Position format: "Position (q,r) [neighbors: direction:tile-type[edge-type], ...]"
- Direction codes: NE=northeast, E=east, SE=southeast, SW=southwest, W=west, NW=northwest
- Edge types in brackets show what edge type each neighbor exposes toward this position
- Valid options format: "tile-id:r# (direction:neighbor_edge→tile_edge)" showing edge type connections
- Example: "Position (1,0) [neighbors: W:grass-tile[grass], SW:road-tile[road]]:"
  "  grass-corner:r2 (W:grass→grass, SW:road→road)"
  This means placing grass-corner with rotation 2 would connect via grass edge to the grass tile's grass edge to the west and via road edge to the road tile's road edge to the southwest

WORLD GENERATION PROCESS:
The world generation process is an iterative process.
At each iteration step you will be provided with:
- the user description
- any other world generation parameters the user has provided and which might influence the world generation process as constraints
- the asset pack the user has chosen to build the world from
- the current world state (tiles and add-ons)
- the world generation plan and any progress from previous iterations - use this context to guide your decisions
- a set of empty positions on which you are allowed to place tiles in the current iteration step
- for each such position a set of valid tiles that can be placed there
- for each such valid tile a set of valid add-ons that can be placed on it

At each iteration step you are allowed to:
- choose an empty position from the list where you want to place a tile
which you choose from the valid tile options for that position and optionally
you can choose a valid add-on for that position from the list
- remove a tile from a non-empty position (based on positions populated in the world)

When choosing and placing a tile you should consider the following:
- the tile should be placed on an allowed empty position
- choose a valid tile from the list of valid tiles for the chosen position including the rotation, for example:
    - positions (1, 0), (2, 0) and (-1, 1) are valid empty positions
    - you choose for example (2,0)
    - for position (2,0) the valid tiles are "my-tile-a:r0,2", "my-tile-b:r*" and "my-tile-c:r2-4"
    - this means you can choose one of the following tiles:
        - "my-tile-a" with rotation 0 or 2
        - "my-tile-b" with rotation 0, 1, 2, 3, 4 or 5
        - "my-tile-c" with rotation 2 or 4
    - if you choose for example "my-tile-b" then check which valid add-ons are available for it
    - for example "my-tile-b" has the following valid add-ons: "my-addon-01", "my-addon-02" and "my-addon-03"
    - so you can choose one of the following add-ons:
        - "my-addon-01"
        - "my-addon-02"
        - "my-addon-03"
- the choice makes sense for the world and the user description, especially pay attention
to the world generation plan and any progress from previous iterations
- also analyze the valid tiles' neighbor context to understand how they connect to the current world state,
this is super important as there might be tile types that require a certain connectivity/flow like roads or rivers for example
- a tile being a valid option means only that it is compatible with the current world state,
it does not mean that it is a good choice for the world and the user description
- a tile being a valid option means only that it is compatible with existing tiles,
so if you place multiple tiles which are adjacent to each other,
you should consider that they might not be compatible with each other
so try choosing wisely, consider the asset pack
- be creative, the goal is to generate a world that is interesting, unique and diverse while being coherent with the user description
- you can also place no tile at all in the current iteration step if you think we are done and we have fulfilled all requirements in the user description and the world generation plan
- there might be a maximum number of tiles the user wants to place, so you should consider that and choose wisely such that you don't exceed that number while still being creative and interesting and coherent with the user description fulfilling all requirements in it

When removing a tile you should consider the following:
- the tile should be removed from a non-empty position
- the choice makes sense for the world and the user description
- sometimes in earlier steps bad choices might have been made,
so you have the option to remove a tile to fix the world state,
i.e. to make it more coherent with the user description
or to relax constraints resulting in holes or no more valid options to place tiles

YOUR OUTPUT:
Your output is a JSON object following the following format:
{
    "reasoning": "explain your placement decisions and current strategy, even if you choose to place nothing",
    "todoProgress": "describe where we are in executing the world generation plan, include what you have done so far and what you are going to do next, also include some reasoning regarding neighbor connectivity (chose this tile because it connects to this and this via these edges)",
    "tiles": [
        {
            "tileId": "my-tile-c",
            "position": {"q": 2, "r": 1},
            "rotation": 0
        }
    ],
    "add-ons": [
        {
            "addonId": "my-addon-01",
            "position": {"q": 2, "r": 1}
        }
    ],
    "removals": [
        {
            "position": {"q": 1, "r": 0}
        }
    ]
}
You should ONLY output the JSON object, nothing else.`;
   }

     /**
    * Create user prompt with current world state and options
    */
   private createUserPrompt(request: GenerationRequest, currentWorld: World, placementOptions: PositionOptions[], assetPack: AssetPack, maxTiles: number): string {
     const isEmpty = currentWorld.tiles.length === 0;
     const remaining = maxTiles - currentWorld.tiles.length;
     
     // Format complete asset pack information
     const assetPackInfo = this.formatAssetPackForLLM(assetPack);
     
     // Format current world state
     const worldState = isEmpty ? 
       'Empty world - no tiles or add-ons placed yet' :
       `Tiles: ${currentWorld.tiles.map(t => `${t.tile_type}@(${t.q},${t.r}):r${t.rotation || 0}`).join(', ')}
Add-ons: ${currentWorld.addons.length > 0 ? currentWorld.addons.map(a => `${a.addon_id}@(${a.q},${a.r})`).join(', ') : 'none'}`;

     // Format empty positions
     const emptyPositions = placementOptions.map(posOpt => `(${posOpt.position.q}, ${posOpt.position.r})`).join(', ');
     
         // Format valid tiles for each position with neighbor connectivity context
    const validTilesDescription = this.formatPlacementOptionsWithNeighborContext(placementOptions, currentWorld, assetPack);

     // Format valid add-ons by unique tile types (not per position)
     const uniqueTileTypes = new Set<string>();
     placementOptions.forEach(posOption => {
       posOption.validOptions.forEach(opt => {
         uniqueTileTypes.add(opt.tileId);
       });
     });
     
     const validAddOnsDescription = Array.from(uniqueTileTypes)
       .sort()
       .map(tileId => {
         const compatibleAddons = this.getCompatibleAddons(tileId, assetPack);
         if (compatibleAddons.length > 0) {
           return `${tileId}: ${compatibleAddons.map(a => a.addonId).join(', ')}`;
         }
         return `${tileId}: none`;
       })
       .join('\n');

  // Format current world plan
  const planDescription = this.currentPlan ? 
    `Theme: ${this.currentPlan.theme}
Detailed world description: ${this.currentPlan.detailedDescription}
Todo tasks:
${this.currentPlan.todos.map((todo, i) => `${i+1}. ${todo.description}
- complete when: ${todo.completionCriteria}
- suggested tiles: ${todo.suggestedTiles?.join(', ')}`).join('\n')}
${this.lastTodoProgress ? `\nLast iteration progress: ${this.lastTodoProgress}` : ''}` : 
    'No world generation plan available - use your best judgment for placement decisions.';

     return `ITERATION STEP:
Now let's do the next iteration step.

The user description is:
${request.description}

The world generation plan is:
${planDescription}

The world generation parameters the user has provided and which might influence the world generation process as constraints are:
Maximum tiles: ${maxTiles} (${remaining} remaining)

The asset pack we are using is:
${assetPackInfo}

The current world state is:
${worldState}

Empty positions you can choose to place a tile on:
${emptyPositions}

Valid tiles for each of the above empty positions:
${validTilesDescription}

Valid add-ons for each of the above valid tiles:
${validAddOnsDescription}

Please output your JSON object now.`;
  }

  /**
   * Create system prompt for hole-filling
   */
  private createFillHolesSystemPrompt(request: GenerationRequest, assetPack: AssetPack): string {
    return `You are a 3D world generator specialized in filling interior holes. You generate 3D worlds based on a user description and a set of hexagonal tiles on which you can place add-ons.

TILES:
You can imagine a tile as a hexagon with a center and 6 sides.
The tiles when placed have an id, a position and a rotation.
Valid tiles provided consist of the tile id and the rotation.
The position is defined by a q and r coordinate in the hexagon grid.
The rotation is defined by an integer between 0 and 5 meaning the number of 60 degree steps around the center in clockwise direction.
For valid tiles a compact notation "tile-id:rotation" is used in the following format:
- "tile-id" is the id of the tile, e.g. "my-tile-c"
- "rotation" is the allowed rotation(s) of the tile
    - if a single rotation is allowed, it is specified as "r0", "r1", "r2", "r3", "r4" or "r5"
    - if multiple rotations are allowed, they are specified as "r0,2,4" (meaning rotations 0, 2 and 4 are allowed)
    - if all rotations are allowed, it is specified as "r*"
- so a valid tile is specified e.g. "my-tile-c:r1,5" or "my-tile-c:r*" or "my-tile-c:r3"

HEXAGONAL COORDINATE SYSTEM:
Understanding the hexagonal grid is crucial for making spatial decisions. The coordinate system uses axial coordinates (q, r):

Coordinate layout:
Imagine looking down at a hexagonal grid. The coordinates work as follows:
- q increases horizontally to the right
- r increases diagonally down-left
- The third implicit coordinate s = -q-r increases diagonally down-right

Neighbor relationships:
Every hexagon at position (q, r) has exactly 6 neighbors. The neighbors are indexed 0-5 in clockwise order:
- Edge 0 neighbor: (q, r+1) - bottom-right direction
- Edge 1 neighbor: (q-1, r+1) - bottom-left direction  
- Edge 2 neighbor: (q-1, r) - left direction
- Edge 3 neighbor: (q, r-1) - top-left direction
- Edge 4 neighbor: (q+1, r-1) - top-right direction
- Edge 5 neighbor: (q+1, r) - right direction

Edge-neighbor mapping:
Each tile has 6 edges numbered 0-5. When two tiles are adjacent:
- Tile A's edge N connects to Tile B's edge (N+3)%6
- For example: if tile at (0,0) has edge 0 facing right toward (1,0), then tile at (1,0) has edge 3 facing left toward (0,0)

Spatial examples:
If you place a tile at (0,0):
- Position (1,0) is to the RIGHT (edge 5 connection)
- Position (0,1) is to the BOTTOM-RIGHT (edge 0 connection)
- Position (-1,1) is to the BOTTOM-LEFT (edge 1 connection)
- Position (-1,0) is to the LEFT (edge 2 connection)
- Position (0,-1) is to the TOP-LEFT (edge 3 connection)
- Position (1,-1) is to the TOP-RIGHT (edge 4 connection)

Distance calculation:
The distance between two hexagons (q1,r1) and (q2,r2) is:
distance = (|q1-q2| + |q1+r1-q2-r2| + |r1-r2|) / 2

Understanding rotations:
When a tile rotates by N steps (60° each), its edge array shifts:
- Rotation 0: edges remain [e0,e1,e2,e3,e4,e5]
- Rotation 1: edges become [e5,e0,e1,e2,e3,e4] (each edge shifts one position right)
- This means what was edge 0 is now at edge 1, what was edge 1 is now at edge 2, etc.

Practical spatial reasoning for hole filling:
When filling holes, consider:
1. Which existing tiles surround the hole (4+ neighbors)
2. How the edges of your chosen tile (with its rotation) will connect to ALL surrounding neighbor edges
3. Whether filling this hole improves connectivity and visual flow
4. How the filled hole contributes to the overall spatial pattern and theme

ADD-ONS:
You can imagine the add-ons as decorations that can be placed on the tiles, they are 3D objects.
The add-ons when placed have an id and a position (determining which tile they are placed on).
The position is defined by a q and r coordinate in the hexagon grid.
Valid add-ons provided consist of the add-on id.
For valid add-ons a compact notation is used in the following format:
- "tile-id: addon1, addon2" (shows which add-on(s) can be placed on specific tile type)

ASSET PACK:
The asset pack is a set of tiles and add-ons and some meta data.
Existing tiles and existing add-ons in the world, as well as valid tiles and valid add-ons in the current iteration step,
are all originating from the asset pack the user has chosen to build the world from.
The asset pack information will be provided in compact notation:
- Edge Types: "type[materials] → compatible_types" (e.g., "road[road] → road" means road edges connect to road edges)
- Tiles: "id[edge0,edge1,edge2,edge3,edge4,edge5] #tag1,tag2" (6 edges clockwise from top-right, with tags)
- Add-ons: "id(required_tile_tags) #addon_tags" (parentheses show which tile tags are required for placement)

USER DESCRIPTION:
The user description is a text that describes the world you should generate.
Follow this description as a guideline to generate the world at every iteration step.

WORLD:
A world is a set of tiles and add-ons.
Current world state will be shown using this notation:
- Existing tiles: "tile-type@(q,r):r#" (e.g., "grass-tile@(0,0):r2" means grass-tile at position q=0,r=0 with rotation 2)
- Existing add-ons: "addon-id@(q,r)" (e.g., "tree-simple@(1,0)" means tree-simple add-on at position q=1,r=0)
- Positions: "(q,r)" coordinates in the hexagonal grid system

VALID TILE OPTIONS WITH NEIGHBOR CONTEXT:
Each interior hole position will be shown with detailed neighbor context to help you understand connectivity:
- Position format: "Position (q,r) [neighbors: direction:tile-type[edge-type], ...]"
- Direction codes: NE=northeast, E=east, SE=southeast, SW=southwest, W=west, NW=northwest
- Edge types in brackets show what edge type each neighbor exposes toward this position
- Valid options format: "tile-id:r# (direction:neighbor_edge→tile_edge)" showing edge type connections
- Since these are holes with 4+ neighbors, you'll see multiple surrounding tiles to connect with

HOLE FILLING PROCESS:
This is a specialized phase of world generation focused on filling interior holes (positions with 4+ neighbors).
At this step you will be provided with:
- the user description
- any other world generation parameters the user has provided and which might influence the world generation process as constraints
- the asset pack the user has chosen to build the world from
- the current world state (tiles and add-ons)
- the world generation plan and any progress from previous iterations - use this context to guide your decisions
- a set of interior hole positions (positions with 4+ neighbors) on which you are allowed to place tiles
- for each such position a set of valid tiles that can be placed there
- for each such valid tile a set of valid add-ons that can be placed on it
- positions that are impossible to fill due to edge constraints

At this step you are allowed to:
- place a tile on an allowed interior hole position optionally with a valid add-on on it
- remove a tile from a non-empty position to resolve impossible holes or improve the world design

When choosing and placing a tile in holes you should consider the following:
- the tile should be placed on an allowed interior hole position
- the choice makes sense for the world and the user description
- focus on filling holes that improve connectivity and coherence
- a tile being a valid option means only that it is compatible with the current world state,
it does not mean that it is a good choice for the world and the user description
- a tile being a valid option means only that it is compatible with existing tiles,
so if you place multiple tiles which are adjacent to each other,
you should consider that they might not be compatible with each other
so try choosing wisely, consider the asset pack
- be creative, the goal is to generate a world that is interesting, unique and diverse while being coherent with the user description
- prioritize holes that create better visual composition and thematic coherence
- avoid creating monotonous patterns (like same tile type only) unless specifically required by the description

When removing a tile you should consider the following:
- the tile should be removed from a non-empty position
- the choice makes sense for the world and the user description
- remove tiles near impossible holes to create new placement opportunities
- remove tiles that break thematic coherence or create visual clutter
- sometimes in earlier steps bad choices might have been made,
so you have the option to remove a tile to fix the world state,
i.e. to make it more coherent with the user description
or to relax constraints resulting in impossible holes

YOUR OUTPUT:
Your output is a JSON object following the following format:
{
    "reasoning": "explain your hole-filling decisions and strategy, even if you choose to place nothing",
    "tiles": [
        {
            "tileId": "my-tile-c",
            "position": {"q": 2, "r": 1},
            "rotation": 0
        }
    ],
    "add-ons": [
        {
            "addonId": "my-addon-01",
            "position": {"q": 2, "r": 1}
        }
    ],
    "removals": [
        {
            "position": {"q": 1, "r": 0}
        }
    ]
}
You should ONLY output the JSON object, nothing else.`;
  }

  /**
   * Create user prompt for hole-filling
   */
  private createFillHolesUserPrompt(request: GenerationRequest, currentWorld: World, placementOptions: PositionOptions[], unpopulatableHoles: PositionOptions[], assetPack: AssetPack, maxTiles: number): string {
    const remaining = maxTiles - currentWorld.tiles.length;
    
         // Format complete asset pack information
     const assetPackInfo = this.formatAssetPackForLLM(assetPack);
    
    // Format current world state
    const worldState = `Tiles: ${currentWorld.tiles.map(t => `${t.tile_type}@(${t.q},${t.r}):r${t.rotation || 0}`).join(', ')}
Add-ons: ${currentWorld.addons.length > 0 ? currentWorld.addons.map(a => `${a.addon_id}@(${a.q},${a.r})`).join(', ') : 'none'}

IMPOSSIBLE HOLES (no valid tiles due to edge constraints): ${unpopulatableHoles.length > 0 ? unpopulatableHoles.map(hole => `(${hole.position.q},${hole.position.r})`).join(', ') : 'none'}
${unpopulatableHoles.length > 0 ? `Consider removing nearby tiles: ${currentWorld.tiles.filter(t => unpopulatableHoles.some(hole => Math.abs(t.q - hole.position.q) + Math.abs(t.r - hole.position.r) <= 2)).map(t => `${t.tile_type}@(${t.q},${t.r})`).join(', ')}` : ''}`;

    // Format interior hole positions
    const interiorHolePositions = placementOptions.map(posOpt => `(${posOpt.position.q}, ${posOpt.position.r})`).join(', ');
    
    // Format valid tiles for each hole position with neighbor connectivity context
    const validTilesDescription = this.formatPlacementOptionsWithNeighborContext(placementOptions, currentWorld, assetPack);

         // Format valid add-ons by unique tile types (not per position)
     const uniqueTileTypes = new Set<string>();
     placementOptions.forEach(posOption => {
       posOption.validOptions.forEach(opt => {
         uniqueTileTypes.add(opt.tileId);
       });
     });
     
     const validAddOnsDescription = Array.from(uniqueTileTypes)
       .sort()
       .map(tileId => {
         const compatibleAddons = this.getCompatibleAddons(tileId, assetPack);
         if (compatibleAddons.length > 0) {
           return `${tileId}: ${compatibleAddons.map(a => a.addonId).join(', ')}`;
         }
         return `${tileId}: none`;
       })
       .join('\n');

    // Format current world plan as simple guidance
    const planDescription = this.currentPlan ? 
      `Theme: ${this.currentPlan.theme}
Detailed world description: ${this.currentPlan.detailedDescription}
Todo tasks:
${this.currentPlan.todos.map((todo, i) => `${i+1}. ${todo.description}`).join('\n')}
${this.lastTodoProgress ? `\nLast iteration progress: ${this.lastTodoProgress}` : ''}
` : 
      'No world generation plan available - use your best judgment for placement decisions.';

    return `HOLE FILLING ITERATION STEP:
Now let's do the hole filling iteration step to fill interior holes in the world.

The user description is:
${request.description}

The world generation plan is:
${planDescription}

The world generation parameters the user has provided and which might influence the world generation process as constraints are:
Maximum tiles: ${maxTiles} (${remaining} remaining)

The asset pack we are using is:
${assetPackInfo}

The current world state is:
${worldState}

Valid positions (interior holes with 4+ neighbors):
${interiorHolePositions}

Valid tiles:
${validTilesDescription}

Valid add-ons:
${validAddOnsDescription}

Please output your JSON object now.`;
  }
   
     /**
   * Format placement options with detailed neighbor connectivity context
   */
  private formatPlacementOptionsWithNeighborContext(
    placementOptions: PositionOptions[], 
    currentWorld: World, 
    assetPack: AssetPack
  ): string {
    return placementOptions.map((posOption, i) => {
      const pos = posOption.position;
      
      // Show neighbor context - what tiles surround this position
      const neighborContext = this.getNeighborContextForPosition(pos, currentWorld, assetPack);
      
      // Format each valid option with its specific edge connectivity
      const optionDetails = posOption.validOptions.map(option => {
        // Get edge connectivity details for this tile option
        const edgeConnections = this.getEdgeConnectivityForOption(pos, option, currentWorld, assetPack);
        const connectivityInfo = edgeConnections.length > 0 ? ` (${edgeConnections.join(', ')})` : '';
        return `${option.tileId}:r${option.rotation}${connectivityInfo}`;
      }).join(', ');
      
      return `Position (${pos.q}, ${pos.r}) ${neighborContext}:\n  ${optionDetails}`;
    }).join('\n\n');
  }

  /**
   * Get neighbor context for a position - what tiles surround it and from which directions
   */
  private getNeighborContextForPosition(
    position: { q: number; r: number }, 
    currentWorld: World, 
    assetPack: AssetPack
  ): string {
    const neighbors = HexCoordinates.getNeighbors(position);
    const directions = ['NE', 'E', 'SE', 'SW', 'W', 'NW']; // Clockwise from top-right
    
    const neighborInfo: string[] = [];
    
    for (let i = 0; i < neighbors.length; i++) {
      const neighbor = neighbors[i];
      const existingTile = currentWorld.tiles.find(t => t.q === neighbor.q && t.r === neighbor.r);
      
      if (existingTile) {
        // Get the edge type that this neighbor exposes toward our position
        const neighborEdgeIndex = (i + 3) % 6; // Opposite edge
        const tileDefinition = assetPack.tiles.find(t => t.id === existingTile.tile_type);
        
        if (tileDefinition) {
          // Apply rotation to get actual edge
          const rotatedEdgeIndex = (neighborEdgeIndex - (existingTile.rotation || 0) + 6) % 6;
          const edgeType = tileDefinition.edges[rotatedEdgeIndex];
          neighborInfo.push(`${directions[i]}:${existingTile.tile_type}[${edgeType}]`);
        } else {
          neighborInfo.push(`${directions[i]}:${existingTile.tile_type}`);
        }
      }
    }
    
    return neighborInfo.length > 0 ? `[neighbors: ${neighborInfo.join(', ')}]` : '[no neighbors]';
  }

  /**
   * Get edge type connectivity information for a specific tile option at a position
   */
  private getEdgeConnectivityForOption(
    position: { q: number; r: number },
    option: PlacementOption,
    currentWorld: World,
    assetPack: AssetPack
  ): string[] {
    const connections: string[] = [];
    const neighbors = HexCoordinates.getNeighbors(position);
    const directions = ['NE', 'E', 'SE', 'SW', 'W', 'NW']; // Clockwise from top-right
    
    // Get the tile definition for this option
    const tileDefinition = assetPack.tiles.find(t => t.id === option.tileId);
    if (!tileDefinition) {
      return connections;
    }
    
    for (let i = 0; i < neighbors.length; i++) {
      const neighbor = neighbors[i];
      const existingTile = currentWorld.tiles.find(t => t.q === neighbor.q && t.r === neighbor.r);
      
      if (existingTile) {
        // Get the edge type that this neighbor exposes toward our position
        const neighborTileDefinition = assetPack.tiles.find(t => t.id === existingTile.tile_type);
        if (!neighborTileDefinition) continue;
        
        // Calculate neighbor's edge index that faces our position
        const neighborEdgeIndex = (i + 3) % 6; // Opposite edge
        const neighborRotatedEdgeIndex = (neighborEdgeIndex - (existingTile.rotation || 0) + 6) % 6;
        const neighborEdgeType = neighborTileDefinition.edges[neighborRotatedEdgeIndex];
        
        // Calculate our tile's edge index that faces this neighbor
        const ourEdgeIndex = i;
        const ourRotatedEdgeIndex = (ourEdgeIndex - option.rotation + 6) % 6;
        const ourEdgeType = tileDefinition.edges[ourRotatedEdgeIndex];
        
        // Format the connection: direction:neighbor_edge→our_edge
        connections.push(`${directions[i]}:${neighborEdgeType}→${ourEdgeType}`);
      }
    }
    
    return connections;
  }

  /**
   * Format complete asset pack information for LLM in compact notation
   */
  private formatAssetPackForLLM(assetPack: AssetPack): string {
    // Format edge types
    const edgeTypesInfo = Object.entries(assetPack.edge_types)
      .map(([id, edgeType]) => {
        const compatible = edgeType.compatible_with ? ` → ${edgeType.compatible_with.join(',')}` : '';
        return `${id}[${edgeType.materials.join(',')}]${compatible}`;
      })
      .join(', ');

    // Format tiles with compact edge and tag info
    const tilesInfo = assetPack.tiles
      .map(tile => {
        const edges = tile.edges.join(',');
        const tags = tile.tags.length > 0 ? ` #${tile.tags.join(',')}` : '';
        return `${tile.id}[${edges}]${tags}`;
      })
      .join(', ');

    // Format add-ons with placement requirements
    const addonsInfo = assetPack.addons
      .map(addon => {
        const tileTags = addon.placement.tile_tags.join(',');
        const addonTags = addon.tags.length > 0 ? ` #${addon.tags.join(',')}` : '';
        return `${addon.id}(${tileTags})${addonTags}`;
      })
      .join(', ');

    return `Asset Pack: ${assetPack.id} v${assetPack.version}
Materials: ${assetPack.materials.join(', ')}
Edge Types: ${edgeTypesInfo}
Tiles: ${tilesInfo}
Add-ons: ${addonsInfo}`;
  }

  /**
   * Create compact notation for all tile options (e.g. "hex-grass:r0-5, road-junction-d:r0,2,4")
   */
  private compactOptionsNotation(options: PlacementOption[]): string {
    // Group by tile ID
    const byTileId = new Map<string, number[]>();
    options.forEach(opt => {
      if (!byTileId.has(opt.tileId)) {
        byTileId.set(opt.tileId, []);
      }
      byTileId.get(opt.tileId)!.push(opt.rotation);
    });

    // Create compact notation for each tile
    const compactTiles = Array.from(byTileId.entries()).map(([tileId, rotations]) => {
      const sortedRotations = [...new Set(rotations)].sort((a, b) => a - b);
      
      // Check if it's a complete sequence (0,1,2,3,4,5)
      if (sortedRotations.length === 6 && sortedRotations.every((r, i) => r === i)) {
        return `${tileId}:r*`;
      }
      
      // Check if it's a contiguous range
      let isContiguous = true;
      for (let i = 1; i < sortedRotations.length; i++) {
        if (sortedRotations[i] !== sortedRotations[i-1] + 1) {
          isContiguous = false;
          break;
        }
      }
      
      if (isContiguous && sortedRotations.length > 2) {
        return `${tileId}:r${sortedRotations[0]}-${sortedRotations[sortedRotations.length - 1]}`;
      }
      
      // Otherwise list individual rotations
      return `${tileId}:r${sortedRotations.join(',')}`;
    });

    return compactTiles.join(', ');
  }

  /**
   * Parse LLM response into placement decisions
   */
  private parseLLMPlacementResponse(response: string, placementOptions: PositionOptions[], assetPack: AssetPack, currentWorld: World): LLMPlacementDecision | null {
          try {
        // Try to extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.log('❌ No JSON found in LLM response');
          return null;
        }

        const parsed = JSON.parse(jsonMatch[0]);
      
      // Handle both old format (placements) and new format (tiles)
      const placementsArray = parsed.tiles || parsed.placements || [];
      
      if (!Array.isArray(placementsArray)) {
        console.warn('Invalid tiles/placements in LLM response');
        return null;
      }

      // Validate each placement against available options
      const validPlacements: TilePlacement[] = [];
      
      const invalidChoices: string[] = [];
      
      // First pass: validate against available options
      const candidatePlacements: TilePlacement[] = [];
      
      for (const placement of placementsArray) {
        if (!placement.position || !placement.tileId || placement.rotation === undefined) {
          invalidChoices.push(`${placement.tileId || 'unknown'}@(${placement.position?.q},${placement.position?.r}) - missing fields`);
          continue;
        }

        // Find the position option
        const posOption = placementOptions.find(opt => 
          opt.position.q === placement.position.q && opt.position.r === placement.position.r
        );

        if (!posOption) {
          invalidChoices.push(`${placement.tileId}@(${placement.position.q},${placement.position.r}) - position not available`);
          continue;
        }

        // Check if the tile+rotation is valid (use loose equality for rotation to handle string/number conversion)
        const validOption = posOption.validOptions.find(opt => 
          opt.tileId === placement.tileId && opt.rotation == placement.rotation
        );

        if (!validOption) {
          invalidChoices.push(`${placement.tileId}@(${placement.position.q},${placement.position.r}):r${placement.rotation} - rotation not available`);
          continue;
        }

        candidatePlacements.push(placement);
      }

      // Second pass: resolve inter-placement conflicts
      // Always run conflict resolution to ensure no invalid edges between new tiles
      const resolvedPlacements = this.resolveInterPlacementConflicts(candidatePlacements, assetPack);
      
      if (resolvedPlacements.length < candidatePlacements.length) {
        console.log(`🔧 Conflict resolution: ${candidatePlacements.length} → ${resolvedPlacements.length} tiles (removed ${candidatePlacements.length - resolvedPlacements.length} conflicting)`);
      }
      
      // Only override reasoning if conflict resolution actually removed tiles
      if (resolvedPlacements.length === 0 && candidatePlacements.length > 0) {
        return {
          placements: [],
          removals: [],
          addonPlacements: [],
          reasoning: 'All tiles had irresolvable inter-placement conflicts'
        };
      }
      
      validPlacements.push(...resolvedPlacements);
      
      if (invalidChoices.length > 0) {
        console.log(`❌ Invalid LLM choices filtered: ${invalidChoices.join(', ')}`);
        console.log(`💡 Full options available to LLM:`);
        placementOptions.forEach(posOpt => {
          const compact = this.compactOptionsNotation(posOpt.validOptions);
          console.log(`   Position (${posOpt.position.q}, ${posOpt.position.r}): ${compact}`);
        });
      }

      // Parse addon placements - handle both old format (addonPlacements) and new format (add-ons)
      const validAddonPlacements: AddOnPlacement[] = [];
      const addonPlacementsArray = parsed["add-ons"] || parsed.addonPlacements || [];
      if (Array.isArray(addonPlacementsArray)) {
        for (const addonPlacement of addonPlacementsArray) {
          if (!addonPlacement.position || !addonPlacement.addonId) {
            invalidChoices.push(`${addonPlacement.addonId || 'unknown'}@(${addonPlacement.position?.q},${addonPlacement.position?.r}) - missing addon fields`);
            continue;
          }

          // Check if the position has a tile placed in this iteration
          const tileAtPosition = validPlacements.find(p => 
            p.position.q === addonPlacement.position.q && p.position.r === addonPlacement.position.r
          );

          if (!tileAtPosition) {
            // Check if there's an existing tile at this position
            const existingTile = currentWorld.tiles.find((t: WorldTile) => 
              t.q === addonPlacement.position.q && t.r === addonPlacement.position.r
            );
            if (!existingTile) {
              invalidChoices.push(`${addonPlacement.addonId}@(${addonPlacement.position.q},${addonPlacement.position.r}) - no tile at position`);
              continue;
            }
          }

          // Check if addon is valid in asset pack
          const addonDefinition = assetPack.addons.find(a => a.id === addonPlacement.addonId);
          if (!addonDefinition) {
            invalidChoices.push(`${addonPlacement.addonId}@(${addonPlacement.position.q},${addonPlacement.position.r}) - addon not found in asset pack`);
            continue;
          }

          validAddonPlacements.push(addonPlacement);
        }
      }

      // Parse removals
      const validRemovals: TileRemoval[] = [];
      if (parsed.removals && Array.isArray(parsed.removals)) {
        for (const removal of parsed.removals) {
          if (!removal.position) {
            invalidChoices.push(`removal at (${removal.position?.q},${removal.position?.r}) - missing position`);
            continue;
          }

          // Check if there's actually a tile at this position to remove
          const existingTile = currentWorld.tiles.find(t => 
            t.q === removal.position.q && t.r === removal.position.r
          );

          if (!existingTile) {
            invalidChoices.push(`removal at (${removal.position.q},${removal.position.r}) - no tile found at position`);
            continue;
          }

          validRemovals.push(removal);
        }
      }

      return {
        placements: validPlacements,
        removals: validRemovals,
        addonPlacements: validAddonPlacements,
        reasoning: parsed.reasoning || 'No reasoning provided',
        todoProgress: parsed.todoProgress || null
      };

    } catch (error) {
      console.error('Error parsing LLM response:', error);
      return null;
    }
  }

          /**
   * Create system prompt for planning
   */
  private createPlanningSystemPrompt(): string {
    return `You are a 3D world planner. You create a so called world generation plan based on a user description, available hexagonal tiles and available add-ons which can be placed on tiles.


TILES:
You can imagine a tile as a hexagon with a center and 6 sides (edges).
Each of the edges has and edge type.
The edge types are defined by a set of materials they consist of.
For each tile in the asset the edge types are listed in clockwise order starting from the top-right edge.
When placing two tiles adjacent to each other, the edges types of the tiles must be compatible.
Tiles can be rotated to achieve edge type compatibility by a number of 60 degree steps around the center in clockwise direction (0-5 steps).

ADD-ONS:
You can imagine the add-ons as decorations that can be placed on the tiles, they are 3D objects.
Not all tiles can have all add-ons placed on them, this issue is handled by tags. Each tile has tags
and each add on has a list of allowed tags to choose the tile to place it on.

HEXAGONAL COORDINATE SYSTEM:
Understanding the hexagonal grid is crucial for planning spatial layouts. The coordinate system uses axial coordinates (q, r):

Coordinate layout:
Imagine looking down at a hexagonal grid. The coordinates work as follows:
- q increases horizontally to the right
- r increases diagonally down-left
- The third implicit coordinate s = -q-r increases diagonally down-right

Neighbor relationships:
Every hexagon at position (q, r) has exactly 6 neighbors. The neighbors are indexed 0-5 in clockwise order:
- Edge 0 neighbor: (q, r+1) - bottom-right direction
- Edge 1 neighbor: (q-1, r+1) - bottom-left direction  
- Edge 2 neighbor: (q-1, r) - left direction
- Edge 3 neighbor: (q, r-1) - top-left direction
- Edge 4 neighbor: (q+1, r-1) - top-right direction
- Edge 5 neighbor: (q+1, r) - right direction

Spatial examples:
If you place a tile at (0,0):
- Position (1,0) is to the RIGHT
- Position (0,1) is to the BOTTOM-RIGHT
- Position (-1,1) is to the BOTTOM-LEFT
- Position (-1,0) is to the LEFT
- Position (0,-1) is to the TOP-LEFT
- Position (1,-1) is to the TOP-RIGHT

Distance calculation:
The distance between two hexagons (q1,r1) and (q2,r2) is:
distance = (|q1-q2| + |q1+r1-q2-r2| + |r1-r2|) / 2

Planning considerations:
When creating your plan, consider:
1. How different areas connect spatially (roads, paths, access routes)
2. Logical spatial grouping (buildings near roads, decorative elements in appropriate areas)
3. The world grows from center (0,0) outward to adjacent positions
4. Edge compatibility constraints between adjacent tiles
5. How the spatial layout supports the user's description and intended flow

ASSET PACK:
The asset pack is a set of tiles and add-ons and some meta data.
The asset pack to build the world from is chosen by the user.

USER DESCRIPTION:
The user description is a text that describes the world you should plan.
You should always follow this description as a guideline to plan the world.

WORLD GENERATION PLAN:
The world generation plan you have to create aims to provide a detailed plan for the world generation process.
It should provide:
- overall theme for the world
- a highly detailed description of the world which is basically an enhanced version of the user description
- ordered list of specific tasks to complete in order to build the world
- each todo item consists mainly in:
    - a description of the task
    - a list of suggested tiles that can be used to complete the task
- the order of the todo items is the order in which the tasks should be completed in order to build the world

WORLD:
A world is a set of tiles and add-ons including information where to place which tile on a hexagonal grid.

WORLD GENERATION PROCESS:
So you understand what the plan is needed for, here is a detailed description of the world generation process.
The world generation process is an iterative process.
At each iteration step an LLM will be provided with:
- the user description
- any other world generation parameters the user has provided and which might influence the world generation process as constraints
- the asset pack the user has chosen to build the world from
- the current world state (tiles and add-ons)
- the world generation plan
- a set of empty positions on which the LLM is allowed to place tiles in the current iteration step
- for each such position a set of valid tiles that can be placed there
- for each such valid tile a set of valid add-ons that can be placed on it

At each iteration step the LLM is allowed to:
- place a tile on an allowed empty position optionally with a valid add-on on it
- remove a tile from a non-empty position (based on positions populated in the world)

When choosing and placing a tile the LLM should consider the following:
- the tile should be placed on an allowed empty position
- the choice makes sense for the world and the user description
- a tile being a valid option means only that it is compatible with the current world state,
it does not mean that it is a good choice for the world and the user description
- a tile being a valid option means only that it is compatible with existing tiles,
so if the LLM places multiple tiles which are adjacent to each other,
it should consider that they might not be compatible with each other
so try choosing wisely, consider the asset pack
- be creative, the goal is to generate a world that is interesting, unique and diverse while being coherent with the user description
- continue placing tiles until a satisfying, complete world that matches the user's intent is created
- if the planned features aren't working with available tiles, adapt and find creative alternatives
- the plan is guidance - use critical thinking to make the best world possible with what's available
- there might be a maximum number of tiles the user wants to place, so the LLM should consider that
and choose wisely such that it doesn't exceed that number while still being creative
and interesting and coherent with the user description fulfilling all requirements in it

When removing a tile the LLM should consider the following:
- the tile should be removed from a non-empty position
- the choice makes sense for the world and the user description
- sometimes in earlier steps bad choices might have been made,
so the LLM has the option to remove a tile to fix the world state,
i.e. to make it more coherent with the user description
or to relax constraints resulting in holes or no more valid options to place tiles


WHAT TO CONSIDER WHEN CREATING THE PLAN:
- the to do list should be helpful for the LLM to create the world during the generation process, as described above
- the world the plan conceptualizes should be coherent with the user description
and it should be possible to create it with the available tiles and add-ons
- especially the edge compatibility constraints should be considered,
so include only features in the plan that are compatible with the edge compatibility constraints,
otherwise the LLM will not be able to create the world during the generation process and will get stuck
- considering the edge compatibility constraints also means that you have to analyze available tiles
to see if two tiles can be placed next to each other at all before you include something in the plan that is not possible
- the plan should be detailed enough to be helpful for the LLM to create the world during the generation process,
but not too specific to be overwhelming and too much restrictive
- the generation process is iterative, it will start at position (0,0) on the hexagonal grid
and at every iteration step the LLM will be provided with a set of empty positions
on which it is allowed to place tiles in the current iteration step, these will be empty positions
which are adjacent to already placed tiles, so the plan should consider that the world grows from the center outwards
(not super regular in detail but on a higher level it is definitely true)
- the order of the todo items is the order in which the tasks should be completed in order to build the world,
so consider that when planning the tasks to avoid impossible worlds

YOUR OUTPUT:
Your output is a JSON object following the following format:
{
    "theme": "string",
    "detailedDescription": "string",
    "todos": [
        {
            "id": "string",
            "description": "string",
            "status": "pending",
            "suggestedTiles": ["string"],
            "completionCriteria": "string"
        }
    ],
    "reasoning": "string"
}

You should ONLY output the JSON object, nothing else.


PLANNING:
Now let's create a strategic world generation plan based on the user description and available asset pack.
Don't forget to analyze the available tiles and their edge compatibility to create a realistic plan.
Especially if you suggest tiles to place, consider what tiles can be placed next to each other at all.`;
  }

  /**
   * Create user prompt for planning
   */
  private createPlanningUserPrompt(request: GenerationRequest, assetPack: AssetPack, maxTiles: number): string {
    
    return `The user description is:
${request.description}

The world generation parameters:
Maximum tiles: ${maxTiles}

The asset pack to work with is:
Name: ${assetPack.id}

The available tiles are:
${assetPack.tiles.map(tile => {
      const edges = tile.edges.join(',');
      const tags = tile.tags.length > 0 ? ` #${tile.tags.join(',')}` : '';
      return `${tile.id}[${edges}]${tags}`;
    }).join(', ')} // in compact notation like "tile-id[edge0,edge1,edge2,edge3,edge4,edge5] #tag1,tag2"

The available add-ons are:
${assetPack.addons.map(addon => {
      const tileTags = addon.placement.tile_tags.join(',');
      const addonTags = addon.tags.length > 0 ? ` #${addon.tags.join(',')}` : '';
      return `${addon.id}(${tileTags})${addonTags}`;
    }).join(', ')} // in compact notation like "addon-id(required_tile_tags) #addon_tags"`;
  }

     /**
    * Parse LLM response into world plan
    */
   private parsePlanningResponse(response: string, assetPack: AssetPack, maxTiles: number): WorldPlan | null {
     try {
       // Try to extract JSON from response (handle markdown code blocks)
       const jsonMatch = response.match(/\{[\s\S]*\}/);
       if (!jsonMatch) {
         console.log('❌ No JSON found in LLM planning response');
         return null;
       }

       const parsed = JSON.parse(jsonMatch[0]);

            // Validate required fields
      if (typeof parsed.theme !== 'string' || typeof parsed.detailedDescription !== 'string' || !Array.isArray(parsed.todos) || parsed.todos.length === 0) {
        console.log('❌ Invalid world plan JSON: missing required fields (theme, detailedDescription, todos)');
        return null;
      }

      // Validate todos
      for (const todo of parsed.todos) {
        if (typeof todo.id !== 'string' || typeof todo.description !== 'string' || typeof todo.completionCriteria !== 'string') {
          console.log('❌ Invalid todo in world plan JSON: missing id, description, or completionCriteria');
          return null;
        }
        if (todo.suggestedTiles && !Array.isArray(todo.suggestedTiles)) {
          console.log('❌ Invalid suggestedTiles in todo');
          return null;
        }
        
        // Status is optional - set default if not provided
        if (!todo.status) {
          todo.status = 'pending';
        }
      }

      if (typeof parsed.reasoning !== 'string') {
        console.log('❌ Invalid reasoning in world plan JSON');
        return null;
      }

      return {
        theme: parsed.theme,
        detailedDescription: parsed.detailedDescription,
        todos: parsed.todos,
        reasoning: parsed.reasoning
      };

    } catch (error) {
      console.error('Error parsing LLM world plan response:', error);
      return null;
    }
  }

  /**
   * Resolve inter-placement conflicts by finding the maximum set of non-conflicting tiles
   * Uses a greedy approach: repeatedly remove the tile with most conflicts until no conflicts remain
   */
  private resolveInterPlacementConflicts(candidatePlacements: TilePlacement[], assetPack: AssetPack): TilePlacement[] {
    if (candidatePlacements.length <= 1) {
      return candidatePlacements; // No conflicts possible
    }

    // Build conflict graph: map each placement to its conflicting placements
    const conflictGraph = new Map<number, Set<number>>();
    const edgeValidator = new EdgeValidator(this.assetPackManager);

    // Initialize conflict sets
    for (let i = 0; i < candidatePlacements.length; i++) {
      conflictGraph.set(i, new Set<number>());
    }

    // Find all conflicts between adjacent placements
    for (let i = 0; i < candidatePlacements.length; i++) {
      const placementA = candidatePlacements[i];
      
      for (let j = i + 1; j < candidatePlacements.length; j++) {
        const placementB = candidatePlacements[j];
        
        // Check if these two placements are adjacent
        const edgeToB = HexCoordinates.getEdgeToNeighbor(placementA.position, placementB.position);
        
        if (edgeToB !== -1) {
          // Create WorldTile objects for validation
          const tileA: WorldTile = {
            tile_type: placementA.tileId,
            q: placementA.position.q,
            r: placementA.position.r,
            elevation: 0,
            rotation: placementA.rotation
          };
          
          const tileB: WorldTile = {
            tile_type: placementB.tileId,
            q: placementB.position.q,
            r: placementB.position.r,
            elevation: 0,
            rotation: placementB.rotation
          };
          
          // Validate the edge connection
          const validation = edgeValidator.validateEdgeConnection(tileA, tileB, edgeToB, assetPack);
          
          if (!validation.isValid) {
            // Add conflict in both directions
            conflictGraph.get(i)!.add(j);
            conflictGraph.get(j)!.add(i);
          }
        }
      }
    }

    // Greedy conflict resolution: repeatedly remove the tile with most conflicts
    const availableIndices = new Set<number>();
    for (let i = 0; i < candidatePlacements.length; i++) {
      availableIndices.add(i);
    }

    while (true) {
      // Count current conflicts for each available tile
      const conflictCounts = new Map<number, number>();
      let hasConflicts = false;

      for (const i of availableIndices) {
        let conflicts = 0;
        for (const j of conflictGraph.get(i)!) {
          if (availableIndices.has(j)) {
            conflicts++;
          }
        }
        conflictCounts.set(i, conflicts);
        if (conflicts > 0) {
          hasConflicts = true;
        }
      }

      // If no conflicts remain, we're done
      if (!hasConflicts) {
        break;
      }

      // Find tile with most conflicts and remove it
      let maxConflicts = 0;
      let tileToRemove = -1;
      
      for (const [index, conflicts] of conflictCounts) {
        if (conflicts > maxConflicts) {
          maxConflicts = conflicts;
          tileToRemove = index;
        }
      }

      if (tileToRemove !== -1) {
        availableIndices.delete(tileToRemove);
        const removedTile = candidatePlacements[tileToRemove];
        console.log(`🗑️  Removed conflicting tile: ${removedTile.tileId}@(${removedTile.position.q},${removedTile.position.r}) (had ${maxConflicts} conflicts)`);
      } else {
        // Safety break - shouldn't happen
        console.error('❌ Conflict resolution failed: no tile to remove but conflicts exist');
        break;
      }
    }

    // Return the non-conflicting subset
    const result = Array.from(availableIndices).map(i => candidatePlacements[i]);
    
    if (result.length < candidatePlacements.length) {
      const kept = result.map(p => `${p.tileId}@(${p.position.q},${p.position.r})`).join(', ');
      console.log(`✅ Conflict-free subset: ${kept}`);
    }
    
    return result;
  }

  /**
   * Get compatible add-ons for a specific tile
   */
  private getCompatibleAddons(tileId: string, assetPack: AssetPack): { addonId: string; tags: string[] }[] {
    const compatibleAddons: { addonId: string; tags: string[] }[] = [];
    
    // Find the tile definition
    const tileDefinition = assetPack.tiles.find(t => t.id === tileId);
    if (!tileDefinition) {
      return compatibleAddons;
    }
    
    // Check each addon for compatibility
    for (const addon of assetPack.addons) {
      const hasCompatibleTag = addon.placement.tile_tags.some(requiredTag => 
        tileDefinition.tags.includes(requiredTag)
      );
      
      if (hasCompatibleTag) {
        compatibleAddons.push({
          addonId: addon.id,
          tags: addon.tags
        });
      }
    }
    
    return compatibleAddons;
  }



  /**
   * Apply add-on placements to the world
   */
  private applyAddonPlacements(world: World, addonPlacements: AddOnPlacement[], assetPack: AssetPack): string[] {
    const failures: string[] = [];
    
    for (const addonPlacement of addonPlacements) {
      try {
        // Find the addon definition
        const addonDefinition = assetPack.addons.find(a => a.id === addonPlacement.addonId);
        if (!addonDefinition) {
          failures.push(`${addonPlacement.addonId}@(${addonPlacement.position.q},${addonPlacement.position.r}) - addon not found`);
          continue;
        }
        
        // Check if there's a tile at this position
        const existingTile = world.tiles.find(t => t.q === addonPlacement.position.q && t.r === addonPlacement.position.r);
        if (!existingTile) {
          failures.push(`${addonPlacement.addonId}@(${addonPlacement.position.q},${addonPlacement.position.r}) - no tile at position`);
          continue;
        }
        
        // Check if there's already an addon at this position
        const existingAddon = world.addons.find(a => a.q === addonPlacement.position.q && a.r === addonPlacement.position.r);
        if (existingAddon) {
          failures.push(`${addonPlacement.addonId}@(${addonPlacement.position.q},${addonPlacement.position.r}) - position already has addon ${existingAddon.addon_id}`);
          continue;
        }
        
        // Create the world addon
        const worldAddon: WorldAddOn = {
          addon_id: addonPlacement.addonId,
          q: addonPlacement.position.q,
          r: addonPlacement.position.r,
          local_position: addonDefinition.placement.local_position,
          local_rotation: addonPlacement.localRotation || addonDefinition.placement.local_rotation,
          local_scale: addonPlacement.localScale || addonDefinition.placement.local_scale
        };
        
        // Add the addon using WorldManager
        this.worldManager.addAddOn(world, worldAddon);
        
        console.log(`✅ Placed addon ${addonPlacement.addonId} at (${addonPlacement.position.q}, ${addonPlacement.position.r})`);
        
      } catch (error) {
        failures.push(`${addonPlacement.addonId}@(${addonPlacement.position.q},${addonPlacement.position.r}) - ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    return failures;
  }


} 