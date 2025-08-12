import { World, AssetPack } from '../types/index';
import { GenerationRequest } from '../types/llm';
import { PositionOptions, PlacementOption } from './PlacementOptionsCalculator';
import { HexCoordinates } from './HexCoordinates';
import { WorldPlan, LLMPlacementDecision, TilePlacement, TileRemoval, AddonPlacement, AddonRemoval } from '../types/world-generation';
import { PromptLoader } from '../lib/prompt-loader';

/**
 * Handles LLM prompt creation and response parsing for world generation
 */
export class LLMPrompter {
  private currentPlan: WorldPlan | null = null;
  private lastTodoProgress: string | null = null;

  /**
   * Set the current world plan
   */
  setCurrentPlan(plan: WorldPlan | null): void {
    this.currentPlan = plan;
  }

  /**
   * Set the last todo progress
   */
  setLastTodoProgress(progress: string | null): void {
    this.lastTodoProgress = progress;
  }

  /**
   * Get the current world plan
   */
  getCurrentPlan(): WorldPlan | null {
    return this.currentPlan;
  }

  /**
   * Create system prompt for tile placement
   */
  createPlacementSystemPrompt(): string {
    return PromptLoader.loadSystemPrompt('tile-placement');
  }

  /**
   * Create user prompt for tile placement
   */
  createPlacementUserPrompt(
    request: GenerationRequest, 
    currentWorld: World, 
    placementOptions: PositionOptions[], 
    assetPack: AssetPack, 
    maxTiles: number
  ): string {
    const isEmpty = currentWorld.tiles.length === 0;
    const remaining = maxTiles - currentWorld.tiles.length;
    
    // Format complete asset pack information
    const assetPackInfo = this.formatAssetPackForLLM(assetPack);
    
    // Format current world state
    const worldState = isEmpty ? 
      'Empty world - no tiles or add-ons placed yet' :
      `Tiles: ${currentWorld.tiles.map(t => `${t.tile_type}@(${t.q},${t.r}):r${t.rotation || 0}`).join(', ')}
Add-ons: ${currentWorld.addons.length > 0 ? currentWorld.addons.map(a => `${a.addon_id}@(${a.q},${a.r})`).join(', ') : 'none'}`;

    // Format empty positions
    const emptyPositions = placementOptions.map(posOpt => `(${posOpt.position.q}, ${posOpt.position.r})`).join(', ');
    
    // Format valid tiles for each position with neighbor connectivity context
    const validTilesDescription = this.formatPlacementOptionsWithNeighborContext(placementOptions, currentWorld, assetPack);

    // Format valid add-ons by unique tile types (not per position)
    const uniqueTileTypes = new Set<string>();
    placementOptions.forEach(posOption => {
      posOption.validOptions.forEach(opt => {
        uniqueTileTypes.add(opt.tileId);
      });
    });
    
    const validAddOnsDescription = Array.from(uniqueTileTypes)
      .sort()
      .map(tileId => {
        const compatibleAddons = this.getCompatibleAddons(tileId, assetPack);
        if (compatibleAddons.length > 0) {
          return `${tileId}: ${compatibleAddons.map(a => a.addonId).join(', ')}`;
        }
        return `${tileId}: none`;
      })
      .join('\n');

    // Format current world plan
    const planDescription = this.currentPlan ? 
      `Theme: ${this.currentPlan.theme}
Detailed world description: ${this.currentPlan.detailedDescription}
Todo tasks:
${this.currentPlan.todos.map((todo, i) => `${i+1}. ${todo.description}
- complete when: ${todo.completionCriteria}
- suggested tiles: ${todo.suggestedTiles?.join(', ')}`).join('\n')}
${this.lastTodoProgress ? `\nLast iteration progress: ${this.lastTodoProgress}` : ''}` : 
      'No world generation plan available - use your best judgment for placement decisions.';

    return `ITERATION STEP:
Now let's do the next iteration step.

The user description is:
${request.description}

The world generation plan is:
${planDescription}

The world generation parameters the user has provided and which might influence the world generation process as constraints are:
Maximum tiles: ${maxTiles} (${remaining} remaining)

The asset pack we are using is:
${assetPackInfo}

The current world state is:
${worldState}

Empty positions you can choose to place a tile on:
${emptyPositions}

Valid tiles for each of the above empty positions:
${validTilesDescription}

Valid add-ons for each of the above valid tiles:
${validAddOnsDescription}

Please output your JSON object now.`;
  }

