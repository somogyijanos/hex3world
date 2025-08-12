'use client';

import { useEffect, useRef, useState } from 'react';
import { HexWorldRenderer, TileInfo, AddonInfo } from '@/renderer/HexWorldRenderer';
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
import { Loader2, Settings, X, RotateCcw, AlertTriangle, XCircle, Earth, Wand2, Hexagon, RotateCw, Layers2, ShieldCheck, XCircle as XCircleIcon, Info, Compass, Box, ArrowUp, CheckCircle, ArrowRight, Activity, Package, Scale, Link } from 'lucide-react';
import { WorldGenerationPanel } from '@/components/WorldGenerationPanel';

// World type definition
interface WorldEntry {
  id: string;
  name: string;
  url: string;
}

// Available asset packs
const AVAILABLE_ASSET_PACKS = [
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
  const [selectedAddonInfo, setSelectedAddonInfo] = useState<AddonInfo | null>(null);
  const [isDarkMode] = useState(false);
  const [showGenerationPanel, setShowGenerationPanel] = useState(false);
  const [generationMode, setGenerationMode] = useState<'create' | 'edit'>('create');
  const [isGenerating, setIsGenerating] = useState(false);
  const [availableWorlds, setAvailableWorlds] = useState<WorldEntry[]>([]);


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
      
      // Set up addon selection callback
      hexRenderer.setAddonSelectionCallback((addonInfo: AddonInfo | null) => {
        setSelectedAddonInfo(addonInfo);
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
      
      {/* Selection Info Panel */}
      {(selectedTileInfo || selectedValidationInfo || selectedAddonInfo) && (
        <div className="absolute top-4 right-4 z-20">
          <Card className="w-72 max-h-[calc(100vh-2rem)] backdrop-blur-sm bg-card/95 border-border/50 shadow-lg overflow-hidden">
            <div className="h-full flex flex-col">
              {selectedTileInfo && (
                <>
                  {/* Header */}
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedTileInfo(null)}
                        className="h-6 w-6"
                      >
                        <X className="h-3 w-3" />
                        <span className="sr-only">Close tile info</span>
                      </Button>
                      <span className="flex items-center gap-2">
                        <Hexagon className="h-4 w-4" />
                        Tile
                      </span>
                    </CardTitle>
                  </CardHeader>

                  {/* Content */}
                  <CardContent className="space-y-4 text-sm flex-1 overflow-y-auto">
                    {/* Location Section */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground border-b border-border/50 pb-1">
                        <Compass className="h-3 w-3" />
                        LOCATION
                      </div>
                      <div className="pl-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Hex Coordinates</span>
                          <div className="font-mono text-xs bg-muted/50 rounded px-2 py-1">
                            ({selectedTileInfo.coordinates.q}, {selectedTileInfo.coordinates.r})
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">World Position</span>
                          <div className="grid grid-cols-3 gap-1 text-xs">
                            <div className="bg-muted/50 rounded px-1.5 py-1 text-center">
                              <div className="text-[10px] text-muted-foreground">X</div>
                              <div className="font-mono text-xs leading-none">{selectedTileInfo.position.x.toFixed(2)}</div>
                            </div>
                            <div className="bg-muted/50 rounded px-1.5 py-1 text-center">
                              <div className="text-[10px] text-muted-foreground">Y</div>
                              <div className="font-mono text-xs leading-none">{selectedTileInfo.position.y.toFixed(2)}</div>
                            </div>
                            <div className="bg-muted/50 rounded px-1.5 py-1 text-center">
                              <div className="text-[10px] text-muted-foreground">Z</div>
                              <div className="font-mono text-xs leading-none">{selectedTileInfo.position.z.toFixed(2)}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Properties Section */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground border-b border-border/50 pb-1">
                        <Box className="h-3 w-3" />
                        PROPERTIES
                      </div>
                      <div className="pl-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Tile Type</span>
                          <div className="font-mono text-xs bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 rounded px-2 py-1 font-medium">
                            {selectedTileInfo.tileType}
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Elevation</span>
                          <div className="flex items-center gap-1">
                            <ArrowUp className="h-3 w-3 text-muted-foreground" />
                            <div className="font-mono text-xs bg-muted/50 rounded px-2 py-1">
                              {selectedTileInfo.elevation}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Transform Section */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground border-b border-border/50 pb-1">
                        <RotateCw className="h-3 w-3" />
                        TRANSFORM
                      </div>
                      <div className="pl-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Rotation</span>
                          <div className="flex items-center gap-2">
                            <div className="font-mono text-xs bg-muted/50 rounded px-2 py-1">
                              {selectedTileInfo.rotation * 60}°
                            </div>
                            <div className="text-xs text-muted-foreground">
                              (step {selectedTileInfo.rotation})
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Edges Section */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground border-b border-border/50 pb-1">
                        <Link className="h-3 w-3" />
                        EDGES
                      </div>
                      <div className="pl-2">
                        {/* Hexagon-like spatial arrangement */}
                        <div className="relative w-full mx-auto" style={{ minHeight: '120px', maxWidth: '180px' }}>
                          {selectedTileInfo.edges.map((edge, index) => {
                            const directions = ['NE', 'E', 'SE', 'SW', 'W', 'NW'];
                            const direction = directions[index];
                            
                            // Position each edge box spatially around the hexagon with more spacing
                            let positionClass = '';
                            switch (direction) {
                              case 'NE': // Top-right
                                positionClass = 'absolute top-0 right-0';
                                break;
                              case 'E': // Right
                                positionClass = 'absolute top-1/2 right-0 -translate-y-1/2';
                                break;
                              case 'SE': // Bottom-right
                                positionClass = 'absolute bottom-0 right-0';
                                break;
                              case 'SW': // Bottom-left
                                positionClass = 'absolute bottom-0 left-0';
                                break;
                              case 'W': // Left
                                positionClass = 'absolute top-1/2 left-0 -translate-y-1/2';
                                break;
                              case 'NW': // Top-left
                                positionClass = 'absolute top-0 left-0';
                                break;
                            }
                            
                            return (
                              <div key={index} className={`${positionClass} bg-muted/50 rounded px-1.5 py-1 w-14 text-center shadow-sm`}>
                                <div className="text-[10px] text-muted-foreground font-medium">{direction}</div>
                                <div className="font-mono text-[9px] leading-tight truncate mt-0.5" title={edge}>
                                  {edge || 'none'}
                                </div>
                              </div>
                            );
                          })}
                          
                          {/* Center indicator with better positioning */}
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded border-2 border-dashed border-muted-foreground/20 flex items-center justify-center">
                            <Hexagon className="h-4 w-4 text-muted-foreground/40" />
                          </div>
                        </div>
                        
                        <div className="text-[10px] text-muted-foreground mt-3 text-center">
                          Spatial edge layout
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </>
              )}
              
              {selectedValidationInfo && (
                <>
                  {/* Header */}
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedValidationInfo(null)}
                        className="h-6 w-6"
                      >
                        <X className="h-3 w-3" />
                        <span className="sr-only">Close validation info</span>
                      </Button>
                      <span className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4" />
                        Validation
                      </span>
                    </CardTitle>
                  </CardHeader>

                  {/* Content */}
                  <CardContent className="space-y-4 text-sm flex-1 overflow-y-auto">
                    {/* Result Status - Featured at top */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground border-b border-border/50 pb-1">
                        <Activity className="h-3 w-3" />
                        VALIDATION RESULT
                      </div>
                      <div className="pl-4">
                        <div className={`text-sm rounded-lg px-3 py-2 flex items-center gap-3 font-medium ${
                          selectedValidationInfo.isValid 
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800' 
                            : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                        }`}>
                          {selectedValidationInfo.isValid ? (
                            <>
                              <CheckCircle className="h-4 w-4" />
                              <span>EDGES COMPATIBLE</span>
                            </>
                          ) : (
                            <>
                              <XCircleIcon className="h-4 w-4" />
                              <span>EDGES INCOMPATIBLE</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Edge Comparison */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground border-b border-border/50 pb-1">
                        <ArrowRight className="h-3 w-3" />
                        EDGE COMPARISON
                      </div>
                      <div className="pl-4 space-y-3">
                        {/* Source Tile */}
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                            <span className="text-xs font-medium">Source Tile</span>
                          </div>
                          <div className="pl-4 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Position</span>
                              <div className="font-mono text-xs bg-muted/50 rounded px-2 py-1">
                                ({selectedValidationInfo.sourcePosition.q}, {selectedValidationInfo.sourcePosition.r})
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Type</span>
                              <div className="text-xs bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 rounded px-2 py-1">
                                {selectedValidationInfo.stepByStep.sourceTileType}
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Edge</span>
                              <div className="text-xs bg-muted/50 rounded px-2 py-1">
                                #{selectedValidationInfo.sourceEdgeIndex}: {selectedValidationInfo.sourceEdgeType}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Target Tile */}
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-orange-500"></div>
                            <span className="text-xs font-medium">Target Tile</span>
                          </div>
                          <div className="pl-4 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Position</span>
                              <div className="font-mono text-xs bg-muted/50 rounded px-2 py-1">
                                ({selectedValidationInfo.targetPosition.q}, {selectedValidationInfo.targetPosition.r})
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Type</span>
                              <div className="text-xs bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 rounded px-2 py-1">
                                {selectedValidationInfo.stepByStep.targetTileType}
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Edge</span>
                              <div className="text-xs bg-muted/50 rounded px-2 py-1">
                                #{selectedValidationInfo.targetEdgeIndex}: {selectedValidationInfo.targetEdgeType}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Technical Details (Collapsible) */}
                    <details className="space-y-2">
                      <summary className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground border-b border-border/50 pb-1">
                        <Info className="h-3 w-3" />
                        TECHNICAL DETAILS
                      </summary>
                      <div className="pl-4 space-y-3 text-xs">
                        <div className="space-y-1">
                          <div className="font-medium text-muted-foreground">Asset Pack Offset</div>
                          <div className="bg-muted/50 rounded px-2 py-1">
                            {selectedValidationInfo.stepByStep.assetPackOffset} ({selectedValidationInfo.stepByStep.assetPackOffsetDirection})
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <div className="font-medium text-muted-foreground">Edge Arrays</div>
                          <div className="space-y-1">
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Original Edges</div>
                              <div className="font-mono text-xs bg-muted/50 rounded px-2 py-1 mb-1">
                                Src: [{selectedValidationInfo.stepByStep.sourceOriginalEdges.map((e, i) => `${i}:${e}`).join(', ')}]
                              </div>
                              <div className="font-mono text-xs bg-muted/50 rounded px-2 py-1">
                                Tgt: [{selectedValidationInfo.stepByStep.targetOriginalEdges.map((e, i) => `${i}:${e}`).join(', ')}]
                              </div>
                            </div>
                            
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Final Edges (after rotation)</div>
                              <div className="font-mono text-xs bg-muted/50 rounded px-2 py-1 mb-1">
                                Src: [{selectedValidationInfo.stepByStep.sourceFinalEdges.map((e, i) => `${i}:${e}`).join(', ')}]
                              </div>
                              <div className="font-mono text-xs bg-muted/50 rounded px-2 py-1">
                                Tgt: [{selectedValidationInfo.stepByStep.targetFinalEdges.map((e, i) => `${i}:${e}`).join(', ')}]
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </details>
                  </CardContent>
                </>
              )}
              
              {selectedAddonInfo && (
                <>
                  {/* Header */}
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedAddonInfo(null)}
                        className="h-6 w-6"
                      >
                        <X className="h-3 w-3" />
                        <span className="sr-only">Close addon info</span>
                      </Button>
                      <span className="flex items-center gap-2">
                        <Layers2 className="h-4 w-4" />
                        Add-on
                      </span>
                    </CardTitle>
                  </CardHeader>

                  {/* Content */}
                  <CardContent className="space-y-4 text-sm flex-1 overflow-y-auto">
                    {/* Identity Section */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground border-b border-border/50 pb-1">
                        <Package className="h-3 w-3" />
                        IDENTITY
                      </div>
                      <div className="pl-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Add-on ID</span>
                          <div className="font-mono text-xs bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 rounded px-2 py-1 font-medium">
                            {selectedAddonInfo.addonId}
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Hex Coordinates</span>
                          <div className="font-mono text-xs bg-muted/50 rounded px-2 py-1">
                            ({selectedAddonInfo.coordinates.q}, {selectedAddonInfo.coordinates.r})
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Transform Section */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground border-b border-border/50 pb-1">
                        <RotateCw className="h-3 w-3" />
                        LOCAL TRANSFORM
                      </div>
                      <div className="pl-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Rotation</span>
                          <div className="font-mono text-xs bg-muted/50 rounded px-2 py-1">
                            {selectedAddonInfo.localRotation}°
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Scale</span>
                          <div className="flex items-center gap-1">
                            <Scale className="h-3 w-3 text-muted-foreground" />
                            <div className="font-mono text-xs bg-muted/50 rounded px-2 py-1">
                              {selectedAddonInfo.localScale}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Position</span>
                          <div className="grid grid-cols-3 gap-1 text-xs">
                            <div className="bg-muted/50 rounded px-1.5 py-1 text-center">
                              <div className="text-[10px] text-muted-foreground">X</div>
                              <div className="font-mono text-xs leading-none">{selectedAddonInfo.localPosition[0].toFixed(2)}</div>
                            </div>
                            <div className="bg-muted/50 rounded px-1.5 py-1 text-center">
                              <div className="text-[10px] text-muted-foreground">Y</div>
                              <div className="font-mono text-xs leading-none">{selectedAddonInfo.localPosition[1].toFixed(2)}</div>
                            </div>
                            <div className="bg-muted/50 rounded px-1.5 py-1 text-center">
                              <div className="text-[10px] text-muted-foreground">Z</div>
                              <div className="font-mono text-xs leading-none">{selectedAddonInfo.localPosition[2].toFixed(2)}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* World Position Section */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground border-b border-border/50 pb-1">
                        <Compass className="h-3 w-3" />
                        WORLD POSITION
                      </div>
                      <div className="pl-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Final Position</span>
                          <div className="grid grid-cols-3 gap-1 text-xs">
                            <div className="bg-muted/50 rounded px-1.5 py-1 text-center">
                              <div className="text-[10px] text-muted-foreground">X</div>
                              <div className="font-mono text-xs leading-none">{selectedAddonInfo.position.x.toFixed(2)}</div>
                            </div>
                            <div className="bg-muted/50 rounded px-1.5 py-1 text-center">
                              <div className="text-[10px] text-muted-foreground">Y</div>
                              <div className="font-mono text-xs leading-none">{selectedAddonInfo.position.y.toFixed(2)}</div>
                            </div>
                            <div className="bg-muted/50 rounded px-1.5 py-1 text-center">
                              <div className="text-[10px] text-muted-foreground">Z</div>
                              <div className="font-mono text-xs leading-none">{selectedAddonInfo.position.z.toFixed(2)}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </>
              )}
            </div>
          </Card>
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
                      <SelectTrigger id="world-select" className="h-8 w-full overflow-hidden">
                        <SelectValue placeholder="Select a world" className="block truncate" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableWorlds.map((world: WorldEntry) => (
                          <SelectItem key={world.id} value={world.id} className="truncate">
                            <span className="truncate" title={world.name}>
                              {world.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    
                    {/* Edit Current World button - positioned near world selection for logical grouping */}
                    <Button
                      onClick={() => {
                        setGenerationMode('edit');
                        setShowGenerationPanel(true);
                      }}
                      disabled={isLoading || !currentWorldData}
                      className="w-full h-7 text-xs"
                      variant="outline"
                      size="sm"
                    >
                      <Wand2 className="h-3 w-3 mr-1" />
                      Edit with AI
                    </Button>
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
                      
                      {validationSummary && (
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
                      )}
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
                        Selection
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
                    <Label className="text-xs font-medium text-muted-foreground">CREATE NEW WORLD</Label>
                    <Button
                      onClick={() => {
                        setGenerationMode('create');
                        setShowGenerationPanel(true);
                      }}
                      disabled={isLoading}
                      className="w-full h-8 text-xs"
                      variant="default"
                    >
                      <Wand2 className="h-3 w-3 mr-1" />
                      Generate with AI
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
          onClick={() => !isGenerating && setShowGenerationPanel(false)}
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
              disabled={isGenerating}
            >
              <X className="h-4 w-4" />
              Close
            </Button>
            <WorldGenerationPanel
              assetPackManager={assetManagerRef.current!}
              availableAssetPacks={AVAILABLE_ASSET_PACKS.map(pack => pack.id)}
              currentWorld={currentWorldData || undefined}
              generationMode={generationMode}
              onWorldGenerated={async (world, savedWorldId) => {
                // Update UI - world is already saved by the backend if saving is enabled
                setCurrentWorldData(world);
                if (hexRendererRef.current) {
                  // Ensure the required asset pack is loaded before rendering
                  await ensureAssetPackLoaded(world.asset_pack);
                  hexRendererRef.current.renderWorld(world);
                }

                // Refresh available worlds list to show the newly saved world
                await refreshAvailableWorlds();

                // Update selected world to the newly generated world if it was saved
                if (savedWorldId) {
                  setSelectedWorld(savedWorldId);
                }
              }}
              onProgressUpdate={(progress) => {
                // Could show progress in a toast or status area
                console.log('Generation progress:', progress);
              }}
              onGenerationStateChange={setIsGenerating}
              onCloseModal={() => setShowGenerationPanel(false)}
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
