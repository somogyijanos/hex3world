'use client';

import { useEffect, useRef, useState } from 'react';
import { HexWorldRenderer } from '@/renderer/HexWorldRenderer';
import { AssetPackManager } from '@/core/AssetPackManager';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Settings, X, RotateCcw } from 'lucide-react';

// Available worlds for selection
const AVAILABLE_WORLDS = [
  { id: 'demo-world', name: 'Demo World', url: '/assets/worlds/demo-world.json' },
  { id: 'medieval-village-world', name: 'Medieval Village World', url: '/assets/worlds/medieval-village-world.json' },
  // Add more worlds here as they become available
  // { id: 'custom-world', name: 'Custom World', url: '/assets/worlds/custom-world.json' }
];

// Preset camera views
const CAMERA_PRESETS = [
  { name: 'Top', position: [0, 10, 0], target: [0, 0, 0] },
  { name: 'Front', position: [0, 0, 10], target: [0, 0, 0] },
  { name: 'Side', position: [10, 0, 0], target: [0, 0, 0] },
  { name: 'Isometric', position: [5, 5, 5], target: [0, 0, 0] },
  { name: 'Bird\'s Eye', position: [3, 8, 3], target: [0, 0, 0] }
];

export default function HexWorldPage() {
  const rendererRef = useRef<HTMLDivElement>(null);
  const hexRendererRef = useRef<HexWorldRenderer | null>(null);
  const assetManagerRef = useRef<AssetPackManager | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWorld, setSelectedWorld] = useState(AVAILABLE_WORLDS[0].id);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  // Dark mode toggle effect
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const initializeRenderer = async () => {
    if (!rendererRef.current) return false;

    const container = rendererRef.current;
    if (container.clientWidth === 0 || container.clientHeight === 0) return false;

    try {
      const assetMgr = new AssetPackManager();
      // WorldManager not needed for this demo, but could be used for world validation
      // const worldMgr = new WorldManager(assetMgr);
      
      // Don't load any asset pack here - will be loaded dynamically based on world
      
      const hexRenderer = new HexWorldRenderer({
        container: container,
        enableControls: true,
        showGrid: false,
        showCornerAxes: showCoordinates
      }, assetMgr);
      
      hexRendererRef.current = hexRenderer;
      assetManagerRef.current = assetMgr;
      
      return true;
    } catch (error: unknown) {
      console.error('Failed to initialize renderer:', error);
      return false;
    }
  };

  const loadWorld = async (worldId: string) => {
    if (!hexRendererRef.current || !assetManagerRef.current) return;
    
    const world = AVAILABLE_WORLDS.find(w => w.id === worldId);
    if (!world) {
      console.error(`World '${worldId}' not found in available worlds`);
      return;
    }
    
    try {
      setIsLoading(true);
      console.log(`Loading world: ${world.name} from ${world.url}`);
      
      const worldResponse = await fetch(world.url);
      if (!worldResponse.ok) {
        throw new Error(`Failed to fetch world '${world.name}': ${worldResponse.status} ${worldResponse.statusText}`);
      }
      
      const worldData = await worldResponse.json();
      
      // Validate that the world data has the expected structure
      if (!worldData.asset_pack || !Array.isArray(worldData.tiles)) {
        throw new Error(`Invalid world data format in '${world.name}'`);
      }
      
      // Load the required asset pack if not already loaded
      const requiredAssetPack = worldData.asset_pack;
      if (!assetManagerRef.current!.getAssetPack(requiredAssetPack)) {
        console.log(`Loading required asset pack: ${requiredAssetPack}`);
        const assetPackUrl = `/assets/packs/${requiredAssetPack}.json`;
        try {
          const loadedPack = await assetManagerRef.current!.loadAssetPackFromUrl(assetPackUrl);
          console.log(`Asset pack loaded successfully: ${loadedPack.id}, now checking if it's available: ${assetManagerRef.current!.getAssetPack(requiredAssetPack) ? 'YES' : 'NO'}`);
        } catch (packError) {
          console.error(`Failed to load asset pack from ${assetPackUrl}:`, packError);
          throw new Error(`Cannot load required asset pack '${requiredAssetPack}': ${packError instanceof Error ? packError.message : String(packError)}`);
        }
      } else {
        console.log(`Asset pack ${requiredAssetPack} already loaded`);
      }
      
      await hexRendererRef.current!.renderWorld(worldData);
      console.log(`Successfully loaded world: ${world.name}`);
      setIsLoading(false);
      
    } catch (error: unknown) {
      console.error(`Failed to load world '${world.name}':`, error);
      setIsLoading(false);
      // Could add error state here to show user-friendly error message
    }
  };

  const handleWorldChange = (worldId: string) => {
    setSelectedWorld(worldId);
    loadWorld(worldId);
  };

  const handleCoordinateToggle = (checked: boolean) => {
    setShowCoordinates(checked);
    
    if (hexRendererRef.current) {
      hexRendererRef.current.toggleCoordinateSystem(checked);
    }
  };

  const handleCameraReset = () => {
    if (hexRendererRef.current) {
      hexRendererRef.current.resetCamera();
    }
  };

  const handlePresetView = (preset: typeof CAMERA_PRESETS[0]) => {
    if (hexRendererRef.current) {
      hexRendererRef.current.setCameraPreset(
        preset.position as [number, number, number], 
        preset.target as [number, number, number]
      );
    }
  };

  const handleReload = () => {
    loadWorld(selectedWorld);
  };

  // Initialize renderer once on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      initializeRenderer().then(success => {
        if (success) {
          setTimeout(() => {
            loadWorld(selectedWorld);
          }, 500);
        } else {
          setTimeout(() => {
            initializeRenderer().then(retrySuccess => {
              if (retrySuccess) {
                setTimeout(() => {
                  loadWorld(selectedWorld);
                }, 500);
              }
            });
          }, 1000);
        }
      });
    }, 100);

    // Handle window resize
    const handleResize = () => {
      if (hexRendererRef.current && rendererRef.current) {
        const container = rendererRef.current;
        hexRendererRef.current.resize(container.clientWidth, container.clientHeight);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, []); // Only run once on mount

  // Load world when selectedWorld changes (but don't reinitialize renderer)
  useEffect(() => {
    if (hexRendererRef.current) {
      loadWorld(selectedWorld);
    }
  }, [selectedWorld]); // Only run when selectedWorld changes

  return (
    <div className="w-full h-screen relative bg-background">
      <div ref={rendererRef} className="w-full h-full" />
      
      {/* Collapsible UI Controls Panel */}
      <div className="absolute top-4 left-4">
        <Collapsible open={isPanelOpen} onOpenChange={setIsPanelOpen}>
          {/* Collapsed state - just show a floating button */}
          {!isPanelOpen && (
            <CollapsibleTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="h-10 w-10 rounded-full backdrop-blur-sm bg-card/95 border-border/50 shadow-lg hover:shadow-xl transition-all"
              >
                <Settings className="h-4 w-4" />
                <span className="sr-only">Open controls</span>
              </Button>
            </CollapsibleTrigger>
          )}

          {/* Expanded state - full controls panel */}
          {isPanelOpen && (
            <Card className="w-64 backdrop-blur-sm bg-card/95 border-border/50 shadow-lg">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Hex3World
                  </span>
                  <div className="flex items-center space-x-2">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <X className="h-3 w-3" />
                        <span className="sr-only">Close controls</span>
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                </CardTitle>
              </CardHeader>
              
              <CollapsibleContent>
                <CardContent className="space-y-4">
                  {/* World Selection */}
                  <div className="space-y-2">
                    <Label htmlFor="world-select" className="text-sm font-medium">
                      World
                    </Label>
                    <Select 
                      value={selectedWorld} 
                      onValueChange={handleWorldChange}
                      disabled={isLoading}
                    >
                      <SelectTrigger id="world-select">
                        <SelectValue placeholder="Select a world" />
                      </SelectTrigger>
                      <SelectContent>
                        {AVAILABLE_WORLDS.map(world => (
                          <SelectItem key={world.id} value={world.id}>
                            {world.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Coordinate Toggle */}
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="coordinates"
                      checked={showCoordinates}
                      onCheckedChange={handleCoordinateToggle}
                      disabled={isLoading}
                    />
                    <Label 
                      htmlFor="coordinates" 
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Show Coordinates
                    </Label>
                  </div>

                  {/* Camera Reset */}
                  <Button
                    onClick={handleCameraReset}
                    disabled={isLoading}
                    className="w-full"
                    variant="outline"
                  >
                    Reset Camera
                  </Button>

                  {/* Reload World */}
                  <Button
                    onClick={handleReload}
                    disabled={isLoading}
                    className="w-full"
                    variant="outline"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Reload World
                  </Button>

                  {/* Preset Views */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Quick Views</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {CAMERA_PRESETS.map(preset => (
                        <Button
                          key={preset.name}
                          onClick={() => handlePresetView(preset)}
                          disabled={isLoading}
                          variant="secondary"
                          size="sm"
                          className="text-xs"
                        >
                          {preset.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          )}
        </Collapsible>
      </div>
      
      {/* Loading indicator */}
      {isLoading && (
        <Card className="absolute bottom-4 right-4 backdrop-blur-sm bg-card/95 border-border/50 shadow-lg">
          <CardContent className="flex items-center space-x-2 p-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading...</span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
