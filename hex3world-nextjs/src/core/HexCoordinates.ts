import { AxialCoordinate, CubeCoordinate, EdgeIndex } from '../types/index';

export class HexCoordinates {
  /**
   * Convert axial coordinates (q, r) to cube coordinates (x, y, z)
   */
  static axialToCube(axial: AxialCoordinate): CubeCoordinate {
    const x = axial.q;
    const z = axial.r;
    const y = -x - z;
    return { x, y, z };
  }

  /**
   * Convert cube coordinates (x, y, z) to axial coordinates (q, r)
   */
  static cubeToAxial(cube: CubeCoordinate): AxialCoordinate {
    return { q: cube.x, r: cube.z };
  }

  /**
   * Get the 6 axial neighbors of a hex tile (clockwise from top-right)
   * Edge index 0 = top-right neighbor, 1 = right, 2 = bottom-right, etc.
   */
  static getNeighbors(coord: AxialCoordinate): AxialCoordinate[] {
    const { q, r } = coord;
    return [
      { q: q + 1, r: r - 1 }, // 0: top-right
      { q: q + 1, r: r },     // 1: right  
      { q: q, r: r + 1 },     // 2: bottom-right
      { q: q - 1, r: r + 1 }, // 3: bottom-left
      { q: q - 1, r: r },     // 4: left
      { q: q, r: r - 1 }      // 5: top-left
    ];
  }

  /**
   * Get a specific neighbor by edge index
   */
  static getNeighbor(coord: AxialCoordinate, edgeIndex: EdgeIndex): AxialCoordinate {
    return this.getNeighbors(coord)[edgeIndex];
  }

  /**
   * Calculate the distance between two hex coordinates
   */
  static distance(a: AxialCoordinate, b: AxialCoordinate): number {
    const cubeA = this.axialToCube(a);
    const cubeB = this.axialToCube(b);
    
    return Math.max(
      Math.abs(cubeA.x - cubeB.x),
      Math.abs(cubeA.y - cubeB.y),
      Math.abs(cubeA.z - cubeB.z)
    );
  }

  /**
   * Get all coordinates within a given range of a center coordinate
   */
  static getRange(center: AxialCoordinate, range: number): AxialCoordinate[] {
    const results: AxialCoordinate[] = [];
    
    for (let q = -range; q <= range; q++) {
      const r1 = Math.max(-range, -q - range);
      const r2 = Math.min(range, -q + range);
      
      for (let r = r1; r <= r2; r++) {
        results.push({
          q: center.q + q,
          r: center.r + r
        });
      }
    }
    
    return results;
  }

  /**
   * Get coordinates in a ring around a center at a specific distance
   */
  static getRing(center: AxialCoordinate, radius: number): AxialCoordinate[] {
    if (radius === 0) {
      return [center];
    }
    
    const results: AxialCoordinate[] = [];
    let coord = { q: center.q - radius, r: center.r + radius };
    
    // Walk around the ring in 6 directions
    const directions = [
      { q: 1, r: -1 }, // northeast
      { q: 1, r: 0 },  // east
      { q: 0, r: 1 },  // southeast
      { q: -1, r: 1 }, // southwest
      { q: -1, r: 0 }, // west
      { q: 0, r: -1 }  // northwest
    ];
    
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < radius; j++) {
        results.push({ ...coord });
        coord.q += directions[i].q;
        coord.r += directions[i].r;
      }
    }
    
    return results;
  }

  /**
   * Check if two coordinates are equal
   */
  static equals(a: AxialCoordinate, b: AxialCoordinate): boolean {
    return a.q === b.q && a.r === b.r;
  }

  /**
   * Find which edge connects to a neighbor
   * Returns the edge index (0-5) or -1 if not adjacent
   */
  static getEdgeToNeighbor(from: AxialCoordinate, to: AxialCoordinate): EdgeIndex | -1 {
    const neighbors = this.getNeighbors(from);
    
    for (let i = 0; i < 6; i++) {
      if (this.equals(neighbors[i], to)) {
        return i as EdgeIndex;
      }
    }
    
    return -1;
  }

  /**
   * Get the opposite edge index (edge on the neighbor that connects back)
   */
  static getOppositeEdge(edgeIndex: EdgeIndex): EdgeIndex {
    return ((edgeIndex + 3) % 6) as EdgeIndex;
  }

  /**
   * Convert coordinate to a string key for use in Maps/Sets
   */
  static toKey(coord: AxialCoordinate): string {
    return `${coord.q},${coord.r}`;
  }

  /**
   * Parse a coordinate from a string key
   */
  static fromKey(key: string): AxialCoordinate {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
  }

  /**
   * Rotate a coordinate around the origin by 60-degree steps
   * @param coord The coordinate to rotate
   * @param steps Number of 60-degree steps (positive = clockwise)
   */
  static rotate(coord: AxialCoordinate, steps: number): AxialCoordinate {
    const cube = this.axialToCube(coord);
    let { x, y, z } = cube;
    
    // Normalize steps to 0-5 range
    steps = ((steps % 6) + 6) % 6;
    
    for (let i = 0; i < steps; i++) {
      // Rotate 60 degrees clockwise in cube space
      const newX = -z;
      const newY = -x;
      const newZ = -y;
      x = newX;
      y = newY;
      z = newZ;
    }
    
    return this.cubeToAxial({ x, y, z });
  }
}