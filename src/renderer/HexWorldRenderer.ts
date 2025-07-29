import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { World, AssetPack, GeometryConfig, WorldTile, WorldAddOn } from '../types/index';
import { AssetPackManager } from '../core/AssetPackManager';

export interface RendererConfig {
  container: HTMLElement;
  width?: number;
  height?: number;
  enableControls?: boolean;
  showGrid?: boolean;
  showCornerAxes?: boolean;
}

export interface HexGridOrientation {
  tilePlane: 'xy' | 'xz' | 'yz';           // Which plane hexes lie in
  upAxis: 'x' | 'y' | 'z';                 // Which axis is "up" (tile thickness)
  upDirection: 1 | -1;                     // Positive or negative direction
  higherOrderAxis: 'x' | 'y' | 'z';       // Primary axis in tile plane (x>y>z rule)
  lowerOrderAxis: 'x' | 'y' | 'z';        // Secondary axis in tile plane
  vertex0Direction: THREE.Vector3;          // Direction from center to vertex 0
  isPointyTop: boolean;                    // Whether hexes are pointy-top or flat-top
  hexToWorldTransform: THREE.Matrix4;      // Transform matrix for hex coords
}

export interface LoadedModel {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
}

export class HexWorldRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls?: OrbitControls;
  private assetPackManager: AssetPackManager;
  private loadedModels = new Map<string, LoadedModel>();
  private materialCache = new Map<string, THREE.Material>();
  private worldGroup: THREE.Group;
  private placedTileMeshes = new Map<string, THREE.Mesh>(); // Cache placed tile meshes for add-on positioning
  
  // UI elements with separate camera (standard Three.js practice)
  private uiScene!: THREE.Scene;
  private uiCamera!: THREE.OrthographicCamera;
  private cornerAxesGroup?: THREE.Group;
  private showCoordinateAxes: boolean = true;

  constructor(config: RendererConfig, assetPackManager: AssetPackManager) {
    this.assetPackManager = assetPackManager;
    this.showCoordinateAxes = config.showCornerAxes ?? true;
    
    // Initialize Three.js components
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      (config.width || config.container.clientWidth) / (config.height || config.container.clientHeight),
      0.1,
      1000
    );
    
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(
      config.width || config.container.clientWidth,
      config.height || config.container.clientHeight
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    config.container.appendChild(this.renderer.domElement);
    
    // Setup scene
    this.setupScene();
    this.setupCamera();
    this.setupLighting();
    
    // Create world group
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    
    // Setup UI scene and camera for overlay elements (standard Three.js practice)
    this.setupUIScene(config);
    
    // Setup controls if enabled
    if (config.enableControls !== false) {
      this.setupControls();
    }
    
    // Show grid if enabled
    if (config.showGrid) {
      this.addGrid();
    }
    
    // Add coordinate system - either corner axes or world axes
    if (config.showCornerAxes) {
      this.setupCornerAxes();
    } else {
      this.addCoordinateSystem();
    }
    
    // Start render loop
    this.animate();
  }

  private setupScene(): void {
    this.scene.background = new THREE.Color(0x87CEEB); // Sky blue
  }
  
  private setupUIScene(config: RendererConfig): void {
    // Create UI scene for overlay elements (axes, etc.)
    this.uiScene = new THREE.Scene();
    
    // Create orthographic camera for UI elements (no perspective distortion)
    const width = config.width || config.container.clientWidth;
    const height = config.height || config.container.clientHeight;
    this.uiCamera = new THREE.OrthographicCamera(
      -width / 2, width / 2,
      height / 2, -height / 2,
      -1000, 1000  // Much larger near/far range to prevent clipping
    );
    this.uiCamera.position.z = 100;
  }

  private setupCamera(): void {
    this.camera.position.set(5, 5, 5);
    this.camera.lookAt(0, 0, 0);
  }

  private setupLighting(): void {
    // Softer ambient light for natural look
    const ambientLight = new THREE.AmbientLight(0x87CEEB, 0.2); // Sky blue, much lower intensity
    this.scene.add(ambientLight);
    
    // Main directional light (sun) - positioned more naturally
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
    sunLight.position.set(-5, 15, 10); // More natural sun position
    sunLight.castShadow = true;
    
    // Better shadow settings for hex world
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.1;
    sunLight.shadow.camera.far = 100;
    sunLight.shadow.camera.left = -20;
    sunLight.shadow.camera.right = 20;
    sunLight.shadow.camera.top = 20;
    sunLight.shadow.camera.bottom = -20;
    sunLight.shadow.bias = -0.0001; // Reduce shadow acne
    sunLight.shadow.normalBias = 0.02;
    
    this.scene.add(sunLight);
    
    // Fill light for softer shadows
    const fillLight = new THREE.DirectionalLight(0x87CEEB, 0.3);
    fillLight.position.set(5, 8, -5); // Opposite side, softer
    // No shadows for fill light to keep performance good
    this.scene.add(fillLight);
    
    // Subtle rim light for better definition
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.2);
    rimLight.position.set(0, 5, -10); // From behind/below
    this.scene.add(rimLight);
  }

  private async setupControls(): Promise<void> {
    try {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
    } catch (error) {
      console.warn('OrbitControls not available:', error);
    }
  }

  private addGrid(): void {
    const gridHelper = new THREE.GridHelper(20, 20, 0x888888, 0x444444);
    this.scene.add(gridHelper);
  }

  private setupCornerAxes(): void {
    // Create a group for the corner axes with arrows and labels
    this.cornerAxesGroup = new THREE.Group();
    this.uiScene.add(this.cornerAxesGroup);  // Add to UI scene instead
    
    // Create arrow helpers with labels (smaller to avoid clipping)
    const axisLength = 30;   // Smaller to fit in corner bounds
    const arrowScale = 6;    // Smaller to fit in corner bounds
    
    // X-axis (Red)
    const xArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      axisLength,
      0xff0000,
      arrowScale,
      arrowScale
    );
    this.cornerAxesGroup.add(xArrow);
    
    // Y-axis (Green)  
    const yArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      axisLength,
      0x00ff00,
      arrowScale,
      arrowScale
    );
    this.cornerAxesGroup.add(yArrow);
    
    // Z-axis (Blue)
    const zArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, 0),
      axisLength,
      0x0000ff,
      arrowScale,
      arrowScale
    );
    this.cornerAxesGroup.add(zArrow);
    
    // Add text labels
    this.addAxisLabels();
    
    // Position in bottom-right corner using screen coordinates
    this.updateCornerAxes();
  }

  private addAxisLabels(): void {
    if (!this.cornerAxesGroup) return;
    
    const labelOffset = 35;  // Smaller to fit in corner bounds
    
    // Helper function to create text sprite
    const createTextSprite = (text: string, color: string) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.width = 64;
      canvas.height = 64;
      
      context.fillStyle = color;
      context.font = 'Bold 48px Arial';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, 32, 32);
      
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ 
        map: texture,
        transparent: true,
        depthWrite: false
      });
      
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(15, 15, 1);  // Smaller to fit in corner bounds
      return sprite;
    };
    
    // X label (Red)
    const xLabel = createTextSprite('X', '#ff0000');
    xLabel.position.set(labelOffset, 0, 0);
    this.cornerAxesGroup.add(xLabel);
    
    // Y label (Green)
    const yLabel = createTextSprite('Y', '#00ff00');
    yLabel.position.set(0, labelOffset, 0);
    this.cornerAxesGroup.add(yLabel);
    
    // Z label (Blue)
    const zLabel = createTextSprite('Z', '#0000ff');
    zLabel.position.set(0, 0, labelOffset);
    this.cornerAxesGroup.add(zLabel);
  }

  private updateCornerAxes(): void {
    if (!this.cornerAxesGroup) return;
    
    // Position in bottom-right corner using orthographic UI camera (standard Three.js practice)
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    
    // Position in bottom-right with padding (in screen pixels)
    const paddingX = 60;   // Reduced padding to keep axes in bounds
    const paddingY = 60;   // Reduced padding to keep axes in bounds
    
    // Position in orthographic camera space (centered coordinate system)
    const x = (width / 2) - paddingX;   // Right side minus padding
    const y = -(height / 2) + paddingY; // Bottom side plus padding (negative Y is down)
    
    this.cornerAxesGroup.position.set(x, y, 50);  // Positioned in front of camera
    
    // Make axes show world orientation as seen FROM camera perspective
    // We need the inverse of camera rotation to show world coords relative to view
    const cameraQuaternion = this.camera.quaternion.clone();
    this.cornerAxesGroup.quaternion.copy(cameraQuaternion.invert());
  }

  private addCoordinateSystem(): void {
    // Always add coordinate system for debugging
    const axesHelper = new THREE.AxesHelper(10);
    this.scene.add(axesHelper);
    
    // Create more visible axis indicators at the origin
    const origin = new THREE.Vector3(0, 0, 0);
    
    // X-axis (red) cone
    const xGeometry = new THREE.ConeGeometry(0.3, 1, 8);
    const xMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const xCone = new THREE.Mesh(xGeometry, xMaterial);
    xCone.position.set(2, 0, 0);
    xCone.rotation.z = -Math.PI / 2;
    this.scene.add(xCone);
    
    // Y-axis (green) cone
    const yGeometry = new THREE.ConeGeometry(0.3, 1, 8);
    const yMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const yCone = new THREE.Mesh(yGeometry, yMaterial);
    yCone.position.set(0, 2, 0);
    this.scene.add(yCone);
    
    // Z-axis (blue) cone
    const zGeometry = new THREE.ConeGeometry(0.3, 1, 8);
    const zMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });
    const zCone = new THREE.Mesh(zGeometry, zMaterial);
    zCone.position.set(0, 0, 2);
    zCone.rotation.x = Math.PI / 2;
    this.scene.add(zCone);
    
    // Origin marker (white cube)
    const originGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const originMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const originCube = new THREE.Mesh(originGeometry, originMaterial);
    originCube.position.copy(origin);
    this.scene.add(originCube);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    
    if (this.controls) {
      this.controls.update();
    }
    
    // Update corner axes to follow camera rotation
    this.updateCornerAxes();
    
    // Render main scene first (this clears automatically)
    this.renderer.render(this.scene, this.camera);
    
    // Render UI overlay on top without clearing color buffer
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.uiScene, this.uiCamera);
    this.renderer.autoClear = true;
  };

  /**
   * Load 3D model and return both geometry and materials (when available)
   * Falls back to generated materials if model doesn't include them
   */
  private async loadModel(modelPath: string, assetPack: AssetPack): Promise<LoadedModel> {
    const cacheKey = `${modelPath}_${assetPack.id}`;
    if (this.loadedModels.has(cacheKey)) {
      const cached = this.loadedModels.get(cacheKey)!;
      return {
        geometry: cached.geometry.clone(),
        materials: [...cached.materials] // Shallow copy of materials array
      };
    }

    try {
      // For now we only support STL, but this structure prepares for other formats
      if (modelPath.toLowerCase().endsWith('.stl')) {
        return await this.loadSTLModel(modelPath, assetPack);
      } else {
        throw new Error(`Unsupported model format: ${modelPath}`);
      }
    } catch (error) {
      console.error(`Error loading model: ${modelPath}`, error);
      throw error;
    }
  }

  /**
   * Load STL model and return geometry with fallback materials
   * STL format doesn't include materials, so we return empty materials array
   */
  private async loadSTLModel(modelPath: string, assetPack: AssetPack): Promise<LoadedModel> {
    const cacheKey = `${modelPath}_${assetPack.id}`;

    try {
      const loader = new STLLoader();
      
      return new Promise((resolve, reject) => {
        loader.load(
          modelPath,
          (geometry: THREE.BufferGeometry) => {
            geometry.computeBoundingBox();
            const originalBounds = geometry.boundingBox!;
            
            // Check if geometry looks like it's lying flat on XY plane (Z-up)
            const zSize = originalBounds.max.z - originalBounds.min.z;
            const xSize = originalBounds.max.x - originalBounds.min.x;
            const ySize = originalBounds.max.y - originalBounds.min.y;
            
            if (zSize < Math.max(xSize, ySize) * 0.2) {
              // Geometry appears flat on XY plane (Z-up), transform to Y-up
            } else {
              // Geometry appears tall - might already be Y-up oriented
            }
            
            // Center the geometry at origin
            const center = new THREE.Vector3();
            originalBounds.getCenter(center);
            geometry.translate(-center.x, -center.y, -center.z);
            
            // Apply coordinate system transformation if pack config exists
            this.transformModelToThreeJS(geometry, assetPack);
            
            // Update bounding box after transformation
            geometry.computeBoundingBox();
            
            const loadedModel: LoadedModel = {
              geometry: geometry.clone(),
              materials: [] // STL doesn't include materials
            };
            
            this.loadedModels.set(cacheKey, loadedModel);
            resolve({
              geometry: geometry,
              materials: []
            });
          },
          () => {
            // Loading progress - could add progress indicator here
          },
          (error) => {
            console.error(`Failed to load STL model: ${modelPath}`, error);
            reject(error);
          }
        );
      });
    } catch (error) {
      console.error(`Error loading STL model: ${modelPath}`, error);
      throw error;
    }
  }

  private transformModelToThreeJS(geometry: THREE.BufferGeometry, assetPack: AssetPack): void {
    if (!assetPack.geometry_config) {
      return;
    }

    const config = assetPack.geometry_config;

    // Step 1: Transform up-axis to Y-up (Three.js standard)
    if (config.tile_up_axis[0] === 'z') {
      // Pack is Z-up, rotate to Y-up: -90° around X
      geometry.rotateX(-Math.PI / 2);
    } else if (config.tile_up_axis[0] === 'x') {
      // Pack is X-up, rotate to Y-up: -90° around Z
      geometry.rotateZ(-Math.PI / 2);
    }
    // If tile_up_axis === 'y', no transformation needed

    // Step 2: Edge alignment rotation (to be implemented when needed)
    // When implemented, will use this.analyzeGeometryConfig(config) for hex orientation matching
  }

  /**
   * Analyze geometry config to determine hex grid orientation and coordinate system
   */
  private analyzeGeometryConfig(config: GeometryConfig): HexGridOrientation {
    // Parse up axis
    const upAxisChar = config.tile_up_axis[0] as 'x' | 'y' | 'z';
    const upDirection = config.tile_up_axis[1] === '+' ? 1 : -1;
    
    // Parse parallel edge direction  
    const parallelAxisChar = config.parallel_edge_direction[0] as 'x' | 'y' | 'z';

    // Determine tile plane (the two axes that aren't the up axis)
    const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
    const planeAxes = axes.filter(axis => axis !== upAxisChar);
    
    let tilePlane: 'xy' | 'xz' | 'yz';
    if (planeAxes.includes('x') && planeAxes.includes('y')) {
      tilePlane = 'xy';
    } else if (planeAxes.includes('x') && planeAxes.includes('z')) {
      tilePlane = 'xz';
    } else {
      tilePlane = 'yz';
    }

    // Determine higher-order axis in plane using x > y > z hierarchy
    const axisOrder = { 'x': 3, 'y': 2, 'z': 1 };
    const higherOrderAxis = planeAxes.reduce((higher, current) => 
      axisOrder[current] > axisOrder[higher] ? current : higher
    );
    const lowerOrderAxis = planeAxes.find(axis => axis !== higherOrderAxis)!;

    // Determine if we have pointy-top or flat-top hexes
    // CORRECTED LOGIC: If parallel edges align with a coordinate axis, we have flat-top
    // If parallel edges would require rotation to align with axis, we have pointy-top
    const isPointyTop = parallelAxisChar !== higherOrderAxis;
    
    // Calculate vertex 0 direction (first vertex clockwise from higher-order axis)
    // This will be used for deterministic vertex indexing
    const vertex0Direction = new THREE.Vector3();
    
    // Start from the higher-order axis direction in the tile plane
    if (tilePlane === 'xy') {
      if (higherOrderAxis === 'x') {
        vertex0Direction.set(1, 0, 0); // Start from +X direction
      } else {
        vertex0Direction.set(0, 1, 0); // Start from +Y direction  
      }
    } else if (tilePlane === 'xz') {
      if (higherOrderAxis === 'x') {
        vertex0Direction.set(1, 0, 0); // Start from +X direction
      } else {
        vertex0Direction.set(0, 0, 1); // Start from +Z direction
      }
    } else { // yz plane
      if (higherOrderAxis === 'y') {
        vertex0Direction.set(0, 1, 0); // Start from +Y direction
      } else {
        vertex0Direction.set(0, 0, 1); // Start from +Z direction
      }
    }

    // Create coordinate transformation matrix
    // This will transform from standard hex coordinates to the asset pack's coordinate system
    const hexToWorldTransform = new THREE.Matrix4();
    
    // For now, start with identity - we'll build the actual transform logic next
    hexToWorldTransform.identity();

    return {
      tilePlane,
      upAxis: upAxisChar,
      upDirection,
      higherOrderAxis,
      lowerOrderAxis,
      vertex0Direction,
      isPointyTop,
      hexToWorldTransform
    };
  }

  /**
   * Get or create a single fallback material for models without materials
   */
  private getFallbackMaterial(): THREE.Material {
    const FALLBACK_KEY = 'fallback';
    
    if (this.materialCache.has(FALLBACK_KEY)) {
      return this.materialCache.get(FALLBACK_KEY)!;
    }

    // Create a single, nice-looking fallback material
    const material = new THREE.MeshStandardMaterial({ 
      color: 0xCCCCCC,  // Light gray
      roughness: 0.7,
      metalness: 0.1
    });

    this.materialCache.set(FALLBACK_KEY, material);
    return material;
  }

  /**
   * Get material for a model - use model materials if available, otherwise use single fallback
   */
  private getModelMaterial(loadedModel: LoadedModel): THREE.Material {
    // If model includes materials, use the first one (or could be more sophisticated)
    if (loadedModel.materials.length > 0) {
      return loadedModel.materials[0];
    }
    
    // Single fallback material for all cases when model doesn't include materials
    return this.getFallbackMaterial();
  }

  /**
   * Reset world group transformations (no longer needed since individual models are transformed)
   */
  private resetWorldGroupTransform(): void {
    this.worldGroup.rotation.set(0, 0, 0);
    this.worldGroup.scale.set(1, 1, 1);
  }

  /**
   * Convert hex coordinates to position in Three.js coordinate system
   */
  private hexToThreeJSPosition(q: number, r: number, elevation: number, assetPack: AssetPack): THREE.Vector3 {
    const config = assetPack.geometry_config;
    const orientation = this.analyzeGeometryConfig(config);

    // Calculate hex coordinates in the asset pack's coordinate system
    let hexCoord1: number; // Along higher-order axis in tile plane
    let hexCoord2: number; // Along lower-order axis in tile plane

    if (orientation.isPointyTop) {
      // Pointy-top hexagon math
      hexCoord1 = Math.sqrt(3) * (q + r / 2);
      hexCoord2 = 3/2 * r;
    } else {
      // Flat-top hexagon math  
      hexCoord1 = 3/2 * q;
      hexCoord2 = Math.sqrt(3) * (r + q / 2);
    }

    // Now map these coordinates to Three.js coordinate system
    // Three.js always uses Y-up, so we need to transform from asset pack CS to Three.js CS
    const assetPackPosition = new THREE.Vector3();
    
    // Map hex coordinates to asset pack coordinate system
    if (orientation.tilePlane === 'xy') {
      assetPackPosition.x = hexCoord1;
      assetPackPosition.y = hexCoord2;
      assetPackPosition.z = elevation;
    } else if (orientation.tilePlane === 'xz') {
      assetPackPosition.x = hexCoord1;
      assetPackPosition.y = elevation;
      assetPackPosition.z = hexCoord2;
    } else { // yz plane
      assetPackPosition.x = elevation;
      assetPackPosition.y = hexCoord1;
      assetPackPosition.z = hexCoord2;
    }
    
    // Transform to Three.js coordinate system (Y-up)
    const threeJSPosition = new THREE.Vector3();
    
    if (orientation.upAxis === 'z') {
      // Pack is Z-up, transform to Y-up
      threeJSPosition.x = assetPackPosition.x;
      threeJSPosition.y = assetPackPosition.z; // Z becomes Y
      threeJSPosition.z = -assetPackPosition.y; // Y becomes -Z
    } else if (orientation.upAxis === 'x') {
      // Pack is X-up, transform to Y-up
      threeJSPosition.x = -assetPackPosition.z; // Z becomes -X
      threeJSPosition.y = assetPackPosition.x; // X becomes Y
      threeJSPosition.z = assetPackPosition.y; // Y becomes Z
    } else {
      // Pack is already Y-up
      threeJSPosition.copy(assetPackPosition);
    }

    return threeJSPosition;
  }

  /**
   * Render a world
   */
  async renderWorld(world: World): Promise<void> {
    // Clear existing world
    this.worldGroup.clear();
    
    // Clear tile mesh cache
    this.placedTileMeshes.clear();
    
    // Get asset pack
    const assetPack = this.assetPackManager.getAssetPack(world.asset_pack);
    if (!assetPack) {
      throw new Error(`Asset pack '${world.asset_pack}' not found`);
    }

    // Render tiles
    for (const worldTile of world.tiles) {
      await this.renderTile(worldTile, assetPack);
    }

    // Render addons
    for (const worldAddon of world.addons) {
      await this.renderAddon(worldAddon, assetPack, world);
    }

    // Reset world group transformations (no longer needed)
    this.resetWorldGroupTransform();
    
  }

  private async renderTile(worldTile: WorldTile, assetPack: AssetPack): Promise<void> {
    const tileDefinition = assetPack.tiles.find(t => t.id === worldTile.tile_type);
    if (!tileDefinition) {
      console.warn(`Tile definition '${worldTile.tile_type}' not found`);
      return;
    }

    try {
      // Load model (geometry + materials if available)
      const loadedModel = await this.loadModel(`assets/${tileDefinition.model}`, assetPack);
      
      // Get material - use model material if available, otherwise generate
      const material = this.getModelMaterial(loadedModel);
      
      // Create mesh
      const mesh = new THREE.Mesh(loadedModel.geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      
      // Position the tile in Three.js coordinate system
      const position = this.hexToThreeJSPosition(worldTile.q, worldTile.r, worldTile.elevation, assetPack);
      mesh.position.copy(position);
      
      // Add to world group
      this.worldGroup.add(mesh);
      
      // Cache the placed tile mesh for add-on positioning
      const tileKey = `${worldTile.q},${worldTile.r}`;
      this.placedTileMeshes.set(tileKey, mesh);
      
    } catch (error) {
      console.error(`Failed to render tile ${worldTile.tile_type}:`, error);
    }
  }

  private async renderAddon(worldAddon: WorldAddOn, assetPack: AssetPack, world: World): Promise<void> {
    const addonDefinition = assetPack.addons.find(a => a.id === worldAddon.addon_id);
    if (!addonDefinition) {
      console.warn(`Addon definition '${worldAddon.addon_id}' not found`);
      return;
    }

    try {
      // Load model (geometry + materials if available)
      const loadedModel = await this.loadModel(`assets/${addonDefinition.model}`, assetPack);
      
      const material = this.getModelMaterial(loadedModel);
      
      // Create mesh
      const mesh = new THREE.Mesh(loadedModel.geometry, material);
      mesh.castShadow = true;
      
      // Find the actual placed tile mesh to get its real surface position
      const tileKey = `${worldAddon.q},${worldAddon.r}`;
      const tileMesh = this.placedTileMeshes.get(tileKey);
      
      let tileSurfacePosition: THREE.Vector3;
      
      if (tileMesh) {
        // Get the actual bounding box of the placed tile mesh
        const tileBox = new THREE.Box3().setFromObject(tileMesh);
        
        // For add-ons, we want to place them on the top surface exactly (no offset needed)
        tileSurfacePosition = new THREE.Vector3(
          tileMesh.position.x,  // Use tile center X
          tileBox.max.y,        // Use actual top surface Y (no offset needed)
          tileMesh.position.z   // Use tile center Z
        );
        
      } else {
        // Fallback: calculate position if tile mesh not found
        console.warn(`Tile mesh not found at (${worldAddon.q}, ${worldAddon.r}), using fallback positioning`);
        const tile = world.tiles.find(t => t.q === worldAddon.q && t.r === worldAddon.r);
        const tileElevation = tile ? tile.elevation : 0;
        tileSurfacePosition = this.hexToThreeJSPosition(worldAddon.q, worldAddon.r, tileElevation, assetPack);
      }
      
      // Apply local position offset using proper geometry config transformation
      const config = assetPack.geometry_config;
      const orientation = this.analyzeGeometryConfig(config);
      
      // Transform local coordinates from asset pack coordinate system to Three.js coordinate system
      const packLocalPos = new THREE.Vector3(
        worldAddon.local_position[0],
        worldAddon.local_position[1], 
        worldAddon.local_position[2]
      );
      
      const threeJSLocalPos = new THREE.Vector3();
      
      // Apply coordinate system transformation for add-on local offsets
      if (orientation.upAxis === 'z' && orientation.upDirection === 1) {
        // Asset pack is Z-up, Three.js is Y-up
        // For local offsets: pack [x, y, z] -> Three.js [x, z, -y]
        // BUT: pack Y should remain as Y (height above surface)
        // AND: pack Z (vertical in pack) should become Y (vertical in Three.js)
        threeJSLocalPos.set(
          packLocalPos.x,   // Pack X → Three.js X (left/right stays the same)
          packLocalPos.z,   // Pack Z → Three.js Y (pack up/down becomes Three.js up/down)
          packLocalPos.y    // Pack Y → Three.js Z (pack forward/back becomes Three.js forward/back)
        );
      } else if (orientation.upAxis === 'y' && orientation.upDirection === 1) {
        // Pack already uses Y-up like Three.js - no transformation needed
        threeJSLocalPos.copy(packLocalPos);
      } else if (orientation.upAxis === 'x' && orientation.upDirection === 1) {
        // Asset pack is X-up, Three.js is Y-up -> apply -90° Z rotation transformation  
        // [x, y, z] -> [-y, x, z]
        threeJSLocalPos.set(-packLocalPos.y, packLocalPos.x, packLocalPos.z);
      } else {
        // Unsupported orientation - fallback to no transformation
        threeJSLocalPos.copy(packLocalPos);
        console.warn(`Unsupported orientation for local coordinates: ${orientation.upAxis}${orientation.upDirection > 0 ? '+' : '-'}`);
      }
      
      const offsetX = threeJSLocalPos.x;
      const offsetY = threeJSLocalPos.y;
      const offsetZ = threeJSLocalPos.z;
      
      // CORRECT APPROACH: Position add-on so its BOTTOM sits on tile TOP
      // First, we need to find the add-on's bounding box to know where its bottom is
      loadedModel.geometry.computeBoundingBox();
      const addonBBox = loadedModel.geometry.boundingBox!;
      
      // Calculate the Y position so that add-on bottom = tile top
      // If add-on center is at position.y, then add-on bottom is at position.y + addonBBox.min.y
      // We want: position.y + addonBBox.min.y = tileSurfacePosition.y
      // So: position.y = tileSurfacePosition.y - addonBBox.min.y
      const correctY = tileSurfacePosition.y - addonBBox.min.y + offsetY;
      
      mesh.position.set(
        tileSurfacePosition.x + offsetX,
        correctY,
        tileSurfacePosition.z + offsetZ
      );
      
      // Apply local rotation around Three.js Y axis (up axis)
      mesh.rotation.y = THREE.MathUtils.degToRad(worldAddon.local_rotation);
      
      mesh.scale.setScalar(worldAddon.local_scale);
      
      // Add to world group
      this.worldGroup.add(mesh);
      
    } catch (error) {
      console.error(`Failed to render addon ${worldAddon.addon_id}:`, error);
    }
  }

  /**
   * Update camera and renderer size
   */
  resize(width: number, height: number): void {
    // Update main perspective camera
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    
    // Update UI orthographic camera for new size
    this.uiCamera.left = -width / 2;
    this.uiCamera.right = width / 2;
    this.uiCamera.top = height / 2;
    this.uiCamera.bottom = -height / 2;
    this.uiCamera.updateProjectionMatrix();
    
    // Update renderer
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(width, height);
    
    // Update corner axes position for new size
    this.updateCornerAxes();
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.renderer.dispose();
    
    // Dispose of cached materials
    this.materialCache.forEach(material => material.dispose());
    this.materialCache.clear();
    
    // Dispose of cached models
    this.loadedModels.forEach(model => {
      model.geometry.dispose();
      model.materials.forEach(material => material.dispose());
    });
    this.loadedModels.clear();
    
    // Clean up UI scene
    if (this.cornerAxesGroup) {
      this.uiScene.remove(this.cornerAxesGroup);
    }
    
    if (this.controls) {
      this.controls.dispose();
    }
  }

  /**
   * Reset camera to default position and target
   */
  resetCamera(): void {
    this.camera.position.set(5, 5, 5);
    this.camera.lookAt(0, 0, 0);
    
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  /**
   * Set camera to a preset view
   */
  setCameraPreset(position: [number, number, number], target: [number, number, number] = [0, 0, 0]): void {
    this.camera.position.set(position[0], position[1], position[2]);
    this.camera.lookAt(target[0], target[1], target[2]);
    
    if (this.controls) {
      this.controls.target.set(target[0], target[1], target[2]);
      this.controls.update();
    }
  }

  /**
   * Toggle coordinate system display
   */
  toggleCoordinateSystem(show: boolean): void {
    this.showCoordinateAxes = show;
    
    if (this.cornerAxesGroup) {
      this.cornerAxesGroup.visible = show;
    }
  }

  /**
   * Get current coordinate system visibility
   */
  getCoordinateSystemVisibility(): boolean {
    return this.showCoordinateAxes;
  }
}