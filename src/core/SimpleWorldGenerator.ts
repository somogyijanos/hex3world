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
}

export class SimpleWorldGenerator {
  private assetPackManager: AssetPackManager;
  private worldManager: WorldManager;
  private placementCalculator: PlacementOptionsCalculator;
  private llmProvider: BaseLLMProvider | null = null;
  private eventHandlers: GenerationEventHandler[] = [];

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

      const maxTiles = request.constraints?.maxTiles || 20;
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
          console.log('❌ STOPPING: LLM chose no actions (no tiles to place or remove)');
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
          console.log(`ℹ️ No holes selected by LLM for filling`);
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

      // Parse LLM response
      return this.parseLLMPlacementResponse(response.message.content, placementOptions, assetPack, currentWorld);

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
    
    const systemPrompt = this.createFillHolesSystemPrompt(request, assetPack);
    const userPrompt = this.createFillHolesUserPrompt(request, currentWorld, placementOptions, unpopulatableHoles, assetPack, maxTiles);

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
     return `You are a creative world generator. Your goal is to build INTERESTING, VARIED worlds that match the description.

🎨 CREATIVITY GUIDELINES:
- AVOID placing only on the same tile type (unless it's explicitly stated in the description) - that's boring!  
- CREATE VARIETY by mixing different tile types when possible but only as long as it makes sense for the world and the description
- BUILD COHERENT SCENES that tell a story
- CONSIDER the description - fishing villages need water, towns need roads, etc.

🔧 TECHNICAL RULES:
- You can ONLY place tiles at the EXACT positions listed below (Position 1, Position 2, etc.)
- You can ONLY choose an EXACT tile:rotation combination based on the "Available" list for each position
- You can ALSO remove existing tiles when needed to resolve constraints or improve the world
- COMPACT NOTATION: 
  • "tile:r*" = all rotations (0-5) available
  • "tile:r0-3" = rotations 0,1,2,3 available  
  • "tile:r0,2,4" = only rotations 0,2,4 available
- If multiple rotations are shown for a tile, pick ANY rotation (e.g. if "my-tile-c:r0,2,4" then you can use my-tile-c:r0, my-tile-c:r2, or my-tile-c:r4)
- You can place tiles at ALL available positions, or leave some empty strategically
- All compatibility is pre-validated - just pick from the given options
- ADDON PLACEMENT: You can also place add-ons on tiles you place (not on existing tiles unless specified)
- Add-ons require compatible tile tags - use only addons shown as compatible
- TILE REMOVAL: You can remove existing tiles to resolve placement conflicts or improve the world

🎯 WORLD BUILDING STRATEGY:
- You can place tiles at ALL available positions in one iteration
- OR strategically leave some positions empty to create better layouts later
- Think about overall composition - sometimes spacing creates better results

REMEMBER: 
- Use ONLY the exact positions listed above (the q,r coordinates from Position 1, Position 2, etc.)
- Use ONLY tile names and rotations shown in the compact notation
- For example: If "Position 1: (0, 1)" shows "my-tile-c:r0,2,4" you can place "my-tile-c" with rotation 0, 2, or 4 at position (0, 1)

Respond with JSON:
{
  "placements": [
    {
      "position": {"q": 0, "r": 0}, 
      "tileId": "my-tile-c",
      "rotation": 0
    }
  ],
  "removals": [
    {
      "position": {"q": 1, "r": 0}
    }
  ],
  "addonPlacements": [
    {
      "position": {"q": 0, "r": 0},
      "addonId": "my-addon-01"
    }
  ],
  "reasoning": "I chose my-tile-c at (0,0) to start a ..., removed the tile at (1,0) that was blocking better connections, and added my-addon-01 for ..."
}`;
   }

     /**
    * Create user prompt with current world state and options
    */
   private createUserPrompt(request: GenerationRequest, currentWorld: World, placementOptions: PositionOptions[], assetPack: AssetPack, maxTiles: number): string {
     const isEmpty = currentWorld.tiles.length === 0;
     const remaining = maxTiles - currentWorld.tiles.length;
     const worldDescription = `🎯 Target: "${request.description}"
🎲 Tiles: ${currentWorld.tiles.length}/${maxTiles} (${remaining} remaining)
🎨 Addons: ${currentWorld.addons.length} total

${isEmpty ? '🌟 STARTING FRESH - This is the very first tile! Only position (0,0) exists. Place ONE tile there to begin the world.' : 
`Current world: ${currentWorld.tiles.map(t => `${t.tile_type}@(${t.q},${t.r}):r${t.rotation || 0}`).join(', ')}
${currentWorld.addons.length > 0 ? `Existing addons: ${currentWorld.addons.map(a => `${a.addon_id}@(${a.q},${a.r})`).join(', ')}` : ''}
🗑️ Removable tiles: You can remove any existing tile if it improves the world design or resolves placement constraints`}

💡 Available placement options:`;

     const optionsDescription = placementOptions.map((posOption, i) => {
       const pos = posOption.position;
       
       // Group options by theme for better presentation
       const byTheme = new Map();
       posOption.validOptions.forEach(opt => {
         const theme = this.categorizeTile(opt.tileId);
         if (!byTheme.has(theme)) byTheme.set(theme, []);
         byTheme.get(theme).push(opt);
       });
       
       // Show ALL options in compact notation
       const compactOptions = this.compactOptionsNotation(posOption.validOptions);
       
       // Show available addons for sample tiles
       const sampleTiles = posOption.validOptions.slice(0, 3); // Show addons for first 3 tiles as examples
       const addonExamples = sampleTiles.map(opt => {
         const compatibleAddons = this.getCompatibleAddons(opt.tileId, assetPack);
         if (compatibleAddons.length > 0) {
           return `${opt.tileId} → addons: ${compatibleAddons.slice(0, 3).map(a => a.addonId).join(', ')}${compatibleAddons.length > 3 ? '...' : ''}`;
         }
         return `${opt.tileId} → no addons`;
       }).join(', ');
       
       return `Position ${i + 1}: (${pos.q}, ${pos.r}) - ${posOption.validOptions.length} total options
  Available: ${compactOptions}
  ${addonExamples ? `Sample addons: ${addonExamples}` : ''}`;
     }).join('\n\n');

     const guidance = isEmpty ? 
       `\n\n🎯 FIRST TILE: Place exactly ONE tile at position (0,0) to start the world. Choose something that fits "${request.description}" and can expand well (like a junction for crossroads, water for lakes, etc.). Consider adding an appropriate addon!` :
       `\n\n🎨 You have ${remaining} tiles remaining. Consider:\n- Filling positions strategically based on remaining tile budget\n- Leaving some positions empty for future expansion\n- Creating coherent themes and connections\n- Adding addons to tiles for variety and detail\n- ${remaining <= 3 ? 'NEARLY DONE - Choose final tiles carefully!' : 'Avoid boring all-grass worlds!'}`;

         return worldDescription + '\n\n' + optionsDescription + guidance;
  }

  /**
   * Create system prompt for hole-filling
   */
  private createFillHolesSystemPrompt(request: GenerationRequest, assetPack: AssetPack): string {
    return `You are a world generator. Your goal is to fill INTERIOR HOLES (positions with 4+ neighbors) or remove tiles to resolve impossible holes in the world to make it more interesting and varied.

🎨 CREATIVITY GUIDELINES:
- AVOID placing only grass tiles - that's boring!  
- CREATE VARIETY by mixing different tile types when possible
- Use water, roads, rivers, coastlines, and special terrain when available
- BUILD COHERENT SCENES that tell a story
- CONSIDER the description - fishing villages need water, towns need roads, etc.

🔧 TECHNICAL RULES:
- You can ONLY place tiles at the EXACT positions listed below (Position 1, Position 2, etc.)
- You can ONLY use EXACT tile:rotation combinations from the "Available" list for each position
- You can ALSO remove existing tiles when holes have no valid placement options
- COMPACT NOTATION: 
  • "tile:r*" = all rotations (0-5) available
  • "tile:r0-3" = rotations 0,1,2,3 available  
  • "tile:r0,2,4" = only rotations 0,2,4 available
- Pick ANY rotation shown for a tile (e.g. if "road-junction-d:r0,2,4" then you can use r0, r2, or r4)
- You can place tiles at ALL available positions, or leave some empty strategically
- All compatibility is pre-validated - just pick from the given options
- ADDON PLACEMENT: You can also place add-ons on tiles you place (not on existing tiles unless specified)
- Add-ons require compatible tile tags - use only addons shown as compatible
- TILE REMOVAL: Remove existing tiles to resolve impossible holes or improve overall design

🎯 WORLD BUILDING STRATEGY:
- You can place tiles at ALL available positions in one iteration
- OR strategically leave some positions empty to create better layouts later
- For fishing villages: Look for coast, water, and shore tiles
- For towns/villages: Use roads, paths, and varied terrain  
- For natural areas: Mix grass with water features, elevation changes
- For farms: Use road networks connecting different areas
- Think about overall composition - sometimes spacing creates better results

Available in ${assetPack.id}: hex-grass, hex-water, coast-a, road-straight-a, river-straight-a, and many more specialized tiles.

REMEMBER: 
- Use ONLY the exact positions listed above (the q,r coordinates from Position 1, Position 2, etc.)
- Use ONLY tile names and rotations shown in the compact notation
- For example: If "Position 1: (0, 1)" shows "road-junction-d:r0,2,4" you can place "road-junction-d" with rotation 0, 2, or 4 at position (0, 1)

Respond with JSON:
{
  "placements": [
    {
      "position": {"q": 0, "r": 0}, 
      "tileId": "road-junction-d",
      "rotation": 0
    }
  ],
  "removals": [
    {
      "position": {"q": 1, "r": 0}
    }
  ],
  "addonPlacements": [
    {
      "position": {"q": 0, "r": 0},
      "addonId": "tree-01"
    }
  ],
  "reasoning": "I filled the hole at (0,0) with a road junction and removed the tile at (1,0) that was blocking better connections"
}`;
  }

  /**
   * Create user prompt for hole-filling
   */
  private createFillHolesUserPrompt(request: GenerationRequest, currentWorld: World, placementOptions: PositionOptions[], unpopulatableHoles: PositionOptions[], assetPack: AssetPack, maxTiles: number): string {
    const remaining = maxTiles - currentWorld.tiles.length;
    const worldDescription = `🕳️ HOLE FILLING PHASE for: "${request.description}"
🎲 Tiles: ${currentWorld.tiles.length}/${maxTiles} (${remaining} remaining slots)
🎨 Addons: ${currentWorld.addons.length} total

🗺️ Current world: ${currentWorld.tiles.map(t => `${t.tile_type}@(${t.q},${t.r}):r${t.rotation || 0}`).join(', ')}
${currentWorld.addons.length > 0 ? `🎯 Existing addons: ${currentWorld.addons.map(a => `${a.addon_id}@(${a.q},${a.r})`).join(', ')}` : ''}

${unpopulatableHoles.length > 0 ? `⚠️ IMPOSSIBLE HOLES (no valid tiles due to edge constraints): ${unpopulatableHoles.map(hole => `(${hole.position.q},${hole.position.r})`).join(', ')}
   Consider removing nearby tiles: ${currentWorld.tiles.filter(t => unpopulatableHoles.some(hole => Math.abs(t.q - hole.position.q) + Math.abs(t.r - hole.position.r) <= 2)).map(t => `${t.tile_type}@(${t.q},${t.r})`).join(', ')}` : ''}

🔍 INTERIOR HOLES TO FILL (positions with 4+ neighbors):`;

    const optionsDescription = placementOptions.map((posOption, i) => {
      const pos = posOption.position;
      
      // Group options by theme for better presentation
      const byTheme = new Map();
      posOption.validOptions.forEach(opt => {
        const theme = this.categorizeTile(opt.tileId);
        if (!byTheme.has(theme)) byTheme.set(theme, []);
        byTheme.get(theme).push(opt);
      });
      
      const themeList = Array.from(byTheme.entries())
        .map(([theme, opts]) => `${theme}(${opts.length})`)
        .join(', ');
      
      // Show ALL options in compact notation
      const compactOptions = this.compactOptionsNotation(posOption.validOptions);
      
      // Show available addons for sample tiles
      const sampleTiles = posOption.validOptions.slice(0, 3); // Show addons for first 3 tiles as examples
      const addonExamples = sampleTiles.map(opt => {
        const compatibleAddons = this.getCompatibleAddons(opt.tileId, assetPack);
        if (compatibleAddons.length > 0) {
          return `${opt.tileId} → addons: ${compatibleAddons.slice(0, 3).map(a => a.addonId).join(', ')}${compatibleAddons.length > 3 ? '...' : ''}`;
        }
        return `${opt.tileId} → no addons`;
      }).join(', ');
      
      return `Hole ${i + 1}: (${pos.q}, ${pos.r}) - ${posOption.validOptions.length} options, ${posOption.adjacentNeighbors.length} neighbors (${themeList})
  Available: ${compactOptions}
  ${addonExamples ? `Sample addons: ${addonExamples}` : ''}`;
    }).join('\n\n');

    const guidance = `\n\n🎯 INTERIOR HOLE FILLING STRATEGY:
- These are true interior holes surrounded by 4+ neighboring tiles
- Consider what tile types would enhance connectivity (roads, rivers, coastlines)
- Fill strategic holes that add variety and avoid monotony
- Leave some holes empty if they create better visual composition
- Add addons to create more visual interest and detail
- Think about thematic coherence with "${request.description}"
- ${remaining <= 3 ? 'Very limited space - choose carefully!' : `${remaining} slots available - be selective!`}

🗑️ TILE REMOVAL STRATEGY:
- Remove tiles near impossible holes to free up new placement options
- Remove tiles that create visual clutter or break thematic coherence
- Remove tiles strategically to improve overall world design
- Consider removing tiles that prevent better connectivity patterns
- CONSTRAINT: You can only remove existing tiles (listed in current world above)

You can fill ALL holes, SOME holes, or NO holes - and remove ANY existing tiles - whatever makes the world better!`;

    return worldDescription + '\n\n' + optionsDescription + guidance;
  }
   
     /**
   * Categorize tiles by theme for better LLM understanding
   */
  private categorizeTile(tileId: string): string {
    if (tileId.includes('water')) return 'Water';
    if (tileId.includes('coast') || tileId.includes('shore')) return 'Coast';
    if (tileId.includes('road')) return 'Road';
    if (tileId.includes('river')) return 'River';
    if (tileId.includes('grass')) return 'Grass';
    if (tileId.includes('stone')) return 'Stone';
    if (tileId.includes('sand')) return 'Sand';
    return 'Other';
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
      
      if (!parsed.placements || !Array.isArray(parsed.placements)) {
        console.warn('Invalid placements in LLM response');
        return null;
      }

      // Validate each placement against available options
      const validPlacements: TilePlacement[] = [];
      
      const invalidChoices: string[] = [];
      
      // First pass: validate against available options
      const candidatePlacements: TilePlacement[] = [];
      
      for (const placement of parsed.placements) {
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
      
      if (resolvedPlacements.length === 0) {
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

      // Parse addon placements
      const validAddonPlacements: AddOnPlacement[] = [];
      if (parsed.addonPlacements && Array.isArray(parsed.addonPlacements)) {
        for (const addonPlacement of parsed.addonPlacements) {
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
        reasoning: parsed.reasoning || 'No reasoning provided'
      };

    } catch (error) {
      console.error('Error parsing LLM response:', error);
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