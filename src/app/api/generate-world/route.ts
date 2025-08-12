import { NextRequest, NextResponse } from 'next/server';
import { AssetPackManager } from '@/core/AssetPackManager';
import { SimpleWorldGenerator } from '@/core/SimpleWorldGenerator';
import { getLLMConfig, isLLMConfigured } from '@/lib/llm-config';
import { GenerationRequest } from '@/types/llm';

/**
 * Generate a filename from theme with a short UID for uniqueness
 */
function generateThemeBasedFilename(theme: string): string {
  // Create a short UID (8 characters)
  const shortUid = Math.random().toString(36).substring(2, 10);
  
  // Sanitize theme for filename
  const sanitizedTheme = theme
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters except spaces
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .substring(0, 30); // Limit length
  
  return `${sanitizedTheme}-${shortUid}.json`;
}

export async function POST(request: NextRequest) {
  try {
    // Check if LLM is configured
    if (!isLLMConfigured()) {
      return NextResponse.json({ 
        error: 'LLM not properly configured. Please check your environment variables.' 
      }, { status: 400 });
    }

    const requestData: GenerationRequest = await request.json();

    // Validate request
    if (!requestData.assetPackId || !requestData.description) {
      return NextResponse.json({ 
        error: 'Asset pack ID and description are required' 
      }, { status: 400 });
    }

    // Initialize asset pack manager
    const assetPackManager = new AssetPackManager();
    
    // Load the asset pack
    const assetPackUrl = `/assets/packs/${requestData.assetPackId}.json`;
    await assetPackManager.loadAssetPackFromUrl(`${process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : ''}${assetPackUrl}`);

    // Initialize world generator
    const generator = new SimpleWorldGenerator(assetPackManager);
    
    // Configure LLM
    const llmConfig = getLLMConfig();
    generator.setLLMProvider(llmConfig);

    // Generate world
    const result = await generator.generateWorld(requestData);

    if (!result.success) {
      return NextResponse.json({ 
        error: result.error || 'World generation failed' 
      }, { status: 500 });
    }

    // Save the generated world (if enabled)
    const enableWorldSaving = process.env.ENABLE_WORLD_SAVING === 'true';
    let savedFilename: string | null = null;
    
    if (enableWorldSaving) {
      try {
        // Generate filename based on theme from the plan
        let filename: string | undefined;
        const currentPlan = generator.getCurrentPlan();
        if (currentPlan?.theme) {
          filename = generateThemeBasedFilename(currentPlan.theme);
          console.log('Generated theme-based filename:', filename);
        }

        const saveResponse = await fetch(`${process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : ''}/api/save-world`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            world: result.world,
            filename: filename // Pass the theme-based filename
          }),
        });

        if (saveResponse.ok) {
          const saveResult = await saveResponse.json();
          savedFilename = saveResult.filename;
          console.log('World saved successfully:', savedFilename);
        } else {
          console.warn('Failed to auto-save world: API returned error');
        }
      } catch (saveError) {
        console.warn('Failed to auto-save world:', saveError);
        // Don't fail the entire request if saving fails
      }
    } else {
      console.log('World saving is disabled - skipping auto-save');
    }

    return NextResponse.json({
      success: true,
      world: result.world,
      validationSummary: result.validationSummary,
      savedFilename: savedFilename // Include the saved filename in response
    });

  } catch (error) {
    console.error('World generation error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
} 