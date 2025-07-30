import { NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import { join } from 'path';

export async function GET() {
  try {
    const worldsDir = join(process.cwd(), 'public', 'assets', 'worlds');
    
    // Read all files in the worlds directory
    const files = await readdir(worldsDir);
    
    // Filter for JSON files and create world entries
    const worlds = files
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const id = file.replace('.json', '');
        
        // Create display names based on filename patterns
        let name: string;
        if (id === 'demo-world') {
          name = 'Demo World';
        } else if (id === 'medieval-village-world') {
          name = 'Medieval Village World';
        } else if (id === 'grass-road-loop-world') {
          name = 'Grass Road Loop World';
        } else if (id.startsWith('generated-world-')) {
          // Extract timestamp or make it readable
          const timestamp = id.replace('generated-world-', '').replace(/-/g, ':');
          name = `Generated World (${timestamp})`;
        } else {
          // Convert kebab-case to Title Case
          name = id
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        }

        return {
          id,
          name,
          url: `/assets/worlds/${file}`
        };
      })
      .sort((a, b) => {
        // Sort with preset worlds first, then generated worlds by newest
        if (a.id.startsWith('generated-world-') && !b.id.startsWith('generated-world-')) {
          return 1; // Generated worlds go after preset worlds
        }
        if (!a.id.startsWith('generated-world-') && b.id.startsWith('generated-world-')) {
          return -1; // Preset worlds go before generated worlds
        }
        if (a.id.startsWith('generated-world-') && b.id.startsWith('generated-world-')) {
          return b.id.localeCompare(a.id); // Newest generated worlds first
        }
        return a.name.localeCompare(b.name); // Alphabetical for preset worlds
      });

    return NextResponse.json({ worlds });

  } catch (error) {
    console.error('Failed to list worlds:', error);
    return NextResponse.json(
      { error: 'Failed to list worlds' }, 
      { status: 500 }
    );
  }
} 