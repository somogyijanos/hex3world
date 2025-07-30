import { World, WorldTile, AssetPack } from '../types/index';
import { HexCoordinates, getRotatedTileEdges } from './HexCoordinates';
import { AssetPackManager } from './AssetPackManager';

export interface EdgeValidationResult {
  isValid: boolean;
  sourcePosition: { q: number; r: number };
  targetPosition: { q: number; r: number };
  sourceEdgeIndex: number; // Edge index on source tile (0-5)
  targetEdgeIndex: number; // Edge index on target tile (0-5)
  sourceEdgeType: string;
  targetEdgeType: string;
  reason?: string; // Explanation for invalid connections
  
  // Step-by-step validation details
  stepByStep: {
    sourceTileType: string;
    targetTileType: string;
    sourceRotation: number;
    targetRotation: number;
    assetPackOffset: number;
    assetPackOffsetDirection: 'clockwise' | 'counterclockwise';
    
    // Step 1: Original edges from asset pack
    sourceOriginalEdges: [string, string, string, string, string, string];
    targetOriginalEdges: [string, string, string, string, string, string];
    
    // Step 2: After undoing asset pack edge indexing offset
    sourceAfterOffset: [string, string, string, string, string, string];
    targetAfterOffset: [string, string, string, string, string, string];
    
    // Step 3: Final edges after tile rotation
    sourceFinalEdges: [string, string, string, string, string, string];
    targetFinalEdges: [string, string, string, string, string, string];
  };
}

export interface ValidationSummary {
  totalEdges: number;
  validEdges: number;
  invalidEdges: number;
  results: EdgeValidationResult[];
  errors: string[];
}

export class EdgeValidator {
  private assetPackManager: AssetPackManager;

  constructor(assetPackManager: AssetPackManager) {
    this.assetPackManager = assetPackManager;
  }

  /**
   * Validate all edge connections in a world
   */
  validateWorld(world: World): ValidationSummary {
    const assetPack = this.assetPackManager.getAssetPack(world.asset_pack);
    if (!assetPack) {
      return {
        totalEdges: 0,
        validEdges: 0,
        invalidEdges: 0,
        results: [],
        errors: [`Asset pack '${world.asset_pack}' not found`]
      };
    }

    const results: EdgeValidationResult[] = [];
    const errors: string[] = [];
    const processedEdges = new Set<string>(); // Track processed edges to avoid duplicates

    // Create a map of tile positions for quick lookup
    const tileMap = new Map<string, WorldTile>();
    for (const tile of world.tiles) {
      const key = HexCoordinates.toKey({ q: tile.q, r: tile.r });
      tileMap.set(key, tile);
    }

    // Check each tile's edges against its neighbors
    for (const sourceTile of world.tiles) {
      const sourceTileDefinition = assetPack.tiles.find(t => t.id === sourceTile.tile_type);
      if (!sourceTileDefinition) {
        errors.push(`Tile definition '${sourceTile.tile_type}' not found in asset pack`);
        continue;
      }

      // Note: sourceEdges are calculated in validateEdgeConnection for each neighbor
      const neighbors = HexCoordinates.getNeighbors({ q: sourceTile.q, r: sourceTile.r });

      for (let edgeIndex = 0; edgeIndex < 6; edgeIndex++) {
        const neighborCoord = neighbors[edgeIndex];
        const neighborKey = HexCoordinates.toKey(neighborCoord);
        const targetTile = tileMap.get(neighborKey);

        // Create unique edge key to avoid processing the same edge twice
        const edgeKey = this.createEdgeKey(sourceTile, targetTile, edgeIndex);
        if (processedEdges.has(edgeKey)) {
          continue;
        }
        processedEdges.add(edgeKey);

        if (targetTile) {
          // There is a neighbor tile, validate edge compatibility
          const result = this.validateEdgeConnection(
            sourceTile,
            targetTile,
            edgeIndex,
            assetPack
          );
          results.push(result);
        }
        // Note: We don't validate edges that have no neighbor (open edges)
        // as these are valid by default
      }
    }

    const validCount = results.filter(r => r.isValid).length;
    const invalidCount = results.filter(r => !r.isValid).length;

    return {
      totalEdges: results.length,
      validEdges: validCount,
      invalidEdges: invalidCount,
      results,
      errors
    };
  }

