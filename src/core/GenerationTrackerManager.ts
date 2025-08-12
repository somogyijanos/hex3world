import { GenerationTracker, PlacementResult } from '../types/world-generation';

/**
 * Manages generation tracking throughout the world generation process
 */
export class GenerationTrackerManager {
  private tracker: GenerationTracker | null = null;

  /**
   * Initialize a new generation tracking session
   */
  initialize(): void {
    this.tracker = {
      start_time: Date.now(),
      iterations: 0,
      tiles_placed: 0,
      tiles_removed: 0,
      addons_placed: 0,
      placement_failures: 0,
      removal_failures: 0,
      addon_failures: 0,
      llm_calls: 0,
      prompts_used: new Set<string>()
    };
  }

  /**
   * Get the current tracker (throws if not initialized)
   */
  getTracker(): GenerationTracker {
    if (!this.tracker) {
      throw new Error('Generation tracker not initialized');
    }
    return this.tracker;
  }

  /**
   * Check if tracker is initialized
   */
  isInitialized(): boolean {
    return this.tracker !== null;
  }

  /**
   * Update iteration count
   */
  updateIteration(iteration: number): void {
    if (this.tracker) {
      this.tracker.iterations = iteration;
    }
  }

  /**
   * Track an LLM call with prompt type
   */
  trackLLMCall(promptType: string): void {
    if (this.tracker) {
      this.tracker.llm_calls++;
      this.tracker.prompts_used.add(promptType);
    }
  }

  /**
   * Update tracker with placement results
   */
  updateWithResults(result: PlacementResult): void {
    if (!this.tracker) return;
    
    this.tracker.tiles_placed += result.tilesPlaced;
    this.tracker.tiles_removed += result.tilesRemoved;
    this.tracker.addons_placed += result.addonsPlaced;
    this.tracker.placement_failures += result.placementFailures.length;
    this.tracker.removal_failures += result.removalFailures.length;
    this.tracker.addon_failures += result.addonFailures.length;
  }

  /**
   * Get current generation time in milliseconds
   */
  getGenerationTimeMs(): number {
    if (!this.tracker) return 0;
    return Date.now() - this.tracker.start_time;
  }

  /**
   * Reset the tracker
   */
  reset(): void {
    this.tracker = null;
  }
}
