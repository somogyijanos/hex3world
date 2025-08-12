import { World, WorldTile, AssetPack } from '../types/index';
import { AssetPackManager } from './AssetPackManager';
import { WorldManager } from './WorldManager';
import { LLMToolsProvider } from './LLMTools';
import { BaseLLMProvider, LLMProviderFactory, executeToolCalls } from '../services/LLMProvider';
import {
  LLMConfig,
  GenerationRequest,
  GenerationResult,
  GenerationProgress,
  GenerationEvent,
  GenerationEventHandler,
  LLMMessage,
  LLMToolCall,
  LLMToolResult
} from '../types/llm';

export class LLMWorldGenerator {
  private assetPackManager: AssetPackManager;
  private worldManager: WorldManager;
  private toolsProvider: LLMToolsProvider;
  private llmProvider: BaseLLMProvider | null = null;
  private eventHandlers: GenerationEventHandler[] = [];

  constructor(assetPackManager: AssetPackManager) {
    this.assetPackManager = assetPackManager;
    this.worldManager = new WorldManager(assetPackManager);
    this.toolsProvider = new LLMToolsProvider(assetPackManager);
  }

  /**
   * Configure the LLM provider
   */
  setLLMProvider(config: LLMConfig): void {
    this.llmProvider = LLMProviderFactory.create(config);
  }