  /**
   * Create step-by-step validation details for debugging
   */
  private createStepByStepDetails(
    sourceTileDefinition: { edges: [string, string, string, string, string, string] } | null,
    targetTileDefinition: { edges: [string, string, string, string, string, string] } | null,
    sourceTile: WorldTile,
    targetTile: WorldTile,
    assetPack: AssetPack
  ) {
    const assetPackOffset = assetPack.geometry_config.edge_indexing_offset || 0;
    
    // Step 1: Original edges
    const sourceOriginalEdges = sourceTileDefinition ? [...sourceTileDefinition.edges] as [string, string, string, string, string, string] : ['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown'] as [string, string, string, string, string, string];
    const targetOriginalEdges = targetTileDefinition ? [...targetTileDefinition.edges] as [string, string, string, string, string, string] : ['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown'] as [string, string, string, string, string, string];
    
    // Step 2: After undoing offset
    let sourceAfterOffset = [...sourceOriginalEdges] as [string, string, string, string, string, string];
    let targetAfterOffset = [...targetOriginalEdges] as [string, string, string, string, string, string];
    
    if (assetPackOffset !== 0 && sourceTileDefinition && targetTileDefinition) {
      const edgeIndexingDirection = assetPack.geometry_config.edge_indexing_direction || 'clockwise';
      
      if (edgeIndexingDirection === 'clockwise') {
        // For clockwise offset: undo by rotating -offset
        sourceAfterOffset = this.rotateEdgeArray(sourceAfterOffset, -assetPackOffset);
        targetAfterOffset = this.rotateEdgeArray(targetAfterOffset, -assetPackOffset);
      } else {
        // For counterclockwise offset: undo by rotating +offset
        sourceAfterOffset = this.rotateEdgeArray(sourceAfterOffset, assetPackOffset);
        targetAfterOffset = this.rotateEdgeArray(targetAfterOffset, assetPackOffset);
      }
    }
    
    // Step 3: Final edges after rotation
    let sourceFinalEdges = [...sourceAfterOffset] as [string, string, string, string, string, string];
    let targetFinalEdges = [...targetAfterOffset] as [string, string, string, string, string, string];
    
    if (sourceTileDefinition && targetTileDefinition) {
      if ((sourceTile.rotation || 0) !== 0) {
        sourceFinalEdges = this.rotateEdgeArray(sourceFinalEdges, sourceTile.rotation || 0);
      }
      if ((targetTile.rotation || 0) !== 0) {
        targetFinalEdges = this.rotateEdgeArray(targetFinalEdges, targetTile.rotation || 0);
      }
    }
    
    return {
      sourceTileType: sourceTile.tile_type,
      targetTileType: targetTile.tile_type,
      sourceRotation: sourceTile.rotation || 0,
      targetRotation: targetTile.rotation || 0,
      assetPackOffset,
      assetPackOffsetDirection: assetPack.geometry_config.edge_indexing_direction || 'clockwise',
      sourceOriginalEdges,
      targetOriginalEdges,
      sourceAfterOffset,
      targetAfterOffset,
      sourceFinalEdges,
      targetFinalEdges
    };
  }

  /**
   * Helper function to rotate edge array
   */
  private rotateEdgeArray(edges: [string, string, string, string, string, string], rotationSteps: number): [string, string, string, string, string, string] {
    if (rotationSteps === 0) return edges;
    
    // For positive rotationSteps: shift right (elements move to higher indices)
    // For negative rotationSteps: shift left (elements move to lower indices)
    // Implementation: result[i] = original[(i - rotationSteps + 6) % 6]
    const result = new Array(6) as [string, string, string, string, string, string];
    for (let i = 0; i < 6; i++) {
      const sourceIndex = (i - rotationSteps + 6) % 6;
      result[i] = edges[sourceIndex];
    }
    return result;
  }

