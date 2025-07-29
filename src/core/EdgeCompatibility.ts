import { AssetPack, TileDefinition, EdgeTypes, EdgeIndex } from '../types/index';

export interface EdgeCompatibilityResult {
  compatible: boolean;
  reason?: string;
}

export class EdgeCompatibility {
  private assetPack: AssetPack;
  
  constructor(assetPack: AssetPack) {
    this.assetPack = assetPack;
  }

  /**
   * Check if two edge types are compatible
   */
  areEdgeTypesCompatible(edgeType1: string, edgeType2: string): EdgeCompatibilityResult {
    const edge1 = this.assetPack.edge_types[edgeType1];
    const edge2 = this.assetPack.edge_types[edgeType2];

    if (!edge1) {
      return { compatible: false, reason: `Edge type '${edgeType1}' not found in asset pack` };
    }

    if (!edge2) {
      return { compatible: false, reason: `Edge type '${edgeType2}' not found in asset pack` };
    }

    // Check direct compatibility (same edge type)
    if (edgeType1 === edgeType2) {
      return { compatible: true };
    }

    // Check if edge1 is compatible with edge2
    if (edge1.compatible_with?.includes(edgeType2)) {
      return { compatible: true };
    }

    // Check if edge2 is compatible with edge1
    if (edge2.compatible_with?.includes(edgeType1)) {
      return { compatible: true };
    }

    return { 
      compatible: false, 
      reason: `Edge types '${edgeType1}' and '${edgeType2}' are not compatible` 
    };
  }

  /**
   * Check if two tiles can be placed adjacent to each other
   * @param tile1 First tile
   * @param edge1 Edge index on tile1 that connects to tile2
   * @param tile2 Second tile  
   * @param edge2 Edge index on tile2 that connects to tile1
   */
  canTilesConnect(
    tile1: TileDefinition, 
    edge1: EdgeIndex, 
    tile2: TileDefinition, 
    edge2: EdgeIndex
  ): EdgeCompatibilityResult {
    const edgeType1 = tile1.edges[edge1];
    const edgeType2 = tile2.edges[edge2];

    return this.areEdgeTypesCompatible(edgeType1, edgeType2);
  }

  /**
   * Get all tiles that can be placed adjacent to a given tile at a specific edge
   * @param tile The reference tile
   * @param edgeIndex The edge index on the reference tile
   * @returns Array of tiles and their compatible edge indices
   */
  getCompatibleTiles(tile: TileDefinition, edgeIndex: EdgeIndex): Array<{
    tile: TileDefinition;
    edgeIndex: EdgeIndex;
  }> {
    const targetEdgeType = tile.edges[edgeIndex];
    const compatibleTiles: Array<{ tile: TileDefinition; edgeIndex: EdgeIndex }> = [];

    for (const candidateTile of this.assetPack.tiles) {
      for (let candidateEdgeIndex = 0; candidateEdgeIndex < 6; candidateEdgeIndex++) {
        const result = this.areEdgeTypesCompatible(
          targetEdgeType, 
          candidateTile.edges[candidateEdgeIndex]
        );

        if (result.compatible) {
          compatibleTiles.push({
            tile: candidateTile,
            edgeIndex: candidateEdgeIndex as EdgeIndex
          });
        }
      }
    }

    return compatibleTiles;
  }

  /**
   * Check if a tile can be placed at a position given its neighbors
   * @param tile The tile to place
   * @param constraints Array of edge constraints from neighbors
   */
  canTileFitConstraints(
    tile: TileDefinition,
    constraints: Array<{
      edgeIndex: EdgeIndex;
      requiredEdgeType: string;
    }>
  ): EdgeCompatibilityResult {
    for (const constraint of constraints) {
      const tileEdgeType = tile.edges[constraint.edgeIndex];
      const result = this.areEdgeTypesCompatible(tileEdgeType, constraint.requiredEdgeType);
      
      if (!result.compatible) {
        return {
          compatible: false,
          reason: `Tile '${tile.id}' edge ${constraint.edgeIndex} (${tileEdgeType}) incompatible with required edge type '${constraint.requiredEdgeType}': ${result.reason}`
        };
      }
    }

    return { compatible: true };
  }

  /**
   * Get all edge types that are compatible with a given edge type
   */
  getCompatibleEdgeTypes(edgeType: string): string[] {
    const compatibleTypes = new Set<string>();
    const targetEdge = this.assetPack.edge_types[edgeType];

    if (!targetEdge) {
      return [];
    }

    // Add self
    compatibleTypes.add(edgeType);

    // Add explicitly compatible types
    if (targetEdge.compatible_with) {
      targetEdge.compatible_with.forEach(type => compatibleTypes.add(type));
    }

    // Find types that list this edge as compatible
    for (const [otherEdgeType, otherEdge] of Object.entries(this.assetPack.edge_types)) {
      if (otherEdge.compatible_with?.includes(edgeType)) {
        compatibleTypes.add(otherEdgeType);
      }
    }

    return Array.from(compatibleTypes);
  }

  /**
   * Validate that all edge types in the asset pack have valid references
   */
  validateEdgeTypeReferences(): Array<{ error: string; edgeType: string }> {
    const errors: Array<{ error: string; edgeType: string }> = [];

    for (const [edgeTypeId, edgeType] of Object.entries(this.assetPack.edge_types)) {
      if (edgeType.compatible_with) {
        for (const compatibleType of edgeType.compatible_with) {
          if (!(compatibleType in this.assetPack.edge_types)) {
            errors.push({
              error: `Edge type '${edgeTypeId}' references unknown compatible type '${compatibleType}'`,
              edgeType: edgeTypeId
            });
          }
        }
      }
    }

    return errors;
  }

  /**
   * Create a compatibility matrix for all edge types
   */
  createCompatibilityMatrix(): Map<string, Set<string>> {
    const matrix = new Map<string, Set<string>>();

    for (const edgeType of Object.keys(this.assetPack.edge_types)) {
      matrix.set(edgeType, new Set(this.getCompatibleEdgeTypes(edgeType)));
    }

    return matrix;
  }
}