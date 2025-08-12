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
          // Extract timestamp or make it readable (legacy format)
          const timestamp = id.replace('generated-world-', '').replace(/-/g, ':');
          name = `Generated World (${timestamp})`;
        } else {
          // For theme-based filenames, use the filename as-is for better readability
          // Remove the UID suffix (last 8 characters + hyphen) to show clean theme name
          const uidPattern = /-[a-z0-9]{8}$/;
          if (uidPattern.test(id)) {
            // This is a theme-based filename, extract the theme part
            const themeId = id.replace(uidPattern, '');
            name = themeId
              .split('-')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
          } else {
            // Convert kebab-case to Title Case for other files
            name = id
              .split('-')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
          }
        }

        return {
          id,
          name,
          url: `/assets/worlds/${file}`
        };
      })
      .sort((a, b) => {
        // Helper function to check if a world is generated (vs preset)
        const isGenerated = (id: string) => 
          id.startsWith('generated-world-') || /-[a-z0-9]{8}$/.test(id);
        
        const aIsGenerated = isGenerated(a.id);
        const bIsGenerated = isGenerated(b.id);
        
        // Sort with preset worlds first, then generated worlds by newest
        if (aIsGenerated && !bIsGenerated) {
          return 1; // Generated worlds go after preset worlds
        }
        if (!aIsGenerated && bIsGenerated) {
          return -1; // Preset worlds go before generated worlds
        }
        if (aIsGenerated && bIsGenerated) {
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