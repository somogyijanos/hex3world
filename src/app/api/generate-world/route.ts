import { NextRequest, NextResponse } from 'next/server';
import { AssetPackManager } from '@/core/AssetPackManager';
import { SimpleWorldGenerator } from '@/core/SimpleWorldGenerator';
import { getLLMConfig, isLLMConfigured } from '@/lib/llm-config';
import { GenerationRequest } from '@/types/llm';
import { 
  GenerationRequestSchema, 
  validateAssetPackId, 
  validateAndSanitizeDescription, 
  validateSessionId,
  moderateContent
} from '@/lib/validation';

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

// Enhanced session management with cleanup and limits
interface GenerationSession {
  generator: SimpleWorldGenerator;
  cancelled: boolean;
  createdAt: number;
  clientId: string;
}

const generationSessions = new Map<string, GenerationSession>();
const MAX_SESSIONS = parseInt(process.env.MAX_CONCURRENT_SESSIONS || '50');
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT_MS || '1800000'); // 30 minutes

// Cleanup function to remove expired sessions
function cleanupExpiredSessions() {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [sessionId, session] of generationSessions.entries()) {
    if (now - session.createdAt > SESSION_TIMEOUT) {
      try {
        session.generator.cancel();
      } catch (error) {
        console.warn('Error cancelling expired session:', sessionId, error);
      }
      generationSessions.delete(sessionId);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} expired generation sessions`);
  }
}

// Cleanup sessions every 10 minutes
setInterval(cleanupExpiredSessions, 10 * 60 * 1000);

function getClientIdentifier(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : 'unknown';
  return ip;
}

export async function POST(request: NextRequest) {
  try {
    // Cleanup expired sessions on each request
    cleanupExpiredSessions();
    
    // Check if LLM is configured
    if (!isLLMConfigured()) {
      return NextResponse.json({ 
        error: 'LLM not properly configured. Please check your environment variables.' 
      }, { status: 400 });
    }

    // Parse and validate request body
    let requestData: unknown;
    try {
      requestData = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    const clientId = getClientIdentifier(request);

    // Check if this is a cancellation request
    if (typeof requestData === 'object' && requestData !== null && 
        'action' in requestData && 'sessionId' in requestData &&
        requestData.action === 'cancel' && typeof requestData.sessionId === 'string') {
      if (!validateSessionId(requestData.sessionId)) {
        return NextResponse.json({ error: 'Invalid session ID format' }, { status: 400 });
      }
      
      const session = generationSessions.get(requestData.sessionId);
      if (session && session.clientId === clientId) {
        session.cancelled = true;
        session.generator.cancel();
        generationSessions.delete(requestData.sessionId);
        console.log(`🛑 Cancelled generation session: ${requestData.sessionId}`);
        return NextResponse.json({ success: true, cancelled: true });
      }
      return NextResponse.json({ error: 'Session not found or unauthorized' }, { status: 404 });
    }

    // Validate request using Zod schema
    const validationResult = GenerationRequestSchema.safeParse(requestData);
    if (!validationResult.success) {
      return NextResponse.json({ 
        error: 'Invalid request data',
        details: validationResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      }, { status: 400 });
    }

    const validatedData = validationResult.data as GenerationRequest;

    // Additional security validations
    if (!validateAssetPackId(validatedData.assetPackId)) {
      return NextResponse.json({ 
        error: 'Invalid or unauthorized asset pack ID' 
      }, { status: 400 });
    }

    // Content moderation
    const moderationResult = moderateContent(validatedData.description);
    if (!moderationResult.allowed) {
      console.warn('Content moderation blocked request:', { clientId, description: validatedData.description });
      return NextResponse.json({ 
        error: moderationResult.reason || 'Content violates usage policies'
      }, { status: 400 });
    }

    // Additional description sanitization and validation
    try {
      validatedData.description = validateAndSanitizeDescription(validatedData.description);
    } catch (error) {
      console.warn('Suspicious content detected:', { clientId, error: error instanceof Error ? error.message : 'Unknown error' });
      return NextResponse.json({ 
        error: 'Description contains potentially harmful content' 
      }, { status: 400 });
    }

    // Check if this is a streaming request
    if (validatedData.stream) {
      return handleStreamingGeneration(validatedData, clientId, request);
    }

    // Check session limits
    if (generationSessions.size >= MAX_SESSIONS) {
      return NextResponse.json({ 
        error: 'Server is currently at capacity. Please try again later.' 
      }, { status: 503 });
    }

    // Initialize asset pack manager
    const assetPackManager = new AssetPackManager();
    
    // Load the asset pack with validation
    const assetPackUrl = `/assets/packs/${validatedData.assetPackId}.json`;
    try {
      // Convert relative URL to absolute URL for server-side fetch
      const baseUrl = new URL(request.url).origin;
      const absoluteUrl = new URL(assetPackUrl, baseUrl).toString();
      await assetPackManager.loadAssetPackFromUrl(absoluteUrl);
    } catch (error) {
      console.error('Failed to load asset pack:', validatedData.assetPackId, error);
      return NextResponse.json({ 
        error: 'Failed to load specified asset pack' 
      }, { status: 400 });
    }

    // Initialize world generator
    const generator = new SimpleWorldGenerator(assetPackManager);
    
    // Configure LLM
    const llmConfig = getLLMConfig();
    generator.setLLMProvider(llmConfig);

    // Generate secure session ID and store session
    const sessionId = Math.random().toString(36).substring(2, 15);
    generationSessions.set(sessionId, { 
      generator, 
      cancelled: false, 
      createdAt: Date.now(),
      clientId 
    });

    console.log('Starting world generation:', { sessionId, clientId, assetPack: validatedData.assetPackId });

    // Generate world
    const result = await generator.generateWorld(validatedData);

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

        // Convert relative URL to absolute URL for server-side fetch
        const baseUrl = new URL(request.url).origin;
        const saveUrl = new URL('/api/save-world', baseUrl).toString();
        const saveResponse = await fetch(saveUrl, {
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

async function handleStreamingGeneration(requestData: GenerationRequest, clientId: string, request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Initialize asset pack manager
        const assetPackManager = new AssetPackManager();
        
        // Load the asset pack
        const assetPackUrl = `/assets/packs/${requestData.assetPackId}.json`;
        // Convert relative URL to absolute URL for server-side fetch
        const baseUrl = new URL(request.url).origin;
        const absoluteUrl = new URL(assetPackUrl, baseUrl).toString();
        await assetPackManager.loadAssetPackFromUrl(absoluteUrl);

        // Initialize world generator
        const generator = new SimpleWorldGenerator(assetPackManager);
        
        // Configure LLM
        const llmConfig = getLLMConfig();
        generator.setLLMProvider(llmConfig);

        // Check session limits for streaming as well
        if (generationSessions.size >= MAX_SESSIONS) {
          const errorData = JSON.stringify({
            type: 'error',
            error: 'Server is currently at capacity. Please try again later.',
            timestamp: Date.now()
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
          return;
        }

        // Generate session ID and store session
        const sessionId = Math.random().toString(36).substring(2, 15);
        generationSessions.set(sessionId, { 
          generator, 
          cancelled: false, 
          createdAt: Date.now(),
          clientId 
        });

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

            // Convert relative URL to absolute URL for server-side fetch
            const baseUrl = new URL(request.url).origin;
            const saveUrl = new URL('/api/save-world', baseUrl).toString();
            const saveResponse = await fetch(saveUrl, {
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