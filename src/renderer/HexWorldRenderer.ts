import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { World, AssetPack, GeometryConfig, WorldTile, WorldAddOn } from '../types/index';
import { AssetPackManager } from '../core/AssetPackManager';
import { EdgeValidator, ValidationSummary, EdgeValidationResult } from '../core/EdgeValidator';

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

export interface TileInfo {
  coordinates: { q: number; r: number };
  tileType: string;
  elevation: number;
  rotation: number;
  position: THREE.Vector3;
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

  // Visibility controls
  private tilesGroup: THREE.Group;
  private addonsGroup: THREE.Group;
  private validationGroup: THREE.Group;
  private showTiles: boolean = true;
  private showAddons: boolean = true;
  private showValidation: boolean = false;

  // Validation system
  private edgeValidator: EdgeValidator;
  private currentValidationSummary?: ValidationSummary;

  // Interactivity system
  private interactivityEnabled: boolean = false;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private selectedTile?: THREE.Mesh;
  private selectedTileHighlight?: THREE.Mesh;
  private selectedValidation?: THREE.Mesh;
  private selectedValidationHighlight?: THREE.Mesh;
  private onTileSelectedCallback?: (tileInfo: TileInfo | null) => void;
  private onValidationSelectedCallback?: (validationInfo: EdgeValidationResult | null) => void;

  constructor(config: RendererConfig, assetPackManager: AssetPackManager) {
    this.assetPackManager = assetPackManager;
    this.showCoordinateAxes = config.showCornerAxes ?? true;
    this.edgeValidator = new EdgeValidator(assetPackManager);
    
    // Initialize interactivity
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
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
    
    // Setup mouse event listeners
    this.setupMouseEvents();
    
    // Setup scene
    this.setupScene();
    this.setupCamera();
    this.setupLighting();
    
    // Create world group and sub-groups for organized rendering
    this.worldGroup = new THREE.Group();
    this.tilesGroup = new THREE.Group();
    this.addonsGroup = new THREE.Group();
    this.validationGroup = new THREE.Group();
    
    this.worldGroup.add(this.tilesGroup);
    this.worldGroup.add(this.addonsGroup);
    this.worldGroup.add(this.validationGroup);
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
   * Setup mouse event listeners for interactivity
   */
  private setupMouseEvents(): void {
    const canvas = this.renderer.domElement;

    const onMouseClick = (event: MouseEvent) => {
      if (!this.interactivityEnabled) return;

      // Calculate mouse position in normalized device coordinates
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      // Perform raycasting - check validation spheres first (they're smaller and on top)
      this.raycaster.setFromCamera(this.mouse, this.camera);
      
      // Check validation objects first (they have priority due to being smaller targets)
      const validationIntersects = this.raycaster.intersectObjects(this.validationGroup.children, true);
      if (validationIntersects.length > 0) {
        const intersectedValidation = validationIntersects[0].object as THREE.Mesh;
        this.selectValidation(intersectedValidation);
        this.deselectTile(); // Clear tile selection when selecting validation
        return;
      }

      // Then check tile objects
      const tileIntersects = this.raycaster.intersectObjects(this.tilesGroup.children, true);
      if (tileIntersects.length > 0) {
        const intersectedMesh = tileIntersects[0].object as THREE.Mesh;
        this.selectTile(intersectedMesh);
        this.deselectValidation(); // Clear validation selection when selecting tile
      } else {
        // Clear all selections if nothing was hit
        this.deselectTile();
        this.deselectValidation();
      }
    };

    canvas.addEventListener('click', onMouseClick, false);
  }

  /**
   * Select a tile and highlight it
   */
  private selectTile(tileMesh: THREE.Mesh): void {
    if (this.selectedTile === tileMesh) return; // Already selected

    // Deselect previous tile
    this.deselectTile();

    this.selectedTile = tileMesh;

    // Create highlight
    this.createTileHighlight(tileMesh);

    // Extract tile info and notify callback
    const tileInfo = this.extractTileInfo(tileMesh);
    if (this.onTileSelectedCallback && tileInfo) {
      this.onTileSelectedCallback(tileInfo);
    }
  }

  /**
   * Deselect current tile and remove highlight
   */
  private deselectTile(): void {
    if (this.selectedTileHighlight) {
      this.scene.remove(this.selectedTileHighlight);
      this.selectedTileHighlight.geometry.dispose();
      (this.selectedTileHighlight.material as THREE.Material).dispose();
      this.selectedTileHighlight = undefined;
    }

    this.selectedTile = undefined;

    if (this.onTileSelectedCallback) {
      this.onTileSelectedCallback(null);
    }
  }

  /**
   * Create visual highlight for selected tile
   */
  private createTileHighlight(tileMesh: THREE.Mesh): void {
    const geometry = tileMesh.geometry.clone();
    
    // Create wireframe material for highlight
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });

