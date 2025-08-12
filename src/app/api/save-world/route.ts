import { NextRequest, NextResponse } from 'next/server';
import { writeFile, access } from 'fs/promises';
import { resolve } from 'path';
import { SaveWorldRequestSchema, validateWorldData, sanitizeFilename } from '@/lib/validation';

export async function POST(request: NextRequest) {
  try {
    // Check if world saving is enabled
    const enableWorldSaving = process.env.ENABLE_WORLD_SAVING === 'true';
    
    if (!enableWorldSaving) {
      return NextResponse.json({ 
        success: false, 
        message: 'World saving is disabled in environment configuration' 
      }, { status: 403 });
    }

    // Parse and validate request body
    let requestData;
    try {
      requestData = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    // Validate request using Zod schema
    const validationResult = SaveWorldRequestSchema.safeParse(requestData);
    if (!validationResult.success) {
      return NextResponse.json({ 
        error: 'Invalid request data',
        details: validationResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      }, { status: 400 });
    }

    const { world, filename } = validationResult.data;

    // Additional world data validation
    if (!validateWorldData(world)) {
      return NextResponse.json({ error: 'Invalid world data structure' }, { status: 400 });
    }

    // Check world size limits
    const worldString = JSON.stringify(world);
    if (worldString.length > 10 * 1024 * 1024) { // 10MB limit
      return NextResponse.json({ error: 'World data too large (max 10MB)' }, { status: 413 });
    }

    // Generate secure filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseFilename = filename || `generated-world-${timestamp}`;
    const sanitizedFilename = sanitizeFilename(baseFilename);

    // Ensure .json extension
    const finalFilename = sanitizedFilename.endsWith('.json') ? sanitizedFilename : `${sanitizedFilename}.json`;

    // Validate filename isn't empty after sanitization
    if (!finalFilename || finalFilename === '.json') {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    // Secure path handling
    const publicDir = resolve(process.cwd(), 'public', 'assets', 'worlds');
    const filePath = resolve(publicDir, finalFilename);

    // Critical security check: ensure file path is within allowed directory
    if (!filePath.startsWith(publicDir + '/') && filePath !== publicDir) {
      console.error('Path traversal attempt detected:', { requestedPath: finalFilename, resolvedPath: filePath });
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    // Check if directory exists and is writable
    try {
      await access(publicDir);
    } catch {
      console.error('World directory not accessible:', publicDir);
      return NextResponse.json({ error: 'World saving directory not available' }, { status: 503 });
    }

    // Add security metadata to the world object
    const worldToSave = {
      ...world,
      metadata: {
        ...world.metadata,
        savedAt: new Date().toISOString(),
        version: '1.0.0',
        source: 'hex3world-generator'
      }
    };

    // Write the world file with proper error handling
    try {
      await writeFile(filePath, JSON.stringify(worldToSave, null, 2), 'utf8');
    } catch (writeError) {
      console.error('Failed to write world file:', writeError);
      return NextResponse.json({ error: 'Failed to save world file to disk' }, { status: 500 });
    }

    const worldUrl = `/assets/worlds/${finalFilename}`;

    console.log('World saved successfully:', { filename: finalFilename, size: worldString.length });

    return NextResponse.json({ 
      success: true, 
      filename: finalFilename,
      url: worldUrl,
      message: `World saved successfully as ${finalFilename}`,
      size: worldString.length
    });

  } catch (error) {
    console.error('Failed to save world:', error);
    
    // Don't expose internal errors to client
    const errorMessage = error instanceof Error && error.message.includes('Invalid') 
      ? error.message 
      : 'Internal server error while saving world';
      
    return NextResponse.json(
      { error: errorMessage }, 
      { status: 500 }
    );
  }
} 