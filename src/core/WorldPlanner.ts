import { AssetPack, World } from '../types/index';
import { GenerationRequest, LLMMessage } from '../types/llm';
import { WorldPlan } from '../types/world-generation';
import { BaseLLMProvider } from '../services/LLMProvider';
import { PromptLoader } from '../lib/prompt-loader';

/**
 * Handles world planning logic - creating strategic plans for world generation
 */
export class WorldPlanner {
  private llmProvider: BaseLLMProvider | null = null;

  /**
   * Set the LLM provider
   */
  setLLMProvider(llmProvider: BaseLLMProvider | null): void {
    this.llmProvider = llmProvider;
  }

  /**
   * Create initial world plan using LLM
   */
  async createWorldPlan(
    request: GenerationRequest,
    assetPack: AssetPack,
    maxTiles: number
  ): Promise<WorldPlan | null> {
    if (!this.llmProvider) {
      console.error('LLM provider not configured for world planning');
      return null;
    }
    
    // Determine if this is existing world modification planning
    const isModification = request.existingWorld && request.existingWorld.tiles.length > 0;
    
    const systemPrompt = this.createPlanningSystemPrompt();
    const userPrompt = isModification 
      ? this.createModificationPlanningUserPrompt(request, assetPack, maxTiles, request.existingWorld!)
      : this.createPlanningUserPrompt(request, assetPack, maxTiles);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    try {
      console.log(`📋 Creating ${isModification ? 'modification' : 'initial'} world plan...`);
      const response = await this.llmProvider.generateResponse(messages, []);
      
      if (!response.message.content) {
        return null;
      }

      // Parse LLM response
      return this.parsePlanningResponse(response.message.content, assetPack, maxTiles);

    } catch (error) {
      console.error('Error getting LLM world plan:', error);
      return null;
    }
  }

  /**
   * Create system prompt for planning
   */
  private createPlanningSystemPrompt(): string {
    return PromptLoader.loadSystemPrompt('world-planning');
  }

  /**
   * Create user prompt for planning
   */
  private createPlanningUserPrompt(request: GenerationRequest, assetPack: AssetPack, maxTiles: number): string {
    
    return `The user description is:
${request.description}

The world generation parameters:
Maximum tiles: ${maxTiles}

The asset pack to work with is:
Name: ${assetPack.id}

The available tiles are:
${assetPack.tiles.map(tile => {
      const edges = tile.edges.join(',');
      const tags = tile.tags.length > 0 ? ` #${tile.tags.join(',')}` : '';
      return `${tile.id}[${edges}]${tags}`;
    }).join(', ')} // in compact notation like "tile-id[edge0,edge1,edge2,edge3,edge4,edge5] #tag1,tag2"

The available add-ons are:
${assetPack.addons.map(addon => {
      const tileTags = addon.placement.tile_tags.join(',');
      const addonTags = addon.tags.length > 0 ? ` #${addon.tags.join(',')}` : '';
      return `${addon.id}(${tileTags})${addonTags}`;
    }).join(', ')} // in compact notation like "addon-id(required_tile_tags) #addon_tags"`;
  }

  /**
   * Create user prompt for existing world modification planning
   */
  private createModificationPlanningUserPrompt(
    request: GenerationRequest, 
    assetPack: AssetPack, 
    maxTiles: number, 
    existingWorld: World
  ): string {
    // Analyze existing world
    const worldAnalysis = this.analyzeExistingWorld(existingWorld, assetPack);
    
    return `WORLD MODIFICATION PLANNING:
You are creating a plan to MODIFY an existing world rather than creating a new one.

The user's modification description is:
${request.description}

EXISTING WORLD ANALYSIS:
${worldAnalysis}

The world generation parameters:
Current tiles: ${existingWorld.tiles.length}
Maximum tiles: ${maxTiles}
Available capacity: ${maxTiles - existingWorld.tiles.length} additional tiles (if adding)
Note: User may want to remove tiles, add tiles, or modify existing areas

The asset pack to work with is:
Name: ${assetPack.id}

The available tiles are:
${assetPack.tiles.map(tile => {
      const edges = tile.edges.join(',');
      const tags = tile.tags.length > 0 ? ` #${tile.tags.join(',')}` : '';
      return `${tile.id}[${edges}]${tags}`;
    }).join(', ')} // in compact notation like "tile-id[edge0,edge1,edge2,edge3,edge4,edge5] #tag1,tag2"

The available add-ons are:
${assetPack.addons.map(addon => {
      const tileTags = addon.placement.tile_tags.join(',');
      const addonTags = addon.tags.length > 0 ? ` #${addon.tags.join(',')}` : '';
      return `${addon.id}(${tileTags})${addonTags}`;
    }).join(', ')} // in compact notation like "addon-id(required_tile_tags) #addon_tags"

