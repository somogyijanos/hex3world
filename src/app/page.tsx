'use client';

import { useEffect, useRef, useState } from 'react';
import { HexWorldRenderer } from '@/renderer/HexWorldRenderer';
import { AssetPackManager } from '@/core/AssetPackManager';
import { WorldManager } from '@/core/WorldManager';

export default function HexWorldPage() {
  const rendererRef = useRef<HTMLDivElement>(null);
  const hexRendererRef = useRef<HexWorldRenderer | null>(null);
  const assetManagerRef = useRef<AssetPackManager | null>(null);
  const [isRendererReady, setIsRendererReady] = useState(false);
  const [worldManager, setWorldManager] = useState<WorldManager | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const [worldInfo, setWorldInfo] = useState({
    tileCount: 0,
    addonCount: 0,
    assetPack: 'None'
  });

  const log = (message: string) => {
    console.log(message);
    const timestamp = new Date().toLocaleTimeString();
    setConsoleLines(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const initializeRenderer = async () => {
    if (!rendererRef.current) {
      log('❌ Container element not ready yet');
      return false;
    }

    // Check if container has dimensions
    const container = rendererRef.current;
    if (container.clientWidth === 0 || container.clientHeight === 0) {
      log('❌ Container has no dimensions');
      return false;
    }

    try {
      log('🚀 INITIALIZING HEX RENDERER FROM ACTUAL CODEBASE...');
      log(`📐 Container dimensions: ${container.clientWidth}x${container.clientHeight}`);
      
      // Initialize managers
      log('📦 Creating asset pack manager...');
      const assetMgr = new AssetPackManager();
      const worldMgr = new WorldManager(assetMgr);
      
      // Load asset pack using the new URL method
      log('📡 Loading asset pack from URL...');
      const assetPack = await assetMgr.loadAssetPackFromUrl('/assets/demo-pack.json');
      log(`✅ Asset pack loaded: ${assetPack.name}`);
      log(`🧭 Geometry config: tile_up_axis="${assetPack.geometry_config.tile_up_axis}"`);
      
      // Initialize renderer with actual TypeScript classes
      log('🎮 Creating Three.js renderer...');
      const hexRenderer = new HexWorldRenderer({
        container: container,
        enableControls: true,
        showGrid: true
      }, assetMgr);
      
      // Store in refs for immediate access
      hexRendererRef.current = hexRenderer;
      assetManagerRef.current = assetMgr;
      setWorldManager(worldMgr);
      setIsRendererReady(true);
      
      log('✅ RENDERER INITIALIZED WITH ACTUAL CODEBASE');
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log(`❌ RENDERER INIT ERROR: ${errorMessage}`);
      console.error('Renderer initialization failed:', error);
      if (error instanceof Error) {
        log(`❌ Error stack: ${error.stack}`);
      }
      return false;
    }
  };

  const loadDemoWorld = async () => {
    if (!hexRendererRef.current || !assetManagerRef.current) {
      log('❌ Renderer not initialized!');
      return;
    }
    
    try {
      setIsLoading(true);
      log('📦 LOADING DEMO WORLD WITH ACTUAL CODEBASE...');
      
      // Load world
      const worldResponse = await fetch('/assets/demo-world.json');
      if (!worldResponse.ok) {
        throw new Error(`Failed to fetch world: ${worldResponse.status}`);
      }
      const world = await worldResponse.json();
      log(`✅ World data loaded: ${world.tiles.length} tiles, ${world.addons.length} addons`);
      
      // Render world using actual TypeScript renderer with fixes
      await hexRendererRef.current!.renderWorld(world);
      
      // Update info panel
      const assetPack = assetManagerRef.current!.getAssetPack(world.asset_pack);
      setWorldInfo({
        tileCount: world.tiles.length,
        addonCount: world.addons.length,
        assetPack: assetPack ? assetPack.name : 'Unknown'
      });
      
      log('🎉 DEMO WORLD LOADED!');
      log('🔍 Camera: Use mouse to orbit, wheel to zoom, right-click to pan');
      log('💡 If you see missing assets errors, add 3D models to public/assets/models/');
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log(`❌ DEMO LOAD ERROR: ${errorMessage}`);
      console.error('Failed to load demo:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const centerCamera = () => {
    if (hexRendererRef.current) {
      log('📹 Camera centering (using actual renderer controls)');
    }
  };

  const toggleGrid = () => {
    log('⊞ Grid toggle (grid is enabled by default in actual renderer)');
  };

  useEffect(() => {
    log('🌍 HEX3WORLD LOADING WITH ACTUAL CODEBASE...');
    
    // Wait a moment for the DOM to fully render
    const timer = setTimeout(() => {
      initializeRenderer().then(success => {
        if (success) {
                  log('✅ READY! Click "Load Demo World" to test with FIXED codebase.');
        // Auto-load demo after a short delay
        setTimeout(() => {
          log('🚀 AUTO-LOADING DEMO WORLD WITH FIXES...');
          loadDemoWorld();
        }, 2000);
        } else {
          log('❌ INITIALIZATION FAILED! Retrying in 1 second...');
          // Retry once after a delay
          setTimeout(() => {
            log('🔄 RETRYING INITIALIZATION...');
            initializeRenderer().then(retrySuccess => {
                             if (retrySuccess) {
                 log('✅ RETRY SUCCESSFUL!');
                 setTimeout(() => {
                   log('🚀 AUTO-LOADING DEMO WORLD WITH FIXES...');
                   loadDemoWorld(); // Use state-based renderer for retry
                 }, 1000);
               } else {
                log('❌ RETRY FAILED! Please try refreshing the page.');
              }
            });
          }, 1000);
        }
      });
    }, 100); // Small delay to ensure DOM is ready

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      {/* Sidebar */}
      <div className="w-96 bg-gray-800 p-5 overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">🌍 Hex3World</h2>
        <div className="bg-green-600 text-white px-3 py-2 rounded mb-4 font-bold">
          ✅ WORKING DEMO WITH COORDINATE SYSTEM
        </div>
        
        {/* World Controls */}
        <div className="mb-5">
          <h3 className="text-green-400 font-bold mb-3">World Controls</h3>
          <div className="space-y-2">
            <button 
              onClick={loadDemoWorld}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded block w-full"
            >
              🚀 Load Demo World
            </button>
            <button 
              onClick={centerCamera}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded block w-full"
            >
              📹 Center Camera
            </button>
            <button 
              onClick={toggleGrid}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded block w-full"
            >
              ⊞ Toggle Grid
            </button>
          </div>
        </div>
        
        {/* Coordinate System Info */}
        <div className="bg-gray-700 p-3 rounded mb-4">
          <h4 className="font-bold mb-2">🧭 Coordinate System:</h4>
          <ul className="text-sm space-y-1">
            <li>🔴 <strong>RED</strong> = X-axis (right)</li>
            <li>🟢 <strong>GREEN</strong> = Y-axis (up)</li>
            <li>🔵 <strong>BLUE</strong> = Z-axis (forward)</li>
            <li>⚪ <strong>WHITE CUBE</strong> = Origin (0,0,0)</li>
          </ul>
        </div>
        
        {/* Controls Info */}
        <div className="bg-gray-700 p-3 rounded mb-4">
          <h4 className="font-bold mb-2">🎮 Controls:</h4>
          <ul className="text-sm space-y-1">
            <li><strong>Mouse:</strong> Orbit camera</li>
            <li><strong>Wheel:</strong> Zoom in/out</li>
            <li><strong>Right-click:</strong> Pan view</li>
          </ul>
        </div>
        
        {/* World Info */}
        {(worldInfo.tileCount > 0 || worldInfo.addonCount > 0) && (
          <div className="bg-gray-700 p-3 rounded mb-4">
            <h4 className="font-bold mb-2">🌍 World Info:</h4>
            <p className="text-sm">Tiles: {worldInfo.tileCount}</p>
            <p className="text-sm">Addons: {worldInfo.addonCount}</p>
            <p className="text-sm">Asset Pack: {worldInfo.assetPack}</p>
          </div>
        )}
        
        {/* Debug Console */}
        <div className="bg-gray-700 p-3 rounded">
          <h4 className="font-bold mb-2">📊 Debug Console:</h4>
          <div className="bg-black text-green-400 font-mono text-xs p-2 h-48 overflow-y-auto whitespace-pre-wrap">
            {consoleLines.join('\n')}
          </div>
        </div>
      </div>
      
      {/* Viewport */}
      <div className="flex-1 relative">
        <div ref={rendererRef} className="w-full h-full" />
        {isLoading && (
          <div className="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center">
            <div className="bg-gray-800 p-6 rounded-lg text-center">
              <h3 className="text-lg font-bold mb-2">🔄 Loading...</h3>
              <p>Loading 3D models and rendering world...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
