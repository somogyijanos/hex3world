import { World, WorldTile, WorldAddOn, AssetPack, AxialCoordinate } from '../types/index';
import { AssetPackManager } from './AssetPackManager';
import { HexCoordinates } from './HexCoordinates';

export class WorldValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'WorldValidationError';
  }
}

export class WorldManager {
  private assetPackManager: AssetPackManager;

  constructor(assetPackManager: AssetPackManager) {
    this.assetPackManager = assetPackManager;
  }

  /**
   * Create a new empty world
   */
  createWorld(assetPackId: string): World {
    const pack = this.assetPackManager.getAssetPack(assetPackId);
    if (!pack) {
      throw new WorldValidationError(`Asset pack '${assetPackId}' not found`);
    }

    return {
      asset_pack: assetPackId,
      tiles: [],
      addons: []
    };
  }

  /**
   * Validate a world against its asset pack
   */
  validateWorld(world: World): void {
    const pack = this.assetPackManager.getAssetPack(world.asset_pack);
    if (!pack) {
      throw new WorldValidationError(`Asset pack '${world.asset_pack}' not found`, 'asset_pack');
    }

    // Validate tiles
    if (!Array.isArray(world.tiles)) {
      throw new WorldValidationError('World tiles must be an array', 'tiles');
    }

    const tilePositions = new Set<string>();
    for (let i = 0; i < world.tiles.length; i++) {
      const tile = world.tiles[i];
      this.validateWorldTile(tile, i, pack);
      
      // Check for duplicate positions
      const posKey = HexCoordinates.toKey({ q: tile.q, r: tile.r });
      if (tilePositions.has(posKey)) {
        throw new WorldValidationError(`Duplicate tile at position (${tile.q}, ${tile.r})`, `tiles[${i}]`);
      }
      tilePositions.add(posKey);
    }

    // Validate addons
    if (!Array.isArray(world.addons)) {
      throw new WorldValidationError('World addons must be an array', 'addons');
    }

    for (let i = 0; i < world.addons.length; i++) {
      this.validateWorldAddOn(world.addons[i], i, pack, world.tiles);
    }
  }

  private validateWorldTile(tile: WorldTile, index: number, pack: AssetPack): void {
    if (!tile || typeof tile !== 'object') {
      throw new WorldValidationError(`tiles[${index}] must be an object`, `tiles[${index}]`);
    }

    // Validate required fields
    if (typeof tile.tile_type !== 'string') {
      throw new WorldValidationError(`tiles[${index}].tile_type must be a string`, `tiles[${index}].tile_type`);
    }

    if (typeof tile.q !== 'number' || !Number.isInteger(tile.q)) {
      throw new WorldValidationError(`tiles[${index}].q must be an integer`, `tiles[${index}].q`);
    }

    if (typeof tile.r !== 'number' || !Number.isInteger(tile.r)) {
      throw new WorldValidationError(`tiles[${index}].r must be an integer`, `tiles[${index}].r`);
    }

    if (typeof tile.elevation !== 'number') {
      throw new WorldValidationError(`tiles[${index}].elevation must be a number`, `tiles[${index}].elevation`);
    }

    // Validate tile_type exists in asset pack
    const tileDefinition = pack.tiles.find(t => t.id === tile.tile_type);
    if (!tileDefinition) {
      throw new WorldValidationError(`tiles[${index}].tile_type '${tile.tile_type}' not found in asset pack`, `tiles[${index}].tile_type`);
    }
  }

  private validateWorldAddOn(addon: WorldAddOn, index: number, pack: AssetPack, tiles: WorldTile[]): void {
    if (!addon || typeof addon !== 'object') {
      throw new WorldValidationError(`addons[${index}] must be an object`, `addons[${index}]`);
    }

    // Validate required fields
    if (typeof addon.addon_id !== 'string') {
      throw new WorldValidationError(`addons[${index}].addon_id must be a string`, `addons[${index}].addon_id`);
    }

    if (typeof addon.q !== 'number' || !Number.isInteger(addon.q)) {
      throw new WorldValidationError(`addons[${index}].q must be an integer`, `addons[${index}].q`);
    }

    if (typeof addon.r !== 'number' || !Number.isInteger(addon.r)) {
      throw new WorldValidationError(`addons[${index}].r must be an integer`, `addons[${index}].r`);
    }

    if (!Array.isArray(addon.local_position) || addon.local_position.length !== 3) {
      throw new WorldValidationError(`addons[${index}].local_position must be an array of 3 numbers`, `addons[${index}].local_position`);
    }

    if (typeof addon.local_rotation !== 'number') {
      throw new WorldValidationError(`addons[${index}].local_rotation must be a number`, `addons[${index}].local_rotation`);
    }

    if (typeof addon.local_scale !== 'number') {
      throw new WorldValidationError(`addons[${index}].local_scale must be a number`, `addons[${index}].local_scale`);
    }

    // Validate addon_id exists in asset pack
    const addonDefinition = pack.addons.find(a => a.id === addon.addon_id);
    if (!addonDefinition) {
      throw new WorldValidationError(`addons[${index}].addon_id '${addon.addon_id}' not found in asset pack`, `addons[${index}].addon_id`);
    }

    // Validate that there's a tile at the addon's position
    const tileAtPosition = tiles.find(t => t.q === addon.q && t.r === addon.r);
    if (!tileAtPosition) {
      throw new WorldValidationError(`addons[${index}] at position (${addon.q}, ${addon.r}) has no corresponding tile`, `addons[${index}]`);
    }

    // Validate addon placement compatibility with tile
    const tileDefinition = pack.tiles.find(t => t.id === tileAtPosition.tile_type);
    if (tileDefinition) {
      const hasMatchingTag = addonDefinition.placement.tile_tags.some(tag =>
        tileDefinition.tags.includes(tag)
      );
      
      if (!hasMatchingTag) {
        throw new WorldValidationError(
          `addons[${index}] '${addon.addon_id}' cannot be placed on tile '${tileAtPosition.tile_type}' - no matching tags`,
          `addons[${index}]`
        );
      }
    }
  }

