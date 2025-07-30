'use client';

import { useEffect, useRef, useState } from 'react';
import { HexWorldRenderer, TileInfo } from '@/renderer/HexWorldRenderer';
import { AssetPackManager } from '@/core/AssetPackManager';
import { ValidationSummary, EdgeValidationResult } from '@/core/EdgeValidator';
import { World } from '@/types/index';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Settings, X, RotateCcw, AlertTriangle, XCircle, Earth, Wand2 } from 'lucide-react';
import { WorldGenerationPanel } from '@/components/WorldGenerationPanel';

// World type definition
interface WorldEntry {
  id: string;
  name: string;
  url: string;
}

// Available asset packs
const AVAILABLE_ASSET_PACKS = [
  { id: 'demo-pack', name: 'Simple Demo Pack', url: '/assets/packs/demo-pack.json' },
  { id: 'kaykit-medieval-pack', name: 'KayKit Medieval Pack', url: '/assets/packs/kaykit-medieval-pack.json' }
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
  const [selectedWorld, setSelectedWorld] = useState('demo-world');
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [showTiles, setShowTiles] = useState(true);
  const [showAddons, setShowAddons] = useState(true);
  const [showValidation, setShowValidation] = useState(false);
  const [interactivityEnabled, setInteractivityEnabled] = useState(false);
  const [selectedTileInfo, setSelectedTileInfo] = useState<TileInfo | null>(null);
  const [selectedValidationInfo, setSelectedValidationInfo] = useState<EdgeValidationResult | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showGenerationPanel, setShowGenerationPanel] = useState(false);
  const [availableWorlds, setAvailableWorlds] = useState<WorldEntry[]>([]);

  // Close modal when selections change
  useEffect(() => {
    if (!selectedTileInfo && !selectedValidationInfo) {
      setShowDetailModal(false);
    }
  }, [selectedTileInfo, selectedValidationInfo]);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isValidating, setIsValidating] = useState(false);
  const [validationSummary, setValidationSummary] = useState<ValidationSummary | null>(null);
  const [currentWorldData, setCurrentWorldData] = useState<World | null>(null);

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
      
      // Set up tile selection callback
      hexRenderer.setTileSelectionCallback((tileInfo: TileInfo | null) => {
        setSelectedTileInfo(tileInfo);
      });
      
      // Set up validation selection callback
      hexRenderer.setValidationSelectionCallback((validationInfo: EdgeValidationResult | null) => {
        setSelectedValidationInfo(validationInfo);
      });
      
      hexRendererRef.current = hexRenderer;
      assetManagerRef.current = assetMgr;
      
      return true;
    } catch (error: unknown) {
      console.error('Failed to initialize renderer:', error);
      return false;
    }
  };

  const refreshAvailableWorlds = async () => {
    try {
      const response = await fetch('/api/list-worlds');
      if (response.ok) {
        const data = await response.json();
        setAvailableWorlds(data.worlds);
      } else {
        console.error('Failed to fetch available worlds:', await response.text());
        // Fallback to basic preset worlds if API fails
        setAvailableWorlds([
          { id: 'demo-world', name: 'Demo World', url: '/assets/worlds/demo-world.json' },
          { id: 'medieval-village-world', name: 'Medieval Village World', url: '/assets/worlds/medieval-village-world.json' },
          { id: 'grass-road-loop-world', name: 'Grass Road Loop World', url: '/assets/worlds/grass-road-loop-world.json' }
        ]);
      }
    } catch (error) {
      console.error('Error fetching available worlds:', error);
      // Fallback to basic preset worlds if API fails
      setAvailableWorlds([
        { id: 'demo-world', name: 'Demo World', url: '/assets/worlds/demo-world.json' },
        { id: 'medieval-village-world', name: 'Medieval Village World', url: '/assets/worlds/medieval-village-world.json' },
        { id: 'grass-road-loop-world', name: 'Grass Road Loop World', url: '/assets/worlds/grass-road-loop-world.json' }
      ]);
    }
  };

  const ensureAssetPackLoaded = async (requiredAssetPack: string) => {
    if (!assetManagerRef.current) {
      throw new Error('Asset manager not initialized');
    }

    // Check if asset pack is already loaded
    if (!assetManagerRef.current.getAssetPack(requiredAssetPack)) {
      console.log(`Loading required asset pack: ${requiredAssetPack}`);
      const assetPackUrl = `/assets/packs/${requiredAssetPack}.json`;
      try {
        const loadedPack = await assetManagerRef.current.loadAssetPackFromUrl(assetPackUrl);
        console.log(`Asset pack loaded successfully: ${loadedPack.id}`);
      } catch (packError) {
        console.error(`Failed to load asset pack from ${assetPackUrl}:`, packError);
        throw new Error(`Cannot load required asset pack '${requiredAssetPack}': ${packError instanceof Error ? packError.message : String(packError)}`);
      }
    } else {
      console.log(`Asset pack ${requiredAssetPack} already loaded`);
    }
  };

  const loadWorld = async (worldId: string) => {
    if (!hexRendererRef.current || !assetManagerRef.current) return;
    
    // Construct world URL directly from ID
    const worldUrl = `/assets/worlds/${worldId}.json`;
    const world = { id: worldId, name: worldId, url: worldUrl };
    
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
      await ensureAssetPackLoaded(worldData.asset_pack);
      
      await hexRendererRef.current!.renderWorld(worldData);
      setCurrentWorldData(worldData); // Store world data for validation
      console.log(`Successfully loaded world: ${world.name}`);
      setIsLoading(false);
      
    } catch (error: unknown) {
      console.error(`Failed to load world '${world.name}':`, error);
      setIsLoading(false);
      setCurrentWorldData(null);
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

  const handleTileVisibilityToggle = (checked: boolean) => {
    setShowTiles(checked);
    
    if (hexRendererRef.current) {
      hexRendererRef.current.setTileVisibility(checked);
    }
  };

  const handleAddonVisibilityToggle = (checked: boolean) => {
    setShowAddons(checked);
    
    if (hexRendererRef.current) {
      hexRendererRef.current.setAddonVisibility(checked);
    }
  };

  const handleValidationVisibilityToggle = (checked: boolean) => {
    setShowValidation(checked);
    
    if (hexRendererRef.current) {
      hexRendererRef.current.setValidationVisibility(checked);
    }
  };

  const handleInteractivityToggle = (checked: boolean) => {
    setInteractivityEnabled(checked);
    
    if (hexRendererRef.current) {
      hexRendererRef.current.setInteractivityEnabled(checked);
    }
    
    // Clear selections when disabling
    if (!checked) {
      setSelectedTileInfo(null);
      setSelectedValidationInfo(null);
    }
  };

  const handleValidateEdges = async () => {
    if (!hexRendererRef.current || !currentWorldData) {
      console.warn('Cannot validate: renderer or world data not available');
      return;
    }

    try {
      setIsValidating(true);
      const summary = await hexRendererRef.current.validateAndVisualizeEdges(currentWorldData);
      setValidationSummary(summary);
      setShowValidation(true); // Auto-show validation results
      if (hexRendererRef.current) {
        hexRendererRef.current.setValidationVisibility(true);
      }
      console.log('Validation completed:', summary);
    } catch (error) {
      console.error('Validation failed:', error);
    } finally {
      setIsValidating(false);
    }
  };

  const handleClearValidation = () => {
    if (hexRendererRef.current) {
      hexRendererRef.current.clearValidationVisualization();
    }
    setValidationSummary(null);
    setShowValidation(false);
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
    const timer = setTimeout(async () => {
      // Load available worlds first
      await refreshAvailableWorlds();
      
      // Then initialize renderer
      const success = await initializeRenderer();
      if (success) {
        setTimeout(() => {
          loadWorld(selectedWorld);
        }, 500);
      } else {
        // Retry initialization after delay
        setTimeout(async () => {
          const retrySuccess = await initializeRenderer();
          if (retrySuccess) {
            setTimeout(() => {
              loadWorld(selectedWorld);
            }, 500);
          }
        }, 1000);
      }
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
      
      {/* Top-Right Selection Info */}
      {(selectedTileInfo || selectedValidationInfo) && (
        <div className="absolute top-4 right-4 z-20">
          <Card className="p-3 bg-card/95 backdrop-blur-sm shadow-lg border-border/50 min-w-[280px]">
            <div className="space-y-2">
              {selectedTileInfo && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-blue-600">Selected Tile</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedTileInfo(null)}
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between">
                      <span>Coordinates:</span>
                      <span className="font-mono">({selectedTileInfo.coordinates.q}, {selectedTileInfo.coordinates.r})</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Type:</span>
                      <span className="font-mono text-blue-600">{selectedTileInfo.tileType}</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDetailModal(true)}
                    className="w-full mt-2"
                  >
                    View Details
                  </Button>
                </div>
              )}
              
              {selectedValidationInfo && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-red-600">Edge Incompatibility</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedValidationInfo(null)}
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between">
                      <span>Source:</span>
                      <span className="font-mono">({selectedValidationInfo.sourcePosition.q}, {selectedValidationInfo.sourcePosition.r})</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Target:</span>
                      <span className="font-mono">({selectedValidationInfo.targetPosition.q}, {selectedValidationInfo.targetPosition.r})</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Edges:</span>
                      <span className="font-mono">{selectedValidationInfo.sourceEdgeIndex} ↔ {selectedValidationInfo.targetEdgeIndex}</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDetailModal(true)}
                    className="w-full mt-2"
                  >
                    View Details
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card rounded-lg shadow-xl border border-border max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold">
                {selectedTileInfo ? 'Tile Details' : 'Validation Details'}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDetailModal(false)}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[calc(90vh-80px)]">
              {selectedTileInfo && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium">Coordinates</Label>
                      <div className="font-mono text-lg">({selectedTileInfo.coordinates.q}, {selectedTileInfo.coordinates.r})</div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Tile Type</Label>
                      <div className="font-mono text-lg text-blue-600">{selectedTileInfo.tileType}</div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Elevation</Label>
                      <div className="font-mono text-lg">{selectedTileInfo.elevation}</div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Rotation</Label>
                      <div className="font-mono text-lg">{selectedTileInfo.rotation * 60}° (step {selectedTileInfo.rotation})</div>
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">3D Position</Label>
                    <div className="font-mono text-sm mt-1 space-y-1">
                      <div>X: {selectedTileInfo.position.x.toFixed(3)}</div>
                      <div>Y: {selectedTileInfo.position.y.toFixed(3)}</div>
                      <div>Z: {selectedTileInfo.position.z.toFixed(3)}</div>
                    </div>
                  </div>
                </div>
              )}
              
              {selectedValidationInfo && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Card className="p-3">
                      <Label className="text-sm font-medium">Source Tile</Label>
                      <div className="space-y-1 mt-1">
                        <div className="font-mono">({selectedValidationInfo.sourcePosition.q}, {selectedValidationInfo.sourcePosition.r})</div>
                        <div className="text-sm text-muted-foreground">{selectedValidationInfo.stepByStep.sourceTileType}</div>
                        <div className="text-xs">Edge {selectedValidationInfo.sourceEdgeIndex}: ({selectedValidationInfo.sourceEdgeType})</div>
                      </div>
                    </Card>
                    <Card className="p-3">
                      <Label className="text-sm font-medium">Target Tile</Label>
                      <div className="space-y-1 mt-1">
                        <div className="font-mono">({selectedValidationInfo.targetPosition.q}, {selectedValidationInfo.targetPosition.r})</div>
                        <div className="text-sm text-muted-foreground">{selectedValidationInfo.stepByStep.targetTileType}</div>
                        <div className="text-xs">Edge {selectedValidationInfo.targetEdgeIndex}: ({selectedValidationInfo.targetEdgeType})</div>
                      </div>
                    </Card>
                  </div>

                  <Card className="p-3">
                    <Label className="text-sm font-medium mb-2 block">Step-by-Step Validation</Label>
                    <div className="space-y-3 text-xs">
                      <div>
                        <div className="font-medium text-gray-600">Asset Pack Configuration:</div>
                        <div className="ml-2">Offset: {selectedValidationInfo.stepByStep.assetPackOffset} ({selectedValidationInfo.stepByStep.assetPackOffsetDirection})</div>
                      </div>

                      <div>
                        <div className="font-medium text-gray-600">1. Original Edges (from asset pack):</div>
                        <div className="ml-2 space-y-1">
                          <div>Source: [{selectedValidationInfo.stepByStep.sourceOriginalEdges.map((e, i) => `${i}:(${e})`).join(', ')}]</div>
                          <div>Target: [{selectedValidationInfo.stepByStep.targetOriginalEdges.map((e, i) => `${i}:(${e})`).join(', ')}]</div>
                        </div>
                      </div>

                      <div>
                        <div className="font-medium text-gray-600">2. After Undoing Asset Pack Offset ({selectedValidationInfo.stepByStep.assetPackOffsetDirection === 'clockwise' ? '-' : '+'}{selectedValidationInfo.stepByStep.assetPackOffset}):</div>
                        <div className="ml-2 space-y-1">
                          <div>Source: [{selectedValidationInfo.stepByStep.sourceAfterOffset.map((e, i) => `${i}:(${e})`).join(', ')}]</div>
                          <div>Target: [{selectedValidationInfo.stepByStep.targetAfterOffset.map((e, i) => `${i}:(${e})`).join(', ')}]</div>
                        </div>
                      </div>

                      <div>
                        <div className="font-medium text-gray-600">3. Final Edges (after tile rotation):</div>
                        <div className="ml-2 space-y-1">
                          <div>Source: [{selectedValidationInfo.stepByStep.sourceFinalEdges.map((e, i) => `${i}:(${e})`).join(', ')}]</div>
                          <div>Target: [{selectedValidationInfo.stepByStep.targetFinalEdges.map((e, i) => `${i}:(${e})`).join(', ')}]</div>
                        </div>
                      </div>

                      <div className="bg-yellow-50 p-2 rounded">
                        <div className="font-medium text-gray-600">4. Connection Check:</div>
                        <div className="ml-2 space-y-1">
                          <div>Source edge {selectedValidationInfo.sourceEdgeIndex}: ({selectedValidationInfo.sourceEdgeType})</div>
                          <div>Target edge {selectedValidationInfo.targetEdgeIndex}: ({selectedValidationInfo.targetEdgeType})</div>
                          <div className="pt-1 border-t">
                            <span className="font-medium">Result: </span>
                            <span className={`font-bold ${selectedValidationInfo.isValid ? 'text-green-600' : 'text-red-600'}`}>
                              {selectedValidationInfo.isValid ? 'COMPATIBLE ✅' : 'INCOMPATIBLE ❌'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
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
            <Card className="w-72 backdrop-blur-sm bg-card/95 border-border/50 shadow-lg">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <X className="h-3 w-3" />
                      <span className="sr-only">Close controls</span>
                    </Button>
                  </CollapsibleTrigger>
                  <span className="flex items-center gap-2">
                    <Earth className="h-4 w-4" />
                    Hex3World
                  </span>
                </CardTitle>
              </CardHeader>
              
              <CollapsibleContent>
                <CardContent className="space-y-3 text-sm">
                  {/* World Selection */}
                  <div className="space-y-1.5">
                    <Label htmlFor="world-select" className="text-xs font-medium text-muted-foreground">
                      WORLD
                    </Label>
                    <Select 
                      value={selectedWorld} 
                      onValueChange={handleWorldChange}
                      disabled={isLoading}
                    >
                      <SelectTrigger id="world-select" className="h-8">
                        <SelectValue placeholder="Select a world" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableWorlds.map((world: WorldEntry) => (
                          <SelectItem key={world.id} value={world.id}>
                            {world.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Display Options */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">DISPLAY</Label>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="tiles"
                          checked={showTiles}
                          onCheckedChange={handleTileVisibilityToggle}
                          disabled={isLoading}
                        />
                        <Label htmlFor="tiles" className="leading-none">
                          Tiles
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="coordinates"
                          checked={showCoordinates}
                          onCheckedChange={handleCoordinateToggle}
                          disabled={isLoading}
                        />
                        <Label htmlFor="coordinates" className="leading-none">
                          Coordinates
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="addons"
                          checked={showAddons}
                          onCheckedChange={handleAddonVisibilityToggle}
                          disabled={isLoading}
                        />
                        <Label htmlFor="addons" className="leading-none">
                          Addons
                        </Label>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="validation"
                          checked={showValidation}
                          onCheckedChange={handleValidationVisibilityToggle}
                          disabled={isLoading}
                        />
                        <Label htmlFor="validation" className="leading-none">
                          Validation
                        </Label>
                      </div>
                    </div>
                  </div>
                  
                  {/* Interactivity Options */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">INTERACTIVITY</Label>
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="interactivity"
                        checked={interactivityEnabled}
                        onCheckedChange={handleInteractivityToggle}
                        disabled={isLoading}
                      />
                      <Label htmlFor="interactivity" className="leading-none">
                        Enable Tile Selection
                      </Label>
                    </div>
                  </div>

                  {/* Validation Actions */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">VALIDATION</Label>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleValidateEdges}
                        disabled={isLoading || !currentWorldData || isValidating}
                        className="flex-1 h-8 text-xs"
                        variant="outline"
                      >
                        {isValidating ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <AlertTriangle className="h-3 w-3 mr-1" />
                        )}
                        {isValidating ? 'Validating...' : 'Validate'}
                      </Button>
                      
                      <Button
                        onClick={handleClearValidation}
                        disabled={isLoading || !validationSummary}
                        className="h-8 px-2"
                        variant="outline"
                        size="sm"
                      >
                        <XCircle className="h-3 w-3" />
                      </Button>
                    </div>

                    {/* Validation Results */}
                    {validationSummary && (
                      <div className="p-2 bg-muted/30 rounded text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Results:</span>
                          <div className="flex items-center gap-1">
                            <span className="text-green-600">{validationSummary.validEdges}</span>
                            <span className="text-muted-foreground">valid</span>
                            <span className="text-muted-foreground mx-1">•</span>
                            <span className="text-red-600">{validationSummary.invalidEdges}</span>
                            <span className="text-muted-foreground">invalid</span>
                          </div>
                        </div>
                        {validationSummary.errors.length > 0 && (
                          <div className="mt-1 text-red-500 text-xs">
                            {validationSummary.errors.length} error{validationSummary.errors.length > 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* AI Generation */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">AI GENERATION</Label>
                    <Button
                      onClick={() => setShowGenerationPanel(true)}
                      disabled={isLoading}
                      className="w-full h-8 text-xs"
                      variant="default"
                    >
                      <Wand2 className="h-3 w-3 mr-1" />
                      Generate World
                    </Button>
                  </div>

                  {/* Camera Controls */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">CAMERA</Label>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleCameraReset}
                        disabled={isLoading}
                        className="flex-1 h-8 text-xs"
                        variant="outline"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Reset
                      </Button>
                      
                      <Button
                        onClick={handleReload}
                        disabled={isLoading}
                        className="flex-1 h-8 text-xs"
                        variant="outline"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Reload
                      </Button>
                    </div>

                    {/* Preset Views - Compact Grid */}
                    <div className="grid grid-cols-3 gap-1">
                      {CAMERA_PRESETS.map(preset => (
                        <Button
                          key={preset.name}
                          onClick={() => handlePresetView(preset)}
                          disabled={isLoading}
                          variant="secondary"
                          size="sm"
                          className="text-[10px] h-6 px-1"
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

      {/* AI World Generation Panel */}
      {showGenerationPanel && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowGenerationPanel(false)}
        >
          <div 
            className="relative max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              onClick={() => setShowGenerationPanel(false)}
              variant="outline"
              size="sm"
              className="absolute -top-12 right-0 bg-white/90 hover:bg-white"
            >
              <X className="h-4 w-4" />
              Close
            </Button>
            <WorldGenerationPanel
              assetPackManager={assetManagerRef.current!}
              availableAssetPacks={AVAILABLE_ASSET_PACKS.map(pack => pack.id)}
              currentWorld={currentWorldData || undefined}
              onWorldGenerated={async (world) => {
                // Save the generated world
                try {
                  const response = await fetch('/api/save-world', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ world })
                  });
                  
                  if (response.ok) {
                    const result = await response.json();
                    console.log('World saved:', result.message);
                  } else {
                    console.error('Failed to save world:', await response.text());
                  }
                } catch (error) {
                  console.error('Error saving world:', error);
                }

                // Update UI
                setCurrentWorldData(world);
                if (hexRendererRef.current) {
                  // Ensure the required asset pack is loaded before rendering
                  await ensureAssetPackLoaded(world.asset_pack);
                  hexRendererRef.current.renderWorld(world);
                }
                setShowGenerationPanel(false);

                // Refresh available worlds list
                await refreshAvailableWorlds();
              }}
              onProgressUpdate={(progress) => {
                // Could show progress in a toast or status area
                console.log('Generation progress:', progress);
              }}
            />
          </div>
        </div>
      )}
      
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
