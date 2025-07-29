// Core hex coordinate system utilities

import { AxialCoordinate } from '../types/index';
import { TileDefinition } from '../types';

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
}

/**
 * Rotate a hex tile's edge array by the specified number of 60-degree steps
 * @param edges - Array of 6 edge types (clockwise from top-right)
 * @param rotationSteps - Number of 60-degree steps to rotate (0-5)
 * @returns Rotated edge array
 */
export function rotateEdgeArray(edges: [string, string, string, string, string, string], rotationSteps: number): [string, string, string, string, string, string] {
  if (rotationSteps === 0) return edges;
  
  const normalizedSteps = ((rotationSteps % 6) + 6) % 6; // Handle negative values
  if (normalizedSteps === 0) return edges;
  
  // Rotate by moving elements to the left by rotationSteps positions
  const rotated = [...edges.slice(normalizedSteps), ...edges.slice(0, normalizedSteps)];
  return rotated as [string, string, string, string, string, string];
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
 * Get the effective edges of a tile after applying rotation
 * @param tileDefinition - The tile definition
 * @param rotation - Rotation steps (0-5)
 * @returns The rotated edge array
 */
export function getRotatedTileEdges(tileDefinition: { edges: [string, string, string, string, string, string] }, rotation: number = 0): [string, string, string, string, string, string] {
  return rotateEdgeArray(tileDefinition.edges, rotation);
}