  /**
   * Add event handler for generation events
   */
  addEventListener(handler: GenerationEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Remove event handler
   */
  removeEventListener(handler: GenerationEventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index > -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  /**
   * Emit a generation event
   */
  private emitEvent(type: GenerationEvent['type'], data: unknown): void {
    const event: GenerationEvent = {
      type,
      data,
      timestamp: Date.now()
    };
    
    this.eventHandlers.forEach(handler => {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in event handler:', error);
      }
    });
  }

  /**
   * Generate a new world based on the request
   */
  async generateWorld(request: GenerationRequest): Promise<GenerationResult> {
    if (!this.llmProvider) {
      return {
        success: false,
        error: 'LLM provider not configured'
      };
    }

    try {
      this.emitEvent('started', { request });

      // Validate asset pack
      const assetPack = this.assetPackManager.getAssetPack(request.assetPackId);
      if (!assetPack) {
        throw new Error(`Asset pack '${request.assetPackId}' not found`);
      }

      // Create initial world or use existing
      const currentWorld = request.existingWorld || this.worldManager.createWorld(request.assetPackId);
      this.toolsProvider.setCurrentWorld(currentWorld);

      // Get available tools
      const tools = this.toolsProvider.getTools();

      // Create system prompt
      const systemPrompt = this.createSystemPrompt(request, assetPack);
      
      // Create user prompt
      const userPrompt = this.createUserPrompt(request);

      console.log('📝 System prompt length:', systemPrompt.length);
      console.log('📝 User prompt:', userPrompt);

      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      const progress: GenerationProgress[] = [];
      const maxIterations = 20; // Prevent infinite loops
      let iteration = 0;

      while (iteration < maxIterations) {
        iteration++;
        console.log(`🔄 Generation iteration ${iteration}/${maxIterations}`);

        // Send request to LLM
        console.log('📤 Sending request to LLM with', messages.length, 'messages and', tools.length, 'tools');
        const response = await this.llmProvider.generateResponse(messages, tools, {
          temperature: 0.7,
          maxTokens: 4000
        });

        console.log('📥 LLM Response:', {
          content: response.message.content.substring(0, 200) + '...',
          hasToolCalls: !!(response.message.toolCalls && response.message.toolCalls.length > 0),
          toolCallCount: response.message.toolCalls?.length || 0
        });

        // Add assistant message to conversation
        messages.push(response.message);

        // If there are tool calls, execute them
        if (response.message.toolCalls && response.message.toolCalls.length > 0) {
          console.log('🔧 Executing', response.message.toolCalls.length, 'tool calls');
          const toolResults = await executeToolCalls(response.message.toolCalls, tools);
          
          // Update current world in tools provider
          this.toolsProvider.setCurrentWorld(currentWorld);

          // Process tool results and update progress
          await this.processToolResults(response.message.toolCalls, toolResults, currentWorld, progress);

          // Add tool results to conversation
          const toolResultMessages = this.createToolResultMessages(toolResults);
          messages.push(...toolResultMessages);

          // Emit progress event
          const latestProgress = progress[progress.length - 1];
          if (latestProgress) {
            this.emitEvent('progress', latestProgress);
          }

          // Check if generation is complete
          if (latestProgress && latestProgress.stage === 'complete') {
            console.log('✅ Generation completed');
            break;
          }

          // Continue conversation with tool results
          continue;
        }

        // If no tool calls, the LLM is done
        console.log('🛑 No tool calls received, ending generation');
        console.log('📄 Final LLM response content:', response.message.content);
        
        // If we have tiles, treat this as completion, otherwise as an error
        if (currentWorld.tiles.length > 0) {
          console.log('✅ Treating as completion (has tiles)');
          break;
        } else {
          console.log('❌ No tiles generated, treating as error');
          throw new Error('LLM did not generate any tiles. Response: ' + response.message.content.substring(0, 500));
        }
      }

      // If we exit the loop without explicit completion, make sure we have a final progress update
      if (progress.length === 0 || progress[progress.length - 1].stage !== 'complete') {
        console.log('🔧 Adding final progress update');
        
        if (currentWorld.tiles.length === 0) {
          throw new Error('World generation completed but no tiles were placed');
        }
      }

      // Final validation
      this.emitEvent('progress', { stage: 'validating', message: 'Running final validation...' });
      
      // Use EdgeValidator for validation since WorldManager.validateWorld is void
      const edgeValidator = new (await import('./EdgeValidator')).EdgeValidator(this.assetPackManager);
      const validationSummary = edgeValidator.validateWorld(currentWorld);
      
      // Mark as complete
      const finalProgress: GenerationProgress = {
        stage: 'complete',
        currentStep: progress.length + 1,
        totalSteps: progress.length + 1,
        message: 'World generation completed successfully',
        placedTiles: currentWorld.tiles.length,
        validationErrors: validationSummary.invalidEdges,
        currentWorld
      };
      
      progress.push(finalProgress);
      this.emitEvent('completed', { world: currentWorld, validationSummary });

      return {
        success: true,
        world: currentWorld,
        validationSummary,
        progress
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emitEvent('error', { error: errorMessage });
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  private createSystemPrompt(request: GenerationRequest, assetPack: AssetPack): string {
    return `You are an expert 3D hex world architect. Your task is to generate a beautiful, coherent hex-based world using the provided tools and asset pack.

## Your Role
- Create worlds that are both aesthetically pleasing and functionally valid
- Use the edge validation tools to ensure all tile connections are compatible
- Think strategically about tile placement and world layout
- Consider elevation changes and natural flow

## Asset Pack Information
**Pack ID**: ${assetPack.id}
**Name**: ${assetPack.name}
**Description**: ${assetPack.description}

**Available Materials**: ${assetPack.materials.join(', ')}

**Available Tiles**: ${assetPack.tiles.map(t => `${t.id} (${t.tags.join(', ')})`).join(', ')}

**Edge Types**: ${Object.keys(assetPack.edge_types).join(', ')}

**Available Add-ons**: ${assetPack.addons.map(a => `${a.id} (${a.tags.join(', ')})`).join(', ')}

## Generation Guidelines

1. **Start with Planning**: Use get_world_state and get_asset_pack_info to understand your tools
2. **Strategic Placement**: Use find_empty_positions and suggest_compatible_tiles to plan layouts
3. **Validate Everything**: Use validate_edge_connection before placing tiles
4. **Build Incrementally**: Place tiles one at a time using place_tile
5. **Check Progress**: Use validate_world periodically to ensure quality
6. **Consider Themes**: Create coherent areas (e.g., forest zones, water features, roads)

## Tool Usage
- Always validate edge connections before placing tiles
- Use neighbor information to make informed placement decisions
- Consider rotation options for better tile fitting
- Think about elevation for visual interest
- Use place_addon to add decorations like trees, buildings, or other add-ons on top of existing tiles
- Check tile compatibility before placing add-ons (add-ons have placement requirements based on tile tags)

## Success Criteria
- All placed tiles must have valid edge connections
- World should be cohesive and thematically consistent
- Use a variety of tile types for visual interest
- Consider natural groupings and transitions

When you're satisfied with the world, use validate_world for final confirmation.`;
  }

  private createUserPrompt(request: GenerationRequest): string {
    let prompt = `Generate a hex world with the following requirements:

**Description**: ${request.description}`;

    if (request.constraints) {
      prompt += '\n\n**Constraints**:';
      if (request.constraints.maxTiles) prompt += `\n- Maximum ${request.constraints.maxTiles} tiles`;
      if (request.constraints.preferredTileTypes?.length) {
        prompt += `\n- Preferred tile types: ${request.constraints.preferredTileTypes.join(', ')}`;
      }
      if (request.constraints.forbiddenTileTypes?.length) {
        prompt += `\n- Avoid tile types: ${request.constraints.forbiddenTileTypes.join(', ')}`;
      }
      if (request.constraints.theme) prompt += `\n- Theme: ${request.constraints.theme}`;
      if (request.constraints.centerPosition) {
        prompt += `\n- Center around position (${request.constraints.centerPosition.q}, ${request.constraints.centerPosition.r})`;
      }
      if (request.constraints.maxRadius) prompt += `\n- Maximum radius: ${request.constraints.maxRadius}`;
      if (request.constraints.includeAddons !== undefined) {
        prompt += `\n- Include add-ons: ${request.constraints.includeAddons}`;
      }
    }

    if (request.existingWorld && request.existingWorld.tiles.length > 0) {
      prompt += `\n\n**Existing World**: You are expanding an existing world with ${request.existingWorld.tiles.length} tiles. Use get_world_state to see the current layout and build upon it coherently.`;
    }

    prompt += `\n\n**START IMMEDIATELY**: Begin by calling get_world_state to examine the current world, then get_asset_pack_info to understand available tiles. Then start placing tiles using place_tile. You MUST use the tools - do not just provide text responses.`;

    return prompt;
  }

  private async processToolResults(
    toolCalls: LLMToolCall[],
    toolResults: LLMToolResult[],
    currentWorld: World,
    progress: GenerationProgress[]
  ): Promise<void> {
    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      const result = toolResults[i];

      if (toolCall.name === 'place_tile' && result.result) {
        const placementResult = result.result as { success: boolean; error?: string };
        if (placementResult.success) {
          const position = toolCall.parameters.position as { q: number; r: number };
          const tileType = toolCall.parameters.tileType as string;
          
          this.emitEvent('tile_placed', {
            position,
            tileType,
            totalTiles: currentWorld.tiles.length
          });

          // Update progress
          const progressUpdate: GenerationProgress = {
            stage: 'placing_tiles',
            currentStep: progress.length + 1,
            totalSteps: progress.length + 10, // Estimate
            message: `Placed ${tileType} at (${position.q}, ${position.r})`,
            placedTiles: currentWorld.tiles.length,
            validationErrors: 0,
            currentWorld
          };
          progress.push(progressUpdate);
        }
      } else if (toolCall.name === 'validate_world') {
        const validationResult = result.result as { isValid: boolean; validationSummary: unknown };
        this.emitEvent('validation_run', {
          isValid: validationResult.isValid,
          summary: validationResult.validationSummary
        });
      }
    }
  }

  private createToolResultMessages(toolResults: LLMToolResult[]): LLMMessage[] {
    return toolResults.map(result => ({
      role: 'tool' as const,
      toolCallId: result.toolCallId,
      content: result.error 
        ? `Tool error: ${result.error}`
        : JSON.stringify(result.result, null, 2)
    }));
  }

  /**
   * Validate LLM configuration
   */
  async validateConfiguration(): Promise<{ isValid: boolean; error?: string }> {
    if (!this.llmProvider) {
      return { isValid: false, error: 'No LLM provider configured' };
    }

    try {
      const isValid = await this.llmProvider.validateConfig();
      return { isValid, error: isValid ? undefined : 'Invalid LLM configuration' };
    } catch (error) {
      return { 
        isValid: false, 
        error: error instanceof Error ? error.message : 'Configuration validation failed' 
      };
    }
  }

  /**
   * Get generation capabilities
   */
  getCapabilities(): {
    supportedAssetPacks: string[];
    availableTools: string[];
    hasLLMProvider: boolean;
  } {
    return {
      supportedAssetPacks: this.assetPackManager.getAllAssetPacks().map(pack => pack.id),
      availableTools: this.toolsProvider.getTools().map(tool => tool.name),
      hasLLMProvider: this.llmProvider !== null
    };
  }
} 