    this.selectedTileHighlight = new THREE.Mesh(geometry, material);
    this.selectedTileHighlight.position.copy(tileMesh.position);
    this.selectedTileHighlight.rotation.copy(tileMesh.rotation);
    this.selectedTileHighlight.scale.copy(tileMesh.scale);
    this.selectedTileHighlight.scale.multiplyScalar(1.02); // Slightly larger for visibility

    this.scene.add(this.selectedTileHighlight);
  }

  /**
   * Extract tile information from mesh userData
   */
  private extractTileInfo(tileMesh: THREE.Mesh): TileInfo | null {
    const userData = tileMesh.userData;
    if (!userData.tileData) return null;

    const tileData = userData.tileData;
    return {
      coordinates: { q: tileData.q, r: tileData.r },
      tileType: tileData.tile_type,
      elevation: tileData.elevation,
      rotation: tileData.rotation || 0,
      position: tileMesh.position.clone()
    };
  }

  /**
   * Select a validation error and highlight it
   */
  private selectValidation(validationMesh: THREE.Mesh): void {
    if (this.selectedValidation === validationMesh) return; // Already selected

    // Deselect previous validation
    this.deselectValidation();

    this.selectedValidation = validationMesh;

    // Create highlight
    this.createValidationHighlight(validationMesh);

    // Extract validation info and notify callback
    const validationInfo = this.extractValidationInfo(validationMesh);
    if (this.onValidationSelectedCallback && validationInfo) {
      this.onValidationSelectedCallback(validationInfo);
    }
  }

  /**
   * Deselect current validation and remove highlight
   */
  private deselectValidation(): void {
    if (this.selectedValidationHighlight) {
      this.scene.remove(this.selectedValidationHighlight);
      this.selectedValidationHighlight.geometry.dispose();
      (this.selectedValidationHighlight.material as THREE.Material).dispose();
      this.selectedValidationHighlight = undefined;
    }

    this.selectedValidation = undefined;

    if (this.onValidationSelectedCallback) {
      this.onValidationSelectedCallback(null);
    }
  }

  /**
   * Create visual highlight for selected validation error
   */
  private createValidationHighlight(validationMesh: THREE.Mesh): void {
    const geometry = new THREE.SphereGeometry(0.18); // Slightly larger than the validation sphere
    
    // Create wireframe material for highlight
    const material = new THREE.MeshBasicMaterial({
      color: 0xffff00, // Yellow highlight
      wireframe: true,
      transparent: true,
      opacity: 1.0
    });

    this.selectedValidationHighlight = new THREE.Mesh(geometry, material);
    this.selectedValidationHighlight.position.copy(validationMesh.position);

    this.scene.add(this.selectedValidationHighlight);
  }

  /**
   * Extract validation information from mesh userData
   */
  private extractValidationInfo(validationMesh: THREE.Mesh): EdgeValidationResult | null {
    const userData = validationMesh.userData;
    return userData.validationResult || null;
  }

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
      const lowerPath = modelPath.toLowerCase();
      if (lowerPath.endsWith('.stl')) {
        return await this.loadSTLModel(modelPath, assetPack);
      } else if (lowerPath.endsWith('.gltf') || lowerPath.endsWith('.glb')) {
        return await this.loadGLTFModel(modelPath, assetPack);
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

  /**
   * Load GLTF/GLB model and return geometry with included materials
   * GLTF format can include materials, textures, animations, etc.
   */
  private async loadGLTFModel(modelPath: string, assetPack: AssetPack): Promise<LoadedModel> {
    const cacheKey = `${modelPath}_${assetPack.id}`;

    try {
      const loader = new GLTFLoader();
      
      return new Promise((resolve, reject) => {
        loader.load(
          modelPath,
          (gltf) => {
            // Extract all meshes from the GLTF scene
            const meshes: THREE.Mesh[] = [];
            gltf.scene.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                meshes.push(child);
              }
            });

            if (meshes.length === 0) {
              reject(new Error(`No meshes found in GLTF model: ${modelPath}`));
              return;
            }

            // For now, use the first mesh's geometry and collect all materials
            const primaryMesh = meshes[0];
            const geometry = primaryMesh.geometry.clone();
            
            // Collect all materials from all meshes
            const materials: THREE.Material[] = [];
            meshes.forEach(mesh => {
              if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                  materials.push(...mesh.material);
                } else {
                  materials.push(mesh.material);
                }
              }
            });

            // Apply coordinate system transformation if pack config exists
            this.transformModelToThreeJS(geometry, assetPack);
            
            // Update bounding box after transformation
            geometry.computeBoundingBox();
            
            const loadedModel: LoadedModel = {
              geometry: geometry.clone(),
              materials: [...materials] // Include GLTF materials
            };
            
            this.loadedModels.set(cacheKey, loadedModel);
            resolve({
              geometry: geometry,
              materials: [...materials]
            });
          },
          () => {
            // Loading progress - could add progress indicator here
          },
          (error) => {
            console.error(`Failed to load GLTF model: ${modelPath}`, error);
            reject(error);
          }
        );
      });
    } catch (error) {
      console.error(`Error loading GLTF model: ${modelPath}`, error);
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
    const radius = config.tile_circumradius;

    // Calculate hex coordinates in the asset pack's coordinate system
    let hexCoord1: number; // Along higher-order axis in tile plane
    let hexCoord2: number; // Along lower-order axis in tile plane

    if (orientation.isPointyTop) {
      // Pointy-top hexagon math (scaled by radius)
      hexCoord1 = radius * Math.sqrt(3) * (q + r / 2);
      hexCoord2 = radius * 3/2 * r;
    } else {
      // Flat-top hexagon math (scaled by radius)
      hexCoord1 = radius * 3/2 * q;
      hexCoord2 = radius * Math.sqrt(3) * (r + q / 2);
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
    this.tilesGroup.clear();
    this.addonsGroup.clear();
    this.validationGroup.clear();
    
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
    
    // Apply current visibility settings
    this.updateVisibility();
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
      
      // Store tile data in userData for selection
      mesh.userData.tileData = worldTile;
      
      // Position the tile in Three.js coordinate system
      const position = this.hexToThreeJSPosition(worldTile.q, worldTile.r, worldTile.elevation, assetPack);
      mesh.position.copy(position);
      
      // Apply rotation if specified (in 60-degree increments)
      const rotation = worldTile.rotation || 0;
      if (rotation > 0) {
        const rotationRadians = (rotation * Math.PI) / 3; // 60 degrees = π/3 radians
        const rotationAxis = this.getTileRotationAxis(assetPack);
        
        if (rotationAxis === 'x') {
          mesh.rotation.x = -rotationRadians; // Negative for clockwise rotation
        } else if (rotationAxis === 'y') {
          mesh.rotation.y = -rotationRadians; // Negative for clockwise rotation
        } else if (rotationAxis === 'z') {
          mesh.rotation.z = -rotationRadians; // Negative for clockwise rotation
        }
      }
      
      // Add to tiles group
      this.tilesGroup.add(mesh);
      
      // Cache the placed tile mesh for add-on positioning
      const tileKey = `${worldTile.q},${worldTile.r}`;
      this.placedTileMeshes.set(tileKey, mesh);
      
    } catch (error) {
      console.error(`Failed to render tile ${worldTile.tile_type}:`, error);
    }
  }

  /**
   * Determine which axis to rotate around in Three.js coordinate system
   * based on the asset pack's tile_up_axis configuration
   */
  private getTileRotationAxis(assetPack: AssetPack): 'x' | 'y' | 'z' {
    const config = assetPack.geometry_config;
    if (!config) {
      return 'y'; // Default to Y-axis (Three.js standard)
    }

    const upAxisChar = config.tile_up_axis[0] as 'x' | 'y' | 'z';
    
    // Since models are transformed to Three.js coordinate system (Y-up),
    // we need to determine which axis in Three.js space corresponds to
    // the original rotation axis in the asset pack coordinate system
    
    if (upAxisChar === 'z') {
      // Asset pack is Z-up, transformed to Y-up in Three.js
      // Rotation around Z in asset pack = rotation around Y in Three.js
      return 'y';
    } else if (upAxisChar === 'y') {
      // Asset pack is already Y-up, no transformation needed
      // Rotation around Y in asset pack = rotation around Y in Three.js
      return 'y';
    } else if (upAxisChar === 'x') {
      // Asset pack is X-up, transformed to Y-up in Three.js
      // Rotation around X in asset pack = rotation around Y in Three.js
      return 'y';
    }
    
    return 'y'; // Default fallback
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
      
      // Determine which placement method to use
      const defaultMethod = assetPack.placement_config?.default_addon_placement_method || 'bounding_box';
      const placementMethod = addonDefinition.placement.placement_method || defaultMethod;
      console.log(`Placement method: ${placementMethod}`);
      
      let finalY: number;
      
      if (placementMethod === 'model_coordinates') {
        // Model coordinates method: assume addon is already correctly positioned
        // Just use the tile surface position + local Y offset
        finalY = tileSurfacePosition.y + offsetY;
      } else {
        // Bounding box method (default): Position add-on so its bottom sits on tile top
        // First, we need to find the add-on's bounding box to know where its bottom is
        loadedModel.geometry.computeBoundingBox();
        const addonBBox = loadedModel.geometry.boundingBox!;
        
        // Calculate the Y position so that add-on bottom = tile top
        // If add-on center is at position.y, then add-on bottom is at position.y + addonBBox.min.y
        // We want: position.y + addonBBox.min.y = tileSurfacePosition.y
        // So: position.y = tileSurfacePosition.y - addonBBox.min.y
        finalY = tileSurfacePosition.y - addonBBox.min.y + offsetY;
      }
      
      mesh.position.set(
        tileSurfacePosition.x + offsetX,
        finalY,
        tileSurfacePosition.z + offsetZ
      );
      
      // Apply local rotation around Three.js Y axis (up axis)
      mesh.rotation.y = THREE.MathUtils.degToRad(worldAddon.local_rotation);
      
      mesh.scale.setScalar(worldAddon.local_scale);
      
      // Add to world group
      this.addonsGroup.add(mesh);
      
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

  /**
   * Enable or disable tile interactivity
   */
  setInteractivityEnabled(enabled: boolean): void {
    this.interactivityEnabled = enabled;
    
    if (!enabled) {
      this.clearAllSelections(); // Clear all selections when disabling
    }
  }

  /**
   * Get current interactivity state
   */
  getInteractivityEnabled(): boolean {
    return this.interactivityEnabled;
  }

  /**
   * Set callback for tile selection events
   */
  setTileSelectionCallback(callback: (tileInfo: TileInfo | null) => void): void {
    this.onTileSelectedCallback = callback;
  }

  /**
   * Set callback for validation selection events
   */
  setValidationSelectionCallback(callback: (validationInfo: EdgeValidationResult | null) => void): void {
    this.onValidationSelectedCallback = callback;
  }

  /**
   * Clear tile selection
   */
  clearTileSelection(): void {
    this.deselectTile();
  }

  /**
   * Clear validation selection
   */
  clearValidationSelection(): void {
    this.deselectValidation();
  }

  /**
   * Clear all selections
   */
  clearAllSelections(): void {
    this.deselectTile();
    this.deselectValidation();
  }

  /**
   * Toggle tile visibility
   */
  setTileVisibility(visible: boolean): void {
    this.showTiles = visible;
    this.updateVisibility();
  }

  /**
   * Toggle add-on visibility
   */
  setAddonVisibility(visible: boolean): void {
    this.showAddons = visible;
    this.updateVisibility();
  }

  /**
   * Toggle validation visualization
   */
  setValidationVisibility(visible: boolean): void {
    this.showValidation = visible;
    this.updateVisibility();
  }

  /**
   * Get current tile visibility state
   */
  getTileVisibility(): boolean {
    return this.showTiles;
  }

  /**
   * Get current addon visibility state
   */
  getAddonVisibility(): boolean {
    return this.showAddons;
  }

  /**
   * Get current validation visibility state
   */
  getValidationVisibility(): boolean {
    return this.showValidation;
  }

  /**
   * Update visibility of all groups based on current settings
   */
  private updateVisibility(): void {
    this.tilesGroup.visible = this.showTiles;
    this.addonsGroup.visible = this.showAddons;
    this.validationGroup.visible = this.showValidation;
  }

  /**
   * Run edge validation on the current world and visualize results
   */
  async validateAndVisualizeEdges(world: World): Promise<ValidationSummary> {
    // Clear existing validation visualization
    this.validationGroup.clear();
    
    // Run validation
    this.currentValidationSummary = this.edgeValidator.validateWorld(world);
    
    // Visualize invalid edges
    await this.visualizeValidationResults(this.currentValidationSummary, world);
    
    return this.currentValidationSummary;
  }

  /**
   * Clear validation visualization
   */
  clearValidationVisualization(): void {
    this.validationGroup.clear();
    this.currentValidationSummary = undefined;
    this.setValidationVisibility(false);
  }

  /**
   * Get current validation summary
   */
  getCurrentValidationSummary(): ValidationSummary | undefined {
    return this.currentValidationSummary;
  }

    /**
   * Visualize validation results in the 3D scene
   */
private async visualizeValidationResults(summary: ValidationSummary, world: World): Promise<void> {
    const assetPack = this.assetPackManager.getAssetPack(world.asset_pack);
    if (!assetPack) {
      console.warn('Cannot visualize validation: asset pack not found');
      return;
    }

    // Visualize both valid and invalid edges
    const invalidEdges = this.edgeValidator.getInvalidEdges(summary);
    const validEdges = this.edgeValidator.getValidEdges(summary);
    
    // Create red dots for invalid edges
    for (const result of invalidEdges) {
      await this.createEdgeValidationVisualization(result, assetPack, false);
    }
    
    // Create green dots for valid edges
    for (const result of validEdges) {
      await this.createEdgeValidationVisualization(result, assetPack, true);
    }
  }

  /**
   * Create visualization for a single edge validation result
   */
  private async createEdgeValidationVisualization(result: EdgeValidationResult, assetPack: AssetPack, isValid: boolean): Promise<void> {
    // Get positions of both tiles
    const sourcePosition = this.hexToThreeJSPosition(
      result.sourcePosition.q, 
      result.sourcePosition.r, 
      0, // Use base elevation for visualization
      assetPack
    );
    
    const targetPosition = this.hexToThreeJSPosition(
      result.targetPosition.q, 
      result.targetPosition.r, 
      0, // Use base elevation for visualization
      assetPack
    );

    // Calculate midpoint for edge visualization
    const midpoint = new THREE.Vector3().addVectors(sourcePosition, targetPosition).multiplyScalar(0.5);
    
    // Add icon/marker at midpoint - green for valid, red for invalid
    const iconGeometry = new THREE.SphereGeometry(0.15);
    const iconMaterial = new THREE.MeshBasicMaterial({ 
      color: isValid ? 0x00ff00 : 0xff0000, // Green for valid, red for invalid
      transparent: true,
      opacity: 0.9
    });
    
    const iconMesh = new THREE.Mesh(iconGeometry, iconMaterial);
    iconMesh.position.copy(midpoint);
    iconMesh.position.y += 0.3; // Above the surface
    
    this.validationGroup.add(iconMesh);
    
    // Store validation info for potential tooltips/interaction
    iconMesh.userData.validationResult = result;
  }
}