WORLD MODIFICATION CONSIDERATIONS:
- Analyze the user's intent: Are they adding, removing, or editing existing areas?
- If adding: New areas should connect logically to existing tiles at world edges
- If removing: Consider which areas to remove and how to maintain world coherence
- If editing: Plan how to modify existing areas while preserving overall structure
- Respect the existing world's established theme unless user specifically wants to change it
- Ensure edge compatibility between modified/new tiles and existing tiles
- Plan modifications in logical phases that maintain world integrity
- The result should enhance the world according to the user's specific goals`;
  }

  /**
   * Parse LLM response into world plan
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private parsePlanningResponse(response: string, _assetPack: AssetPack, _maxTiles: number): WorldPlan | null {
    try {
      // Try to extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('❌ No JSON found in LLM planning response');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate required fields
      if (typeof parsed.theme !== 'string' || typeof parsed.detailedDescription !== 'string' || !Array.isArray(parsed.todos) || parsed.todos.length === 0) {
        console.log('❌ Invalid world plan JSON: missing required fields (theme, detailedDescription, todos)');
        return null;
      }

      // Validate todos
      for (const todo of parsed.todos) {
        if (typeof todo.id !== 'string' || typeof todo.description !== 'string' || typeof todo.completionCriteria !== 'string') {
          console.log('❌ Invalid todo in world plan JSON: missing id, description, or completionCriteria');
          return null;
        }
        if (todo.suggestedTiles && !Array.isArray(todo.suggestedTiles)) {
          console.log('❌ Invalid suggestedTiles in todo');
          return null;
        }
        
        // Status is optional - set default if not provided
        if (!todo.status) {
          todo.status = 'pending';
        }
      }

      if (typeof parsed.reasoning !== 'string') {
        console.log('❌ Invalid reasoning in world plan JSON');
        return null;
      }

      return {
        theme: parsed.theme,
        detailedDescription: parsed.detailedDescription,
        todos: parsed.todos,
        reasoning: parsed.reasoning
      };

    } catch (error) {
      console.error('Error parsing LLM world plan response:', error);
      return null;
    }
  }

  /**
   * Analyze existing world to understand its structure and theme
   */
  private analyzeExistingWorld(existingWorld: World, assetPack: AssetPack): string {
    const analysis: string[] = [];
    
    // Basic world info
    analysis.push(`Size: ${existingWorld.tiles.length} tiles, ${existingWorld.addons.length} addons`);
    
    // Tile composition analysis
    const tileCounts = new Map<string, number>();
    
    for (const tile of existingWorld.tiles) {
      tileCounts.set(tile.tile_type, (tileCounts.get(tile.tile_type) || 0) + 1);
    }
    
    const sortedTiles = Array.from(tileCounts.entries()).sort((a, b) => b[1] - a[1]);
    analysis.push(`Tile composition: ${sortedTiles.map(([type, count]) => `${type}(${count})`).join(', ')}`);
    
    // Addon composition analysis
    if (existingWorld.addons.length > 0) {
      const addonCounts = new Map<string, number>();
      for (const addon of existingWorld.addons) {
        addonCounts.set(addon.addon_id, (addonCounts.get(addon.addon_id) || 0) + 1);
      }
      const sortedAddons = Array.from(addonCounts.entries()).sort((a, b) => b[1] - a[1]);
      analysis.push(`Addon composition: ${sortedAddons.map(([type, count]) => `${type}(${count})`).join(', ')}`);
    }
    
    // Determine world bounds and layout pattern
    const minQ = Math.min(...existingWorld.tiles.map(t => t.q));
    const maxQ = Math.max(...existingWorld.tiles.map(t => t.q));
    const minR = Math.min(...existingWorld.tiles.map(t => t.r));
    const maxR = Math.max(...existingWorld.tiles.map(t => t.r));
    
    analysis.push(`Bounds: Q(${minQ} to ${maxQ}), R(${minR} to ${maxR})`);
    
    // Identify edge tiles (tiles with empty neighbors - potential expansion points)
    const edgeTiles: Array<{ q: number, r: number, type: string }> = [];
    for (const tile of existingWorld.tiles) {
      const neighbors = [
        { q: tile.q, r: tile.r + 1 },      // bottom-right
        { q: tile.q - 1, r: tile.r + 1 },  // bottom-left  
        { q: tile.q - 1, r: tile.r },      // left
        { q: tile.q, r: tile.r - 1 },      // top-left
        { q: tile.q + 1, r: tile.r - 1 },  // top-right
        { q: tile.q + 1, r: tile.r }       // right
      ];
      
      const hasEmptyNeighbor = neighbors.some(neighbor => 
        !existingWorld.tiles.some(t => t.q === neighbor.q && t.r === neighbor.r)
      );
      
      if (hasEmptyNeighbor) {
        edgeTiles.push({ q: tile.q, r: tile.r, type: tile.tile_type });
      }
    }
    
    analysis.push(`Edge tiles (expansion points): ${edgeTiles.length} tiles`);
    if (edgeTiles.length > 0) {
      const edgeTileTypes = new Map<string, number>();
      for (const edgeTile of edgeTiles) {
        edgeTileTypes.set(edgeTile.type, (edgeTileTypes.get(edgeTile.type) || 0) + 1);
      }
      const sortedEdgeTypes = Array.from(edgeTileTypes.entries()).sort((a, b) => b[1] - a[1]);
      analysis.push(`Edge tile types: ${sortedEdgeTypes.map(([type, count]) => `${type}(${count})`).join(', ')}`);
    }
    
    // Infer theme from dominant tile types and tags
    const dominantTileType = sortedTiles[0]?.[0];
    if (dominantTileType) {
      const tileDefinition = assetPack.tiles.find(t => t.id === dominantTileType);
      if (tileDefinition) {
        analysis.push(`Inferred theme: Dominant tile "${dominantTileType}" with tags [${tileDefinition.tags.join(', ')}]`);
      }
    }
    
    return analysis.join('\n');
  }
}
