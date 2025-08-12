import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { World } from '@/types/index';

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

    const { world, filename }: { world: World; filename?: string } = await request.json();

    if (!world || !world.asset_pack || !Array.isArray(world.tiles)) {
      return NextResponse.json({ error: 'Invalid world data' }, { status: 400 });
    }

    // Generate filename if not provided
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const worldFilename = filename || `generated-world-${timestamp}.json`;
    const sanitizedFilename = worldFilename.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase();

    // Ensure .json extension
    const finalFilename = sanitizedFilename.endsWith('.json') ? sanitizedFilename : `${sanitizedFilename}.json`;

    // Path to save the world file
    const publicDir = join(process.cwd(), 'public', 'assets', 'worlds');
    const filePath = join(publicDir, finalFilename);

    // The world object should already contain comprehensive metadata from the generator
    const worldToSave = world;

    // Write the world file
    await writeFile(filePath, JSON.stringify(worldToSave, null, 2), 'utf8');

    const worldUrl = `/assets/worlds/${finalFilename}`;

    return NextResponse.json({ 
      success: true, 
      filename: finalFilename,
      url: worldUrl,
      message: `World saved successfully as ${finalFilename}`
    });

  } catch (error) {
    console.error('Failed to save world:', error);
    return NextResponse.json(
      { error: 'Failed to save world file' }, 
      { status: 500 }
    );
  }
} 