  /**
   * Create system prompt for hole-filling
   */
  createFillHolesSystemPrompt(request: GenerationRequest, assetPack: AssetPack): string {
    return PromptLoader.loadSystemPrompt('hole-filling');
  }

  /**
   * Create user prompt for hole-filling
   */
  createFillHolesUserPrompt(
    request: GenerationRequest, 
    currentWorld: World, 
    placementOptions: PositionOptions[], 
    unpopulatableHoles: PositionOptions[], 
    assetPack: AssetPack, 
    maxTiles: number
  ): string {
    const remaining = maxTiles - currentWorld.tiles.length;
    
    // Format complete asset pack information
    const assetPackInfo = this.formatAssetPackForLLM(assetPack);
    
    // Format current world state
    const worldState = `Tiles: ${currentWorld.tiles.map(t => `${t.tile_type}@(${t.q},${t.r}):r${t.rotation || 0}`).join(', ')}
Add-ons: ${currentWorld.addons.length > 0 ? currentWorld.addons.map(a => `${a.addon_id}@(${a.q},${a.r})`).join(', ') : 'none'}

IMPOSSIBLE HOLES (no valid tiles due to edge constraints): ${unpopulatableHoles.length > 0 ? unpopulatableHoles.map(hole => `(${hole.position.q},${hole.position.r})`).join(', ') : 'none'}
${unpopulatableHoles.length > 0 ? `Consider removing nearby tiles: ${currentWorld.tiles.filter(t => unpopulatableHoles.some(hole => Math.abs(t.q - hole.position.q) + Math.abs(t.r - hole.position.r) <= 2)).map(t => `${t.tile_type}@(${t.q},${t.r})`).join(', ')}` : ''}`;

    // Format interior hole positions
    const interiorHolePositions = placementOptions.map(posOpt => `(${posOpt.position.q}, ${posOpt.position.r})`).join(', ');
    
    // Format valid tiles for each hole position with neighbor connectivity context
    const validTilesDescription = this.formatPlacementOptionsWithNeighborContext(placementOptions, currentWorld, assetPack);

    // Format valid add-ons by unique tile types (not per position)
    const uniqueTileTypes = new Set<string>();
    placementOptions.forEach(posOption => {
      posOption.validOptions.forEach(opt => {
        uniqueTileTypes.add(opt.tileId);
      });
    });
    
    const validAddOnsDescription = Array.from(uniqueTileTypes)
      .sort()
      .map(tileId => {
        const compatibleAddons = this.getCompatibleAddons(tileId, assetPack);
        if (compatibleAddons.length > 0) {
          return `${tileId}: ${compatibleAddons.map(a => a.addonId).join(', ')}`;
        }
        return `${tileId}: none`;
      })
      .join('\n');

    // Format current world plan as simple guidance
    const planDescription = this.currentPlan ? 
      `Theme: ${this.currentPlan.theme}
Detailed world description: ${this.currentPlan.detailedDescription}
Todo tasks:
${this.currentPlan.todos.map((todo, i) => `${i+1}. ${todo.description}`).join('\n')}
${this.lastTodoProgress ? `\nLast iteration progress: ${this.lastTodoProgress}` : ''}
` : 
      'No world generation plan available - use your best judgment for placement decisions.';

    return `HOLE FILLING ITERATION STEP:
Now let's do the hole filling iteration step to fill interior holes in the world.

The user description is:
${request.description}

The world generation plan is:
${planDescription}

The world generation parameters the user has provided and which might influence the world generation process as constraints are:
Maximum tiles: ${maxTiles} (${remaining} remaining)

The asset pack we are using is:
${assetPackInfo}

The current world state is:
${worldState}

Valid positions (interior holes with 4+ neighbors):
${interiorHolePositions}

Valid tiles:
${validTilesDescription}

Valid add-ons:
${validAddOnsDescription}

Please output your JSON object now.`;
  }

