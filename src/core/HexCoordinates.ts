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
}