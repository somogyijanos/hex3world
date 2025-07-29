import { AssetPack, TileDefinition, AddOnDefinition, EdgeTypes } from '../types/index';

export class AssetPackValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'AssetPackValidationError';
  }
}

export class AssetPackManager {
  private loadedPacks = new Map<string, AssetPack>();

  async loadAssetPack(packData: unknown): Promise<AssetPack> {
    const pack = this.validateAssetPack(packData);
    this.loadedPacks.set(pack.id, pack);
    return pack;
  }

  // For web applications, use loadAssetPackFromUrl() instead
  async loadAssetPackFromFile(filePath: string): Promise<AssetPack> {
    throw new AssetPackValidationError(`File system operations not available in browser environment. Cannot load from ${filePath}. Use loadAssetPackFromUrl() instead.`);
  }

  /**
   * Load asset pack from URL (recommended for web applications)
   */
  async loadAssetPackFromUrl(url: string): Promise<AssetPack> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const packData = await response.json();
      return this.loadAssetPack(packData);
    } catch (error) {
      throw new AssetPackValidationError(`Failed to load asset pack from ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getAssetPack(packId: string): AssetPack | undefined {
    return this.loadedPacks.get(packId);
  }

  getAllAssetPacks(): AssetPack[] {
    return Array.from(this.loadedPacks.values());
  }

  getTileDefinition(packId: string, tileId: string): TileDefinition | undefined {
    const pack = this.getAssetPack(packId);
    return pack?.tiles.find(tile => tile.id === tileId);
  }

  getAddOnDefinition(packId: string, addOnId: string): AddOnDefinition | undefined {
    const pack = this.getAssetPack(packId);
    return pack?.addons.find(addon => addon.id === addOnId);
  }

  private validateAssetPack(data: unknown): AssetPack {
    if (!data || typeof data !== 'object') {
      throw new AssetPackValidationError('Asset pack must be an object');
    }

    const pack = data as Record<string, unknown>;

    // Validate required fields (based on JSON Schema)
    this.validateRequired(pack, 'id', 'string');
    this.validateRequired(pack, 'name', 'string');
    this.validateRequired(pack, 'version', 'string');
    // description is optional in schema
    this.validateRequired(pack, 'geometry_config', 'object');
    this.validateRequired(pack, 'materials', 'object');
    this.validateRequired(pack, 'edge_types', 'object');
    this.validateRequired(pack, 'tiles', 'object');
    this.validateRequired(pack, 'addons', 'object');

    // Validate geometry config
    this.validateGeometryConfig(pack.geometry_config);

    // Validate materials array
    if (!Array.isArray(pack.materials)) {
      throw new AssetPackValidationError('materials must be an array', 'materials');
    }

    // Validate edge types
    this.validateEdgeTypes(pack.edge_types as EdgeTypes, pack.materials as string[]);

    // Validate tiles array
    if (!Array.isArray(pack.tiles)) {
      throw new AssetPackValidationError('tiles must be an array', 'tiles');
    }
    pack.tiles.forEach((tile, index) => this.validateTile(tile, index, pack.edge_types as EdgeTypes, pack.materials as string[]));

    // Validate addons array
    if (!Array.isArray(pack.addons)) {
      throw new AssetPackValidationError('addons must be an array', 'addons');
    }
    pack.addons.forEach((addon, index) => this.validateAddOn(addon, index));

    return pack as unknown as AssetPack;
  }

  private validateRequired(obj: Record<string, unknown>, field: string, type: string): void {
    if (!(field in obj)) {
      throw new AssetPackValidationError(`Missing required field: ${field}`, field);
    }
    if (type === 'object' && (obj[field] === null || typeof obj[field] !== 'object')) {
      throw new AssetPackValidationError(`Field ${field} must be an object`, field);
    }
    if (type === 'string' && typeof obj[field] !== 'string') {
      throw new AssetPackValidationError(`Field ${field} must be a string`, field);
    }
  }

  private validateGeometryConfig(config: unknown): void {
    if (!config || typeof config !== 'object') {
      throw new AssetPackValidationError('geometry_config must be an object', 'geometry_config');
    }

    const gc = config as Record<string, unknown>;
    const validAxes = ['x+', 'x-', 'y+', 'y-', 'z+', 'z-'];

    if (!validAxes.includes(gc.tile_up_axis as string)) {
      throw new AssetPackValidationError('geometry_config.tile_up_axis must be one of: ' + validAxes.join(', '), 'geometry_config.tile_up_axis');
    }

    if (!validAxes.includes(gc.parallel_edge_direction as string)) {
      throw new AssetPackValidationError('geometry_config.parallel_edge_direction must be one of: ' + validAxes.join(', '), 'geometry_config.parallel_edge_direction');
    }

    if (typeof gc.tile_circumradius !== 'number' || gc.tile_circumradius <= 0) {
      throw new AssetPackValidationError('geometry_config.tile_circumradius must be a positive number', 'geometry_config.tile_circumradius');
    }
  }

  private validateEdgeTypes(edgeTypes: EdgeTypes, materials: string[]): void {
    for (const [edgeTypeId, edgeType] of Object.entries(edgeTypes)) {
      if (!Array.isArray(edgeType.materials)) {
        throw new AssetPackValidationError(`edge_types.${edgeTypeId}.materials must be an array`, `edge_types.${edgeTypeId}.materials`);
      }

      // Validate materials exist in the pack's materials list
      for (const material of edgeType.materials) {
        if (!materials.includes(material)) {
          throw new AssetPackValidationError(`edge_types.${edgeTypeId} references unknown material: ${material}`, `edge_types.${edgeTypeId}.materials`);
        }
      }

      // Validate compatible_with references exist
      if (edgeType.compatible_with) {
        if (!Array.isArray(edgeType.compatible_with)) {
          throw new AssetPackValidationError(`edge_types.${edgeTypeId}.compatible_with must be an array`, `edge_types.${edgeTypeId}.compatible_with`);
        }
        for (const compatibleType of edgeType.compatible_with) {
          if (!(compatibleType in edgeTypes)) {
            throw new AssetPackValidationError(`edge_types.${edgeTypeId}.compatible_with references unknown edge type: ${compatibleType}`, `edge_types.${edgeTypeId}.compatible_with`);
          }
        }
      }
    }
  }

  private validateTile(tile: unknown, index: number, edgeTypes: EdgeTypes, materials: string[]): void {
    if (!tile || typeof tile !== 'object') {
      throw new AssetPackValidationError(`tiles[${index}] must be an object`, `tiles[${index}]`);
    }

    const t = tile as Record<string, unknown>;

    // Required fields (based on JSON Schema: id, model, edges)
    this.validateRequired(t, 'id', 'string');
    this.validateRequired(t, 'model', 'string');
    this.validateRequired(t, 'edges', 'object');
    
    // Optional fields
    if (t.base_material && typeof t.base_material !== 'string') {
      throw new AssetPackValidationError(`tiles[${index}].base_material must be a string`, `tiles[${index}].base_material`);
    }
    if (t.tags && !Array.isArray(t.tags)) {
      throw new AssetPackValidationError(`tiles[${index}].tags must be an array`, `tiles[${index}].tags`);
    }
    if (t.vertices && !Array.isArray(t.vertices)) {
      throw new AssetPackValidationError(`tiles[${index}].vertices must be an array`, `tiles[${index}].vertices`);
    }

    // Validate base_material exists (if provided)
    if (t.base_material && !materials.includes(t.base_material as string)) {
      throw new AssetPackValidationError(`tiles[${index}].base_material references unknown material: ${t.base_material}`, `tiles[${index}].base_material`);
    }

    // Validate edges array (must have exactly 6 elements)
    if (!Array.isArray(t.edges) || t.edges.length !== 6) {
      throw new AssetPackValidationError(`tiles[${index}].edges must be an array of exactly 6 elements`, `tiles[${index}].edges`);
    }
    t.edges.forEach((edgeType, edgeIndex) => {
      if (!(edgeType in edgeTypes)) {
        throw new AssetPackValidationError(`tiles[${index}].edges[${edgeIndex}] references unknown edge type: ${edgeType}`, `tiles[${index}].edges[${edgeIndex}]`);
      }
    });

    // Validate vertices array (if provided, must have exactly 6 elements, each an array of materials)
    if (t.vertices) {
      if (!Array.isArray(t.vertices) || t.vertices.length !== 6) {
        throw new AssetPackValidationError(`tiles[${index}].vertices must be an array of exactly 6 elements`, `tiles[${index}].vertices`);
      }
      t.vertices.forEach((vertex, vertexIndex) => {
        if (!Array.isArray(vertex)) {
          throw new AssetPackValidationError(`tiles[${index}].vertices[${vertexIndex}] must be an array`, `tiles[${index}].vertices[${vertexIndex}]`);
        }
        vertex.forEach((material, materialIndex) => {
          if (!materials.includes(material)) {
            throw new AssetPackValidationError(`tiles[${index}].vertices[${vertexIndex}][${materialIndex}] references unknown material: ${material}`, `tiles[${index}].vertices[${vertexIndex}][${materialIndex}]`);
          }
        });
      });
    }
  }

  private validateAddOn(addon: unknown, index: number): void {
    if (!addon || typeof addon !== 'object') {
      throw new AssetPackValidationError(`addons[${index}] must be an object`, `addons[${index}]`);
    }

    const a = addon as Record<string, unknown>;

    // Required fields
    this.validateRequired(a, 'id', 'string');
    this.validateRequired(a, 'model', 'string');
    this.validateRequired(a, 'tags', 'object');
    this.validateRequired(a, 'placement', 'object');

    // Validate tags array
    if (!Array.isArray(a.tags)) {
      throw new AssetPackValidationError(`addons[${index}].tags must be an array`, `addons[${index}].tags`);
    }

    // Validate placement object
    const placement = a.placement as Record<string, unknown>;
    this.validateRequired(placement, 'tile_tags', 'object');
    this.validateRequired(placement, 'local_position', 'object');
    
    if (!Array.isArray(placement.tile_tags)) {
      throw new AssetPackValidationError(`addons[${index}].placement.tile_tags must be an array`, `addons[${index}].placement.tile_tags`);
    }

    if (!Array.isArray(placement.local_position) || placement.local_position.length !== 3) {
      throw new AssetPackValidationError(`addons[${index}].placement.local_position must be an array of 3 numbers`, `addons[${index}].placement.local_position`);
    }

    if (typeof placement.local_rotation !== 'number') {
      throw new AssetPackValidationError(`addons[${index}].placement.local_rotation must be a number`, `addons[${index}].placement.local_rotation`);
    }

    if (typeof placement.local_scale !== 'number') {
      throw new AssetPackValidationError(`addons[${index}].placement.local_scale must be a number`, `addons[${index}].placement.local_scale`);
    }
  }
}