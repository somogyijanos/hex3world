import { World, WorldTile, WorldAddOn, AssetPack, TileDefinition } from '../types/index';
import { EdgeValidator, EdgeValidationResult } from './EdgeValidator';
import { AssetPackManager } from './AssetPackManager';
import { HexCoordinates } from './HexCoordinates';
import { 
  LLMTool, 
  WorldSnapshot, 
  NeighborInfo, 
  TilePlacementSuggestion 
} from '../types/llm';

export class LLMToolsProvider {
  private assetPackManager: AssetPackManager;
  private edgeValidator: EdgeValidator;
  private currentWorld: World | null = null;

  constructor(assetPackManager: AssetPackManager) {
    this.assetPackManager = assetPackManager;
    this.edgeValidator = new EdgeValidator(assetPackManager);
  }

  setCurrentWorld(world: World): void {
    this.currentWorld = world;
  }

  /**
   * Get all available LLM tools
   */
  getTools(): LLMTool[] {
    return [
      this.createValidateEdgeConnectionTool(),
      this.createGetWorldStateTool(),
      this.createGetAvailableTileTypesTool(),
      this.createGetNeighborInfoTool(),
      this.createSuggestCompatibleTilesTool(),
      this.createPlaceTileTool(),
      this.createPlaceAddonTool(),
      this.createGetAssetPackInfoTool(),
      this.createFindEmptyPositionsTool(),
      this.createCalculateDistanceTool(),
      this.createValidateWorldTool()
    ];
  }

  private createValidateEdgeConnectionTool(): LLMTool {
    return {
      name: 'validate_edge_connection',
      description: 'Validate if two tiles can be placed next to each other by checking edge compatibility',
      parameters: {
        type: 'object',
        properties: {
          sourceTileType: {
            type: 'string',
            description: 'The tile type ID of the first tile'
          },
          sourcePosition: {
            type: 'object',
            description: 'Position of the first tile',
            properties: {
              q: { type: 'number', description: 'Q coordinate' },
              r: { type: 'number', description: 'R coordinate' }
            }
          },
          sourceRotation: {
            type: 'number',
            description: 'Rotation of the first tile (0-5, in 60-degree steps)'
          },
          targetTileType: {
            type: 'string',
            description: 'The tile type ID of the second tile'
          },
          targetPosition: {
            type: 'object',
            description: 'Position of the second tile',
            properties: {
              q: { type: 'number', description: 'Q coordinate' },
              r: { type: 'number', description: 'R coordinate' }
            }
          },
          targetRotation: {
            type: 'number',
            description: 'Rotation of the second tile (0-5, in 60-degree steps)'
          }
        },
        required: ['sourceTileType', 'sourcePosition', 'targetTileType', 'targetPosition']
      },
      handler: this.handleValidateEdgeConnection.bind(this)
    };
  }

  private createGetWorldStateTool(): LLMTool {
    return {
      name: 'get_world_state',
      description: 'Get complete information about the current world state including all placed tiles',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: this.handleGetWorldState.bind(this)
    };
  }

  private createGetAvailableTileTypesTool(): LLMTool {
    return {
      name: 'get_available_tile_types',
      description: 'Get all available tile types from the current asset pack with their properties',
      parameters: {
        type: 'object',
        properties: {
          filterByTags: {
            type: 'array',
            description: 'Optional: filter tiles by specific tags',
            items: { type: 'string', description: 'Tag name' }
          }
        },
        required: []
      },
      handler: this.handleGetAvailableTileTypes.bind(this)
    };
  }

  private createGetNeighborInfoTool(): LLMTool {
    return {
      name: 'get_neighbor_info',
      description: 'Get information about all 6 neighbors of a hex position',
      parameters: {
        type: 'object',
        properties: {
          position: {
            type: 'object',
            description: 'The center position to check neighbors for',
            properties: {
              q: { type: 'number', description: 'Q coordinate' },
              r: { type: 'number', description: 'R coordinate' }
            }
          }
        },
        required: ['position']
      },
      handler: this.handleGetNeighborInfo.bind(this)
    };
  }

