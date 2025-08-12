import { NextRequest, NextResponse } from 'next/server';
import { AssetPackManager } from '@/core/AssetPackManager';
import { SimpleWorldGenerator } from '@/core/SimpleWorldGenerator';
import { getLLMConfig, isLLMConfigured } from '@/lib/llm-config';
import { GenerationRequest } from '@/types/llm';

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
    
    if (enableWorldSaving) {
      try {
        const saveResponse = await fetch(`${process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : ''}/api/save-world`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ world: result.world }),
        });

        if (saveResponse.ok) {
          const saveResult = await saveResponse.json();
          console.log('World saved successfully:', saveResult.filename);
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
      validationSummary: result.validationSummary
    });

  } catch (error) {
    console.error('World generation error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
} 