'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { 
  Wand2, 
  ChevronDown, 
  ChevronUp, 
  Play, 
  Square, 
  RotateCcw,
  AlertCircle
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
  generationMode: 'create' | 'edit';
  onWorldGenerated: (world: World, savedWorldId?: string) => void;
  onProgressUpdate?: (progress: GenerationProgress) => void;
  onGenerationStateChange?: (isGenerating: boolean) => void;
  onCloseModal?: () => void;
}

export function WorldGenerationPanel({
  assetPackManager,
  availableAssetPacks,
  currentWorld,
  generationMode,
  onWorldGenerated,
  onProgressUpdate,
  onGenerationStateChange,
  onCloseModal
}: WorldGenerationPanelProps) {
  // Generation Settings
  const [selectedAssetPack, setSelectedAssetPack] = useState(availableAssetPacks[0] || '');
  const [description, setDescription] = useState('');
  const [maxTiles, setMaxTiles] = useState(20);
  const [includeAddons, setIncludeAddons] = useState(true);

  // Determine if we're in edit mode
  const isEditMode = generationMode === 'edit';

  // Auto-select current world's asset pack when editing existing world
  const effectiveAssetPack = isEditMode && currentWorld 
    ? currentWorld.asset_pack 
    : selectedAssetPack;

  // Check for asset pack mismatch warning
  const hasAssetPackMismatch = isEditMode && currentWorld && 
    currentWorld.asset_pack !== selectedAssetPack;

  // Update selected asset pack to match current world when in edit mode
  React.useEffect(() => {
    if (isEditMode && currentWorld && currentWorld.asset_pack !== selectedAssetPack) {
      setSelectedAssetPack(currentWorld.asset_pack);
    }
  }, [isEditMode, currentWorld, selectedAssetPack]);
  
  // UI State
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [currentProgress, setCurrentProgress] = useState<GenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [generationComplete, setGenerationComplete] = useState(false);

  const handleStartGeneration = async () => {
    if (!description.trim() || !selectedAssetPack) {
      return;
    }

    setIsGenerating(true);
    if (onGenerationStateChange) {
      onGenerationStateChange(true);
    }
    setError(null);
    setCurrentProgress(null);
    setGenerationComplete(false);
    setSessionId(null);

    try {
      const constraints: GenerationConstraints = {
        maxTiles,
        includeAddons
      };

      // Show initial loading progress
      setCurrentProgress({
        stage: 'generating',
        currentStep: 0,
        totalSteps: (constraints.maxTiles || 20) + 1, // +1 for planning step
        message: `Starting world generation...`,
        placedTiles: 0,
        validationErrors: 0,
        currentWorld: currentWorld || { asset_pack: selectedAssetPack, tiles: [], addons: [] }
      });

      const request: GenerationRequest = {
        assetPackId: effectiveAssetPack,
        description: description.trim(),
        constraints,
        existingWorld: isEditMode ? currentWorld : undefined,
        stream: true // Enable streaming
      };

      // Start generation with streaming
      const response = await fetch('/api/generate-world', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start generation');
      }

      // Check if response is streaming
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error('Failed to get response reader');
        }

        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              
              if (done) break;

              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    
                    switch (data.type) {
                      case 'session_started':
                        setSessionId(data.sessionId);
                        break;
                        
                      case 'progress':
                        const progress = data.progress as GenerationProgress;
                        setCurrentProgress(progress);
                        if (onProgressUpdate) {
                          onProgressUpdate(progress);
                        }
                        break;
                        
                      case 'completed':
                        setCurrentProgress({
                          stage: 'complete',
                          currentStep: data.world.tiles.length,
                          totalSteps: data.world.tiles.length,
                          message: data.savedFilename 
                            ? `World saved as: ${data.savedFilename}` 
                            : 'World generation completed successfully!',
                          placedTiles: data.world.tiles.length,
                          validationErrors: data.validationSummary?.invalidEdges || 0,
                          currentWorld: data.world
                        });
                        
                        // Extract world ID from saved filename if available
                        let savedWorldId: string | undefined;
                        if (data.savedFilename) {
                          savedWorldId = data.savedFilename.replace('.json', '');
                        }

                        // Call success callback
                        onWorldGenerated(data.world, savedWorldId);
                        setGenerationComplete(true);
                        setIsGenerating(false);
                        if (onGenerationStateChange) {
                          onGenerationStateChange(false);
                        }
                        return; // Exit the stream processing
                        
                      case 'error':
                        setError(data.error);
                        setIsGenerating(false);
                        if (onGenerationStateChange) {
                          onGenerationStateChange(false);
                        }
                        setCurrentProgress(null);
                        return; // Exit the stream processing
                        
                      case 'cancelled':
                        setCurrentProgress(null);
                        setIsGenerating(false);
                        if (onGenerationStateChange) {
                          onGenerationStateChange(false);
                        }
                        return; // Exit the stream processing
                    }
                  } catch (err) {
                    console.error('Error parsing SSE data:', err);
                  }
                }
              }
            }
          } catch (err) {
            console.error('Stream processing error:', err);
            setError('Connection error during generation');
            setIsGenerating(false);
            if (onGenerationStateChange) {
              onGenerationStateChange(false);
            }
            setCurrentProgress(null);
          }
        };

        // Start processing the stream
        processStream();
      } else {
        // Fallback to non-streaming response
        throw new Error('Streaming not supported, falling back not implemented');
      }

    } catch (err) {
      setIsGenerating(false);
      if (onGenerationStateChange) {
        onGenerationStateChange(false);
      }
      setCurrentProgress(null);
      setError(err instanceof Error ? err.message : 'Generation failed');
    }
  };

  const handleStopGeneration = async () => {
    if (sessionId) {
      try {
        // Send cancellation request to backend
        await fetch('/api/generate-world', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'cancel',
            sessionId: sessionId
          }),
        });
      } catch (err) {
        console.error('Error cancelling generation:', err);
      }
    }
    
    setIsGenerating(false);
    if (onGenerationStateChange) {
      onGenerationStateChange(false);
    }
    setCurrentProgress(null);
    setSessionId(null);
    setGenerationComplete(false);
  };

  const handleCloseModal = () => {
    // Clean up any active generation
    if (isGenerating && sessionId) {
      handleStopGeneration();
    }
    setIsGenerating(false);
    if (onGenerationStateChange) {
      onGenerationStateChange(false);
    }
    setCurrentProgress(null);
    setSessionId(null);
    setGenerationComplete(false);
    setError(null);
  };

  const handleDoneGeneration = () => {
    handleCloseModal();
    // Trigger closing the modal in the parent component
    if (onCloseModal) {
      onCloseModal();
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="h-5 w-5" />
          {isEditMode ? 'Edit World with AI' : 'Create New World with AI'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Generation Settings */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="asset-pack">Asset Pack</Label>
            <Select 
              value={selectedAssetPack} 
              onValueChange={setSelectedAssetPack}
              disabled={isEditMode}
            >
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
            {isEditMode && (
              <p className="text-xs text-muted-foreground">
                Asset pack is locked to current world&apos;s pack: {effectiveAssetPack}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              {isEditMode ? 'Describe changes to make' : 'World Description'}
            </Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                isEditMode 
                  ? "Describe what changes you want to make to the current world (e.g., 'Add a market square in the center' or 'Connect the buildings with paths')"
                  : "Describe the world you want to generate (e.g., 'A peaceful village by a lake with roads connecting different areas')"
              }
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {isEditMode && currentWorld && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
                <Wand2 className="h-4 w-4" />
                Editing Current World
              </div>
              <p className="text-xs text-blue-600 dark:text-blue-300">
                Starting with {currentWorld.tiles.length} tiles using {currentWorld.asset_pack} asset pack
              </p>
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
            <div className="space-y-2">
              <Label htmlFor="max-tiles">Max Tiles: {maxTiles}</Label>
              <Slider
                id="max-tiles"
                min={5}
                max={100}
                step={1}
                value={[maxTiles]}
                onValueChange={(value) => setMaxTiles(value[0])}
                className="w-full"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="include-addons"
                checked={includeAddons}
                onCheckedChange={setIncludeAddons}
              />
              <Label htmlFor="include-addons">Use add-ons</Label>
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
                    {currentProgress.stage === 'generating' ? 'Generating World' : 
                     currentProgress.stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
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
          {generationComplete ? (
            // Show Done button when generation is complete
            <Button onClick={handleDoneGeneration} className="flex-1">
              Done
            </Button>
          ) : isGenerating ? (
            // Show Stop button during generation
            <Button onClick={handleStopGeneration} variant="outline" className="flex-1">
              <Square className="h-4 w-4 mr-2" />
              Stop Generation
            </Button>
          ) : (
            // Show Generate button when idle
            <Button
              onClick={handleStartGeneration}
              disabled={!description.trim() || !selectedAssetPack}
              className="flex-1"
            >
              <Play className="h-4 w-4 mr-2" />
              {isEditMode ? 'Edit World' : 'Generate World'}
            </Button>
          )}
          <Button
            onClick={() => {
              setDescription('');
              setError(null);
              setCurrentProgress(null);
              setGenerationComplete(false);
            }}
            variant="outline"
            disabled={isGenerating}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
} 