  /**
   * Validate connection between two specific tiles at a shared edge
   */
  validateEdgeConnection(
    sourceTile: WorldTile,
    targetTile: WorldTile,
    sourceEdgeIndex: number,
    assetPack: AssetPack
  ): EdgeValidationResult {
    // Get tile definitions
    const sourceTileDefinition = assetPack.tiles.find(t => t.id === sourceTile.tile_type);
    const targetTileDefinition = assetPack.tiles.find(t => t.id === targetTile.tile_type);

    if (!sourceTileDefinition) {
      return {
        isValid: false,
        sourcePosition: { q: sourceTile.q, r: sourceTile.r },
        targetPosition: { q: targetTile.q, r: targetTile.r },
        sourceEdgeIndex: sourceEdgeIndex,
        targetEdgeIndex: -1, // Indicate no target edge found
        sourceEdgeType: 'unknown',
        targetEdgeType: 'unknown',
        reason: `Source tile definition '${sourceTile.tile_type}' not found`,
        stepByStep: this.createStepByStepDetails(null, targetTileDefinition || null, sourceTile, targetTile, assetPack)
      };
    }

    if (!targetTileDefinition) {
      return {
        isValid: false,
        sourcePosition: { q: sourceTile.q, r: sourceTile.r },
        targetPosition: { q: targetTile.q, r: targetTile.r },
        sourceEdgeIndex: sourceEdgeIndex,
        targetEdgeIndex: -1, // Indicate no target edge found
        sourceEdgeType: 'unknown',
        targetEdgeType: 'unknown',
        reason: `Target tile definition '${targetTile.tile_type}' not found`,
        stepByStep: this.createStepByStepDetails(sourceTileDefinition || null, null, sourceTile, targetTile, assetPack)
      };
    }

    // Get effective edges after rotation
    const sourceEdges = getRotatedTileEdges(sourceTileDefinition, assetPack, sourceTile.rotation || 0);
    const targetEdges = getRotatedTileEdges(targetTileDefinition, assetPack, targetTile.rotation || 0);

    // Get edge types
    const sourceEdgeType = sourceEdges[sourceEdgeIndex];
    
    // Find the correct target edge index: which edge of target tile connects back to source tile
    const targetEdgeIndex = HexCoordinates.getEdgeToNeighbor(
      { q: targetTile.q, r: targetTile.r },
      { q: sourceTile.q, r: sourceTile.r }
    );
    
    if (targetEdgeIndex === -1) {
      return {
        isValid: false,
        sourcePosition: { q: sourceTile.q, r: sourceTile.r },
        targetPosition: { q: targetTile.q, r: targetTile.r },
        sourceEdgeIndex: sourceEdgeIndex,
        targetEdgeIndex: -1,
        sourceEdgeType,
        targetEdgeType: 'unknown',
        reason: `Target tile (${targetTile.q},${targetTile.r}) is not adjacent to source tile (${sourceTile.q},${sourceTile.r})`,
        stepByStep: this.createStepByStepDetails(sourceTileDefinition, targetTileDefinition, sourceTile, targetTile, assetPack)
      };
    }
    
    const targetEdgeType = targetEdges[targetEdgeIndex];

    // Check compatibility
    const isValid = this.areEdgesCompatible(sourceEdgeType, targetEdgeType, assetPack);
    
    return {
      isValid,
      sourcePosition: { q: sourceTile.q, r: sourceTile.r },
      targetPosition: { q: targetTile.q, r: targetTile.r },
      sourceEdgeIndex: sourceEdgeIndex,
      targetEdgeIndex: targetEdgeIndex,
      sourceEdgeType,
      targetEdgeType,
      reason: isValid ? undefined : `Edge types '${sourceEdgeType}' and '${targetEdgeType}' are not compatible`,
      stepByStep: this.createStepByStepDetails(sourceTileDefinition, targetTileDefinition, sourceTile, targetTile, assetPack)
    };
  }

  /**
   * Check if two edge types are compatible
   */
  private areEdgesCompatible(edgeType1: string, edgeType2: string, assetPack: AssetPack): boolean {
    const edge1 = assetPack.edge_types[edgeType1];
    const edge2 = assetPack.edge_types[edgeType2];

    if (!edge1 || !edge2) {
      return false; // Unknown edge types are incompatible
    }

    // Direct match
    if (edgeType1 === edgeType2) {
      return true;
    }

    // Check compatibility lists
    if (edge1.compatible_with?.includes(edgeType2)) {
      return true;
    }

    if (edge2.compatible_with?.includes(edgeType1)) {
      return true;
    }

    return false;
  }

  /**
   * Create unique key for an edge to avoid duplicate processing
   */
  private createEdgeKey(tile1: WorldTile | undefined, tile2: WorldTile | undefined, edgeIndex: number): string {
    if (!tile1 || !tile2) {
      return `open_${tile1?.q || 0}_${tile1?.r || 0}_${edgeIndex}`;
    }

    // Ensure consistent ordering to avoid duplicate processing
    const pos1 = `${tile1.q},${tile1.r}`;
    const pos2 = `${tile2.q},${tile2.r}`;
    
    if (pos1 < pos2) {
      return `${pos1}-${pos2}_${edgeIndex}`;
    } else {
      return `${pos2}-${pos1}_${HexCoordinates.getOppositeEdgeIndex(edgeIndex)}`;
    }
  }

  /**
   * Get validation results for edges at a specific tile position
   */
  getValidationResultsForTile(position: { q: number; r: number }, summary: ValidationSummary): EdgeValidationResult[] {
    return summary.results.filter(result => 
      (result.sourcePosition.q === position.q && result.sourcePosition.r === position.r) ||
      (result.targetPosition.q === position.q && result.targetPosition.r === position.r)
    );
  }

  /**
   * Get only invalid edge results
   */
  getInvalidEdges(summary: ValidationSummary): EdgeValidationResult[] {
    return summary.results.filter(result => !result.isValid);
  }

  /**
   * Get only valid edge results
   */
  getValidEdges(summary: ValidationSummary): EdgeValidationResult[] {
    return summary.results.filter(result => result.isValid);
  }

  /**
   * Get validation statistics
   */
  getStatistics(summary: ValidationSummary): { validPercent: number; invalidPercent: number } {
    if (summary.totalEdges === 0) {
      return { validPercent: 0, invalidPercent: 0 };
    }

    return {
      validPercent: Math.round((summary.validEdges / summary.totalEdges) * 100),
      invalidPercent: Math.round((summary.invalidEdges / summary.totalEdges) * 100)
    };
  }
} 