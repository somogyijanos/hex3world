import { NextRequest, NextResponse } from 'next/server';
import { AssetPackManager } from '@/core/AssetPackManager';
import { SimpleWorldGenerator } from '@/core/SimpleWorldGenerator';
import { getLLMConfig, isLLMConfigured } from '@/lib/llm-config';
import { GenerationRequest, GenerationProgress } from '@/types/llm';

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
    .substring(0, 150); // Limit length to 100 characters (much higher threshold)
  
  return `${sanitizedTheme}-${shortUid}.json`;
}

// Store for managing generation sessions
const generationSessions = new Map<string, { generator: SimpleWorldGenerator; cancelled: boolean }>();

export async function POST(request: NextRequest) {
  try {
    // Check if LLM is configured
    if (!isLLMConfigured()) {
      return NextResponse.json({ 
        error: 'LLM not properly configured. Please check your environment variables.' 
      }, { status: 400 });
    }

    const requestData: GenerationRequest = await request.json();

    // Check if this is a cancellation request
    if (requestData.action === 'cancel' && requestData.sessionId) {
      const session = generationSessions.get(requestData.sessionId);
      if (session) {
        session.cancelled = true;
        // Call cancel method on the generator
        session.generator.cancel();
        generationSessions.delete(requestData.sessionId);
        console.log(`🛑 Cancelled generation session: ${requestData.sessionId}`);
        return NextResponse.json({ success: true, cancelled: true });
      }
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Check if this is a streaming request
    if (requestData.stream) {
      return handleStreamingGeneration(requestData);
    }

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

    // Generate session ID and store session
    const sessionId = Math.random().toString(36).substring(2, 15);
    generationSessions.set(sessionId, { generator, cancelled: false });

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

    // Clean up session
    generationSessions.delete(sessionId);

    return NextResponse.json({
      success: true,
      world: result.world,
      validationSummary: result.validationSummary,
      savedFilename: savedFilename, // Include the saved filename in response
      sessionId
    });

  } catch (error) {
    console.error('World generation error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

async function handleStreamingGeneration(requestData: GenerationRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
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

        // Generate session ID and store session
        const sessionId = Math.random().toString(36).substring(2, 15);
        generationSessions.set(sessionId, { generator, cancelled: false });

        // Send initial response with session ID
        const initialData = JSON.stringify({ 
          type: 'session_started', 
          sessionId,
          timestamp: Date.now()
        });
        controller.enqueue(encoder.encode(`data: ${initialData}\n\n`));

        // Set up progress listener
        generator.addEventListener((event) => {
          const session = generationSessions.get(sessionId);
          if (session?.cancelled) {
            controller.close();
            return;
          }

          if (event.type === 'progress') {
            const progressData = JSON.stringify({
              type: 'progress',
              progress: event.data,
              timestamp: Date.now()
            });
            controller.enqueue(encoder.encode(`data: ${progressData}\n\n`));
          }
        });

        // Generate world
        const result = await generator.generateWorld(requestData);

        // Check if cancelled during generation
        const session = generationSessions.get(sessionId);
        if (session?.cancelled || !result.success && result.error === 'Generation cancelled by user') {
          const cancelData = JSON.stringify({
            type: 'cancelled',
            timestamp: Date.now()
          });
          controller.enqueue(encoder.encode(`data: ${cancelData}\n\n`));
          generationSessions.delete(sessionId);
          controller.close();
          return;
        }

        if (!result.success) {
          const errorData = JSON.stringify({
            type: 'error',
            error: result.error || 'World generation failed',
            timestamp: Date.now()
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
          return;
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

        // Send completion
        const completionData = JSON.stringify({
          type: 'completed',
          world: result.world,
          validationSummary: result.validationSummary,
          savedFilename: savedFilename,
          sessionId,
          timestamp: Date.now()
        });
        controller.enqueue(encoder.encode(`data: ${completionData}\n\n`));

        // Clean up session
        generationSessions.delete(sessionId);
        controller.close();

      } catch (error) {
        console.error('Streaming generation error:', error);
        const errorData = JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Internal server error',
          timestamp: Date.now()
        });
        controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
} 