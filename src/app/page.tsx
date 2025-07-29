'use client';

import { useEffect, useRef, useState } from 'react';
import { HexWorldRenderer } from '@/renderer/HexWorldRenderer';
import { AssetPackManager } from '@/core/AssetPackManager';

export default function HexWorldPage() {
  const rendererRef = useRef<HTMLDivElement>(null);
  const hexRendererRef = useRef<HexWorldRenderer | null>(null);
  const assetManagerRef = useRef<AssetPackManager | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const initializeRenderer = async () => {
    if (!rendererRef.current) return false;

    const container = rendererRef.current;
    if (container.clientWidth === 0 || container.clientHeight === 0) return false;

    try {
      const assetMgr = new AssetPackManager();
      // WorldManager not needed for this demo, but could be used for world validation
      // const worldMgr = new WorldManager(assetMgr);
      
      await assetMgr.loadAssetPackFromUrl('/assets/demo-pack.json');
      
      const hexRenderer = new HexWorldRenderer({
        container: container,
        enableControls: true,
        showGrid: false,
        showCornerAxes: true
      }, assetMgr);
      
      hexRendererRef.current = hexRenderer;
      assetManagerRef.current = assetMgr;
      
      return true;
    } catch (error: unknown) {
      console.error('Failed to initialize renderer:', error);
      return false;
    }
  };

  const loadDemoWorld = async () => {
    if (!hexRendererRef.current || !assetManagerRef.current) return;
    
    try {
      const worldResponse = await fetch('/assets/demo-world.json');
      if (!worldResponse.ok) {
        throw new Error(`Failed to fetch world: ${worldResponse.status}`);
      }
      const world = await worldResponse.json();
      
      await hexRendererRef.current!.renderWorld(world);
      setIsLoading(false);
      
    } catch (error: unknown) {
      console.error('Failed to load world:', error);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      initializeRenderer().then(success => {
        if (success) {
          setTimeout(() => {
            loadDemoWorld();
          }, 500);
        } else {
          setTimeout(() => {
            initializeRenderer().then(retrySuccess => {
              if (retrySuccess) {
                setTimeout(() => {
                  loadDemoWorld();
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
  }, []);

  return (
    <div className="w-full h-screen relative">
      <div ref={rendererRef} className="w-full h-full" />
      
      {/* Simple loading indicator */}
      {isLoading && (
        <div className="absolute bottom-4 right-4 bg-black bg-opacity-50 text-white text-sm px-3 py-2 rounded">
          Loading...
        </div>
      )}
    </div>
  );
}
