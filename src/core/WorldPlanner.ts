import { AssetPack } from '../types/index';
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
    
    const systemPrompt = this.createPlanningSystemPrompt();
    const userPrompt = this.createPlanningUserPrompt(request, assetPack, maxTiles);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    try {
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
   * Parse LLM response into world plan
   */
  private parsePlanningResponse(response: string, assetPack: AssetPack, maxTiles: number): WorldPlan | null {
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
}
