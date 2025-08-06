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
     return `You are a 3D world generator. You generate 3D worlds based on a user description and a set of hexagonal tiles on which you can place add-ons.

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

WORLD GENERATION PROCESS:
The world generation process is an iterative process.
At each iteration step you will be provided with:
- the user description
- any other world generation parameters the user has provided and which might influence the world generation process as constraints
- the asset pack the user has chosen to build the world from
- the current world state (tiles and add-ons)
- a set of empty positions on which you are allowed to place tiles in the current iteration step
- for each such position a set of valid tiles that can be placed there
- for each such valid tile a set of valid add-ons that can be placed on it

At each iteration step you are allowed to:
- place a tile on an allowed empty position optionally with a valid add-on on it
- remove a tile from a non-empty position (based on positions populated in the world)

When choosing and placing a tile you should consider the following:
- the tile should be placed on an allowed empty position
- the choice makes sense for the world and the user description
- a tile being a valid option means only that it is compatible with the current world state,
it does not mean that it is a good choice for the world and the user description
- a tile being a valid option means only that it is compatible with existing tiles,
so if you place multiple tiles which are adjacent to each other,
you should consider that they might not be compatible with each other
so try choosing wisely, consider the asset pack
- be creative, the goal is to generate a world that is interesting, unique and diverse while being coherent with the user description
- you can also place no tile at all in the current iteration step if you think we are done and we have fulfilled all requirements in the user description
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
     
     // Format valid tiles for each position
     const validTilesDescription = placementOptions.map((posOption, i) => {
       const pos = posOption.position;
       const compactOptions = this.compactOptionsNotation(posOption.validOptions);
       return `Position (${pos.q}, ${pos.r}): ${compactOptions}`;
     }).join('\n');

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

     return `ITERATION STEP:
Now let's do the next iteration step.

The user description is:
${request.description}

The world generation parameters the user has provided and which might influence the world generation process as constraints are:
Maximum tiles: ${maxTiles} (${remaining} remaining)

The asset pack we are using is:
${assetPackInfo}

The current world state is:
${worldState}

Valid positions:
${emptyPositions}

Valid tiles:
${validTilesDescription}

Valid add-ons:
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

HOLE FILLING PROCESS:
This is a specialized phase of world generation focused on filling interior holes (positions with 4+ neighbors).
At this step you will be provided with:
- the user description
- any other world generation parameters the user has provided and which might influence the world generation process as constraints
- the asset pack the user has chosen to build the world from
- the current world state (tiles and add-ons)
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
- avoid creating monotonous patterns (like all grass) unless specifically required by the description

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
    
    // Format valid tiles for each hole position
    const validTilesDescription = placementOptions.map((posOption, i) => {
      const pos = posOption.position;
      const compactOptions = this.compactOptionsNotation(posOption.validOptions);
      return `Position (${pos.q}, ${pos.r}): ${compactOptions} [${posOption.adjacentNeighbors.length} neighbors]`;
    }).join('\n');

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

    return `HOLE FILLING ITERATION STEP:
Now let's do the hole filling iteration step to fill interior holes in the world.

The user description is:
${request.description}

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