  private createSuggestCompatibleTilesTool(): LLMTool {
    return {
      name: 'suggest_compatible_tiles',
      description: 'Get suggestions for tile types that would be compatible at a specific position',
      parameters: {
        type: 'object',
        properties: {
          position: {
            type: 'object',
            description: 'Position to place tile at',
            properties: {
              q: { type: 'number', description: 'Q coordinate' },
              r: { type: 'number', description: 'R coordinate' }
            }
          },
          maxSuggestions: {
            type: 'number',
            description: 'Maximum number of suggestions to return (default: 10)'
          }
        },
        required: ['position']
      },
      handler: this.handleSuggestCompatibleTiles.bind(this)
    };
  }

  private createPlaceTileTool(): LLMTool {
    return {
      name: 'place_tile',
      description: 'Place a tile at a specific position and validate it automatically',
      parameters: {
        type: 'object',
        properties: {
          tileType: {
            type: 'string',
            description: 'The tile type ID to place'
          },
          position: {
            type: 'object',
            description: 'Position to place the tile',
            properties: {
              q: { type: 'number', description: 'Q coordinate' },
              r: { type: 'number', description: 'R coordinate' }
            }
          },
          rotation: {
            type: 'number',
            description: 'Rotation of the tile (0-5, in 60-degree steps, default: 0)'
          },
          elevation: {
            type: 'number',
            description: 'Elevation of the tile (default: 0)'
          }
        },
        required: ['tileType', 'position']
      },
      handler: this.handlePlaceTile.bind(this)
    };
  }

  private createPlaceAddonTool(): LLMTool {
    return {
      name: 'place_addon',
      description: 'Place an addon (like a tree, building, or decoration) on top of an existing tile',
      parameters: {
        type: 'object',
        properties: {
          addonId: {
            type: 'string',
            description: 'The addon ID to place (e.g., "tree-single-a", "tree-single-b")'
          },
          position: {
            type: 'object',
            description: 'Position of the tile to place the addon on',
            properties: {
              q: { type: 'number', description: 'Q coordinate' },
              r: { type: 'number', description: 'R coordinate' }
            }
          },
          localRotation: {
            type: 'number',
            description: 'Local rotation of the addon in degrees (default: 0)'
          },
          localScale: {
            type: 'number',
            description: 'Local scale of the addon (default: 1.0)'
          }
        },
        required: ['addonId', 'position']
      },
      handler: this.handlePlaceAddon.bind(this)
    };
  }

  private createGetAssetPackInfoTool(): LLMTool {
    return {
      name: 'get_asset_pack_info',
      description: 'Get complete information about the current asset pack including all tiles, edge types, and materials',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: this.handleGetAssetPackInfo.bind(this)
    };
  }

  private createFindEmptyPositionsTool(): LLMTool {
    return {
      name: 'find_empty_positions',
      description: 'Find all empty positions within a certain radius of existing tiles',
      parameters: {
        type: 'object',
        properties: {
          centerPosition: {
            type: 'object',
            description: 'Center position to search from (optional, defaults to world center)',
            properties: {
              q: { type: 'number', description: 'Q coordinate' },
              r: { type: 'number', description: 'R coordinate' }
            }
          },
          radius: {
            type: 'number',
            description: 'Maximum radius to search (default: 5)'
          },
          adjacentOnly: {
            type: 'boolean',
            description: 'Only return positions adjacent to existing tiles (default: false)'
          }
        },
        required: []
      },
      handler: this.handleFindEmptyPositions.bind(this)
    };
  }

  private createCalculateDistanceTool(): LLMTool {
    return {
      name: 'calculate_distance',
      description: 'Calculate hex distance between two positions',
      parameters: {
        type: 'object',
        properties: {
          position1: {
            type: 'object',
            description: 'First position',
            properties: {
              q: { type: 'number', description: 'Q coordinate' },
              r: { type: 'number', description: 'R coordinate' }
            }
          },
          position2: {
            type: 'object',
            description: 'Second position',
            properties: {
              q: { type: 'number', description: 'Q coordinate' },
              r: { type: 'number', description: 'R coordinate' }
            }
          }
        },
        required: ['position1', 'position2']
      },
      handler: this.handleCalculateDistance.bind(this)
    };
  }

