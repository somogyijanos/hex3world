'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { 
  Wand2, 
  ChevronDown, 
  ChevronUp, 
  Play, 
  Square, 
  RotateCcw,
  AlertCircle,
  Loader2 
} from 'lucide-react';
import { AssetPackManager } from '@/core/AssetPackManager';
import { 
  GenerationRequest, 
  GenerationConstraints,
  GenerationProgress
} from '@/types/llm';
import { World } from '@/types/index';

interface WorldGenerationPanelProps {
  assetPackManager: AssetPackManager;
  availableAssetPacks: string[];
  currentWorld?: World;
  onWorldGenerated: (world: World) => void;
  onProgressUpdate?: (progress: GenerationProgress) => void;
}

export function WorldGenerationPanel({
  assetPackManager,
  availableAssetPacks,
  currentWorld,
  onWorldGenerated,
  onProgressUpdate
}: WorldGenerationPanelProps) {
  // Generation Settings
  const [selectedAssetPack, setSelectedAssetPack] = useState(availableAssetPacks[0] || '');
  const [description, setDescription] = useState('');
  const [maxTiles, setMaxTiles] = useState(20);
  const [minTiles, setMinTiles] = useState(5);
  const [includeAddons, setIncludeAddons] = useState(true);
  const [expandExisting, setExpandExisting] = useState(false);
  
  // UI State
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [currentProgress, setCurrentProgress] = useState<GenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleStartGeneration = async () => {
    if (!description.trim() || !selectedAssetPack) {
      return;
    }

    setIsGenerating(true);
    setError(null);
    setCurrentProgress(null);

    try {
      // Show loading progress
      setCurrentProgress({
        stage: 'planning',
        currentStep: 1,
        totalSteps: 10,
        message: `Starting world generation...`,
        placedTiles: 0,
        validationErrors: 0,
        currentWorld: currentWorld || { asset_pack: selectedAssetPack, tiles: [], addons: [] }
      });

      const constraints: GenerationConstraints = {
        maxTiles,
        minTiles,
        includeAddons
      };

      const request: GenerationRequest = {
        assetPackId: selectedAssetPack,
        description: description.trim(),
        constraints,
        existingWorld: expandExisting ? currentWorld : undefined
      };

      // Call the API route
      const response = await fetch('/api/generate-world', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate world');
      }

      // Show completion
      setCurrentProgress({
        stage: 'complete',
        currentStep: 10,
        totalSteps: 10,
        message: 'World generation completed successfully!',
        placedTiles: result.world.tiles.length,
        validationErrors: result.validationSummary?.invalidEdges || 0,
        currentWorld: result.world
      });

      // Call success callback
      onWorldGenerated(result.world);
      
      // Clear progress after a short delay
      setTimeout(() => {
        setCurrentProgress(null);
        setIsGenerating(false);
      }, 2000);

    } catch (err) {
      setIsGenerating(false);
      setCurrentProgress(null);
      setError(err instanceof Error ? err.message : 'Generation failed');
    }
  };

  const handleStopGeneration = () => {
    setIsGenerating(false);
    setCurrentProgress(null);
    // Note: Actual cancellation would require implementation in the generator
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="h-5 w-5" />
          AI World Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Generation Settings */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="asset-pack">Asset Pack</Label>
            <Select value={selectedAssetPack} onValueChange={setSelectedAssetPack}>
              <SelectTrigger id="asset-pack">
                <SelectValue placeholder="Select an asset pack" />
              </SelectTrigger>
              <SelectContent>
                {availableAssetPacks.map(packId => {
                  // Try to get the pack if it's loaded, otherwise use a default display name
                  const pack = assetPackManager.getAssetPack(packId);
                  const displayName = pack ? `${pack.name} (${pack.id})` : 
                    packId === 'demo-pack' ? 'Simple Demo Pack (demo-pack)' :
                    packId === 'kaykit-medieval-pack' ? 'KayKit Medieval Pack (kaykit-medieval-pack)' :
                    packId;
                  return (
                    <SelectItem key={packId} value={packId}>
                      {displayName}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">World Description</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the world you want to generate (e.g., 'A peaceful village by a lake with roads connecting different areas')"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {currentWorld && currentWorld.tiles.length > 0 && (
            <div className="flex items-center space-x-2">
              <Switch
                id="expand-existing"
                checked={expandExisting}
                onCheckedChange={setExpandExisting}
              />
              <Label htmlFor="expand-existing">
                Expand existing world ({currentWorld.tiles.length} tiles)
              </Label>
            </div>
          )}
        </div>

        {/* Advanced Settings */}
        <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              Advanced Settings
              {isAdvancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="min-tiles">Min Tiles: {minTiles}</Label>
                <input
                  id="min-tiles"
                  type="range"
                  min="1"
                  max="50"
                  value={minTiles}
                  onChange={(e) => setMinTiles(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-tiles">Max Tiles: {maxTiles}</Label>
                <input
                  id="max-tiles"
                  type="range"
                  min="5"
                  max="100"
                  value={maxTiles}
                  onChange={(e) => setMaxTiles(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="include-addons"
                checked={includeAddons}
                onCheckedChange={setIncludeAddons}
              />
              <Label htmlFor="include-addons">Include decorative add-ons</Label>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Progress Display */}
        {currentProgress && (
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {currentProgress.stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {currentProgress.currentStep}/{currentProgress.totalSteps}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${(currentProgress.currentStep / currentProgress.totalSteps) * 100}%`
                    }}
                  />
                </div>
                <p className="text-sm text-muted-foreground">{currentProgress.message}</p>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Tiles: {currentProgress.placedTiles}</span>
                  <span>Errors: {currentProgress.validationErrors}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error Display */}
        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
                <div>
                  <p className="text-red-700 font-medium">Generation Error</p>
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          {isGenerating ? (
            <Button onClick={handleStopGeneration} variant="outline" className="flex-1">
              <Square className="h-4 w-4 mr-2" />
              Stop Generation
            </Button>
          ) : (
            <Button
              onClick={handleStartGeneration}
              disabled={!description.trim() || !selectedAssetPack}
              className="flex-1"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Generate World
            </Button>
          )}
          <Button
            onClick={() => {
              setDescription('');
              setError(null);
              setCurrentProgress(null);
            }}
            variant="outline"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
} 