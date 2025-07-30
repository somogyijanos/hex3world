// Core hex coordinate system utilities

import { AxialCoordinate } from '../types/index';

export class HexCoordinates {
  /**
   * Convert axial coordinate to string key for maps/sets
   */
  static toKey(coord: AxialCoordinate): string {
    return `${coord.q},${coord.r}`;
  }

  /**
   * Convert string key back to axial coordinate
   */
  static fromKey(key: string): AxialCoordinate {
    const [q, r] = key.split(',').map(Number);
    if (isNaN(q) || isNaN(r)) {
      throw new Error(`Invalid coordinate key: ${key}`);
    }
    return { q, r };
  }

  /**
   * Get all 6 neighbors of a hex coordinate
   * Returns array in clockwise order matching the 3D scene coordinate system
   * Edge indexing matches: parallel_edge_direction z+, tile_up_axis y+, viewed from y-
   */
  static getNeighbors(coord: AxialCoordinate): AxialCoordinate[] {
    const { q, r } = coord;
    return [
      { q: q, r: r + 1 },     // Edge 0: bottom-right
      { q: q - 1, r: r + 1 }, // Edge 1: bottom-left  
      { q: q - 1, r: r },     // Edge 2: left
      { q: q, r: r - 1 },     // Edge 3: top-left
      { q: q + 1, r: r - 1 }, // Edge 4: top-right
      { q: q + 1, r: r }      // Edge 5: right
    ];
  }

  /**
   * Get neighbor at specific edge direction
   * @param coord - Source coordinate
   * @param edgeIndex - Edge index (0-5, clockwise from top-right)
   */
  static getNeighborAtEdge(coord: AxialCoordinate, edgeIndex: number): AxialCoordinate {
    const neighbors = this.getNeighbors(coord);
    return neighbors[edgeIndex % 6];
  }

  /**
   * Get the edge index that connects from one hex to its neighbor
   * @param from - Source coordinate  
   * @param to - Target coordinate
   * @returns Edge index (0-5) or -1 if not adjacent
   */
  static getEdgeToNeighbor(from: AxialCoordinate, to: AxialCoordinate): number {
    const neighbors = this.getNeighbors(from);
    for (let i = 0; i < 6; i++) {
      if (neighbors[i].q === to.q && neighbors[i].r === to.r) {
        return i;
      }
    }
    return -1; // Not adjacent
  }

  /**
   * Get the opposite edge index (edge on the other side of the hex)
   * @param edgeIndex - Original edge index (0-5)
   * @returns Opposite edge index (0-5)
   */
  static getOppositeEdgeIndex(edgeIndex: number): number {
    return (edgeIndex + 3) % 6;
  }
}

/**
 * Rotate a hex tile's edge array by the specified number of 60-degree steps
 * @param edges - Array of 6 edge types (clockwise from edge 0)
 * @param rotationSteps - Number of 60-degree steps to rotate
 *                       - Positive: shift right (clockwise visual rotation)
 *                       - Negative: shift left (counterclockwise visual rotation)
 * @returns Rotated edge array
 */
export function rotateEdgeArray(edges: [string, string, string, string, string, string], rotationSteps: number): [string, string, string, string, string, string] {
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
 * Rotate a hex tile's vertex array by the specified number of 60-degree steps
 * @param vertices - Array of 6 vertex material arrays (clockwise from top-right)
 * @param rotationSteps - Number of 60-degree steps to rotate (0-5)
 * @returns Rotated vertex array
 */
export function rotateVertexArray(vertices: [string[], string[], string[], string[], string[], string[]], rotationSteps: number): [string[], string[], string[], string[], string[], string[]] {
  if (rotationSteps === 0) return vertices;
  
  const normalizedSteps = ((rotationSteps % 6) + 6) % 6; // Handle negative values
  if (normalizedSteps === 0) return vertices;
  
  // Rotate by moving elements to the left by rotationSteps positions
  const rotated = [...vertices.slice(normalizedSteps), ...vertices.slice(0, normalizedSteps)];
  return rotated as [string[], string[], string[], string[], string[], string[]];
}

/**
 * Get the effective edges of a tile after applying both asset pack edge indexing and tile rotation
 * @param tileDefinition - The tile definition
 * @param assetPack - The asset pack containing geometry config
 * @param rotation - Tile rotation steps (0-5)
 * @returns The properly indexed and rotated edge array
 */
export function getRotatedTileEdges(
  tileDefinition: { edges: [string, string, string, string, string, string] }, 
  assetPack: { geometry_config: { edge_indexing_offset?: number; edge_indexing_direction?: 'clockwise' | 'counterclockwise' } },
  rotation: number = 0
): [string, string, string, string, string, string] {
  let edges = [...tileDefinition.edges] as [string, string, string, string, string, string];
  
  // Step 1: Apply asset pack edge indexing offset and direction
  const edgeIndexingOffset = assetPack.geometry_config.edge_indexing_offset || 0;
  const edgeIndexingDirection = assetPack.geometry_config.edge_indexing_direction || 'clockwise';
  
  if (edgeIndexingOffset !== 0) {
    // UNDO the asset pack's edge indexing offset
    if (edgeIndexingDirection === 'clockwise') {
      // For clockwise offset: undo by rotating -offset
      edges = rotateEdgeArray(edges, -edgeIndexingOffset);
    } else {
      // For counterclockwise offset: undo by rotating +offset
      edges = rotateEdgeArray(edges, edgeIndexingOffset);
    }
  }
  
  // Step 2: Apply tile-specific rotation
  if (rotation !== 0) {
    // For clockwise tile rotation: shift edge types to the 'right' by rotation steps
    // This means positive rotation direction
    edges = rotateEdgeArray(edges, rotation);
  }
  
  return edges;
}