  private createValidateWorldTool(): LLMTool {
    return {
      name: 'validate_world',
      description: 'Run complete validation on the current world state',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: this.handleValidateWorld.bind(this)
    };
  }

  // Tool Handlers

  private async handleValidateEdgeConnection(params: Record<string, unknown>): Promise<EdgeValidationResult> {
    if (!this.currentWorld) {
      throw new Error('No world loaded');
    }

    const assetPack = this.assetPackManager.getAssetPack(this.currentWorld.asset_pack);
    if (!assetPack) {
      throw new Error(`Asset pack '${this.currentWorld.asset_pack}' not found`);
    }

    const sourceTile: WorldTile = {
      tile_type: params.sourceTileType as string,
      q: (params.sourcePosition as { q: number; r: number }).q,
      r: (params.sourcePosition as { q: number; r: number }).r,
      elevation: 0,
      rotation: (params.sourceRotation as number) || 0
    };

    const targetTile: WorldTile = {
      tile_type: params.targetTileType as string,
      q: (params.targetPosition as { q: number; r: number }).q,
      r: (params.targetPosition as { q: number; r: number }).r,
      elevation: 0,
      rotation: (params.targetRotation as number) || 0
    };

    // Find the edge index between the two tiles
    const sourceEdgeIndex = HexCoordinates.getEdgeToNeighbor(
      { q: sourceTile.q, r: sourceTile.r },
      { q: targetTile.q, r: targetTile.r }
    );

    if (sourceEdgeIndex === -1) {
      throw new Error('Tiles are not adjacent');
    }

    return this.edgeValidator.validateEdgeConnection(sourceTile, targetTile, sourceEdgeIndex, assetPack);
  }

  private async handleGetWorldState(): Promise<WorldSnapshot> {
    if (!this.currentWorld) {
      throw new Error('No world loaded');
    }

    const assetPack = this.assetPackManager.getAssetPack(this.currentWorld.asset_pack);
    if (!assetPack) {
      throw new Error(`Asset pack '${this.currentWorld.asset_pack}' not found`);
    }

    const occupiedPositions = this.currentWorld.tiles.map(tile => ({ q: tile.q, r: tile.r }));
    
    // Calculate world bounds
    let minQ = 0, maxQ = 0, minR = 0, maxR = 0;
    if (this.currentWorld.tiles.length > 0) {
      minQ = Math.min(...this.currentWorld.tiles.map(t => t.q));
      maxQ = Math.max(...this.currentWorld.tiles.map(t => t.q));
      minR = Math.min(...this.currentWorld.tiles.map(t => t.r));
      maxR = Math.max(...this.currentWorld.tiles.map(t => t.r));
    }

    // Find available positions (adjacent to existing tiles)
    const availablePositions: Array<{ q: number; r: number }> = [];
    const occupiedSet = new Set(occupiedPositions.map(pos => `${pos.q},${pos.r}`));
    
    for (const tile of this.currentWorld.tiles) {
      const neighbors = HexCoordinates.getNeighbors({ q: tile.q, r: tile.r });
      for (const neighbor of neighbors) {
        const key = `${neighbor.q},${neighbor.r}`;
        if (!occupiedSet.has(key) && !availablePositions.some(pos => pos.q === neighbor.q && pos.r === neighbor.r)) {
          availablePositions.push(neighbor);
        }
      }
    }

    return {
      assetPack,
      currentTiles: [...this.currentWorld.tiles],
      totalTiles: this.currentWorld.tiles.length,
      occupiedPositions,
      availablePositions,
      worldBounds: { minQ, maxQ, minR, maxR }
    };
  }

  private async handleGetAvailableTileTypes(params: Record<string, unknown>): Promise<TileDefinition[]> {
    if (!this.currentWorld) {
      throw new Error('No world loaded');
    }

    const assetPack = this.assetPackManager.getAssetPack(this.currentWorld.asset_pack);
    if (!assetPack) {
      throw new Error(`Asset pack '${this.currentWorld.asset_pack}' not found`);
    }

    let tiles = assetPack.tiles;
    
    const filterByTags = params.filterByTags as string[] | undefined;
    if (filterByTags && filterByTags.length > 0) {
      tiles = tiles.filter(tile => 
        filterByTags.some(tag => tile.tags.includes(tag))
      );
    }

    return tiles;
  }

