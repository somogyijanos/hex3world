import { World, WorldTile, AssetPack, WorldAddOn } from '../types/index';
import { AssetPackManager } from './AssetPackManager';
import { WorldManager } from './WorldManager';
import { EdgeValidator } from './EdgeValidator';
import { HexCoordinates } from './HexCoordinates';
import { TilePlacement, TileRemoval, AddonPlacement, AddonRemoval, LLMPlacementDecision } from '../types/world-generation';
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
    addonsRemoved: number;
    placementFailures: string[];
    removalFailures: string[];
    addonFailures: string[];
    addonRemovalFailures: string[];
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

    // Apply addon removals before placements to enable replacement
    const { removed: addonsRemoved, failures: addonRemovalFailures } = this.applyAddonRemovals(
      world,
      decision.addonRemovals || [],
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
      addonsRemoved,
      placementFailures,
      removalFailures,
      addonFailures,
      addonRemovalFailures
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

        // Emit tile removed event
        if (eventEmitter) {
          eventEmitter('tile_removed', {
            position: { q: removal.position.q, r: removal.position.r },
            tileType: removedTileType,
            totalTiles: world.tiles.length,
            removedAddonCount: addonIndices.length
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

        // Use addTile which will fail if tile already exists (as it should)
        this.worldManager.addTile(world, newTile);
        tilesPlaced++;

        // Emit tile placed event
        if (eventEmitter) {
          eventEmitter('tile_placed', {
            position: { q: placement.position.q, r: placement.position.r },
            tileType: placement.tileId,
            rotation: placement.rotation,
            totalTiles: world.tiles.length
          });
        }

      } catch (error) {
        failures.push(`${placement.tileId}@(${placement.position.q},${placement.position.r}): ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return { placed: tilesPlaced, failures };
  }

  /**
   * Apply addon removals to the world
   */
  private applyAddonRemovals(
    world: World,
    addonRemovals: AddonRemoval[],
    eventEmitter?: (type: GenerationEvent['type'], data: unknown) => void
  ): { removed: number; failures: string[] } {
    let addonsRemoved = 0;
    const failures: string[] = [];

    for (const addonRemoval of addonRemovals) {
      try {
        // Find the addon at the specified position
        const addonIndex = world.addons.findIndex(a => a.q === addonRemoval.position.q && a.r === addonRemoval.position.r);
        
        if (addonIndex === -1) {
          failures.push(`addon@(${addonRemoval.position.q},${addonRemoval.position.r}) - no addon at position`);
          continue;
        }

        const removedAddon = world.addons[addonIndex];
        
        // Remove the addon from the world
        world.addons.splice(addonIndex, 1);
        addonsRemoved++;

        // Emit addon removed event
        if (eventEmitter) {
          eventEmitter('addon_removed', {
            addon_id: removedAddon.addon_id,
            position: { q: removedAddon.q, r: removedAddon.r },
            totalAddons: world.addons.length
          });
        }

      } catch (error) {
        failures.push(`addon@(${addonRemoval.position.q},${addonRemoval.position.r}) - removal error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { removed: addonsRemoved, failures };
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
          // Placement conflicts with existing addon - this should fail unless explicit removal was requested
          failures.push(`${addonPlacement.addonId}@(${addonPlacement.position.q},${addonPlacement.position.r}) - position already has addon ${existingAddon.addon_id} (use explicit removal first)`);
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
        
        // Emit addon placed event
        if (eventEmitter) {
          eventEmitter('addon_placed', {
            addon_id: addonPlacement.addonId,
            position: { q: addonPlacement.position.q, r: addonPlacement.position.r },
            localRotation: worldAddon.local_rotation,
            localScale: worldAddon.local_scale,
            totalAddons: world.addons.length
          });
        }
        
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