  /**
   * Add a tile to the world
   */
  addTile(world: World, tile: WorldTile): void {
    // Check for existing tile at position
    const existingTile = world.tiles.find(t => t.q === tile.q && t.r === tile.r);
    if (existingTile) {
      throw new WorldValidationError(`Tile already exists at position (${tile.q}, ${tile.r})`);
    }

    // Validate the tile
    const pack = this.assetPackManager.getAssetPack(world.asset_pack);
    if (!pack) {
      throw new WorldValidationError(`Asset pack '${world.asset_pack}' not found`);
    }

    this.validateWorldTile(tile, world.tiles.length, pack);
    world.tiles.push(tile);
  }

  /**
   * Remove a tile from the world
   */
  removeTile(world: World, coord: AxialCoordinate): boolean {
    const index = world.tiles.findIndex(t => t.q === coord.q && t.r === coord.r);
    if (index === -1) {
      return false;
    }

    // Remove the tile
    world.tiles.splice(index, 1);

    // Remove any addons at this position
    world.addons = world.addons.filter(addon => !(addon.q === coord.q && addon.r === coord.r));

    return true;
  }

  /**
   * Add an addon to the world
   */
  addAddOn(world: World, addon: WorldAddOn): void {
    const pack = this.assetPackManager.getAssetPack(world.asset_pack);
    if (!pack) {
      throw new WorldValidationError(`Asset pack '${world.asset_pack}' not found`);
    }

    this.validateWorldAddOn(addon, world.addons.length, pack, world.tiles);
    world.addons.push(addon);
  }

  /**
   * Remove an addon from the world
   */
  removeAddOn(world: World, index: number): boolean {
    if (index < 0 || index >= world.addons.length) {
      return false;
    }

    world.addons.splice(index, 1);
    return true;
  }

  /**
   * Get tile at specific coordinates
   */
  getTileAt(world: World, coord: AxialCoordinate): WorldTile | undefined {
    return world.tiles.find(t => t.q === coord.q && t.r === coord.r);
  }

  /**
   * Get all addons at specific coordinates
   */
  getAddOnsAt(world: World, coord: AxialCoordinate): WorldAddOn[] {
    return world.addons.filter(addon => addon.q === coord.q && addon.r === coord.r);
  }

  /**
   * Get all occupied coordinates in the world
   */
  getOccupiedCoordinates(world: World): AxialCoordinate[] {
    return world.tiles.map(tile => ({ q: tile.q, r: tile.r }));
  }

  /**
   * Get the bounding box of the world
   */
  getBoundingBox(world: World): { min: AxialCoordinate; max: AxialCoordinate } | null {
    if (world.tiles.length === 0) {
      return null;
    }

    let minQ = world.tiles[0].q;
    let maxQ = world.tiles[0].q;
    let minR = world.tiles[0].r;
    let maxR = world.tiles[0].r;

    for (const tile of world.tiles) {
      minQ = Math.min(minQ, tile.q);
      maxQ = Math.max(maxQ, tile.q);
      minR = Math.min(minR, tile.r);
      maxR = Math.max(maxR, tile.r);
    }

    return {
      min: { q: minQ, r: minR },
      max: { q: maxQ, r: maxR }
    };
  }

  /**
   * Serialize world to JSON string
   */
  serializeWorld(world: World): string {
    this.validateWorld(world);
    return JSON.stringify(world, null, 2);
  }

  /**
   * Load world from JSON string
   */
  async loadWorldFromJson(jsonString: string): Promise<World> {
    let worldData: unknown;
    
    try {
      worldData = JSON.parse(jsonString);
    } catch (error) {
      throw new WorldValidationError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const world = this.validateWorldData(worldData);
    this.validateWorld(world);
    
    return world;
  }

  /**
   * Load world from file (server-side only)
   * For web applications, use loadWorldFromUrl() instead
   */
  async loadWorldFromFile(filePath: string): Promise<World> {
    throw new WorldValidationError(`File system operations not available in browser environment. Cannot load from ${filePath}. Use loadWorldFromUrl() instead.`);
  }

  /**
   * Load world from URL (recommended for web applications)
   */
  async loadWorldFromUrl(url: string): Promise<World> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
             const content = await response.text();
       return this.loadWorldFromJson(content);
    } catch (error) {
      throw new WorldValidationError(`Failed to load world from ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private validateWorldData(data: unknown): World {
    if (!data || typeof data !== 'object') {
      throw new WorldValidationError('World data must be an object');
    }

    const world = data as Record<string, unknown>;

    if (typeof world.asset_pack !== 'string') {
      throw new WorldValidationError('asset_pack must be a string', 'asset_pack');
    }

    if (!Array.isArray(world.tiles)) {
      throw new WorldValidationError('tiles must be an array', 'tiles');
    }

    if (!Array.isArray(world.addons)) {
      throw new WorldValidationError('addons must be an array', 'addons');
    }

    return world as unknown as World;
  }
}