  private async handleGetNeighborInfo(params: Record<string, unknown>): Promise<NeighborInfo[]> {
    if (!this.currentWorld) {
      throw new Error('No world loaded');
    }

    const position = params.position as { q: number; r: number };
    const neighbors = HexCoordinates.getNeighbors(position);
    const tileMap = new Map<string, WorldTile>();
    
    for (const tile of this.currentWorld.tiles) {
      tileMap.set(`${tile.q},${tile.r}`, tile);
    }

    return neighbors.map((neighborPos, edgeIndex) => {
      const tile = tileMap.get(`${neighborPos.q},${neighborPos.r}`);
      return {
        position: neighborPos,
        tileType: tile?.tile_type,
        isEmpty: !tile,
        edgeIndex
      };
    });
  }

  private async handleSuggestCompatibleTiles(params: Record<string, unknown>): Promise<TilePlacementSuggestion[]> {
    if (!this.currentWorld) {
      throw new Error('No world loaded');
    }

    const assetPack = this.assetPackManager.getAssetPack(this.currentWorld.asset_pack);
    if (!assetPack) {
      throw new Error(`Asset pack '${this.currentWorld.asset_pack}' not found`);
    }

    const position = params.position as { q: number; r: number };
    const maxSuggestions = (params.maxSuggestions as number) || 10;
    const suggestions: TilePlacementSuggestion[] = [];

    // Get neighbors to check compatibility
    const neighbors = await this.handleGetNeighborInfo({ position });
    const existingNeighbors = neighbors.filter(n => !n.isEmpty);

    for (const tileDefinition of assetPack.tiles) {
      for (let rotation = 0; rotation < 6; rotation++) {
        let compatibilityScore = 0;
        let totalChecks = 0;
        const reasons: string[] = [];

        // Check compatibility with each existing neighbor
        for (const neighbor of existingNeighbors) {
          if (!neighbor.tileType) continue;
          
          const existingTile = this.currentWorld.tiles.find(t => 
            t.q === neighbor.position.q && t.r === neighbor.position.r
          );
          if (!existingTile) continue;

          const testTile: WorldTile = {
            tile_type: tileDefinition.id,
            q: position.q,
            r: position.r,
            elevation: 0,
            rotation
          };

          try {
            const validation = await this.handleValidateEdgeConnection({
              sourceTileType: testTile.tile_type,
              sourcePosition: { q: testTile.q, r: testTile.r },
              sourceRotation: testTile.rotation,
              targetTileType: existingTile.tile_type,
              targetPosition: { q: existingTile.q, r: existingTile.r },
              targetRotation: existingTile.rotation || 0
            });

            totalChecks++;
            if (validation.isValid) {
              compatibilityScore++;
              reasons.push(`Compatible with ${neighbor.tileType} at edge ${neighbor.edgeIndex}`);
            } else {
              reasons.push(`Incompatible with ${neighbor.tileType}: ${validation.reason}`);
            }
          } catch (error) {
            reasons.push(`Error checking ${neighbor.tileType}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }

        let compatibility: TilePlacementSuggestion['compatibility'];
        if (totalChecks === 0) {
          compatibility = 'perfect'; // No neighbors to conflict with
          reasons.push('No adjacent tiles to conflict with');
        } else if (compatibilityScore === totalChecks) {
          compatibility = 'perfect';
        } else if (compatibilityScore > totalChecks * 0.7) {
          compatibility = 'good';
        } else if (compatibilityScore > 0) {
          compatibility = 'possible';
        } else {
          compatibility = 'incompatible';
        }

        suggestions.push({
          tileType: tileDefinition.id,
          position,
          rotation,
          compatibility,
          reasons
        });
      }
    }

    // Sort by compatibility and limit results
    suggestions.sort((a, b) => {
      const compatOrder = { perfect: 0, good: 1, possible: 2, incompatible: 3 };
      return compatOrder[a.compatibility] - compatOrder[b.compatibility];
    });

    return suggestions.slice(0, maxSuggestions);
  }

  private async handlePlaceTile(params: Record<string, unknown>): Promise<{ success: boolean; validation?: EdgeValidationResult[]; error?: string }> {
    if (!this.currentWorld) {
      throw new Error('No world loaded');
    }

    const tileType = params.tileType as string;
    const position = params.position as { q: number; r: number };
    const rotation = (params.rotation as number) || 0;
    const elevation = (params.elevation as number) || 0;

    // Check if position is already occupied
    const existing = this.currentWorld.tiles.find(t => t.q === position.q && t.r === position.r);
    if (existing) {
      return { success: false, error: `Position (${position.q}, ${position.r}) is already occupied by ${existing.tile_type}` };
    }

    // Create the new tile
    const newTile: WorldTile = {
      tile_type: tileType,
      q: position.q,
      r: position.r,
      elevation,
      rotation
    };

    // Add tile to world temporarily for validation
    this.currentWorld.tiles.push(newTile);

    try {
      // Validate the entire world
      const validationSummary = this.edgeValidator.validateWorld(this.currentWorld);
      const newTileValidations = validationSummary.results.filter(result => 
        (result.sourcePosition.q === position.q && result.sourcePosition.r === position.r) ||
        (result.targetPosition.q === position.q && result.targetPosition.r === position.r)
      );

      const hasErrors = newTileValidations.some(v => !v.isValid);
      
      if (hasErrors) {
        // Remove tile if validation failed
        this.currentWorld.tiles.pop();
        return { 
          success: false, 
          validation: newTileValidations,
          error: 'Tile placement would create edge validation errors'
        };
      }

      return { success: true, validation: newTileValidations };
    } catch (error) {
      // Remove tile if validation failed
      this.currentWorld.tiles.pop();
      return { 
        success: false, 
        error: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async handlePlaceAddon(params: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    if (!this.currentWorld) {
      throw new Error('No world loaded');
    }

    const assetPack = this.assetPackManager.getAssetPack(this.currentWorld.asset_pack);
    if (!assetPack) {
      throw new Error(`Asset pack '${this.currentWorld.asset_pack}' not found`);
    }

    const addonId = params.addonId as string;
    const position = params.position as { q: number; r: number };
    const localRotation = (params.localRotation as number) || 0;
    const localScale = (params.localScale as number) || 1.0;

    // Find the addon definition
    const addonDefinition = assetPack.addons.find(a => a.id === addonId);
    if (!addonDefinition) {
      return { success: false, error: `Addon '${addonId}' not found in asset pack` };
    }

    // Check if there's a tile at the specified position
    const existingTile = this.currentWorld.tiles.find(t => t.q === position.q && t.r === position.r);
    if (!existingTile) {
      return { success: false, error: `No tile found at position (${position.q}, ${position.r}) to place addon on` };
    }

    // Get the tile definition to check compatibility
    const tileDefinition = assetPack.tiles.find(t => t.id === existingTile.tile_type);
    if (!tileDefinition) {
      return { success: false, error: `Tile type '${existingTile.tile_type}' not found in asset pack` };
    }

    // Check if the tile is compatible with the addon
    const hasRequiredTags = addonDefinition.placement.tile_tags.every(requiredTag => 
      tileDefinition.tags.includes(requiredTag)
    );
    if (!hasRequiredTags) {
      return { 
        success: false, 
        error: `Tile '${existingTile.tile_type}' (tags: ${tileDefinition.tags.join(', ')}) is not compatible with addon '${addonId}' (requires: ${addonDefinition.placement.tile_tags.join(', ')})` 
      };
    }

    // Check if there's already an addon at this position
    const existingAddon = this.currentWorld.addons.find(a => a.q === position.q && a.r === position.r);
    if (existingAddon) {
      return { success: false, error: `Position (${position.q}, ${position.r}) already has addon '${existingAddon.addon_id}'` };
    }

    // Create the new addon
    const newAddon: WorldAddOn = {
      addon_id: addonId,
      q: position.q,
      r: position.r,
      local_position: [...addonDefinition.placement.local_position] as [number, number, number],
      local_rotation: localRotation,
      local_scale: localScale
    };

    // Add addon to world
    this.currentWorld.addons.push(newAddon);

    return { success: true };
  }

  private async handleGetAssetPackInfo(): Promise<AssetPack> {
    if (!this.currentWorld) {
      throw new Error('No world loaded');
    }

    const assetPack = this.assetPackManager.getAssetPack(this.currentWorld.asset_pack);
    if (!assetPack) {
      throw new Error(`Asset pack '${this.currentWorld.asset_pack}' not found`);
    }

    return assetPack;
  }

  private async handleFindEmptyPositions(params: Record<string, unknown>): Promise<Array<{ q: number; r: number }>> {
    if (!this.currentWorld) {
      throw new Error('No world loaded');
    }

    const centerPosition = params.centerPosition as { q: number; r: number } | undefined;
    const radius = (params.radius as number) || 5;
    const adjacentOnly = (params.adjacentOnly as boolean) || false;

    const occupiedSet = new Set(this.currentWorld.tiles.map(tile => `${tile.q},${tile.r}`));
    const emptyPositions: Array<{ q: number; r: number }> = [];

    // Determine search center
    let searchCenter = centerPosition || { q: 0, r: 0 };
    if (!centerPosition && this.currentWorld.tiles.length > 0) {
      // Use centroid of existing tiles
      const avgQ = this.currentWorld.tiles.reduce((sum, tile) => sum + tile.q, 0) / this.currentWorld.tiles.length;
      const avgR = this.currentWorld.tiles.reduce((sum, tile) => sum + tile.r, 0) / this.currentWorld.tiles.length;
      searchCenter = { q: Math.round(avgQ), r: Math.round(avgR) };
    }

    if (adjacentOnly) {
      // Only return positions adjacent to existing tiles
      for (const tile of this.currentWorld.tiles) {
        const neighbors = HexCoordinates.getNeighbors({ q: tile.q, r: tile.r });
        for (const neighbor of neighbors) {
          const key = `${neighbor.q},${neighbor.r}`;
          if (!occupiedSet.has(key) && !emptyPositions.some(pos => pos.q === neighbor.q && pos.r === neighbor.r)) {
            emptyPositions.push(neighbor);
          }
        }
      }
    } else {
      // Search within radius
      for (let q = searchCenter.q - radius; q <= searchCenter.q + radius; q++) {
        for (let r = searchCenter.r - radius; r <= searchCenter.r + radius; r++) {
          if (this.calculateHexDistance(searchCenter, { q, r }) <= radius) {
            const key = `${q},${r}`;
            if (!occupiedSet.has(key)) {
              emptyPositions.push({ q, r });
            }
          }
        }
      }
    }

    return emptyPositions;
  }

  private async handleCalculateDistance(params: Record<string, unknown>): Promise<{ distance: number }> {
    const position1 = params.position1 as { q: number; r: number };
    const position2 = params.position2 as { q: number; r: number };
    
    const distance = this.calculateHexDistance(position1, position2);
    return { distance };
  }

  /**
   * Calculate hex distance between two positions
   */
  private calculateHexDistance(pos1: { q: number; r: number }, pos2: { q: number; r: number }): number {
    // Convert axial coordinates to cube coordinates for easier distance calculation
    const x1 = pos1.q;
    const z1 = pos1.r;
    const y1 = -x1 - z1;
    
    const x2 = pos2.q;
    const z2 = pos2.r;
    const y2 = -x2 - z2;
    
    return (Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(z1 - z2)) / 2;
  }

  private async handleValidateWorld(): Promise<{ validationSummary: unknown; isValid: boolean }> {
    if (!this.currentWorld) {
      throw new Error('No world loaded');
    }

    const validationSummary = this.edgeValidator.validateWorld(this.currentWorld);
    return { 
      validationSummary, 
      isValid: validationSummary.invalidEdges === 0 && validationSummary.errors.length === 0 
    };
  }
} 