  /**
   * Parse LLM response into placement decisions
   */
  parsePlacementResponse(
    response: string, 
    placementOptions: PositionOptions[], 
    assetPack: AssetPack, 
    currentWorld: World
  ): LLMPlacementDecision | null {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('❌ No JSON found in LLM response');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
    
      // Handle both old format (placements) and new format (tiles)
      const placementsArray = parsed.tiles || parsed.placements || [];
      const addonPlacementsArray = parsed["add-ons"] || parsed.addonPlacements || [];
      const removalsArray = parsed.removals || [];
      const addonRemovalsArray = parsed["addon-removals"] || parsed.addonRemovals || [];
      
      // Track if LLM originally intended any actions (before validation/filtering)
      const originallyIntendedActions = (Array.isArray(placementsArray) && placementsArray.length > 0) ||
                                       (Array.isArray(addonPlacementsArray) && addonPlacementsArray.length > 0) ||
                                       (Array.isArray(removalsArray) && removalsArray.length > 0) ||
                                       (Array.isArray(addonRemovalsArray) && addonRemovalsArray.length > 0);
      
      if (!Array.isArray(placementsArray)) {
        console.warn('Invalid tiles/placements in LLM response');
        return null;
      }

      // Validate each placement against available options
      const validPlacements: TilePlacement[] = [];
      const invalidChoices: string[] = [];
      
      // First pass: validate against available options
      const candidatePlacements: TilePlacement[] = [];
      
      for (const placement of placementsArray) {
        if (!placement.position || !placement.tileId || placement.rotation === undefined) {
          invalidChoices.push(`${placement.tileId || 'unknown'}@(${placement.position?.q},${placement.position?.r}) - missing fields`);
          continue;
        }

        // Find the position option
        const posOption = placementOptions.find(opt => 
          opt.position.q === placement.position.q && opt.position.r === placement.position.r
        );

        if (!posOption) {
          invalidChoices.push(`${placement.tileId}@(${placement.position.q},${placement.position.r}) - position not available`);
          continue;
        }

        // Check if the tile+rotation is valid (use loose equality for rotation to handle string/number conversion)
        const validOption = posOption.validOptions.find(opt => 
          opt.tileId === placement.tileId && opt.rotation == placement.rotation
        );

        if (!validOption) {
          invalidChoices.push(`${placement.tileId}@(${placement.position.q},${placement.position.r}):r${placement.rotation} - rotation not available`);
          continue;
        }

        candidatePlacements.push(placement);
      }

      // Parse addon placements - handle both old format (addonPlacements) and new format (add-ons)
      const validAddonPlacements: AddonPlacement[] = [];
      if (Array.isArray(addonPlacementsArray)) {
        for (const addonPlacement of addonPlacementsArray) {
          if (!addonPlacement.position || !addonPlacement.addonId) {
            invalidChoices.push(`${addonPlacement.addonId || 'unknown'}@(${addonPlacement.position?.q},${addonPlacement.position?.r}) - missing addon fields`);
            continue;
          }

          // Check if the position has a tile placed in this iteration
          const tileAtPosition = candidatePlacements.find(p => 
            p.position.q === addonPlacement.position.q && p.position.r === addonPlacement.position.r
          );

          if (!tileAtPosition) {
            // Check if there's an existing tile at this position
            const existingTile = currentWorld.tiles.find(t => 
              t.q === addonPlacement.position.q && t.r === addonPlacement.position.r
            );
            if (!existingTile) {
              invalidChoices.push(`${addonPlacement.addonId}@(${addonPlacement.position.q},${addonPlacement.position.r}) - no tile at position`);
              continue;
            }
          }

          // Check if addon is valid in asset pack
          const addonDefinition = assetPack.addons.find(a => a.id === addonPlacement.addonId);
          if (!addonDefinition) {
            invalidChoices.push(`${addonPlacement.addonId}@(${addonPlacement.position.q},${addonPlacement.position.r}) - addon not found in asset pack`);
            continue;
          }

          validAddonPlacements.push(addonPlacement);
        }
      }

      // Parse removals
      const validRemovals: TileRemoval[] = [];
      if (Array.isArray(removalsArray)) {
        for (const removal of removalsArray) {
          if (!removal.position) {
            invalidChoices.push(`removal at (${removal.position?.q},${removal.position?.r}) - missing position`);
            continue;
          }

          // Check if there's actually a tile at this position to remove
          const existingTile = currentWorld.tiles.find(t => 
            t.q === removal.position.q && t.r === removal.position.r
          );

          if (!existingTile) {
            invalidChoices.push(`removal at (${removal.position.q},${removal.position.r}) - no tile found at position`);
            continue;
          }

          validRemovals.push(removal);
        }
      }

      // Parse addon removals
      const validAddonRemovals: AddonRemoval[] = [];
      if (Array.isArray(addonRemovalsArray)) {
        for (const addonRemoval of addonRemovalsArray) {
          if (!addonRemoval.position) {
            invalidChoices.push(`addon-removal at (${addonRemoval.position?.q},${addonRemoval.position?.r}) - missing position`);
            continue;
          }

          // Check if there's actually an addon at this position to remove
          const existingAddon = currentWorld.addons.find(a => 
            a.q === addonRemoval.position.q && a.r === addonRemoval.position.r
          );

          if (!existingAddon) {
            invalidChoices.push(`addon-removal at (${addonRemoval.position.q},${addonRemoval.position.r}) - no addon found at position`);
            continue;
          }

          validAddonRemovals.push(addonRemoval);
        }
      }

      if (invalidChoices.length > 0) {
        console.log(`❌ Invalid LLM choices filtered: ${invalidChoices.join(', ')}`);
      }

      return {
        placements: candidatePlacements,
        removals: validRemovals,
        addonPlacements: validAddonPlacements,
        addonRemovals: validAddonRemovals,
        reasoning: parsed.reasoning || 'No reasoning provided',
        todoProgress: parsed.todoProgress || null,
        originallyIntendedActions
      };

    } catch (error) {
      console.error('Error parsing LLM response:', error);
      return null;
    }
  }

  /**
   * Format placement options with detailed neighbor connectivity context
   */
  private formatPlacementOptionsWithNeighborContext(
    placementOptions: PositionOptions[], 
    currentWorld: World, 
    assetPack: AssetPack
  ): string {
    return placementOptions.map((posOption, i) => {
      const pos = posOption.position;
      
      // Show neighbor context - what tiles surround this position
      const neighborContext = this.getNeighborContextForPosition(pos, currentWorld, assetPack);
      
      // Format each valid option with its specific edge connectivity
      const optionDetails = posOption.validOptions.map(option => {
        // Get edge connectivity details for this tile option
        const edgeConnections = this.getEdgeConnectivityForOption(pos, option, currentWorld, assetPack);
        const connectivityInfo = edgeConnections.length > 0 ? ` (${edgeConnections.join(', ')})` : '';
        return `${option.tileId}:r${option.rotation}${connectivityInfo}`;
      }).join(', ');
      
      return `Position (${pos.q}, ${pos.r}) ${neighborContext}:\n  ${optionDetails}`;
    }).join('\n\n');
  }

  /**
   * Get neighbor context for a position - what tiles surround it and from which directions
   */
  private getNeighborContextForPosition(
    position: { q: number; r: number }, 
    currentWorld: World, 
    assetPack: AssetPack
  ): string {
    const neighbors = HexCoordinates.getNeighbors(position);
    const directions = ['NE', 'E', 'SE', 'SW', 'W', 'NW']; // Clockwise from top-right
    
    const neighborInfo: string[] = [];
    
    for (let i = 0; i < neighbors.length; i++) {
      const neighbor = neighbors[i];
      const existingTile = currentWorld.tiles.find(t => t.q === neighbor.q && t.r === neighbor.r);
      
      if (existingTile) {
        // Get the edge type that this neighbor exposes toward our position
        const neighborEdgeIndex = (i + 3) % 6; // Opposite edge
        const tileDefinition = assetPack.tiles.find(t => t.id === existingTile.tile_type);
        
        if (tileDefinition) {
          // Apply rotation to get actual edge
          const rotatedEdgeIndex = (neighborEdgeIndex - (existingTile.rotation || 0) + 6) % 6;
          const edgeType = tileDefinition.edges[rotatedEdgeIndex];
          neighborInfo.push(`${directions[i]}:${existingTile.tile_type}[${edgeType}]`);
        } else {
          neighborInfo.push(`${directions[i]}:${existingTile.tile_type}`);
        }
      }
    }
    
    return neighborInfo.length > 0 ? `[neighbors: ${neighborInfo.join(', ')}]` : '[no neighbors]';
  }

  /**
   * Get edge type connectivity information for a specific tile option at a position
   */
  private getEdgeConnectivityForOption(
    position: { q: number; r: number },
    option: PlacementOption,
    currentWorld: World,
    assetPack: AssetPack
  ): string[] {
    const connections: string[] = [];
    const neighbors = HexCoordinates.getNeighbors(position);
    const directions = ['NE', 'E', 'SE', 'SW', 'W', 'NW']; // Clockwise from top-right
    
    // Get the tile definition for this option
    const tileDefinition = assetPack.tiles.find(t => t.id === option.tileId);
    if (!tileDefinition) {
      return connections;
    }
    
    for (let i = 0; i < neighbors.length; i++) {
      const neighbor = neighbors[i];
      const existingTile = currentWorld.tiles.find(t => t.q === neighbor.q && t.r === neighbor.r);
      
      if (existingTile) {
        // Get the edge type that this neighbor exposes toward our position
        const neighborTileDefinition = assetPack.tiles.find(t => t.id === existingTile.tile_type);
        if (!neighborTileDefinition) continue;
        
        // Calculate neighbor's edge index that faces our position
        const neighborEdgeIndex = (i + 3) % 6; // Opposite edge
        const neighborRotatedEdgeIndex = (neighborEdgeIndex - (existingTile.rotation || 0) + 6) % 6;
        const neighborEdgeType = neighborTileDefinition.edges[neighborRotatedEdgeIndex];
        
        // Calculate our tile's edge index that faces this neighbor
        const ourEdgeIndex = i;
        const ourRotatedEdgeIndex = (ourEdgeIndex - option.rotation + 6) % 6;
        const ourEdgeType = tileDefinition.edges[ourRotatedEdgeIndex];
        
        // Format the connection: direction:neighbor_edge→our_edge
        connections.push(`${directions[i]}:${neighborEdgeType}→${ourEdgeType}`);
      }
    }
    
    return connections;
  }

  /**
   * Format complete asset pack information for LLM in compact notation
   */
  private formatAssetPackForLLM(assetPack: AssetPack): string {
    // Format edge types
    const edgeTypesInfo = Object.entries(assetPack.edge_types)
      .map(([id, edgeType]) => {
        const compatible = edgeType.compatible_with ? ` → ${edgeType.compatible_with.join(',')}` : '';
        return `${id}[${edgeType.materials.join(',')}]${compatible}`;
      })
      .join(', ');

    // Format tiles with compact edge and tag info
    const tilesInfo = assetPack.tiles
      .map(tile => {
        const edges = tile.edges.join(',');
        const tags = tile.tags.length > 0 ? ` #${tile.tags.join(',')}` : '';
        return `${tile.id}[${edges}]${tags}`;
      })
      .join(', ');

    // Format add-ons with placement requirements
    const addonsInfo = assetPack.addons
      .map(addon => {
        const tileTags = addon.placement.tile_tags.join(',');
        const addonTags = addon.tags.length > 0 ? ` #${addon.tags.join(',')}` : '';
        return `${addon.id}(${tileTags})${addonTags}`;
      })
      .join(', ');

    return `Asset Pack: ${assetPack.id} v${assetPack.version}
Materials: ${assetPack.materials.join(', ')}
Edge Types: ${edgeTypesInfo}
Tiles: ${tilesInfo}
Add-ons: ${addonsInfo}`;
  }

  /**
   * Get compatible add-ons for a specific tile
   */
  private getCompatibleAddons(tileId: string, assetPack: AssetPack): { addonId: string; tags: string[] }[] {
    const compatibleAddons: { addonId: string; tags: string[] }[] = [];
    
    // Find the tile definition
    const tileDefinition = assetPack.tiles.find(t => t.id === tileId);
    if (!tileDefinition) {
      return compatibleAddons;
    }
    
    // Check each addon for compatibility
    for (const addon of assetPack.addons) {
      const hasCompatibleTag = addon.placement.tile_tags.some(requiredTag => 
        tileDefinition.tags.includes(requiredTag)
      );
      
      if (hasCompatibleTag) {
        compatibleAddons.push({
          addonId: addon.id,
          tags: addon.tags
        });
      }
    }
    
    return compatibleAddons;
  }
}
