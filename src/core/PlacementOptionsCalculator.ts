import { World, WorldTile, AssetPack } from '../types/index';
import { HexCoordinates } from './HexCoordinates';
import { EdgeValidator } from './EdgeValidator';
import { AssetPackManager } from './AssetPackManager';

export interface PlacementOption {
  tileId: string;
  rotation: number;
  compatibilityScore: number; // Number of adjacent neighbors this option is compatible with
  reasons: string[]; // Detailed compatibility reasoning
}

export interface PositionOptions {
  position: { q: number; r: number };
  validOptions: PlacementOption[];
  adjacentNeighbors: { q: number; r: number; tileType: string }[]; // Existing tiles this position is adjacent to
}

export class PlacementOptionsCalculator {
  private assetPackManager: AssetPackManager;
  private edgeValidator: EdgeValidator;

  constructor(assetPackManager: AssetPackManager) {
    this.assetPackManager = assetPackManager;
    this.edgeValidator = new EdgeValidator(assetPackManager);
  }

  /**
   * Find all empty positions adjacent to existing tiles and calculate valid placement options for each
   */
  async calculatePlacementOptions(world: World): Promise<PositionOptions[]> {
    const assetPack = this.assetPackManager.getAssetPack(world.asset_pack);
    if (!assetPack) {
      throw new Error(`Asset pack '${world.asset_pack}' not found`);
    }

    // Find all adjacent empty positions
    const adjacentEmptyPositions = this.findAdjacentEmptyPositions(world);
    
    const results: PositionOptions[] = [];

    for (const position of adjacentEmptyPositions) {
      const validOptions = await this.calculateValidOptionsForPosition(world, position, assetPack);
      const adjacentNeighbors = this.getAdjacentExistingTiles(world, position);
      
      results.push({
        position,
        validOptions,
        adjacentNeighbors
      });
    }

    return results;
  }

  /**
   * Find all empty positions that are adjacent to at least one existing tile
   */
  private findAdjacentEmptyPositions(world: World): { q: number; r: number }[] {
    const occupiedPositions = new Set<string>();
    const adjacentEmptyPositions = new Set<string>();

    // Mark all occupied positions
    for (const tile of world.tiles) {
      occupiedPositions.add(HexCoordinates.toKey({ q: tile.q, r: tile.r }));
    }

    // For empty world, return origin
    if (world.tiles.length === 0) {
      return [{ q: 0, r: 0 }];
    }

    // Find all positions adjacent to existing tiles
    for (const tile of world.tiles) {
      const neighbors = HexCoordinates.getNeighbors({ q: tile.q, r: tile.r });
      
      for (const neighbor of neighbors) {
        const neighborKey = HexCoordinates.toKey(neighbor);
        
        // If position is empty and not already recorded
        if (!occupiedPositions.has(neighborKey)) {
          adjacentEmptyPositions.add(neighborKey);
        }
      }
    }

    // Convert back to coordinates
    return Array.from(adjacentEmptyPositions).map(key => HexCoordinates.fromKey(key));
  }

  /**
   * Get all existing tiles adjacent to a given position
   */
  private getAdjacentExistingTiles(world: World, position: { q: number; r: number }): { q: number; r: number; tileType: string }[] {
    const neighbors = HexCoordinates.getNeighbors(position);
    const adjacentTiles: { q: number; r: number; tileType: string }[] = [];

    for (const neighbor of neighbors) {
      const existingTile = world.tiles.find(tile => 
        tile.q === neighbor.q && tile.r === neighbor.r
      );
      
      if (existingTile) {
        adjacentTiles.push({
          q: existingTile.q,
          r: existingTile.r,
          tileType: existingTile.tile_type
        });
      }
    }

    return adjacentTiles;
  }

