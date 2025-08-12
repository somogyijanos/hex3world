import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Utility for loading prompt templates from files
 */
export class PromptLoader {
  private static promptCache = new Map<string, string>();

  /**
   * Load a system prompt from the prompts directory
   * @param promptName Name of the prompt file (without .md extension)
   * @returns The prompt content as a string
   */
  static loadSystemPrompt(promptName: string): string {
    const cacheKey = `system:${promptName}`;
    
    // Check cache first
    if (this.promptCache.has(cacheKey)) {
      return this.promptCache.get(cacheKey)!;
    }

    try {
      // Construct path to prompt file
      const promptPath = join(process.cwd(), 'src', 'prompts', 'system', `${promptName}.md`);
      
      // Read the file
      const content = readFileSync(promptPath, 'utf-8');
      
      // Cache the content
      this.promptCache.set(cacheKey, content);
      
      return content;
    } catch (error) {
      console.error(`Failed to load system prompt "${promptName}":`, error);
      throw new Error(`Failed to load system prompt "${promptName}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Clear the prompt cache (useful for development/testing)
   */
  static clearCache(): void {
    this.promptCache.clear();
  }

  /**
   * Get available system prompts
   */
  static getAvailableSystemPrompts(): string[] {
    return [
      'tile-placement',
      'hole-filling',
      'world-planning'
    ];
  }
}
