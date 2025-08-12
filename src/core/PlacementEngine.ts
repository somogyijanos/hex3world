import { World, WorldTile, AssetPack, WorldAddOn } from '../types/index';
import { AssetPackManager } from './AssetPackManager';
import { WorldManager } from './WorldManager';
import { EdgeValidator } from './EdgeValidator';
import { HexCoordinates } from './HexCoordinates';
import { TilePlacement, TileRemoval, AddonPlacement, LLMPlacementDecision } from '../types/world-generation';
import { GenerationEvent } from '../types/llm';

/**
 * Handles tile placement, removal, and conflict resolution logic
 */
export class PlacementEngine {
  private assetPackManager: AssetPackManager;
  private worldManager: WorldManager;

  constructor(assetPackManager: AssetPackManager, worldManager: WorldManager) {
    this.assetPackManager = assetPackManager;
    this.worldManager = worldManager;
  }

  /**
   * Apply placement decisions to the world
   */
  applyPlacementDecisions(
    world: World, 
    decision: LLMPlacementDecision, 
    assetPack: AssetPack, 
    maxTiles: number,
    eventEmitter?: (type: GenerationEvent['type'], data: unknown) => void
  ): {
    tilesPlaced: number;
    tilesRemoved: number;
    addonsPlaced: number;
    placementFailures: string[];
    removalFailures: string[];
    addonFailures: string[];
  } {
    
    // Safety constraint: prevent removing more than 25% of current tiles in one iteration
    const maxRemovalsAllowed = Math.max(1, Math.floor(world.tiles.length * 0.25));
    const actualRemovals = Math.min(decision.removals.length, maxRemovalsAllowed);
    
    if (decision.removals.length > maxRemovalsAllowed) {
      console.log(`⚠️  Safety constraint: limiting removals from ${decision.removals.length} to ${maxRemovalsAllowed} (25% max)`);
    }

    // Apply tile removals first
    const { removed: tilesRemoved, failures: removalFailures } = this.applyTileRemovals(
      world, 
      decision.removals.slice(0, actualRemovals),
      eventEmitter
    );

    // Apply tile placements
    const { placed: tilesPlaced, failures: placementFailures } = this.applyTilePlacements(
      world, 
      decision.placements, 
      maxTiles,
      eventEmitter
    );

    // Apply addon placements
    const { placed: addonsPlaced, failures: addonFailures } = this.applyAddonPlacements(
      world, 
      decision.addonPlacements, 
      assetPack,
      eventEmitter
    );

    return {
      tilesPlaced,
      tilesRemoved,
      addonsPlaced,
      placementFailures,
      removalFailures,
      addonFailures
    };
  }

  /**
   * Apply tile removals to the world
   */
  private applyTileRemovals(
    world: World, 
    removals: TileRemoval[],
    eventEmitter?: (type: GenerationEvent['type'], data: unknown) => void
  ): { removed: number; failures: string[] } {
    let tilesRemoved = 0;
    const failures: string[] = [];
    
    for (const removal of removals) {
      try {
        // Find and remove the tile (only check position)
        const tileIndex = world.tiles.findIndex(t => 
          t.q === removal.position.q && t.r === removal.position.r
        );
        
        if (tileIndex === -1) {
          failures.push(`(${removal.position.q},${removal.position.r}) - no tile found at position`);
          continue;
        }

        // Get the tile type before removing for logging
        const removedTile = world.tiles[tileIndex];
        const removedTileType = removedTile.tile_type;

        // Remove the tile
        world.tiles.splice(tileIndex, 1);
        tilesRemoved++;

        // Also remove any addons at this position
        const addonIndices = [];
        for (let j = world.addons.length - 1; j >= 0; j--) {
          if (world.addons[j].q === removal.position.q && world.addons[j].r === removal.position.r) {
            addonIndices.push(j);
          }
        }
        addonIndices.forEach(index => world.addons.splice(index, 1));

        if (eventEmitter) {
          eventEmitter('progress', {
            stage: 'removing',
            currentStep: world.tiles.length,
            message: `Removed ${removedTileType} at (${removal.position.q}, ${removal.position.r})`,
            placedTiles: world.tiles.length,
            validationErrors: 0,
            currentWorld: world
          });
        }

      } catch (error) {
        failures.push(`(${removal.position.q},${removal.position.r}): ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return { removed: tilesRemoved, failures };
  }

  /**
   * Apply tile placements to the world
   */
  private applyTilePlacements(
    world: World, 
    placements: TilePlacement[], 
    maxTiles: number,
    eventEmitter?: (type: GenerationEvent['type'], data: unknown) => void
  ): { placed: number; failures: string[] } {
    let tilesPlaced = 0;
    const failures: string[] = [];
    
    for (const placement of placements) {
      // Check if we've reached the max tiles limit
      if (world.tiles.length >= maxTiles) {
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

        this.worldManager.addTile(world, newTile);
        tilesPlaced++;

        if (eventEmitter) {
          eventEmitter('progress', {
            stage: 'placing',
            currentStep: world.tiles.length,
            message: `Placed ${placement.tileId} at (${placement.position.q}, ${placement.position.r})`,
            placedTiles: world.tiles.length,
            validationErrors: 0,
            currentWorld: world
          });
        }

      } catch (error) {
        failures.push(`${placement.tileId}@(${placement.position.q},${placement.position.r}): ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return { placed: tilesPlaced, failures };
  }

  /**
   * Apply add-on placements to the world
   */
  private applyAddonPlacements(
    world: World, 
    addonPlacements: AddonPlacement[], 
    assetPack: AssetPack,
    eventEmitter?: (type: GenerationEvent['type'], data: unknown) => void
  ): { placed: number; failures: string[] } {
    let addonsPlaced = 0;
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
        addonsPlaced++;
        
        console.log(`✅ Placed addon ${addonPlacement.addonId} at (${addonPlacement.position.q}, ${addonPlacement.position.r})`);
        
      } catch (error) {
        failures.push(`${addonPlacement.addonId}@(${addonPlacement.position.q},${addonPlacement.position.r}) - ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    return { placed: addonsPlaced, failures };
  }

  /**
   * Resolve inter-placement conflicts by finding the maximum set of non-conflicting tiles
   * Uses a greedy approach: repeatedly remove the tile with most conflicts until no conflicts remain
   */
  resolveInterPlacementConflicts(candidatePlacements: TilePlacement[], assetPack: AssetPack): TilePlacement[] {
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
}