  /**
   * Calculate all valid tile+rotation combinations for a specific position
   * Uses multi-directional validation - tile must be compatible with ALL adjacent neighbors
   */
  private async calculateValidOptionsForPosition(
    world: World, 
    position: { q: number; r: number }, 
    assetPack: AssetPack
  ): Promise<PlacementOption[]> {
    const validOptions: PlacementOption[] = [];
    const adjacentExistingTiles = this.getAdjacentExistingTiles(world, position);

    // Test each tile type with each possible rotation
    for (const tileDefinition of assetPack.tiles) {
      for (let rotation = 0; rotation < 6; rotation++) {
        const compatibilityResult = await this.testTileCompatibility(
          world,
          position,
          tileDefinition.id,
          rotation,
          adjacentExistingTiles,
          assetPack
        );

        if (compatibilityResult.isValid) {
          validOptions.push({
            tileId: tileDefinition.id,
            rotation,
            compatibilityScore: compatibilityResult.compatibilityScore,
            reasons: compatibilityResult.reasons
          });
        }
      }
    }

    // Sort by compatibility score (higher is better)
    return validOptions.sort((a, b) => b.compatibilityScore - a.compatibilityScore);
  }

  /**
   * Test if a specific tile+rotation is compatible with ALL adjacent existing tiles
   * This is the core multi-directional validation
   */
  private async testTileCompatibility(
    world: World,
    position: { q: number; r: number },
    tileId: string,
    rotation: number,
    adjacentExistingTiles: { q: number; r: number; tileType: string }[],
    assetPack: AssetPack
  ): Promise<{ isValid: boolean; compatibilityScore: number; reasons: string[] }> {
    const reasons: string[] = [];
    let compatibilityScore = 0;

    // Create test tile
    const testTile: WorldTile = {
      tile_type: tileId,
      q: position.q,
      r: position.r,
      elevation: 0,
      rotation
    };

    // If no adjacent tiles, it's always valid (for first tile placement)
    if (adjacentExistingTiles.length === 0) {
      return {
        isValid: true,
        compatibilityScore: 1,
        reasons: ['No adjacent constraints - valid placement']
      };
    }

    // Test compatibility with each adjacent existing tile
    for (const adjacentTile of adjacentExistingTiles) {
      const existingWorldTile = world.tiles.find(tile => 
        tile.q === adjacentTile.q && tile.r === adjacentTile.r
      );

      if (!existingWorldTile) {
        const msg = `Could not find world tile at (${adjacentTile.q}, ${adjacentTile.r})`;
        reasons.push(msg);
        continue;
      }

      try {
        // Find which edge of the test tile connects to this neighbor
        const edgeToNeighbor = HexCoordinates.getEdgeToNeighbor(position, { q: adjacentTile.q, r: adjacentTile.r });
        
        if (edgeToNeighbor === -1) {
          const msg = `Position (${adjacentTile.q}, ${adjacentTile.r}) is not adjacent`;
          reasons.push(msg);
          continue;
        }

        // Validate the edge connection
        const validation = this.edgeValidator.validateEdgeConnection(
          testTile,
          existingWorldTile,
          edgeToNeighbor,
          assetPack
        );

        if (validation.isValid) {
          compatibilityScore++;
          const msg = `✓ Compatible with ${adjacentTile.tileType} at (${adjacentTile.q}, ${adjacentTile.r})`;
          reasons.push(msg);
        } else {
          const msg = `✗ Incompatible with ${adjacentTile.tileType}: ${validation.reason}`;
          reasons.push(msg);
          // Return early - must be compatible with ALL neighbors  
          return {
            isValid: false,
            compatibilityScore: 0,
            reasons
          };
        }
      } catch (error) {
        const msg = `Error checking ${adjacentTile.tileType}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        reasons.push(msg);
        return {
          isValid: false,
          compatibilityScore: 0,
          reasons
        };
      }
    }

    // Must be compatible with ALL adjacent tiles
    const isValid = compatibilityScore === adjacentExistingTiles.length;

    return {
      isValid,
      compatibilityScore,
      reasons
    };
  }
} 