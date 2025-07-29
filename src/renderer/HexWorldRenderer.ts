import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { World, AssetPack, GeometryConfig } from '../types/index.js';
import { AssetPackManager } from '../core/AssetPackManager.js';
import { HexCoordinates } from '../core/HexCoordinates.js';

export interface RendererConfig {
  container: HTMLElement;
  width?: number;
  height?: number;
  enableControls?: boolean;
  showGrid?: boolean;
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

export class HexWorldRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls?: OrbitControls;
  private assetPackManager: AssetPackManager;
  private loadedModels = new Map<string, THREE.BufferGeometry>();
  private materialCache = new Map<string, THREE.Material>();
  private worldGroup: THREE.Group;
  private placedTileMeshes = new Map<string, THREE.Mesh>(); // Cache placed tile meshes for add-on positioning

  constructor(config: RendererConfig, assetPackManager: AssetPackManager) {
    this.assetPackManager = assetPackManager;
    
    // Initialize Three.js components
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      (config.width || config.container.clientWidth) / (config.height || config.container.clientHeight),
      0.1,
      1000
    );
    
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
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
    
    // Setup controls if enabled
    if (config.enableControls !== false) {
      this.setupControls();
    }
    
    // Show grid if enabled
    if (config.showGrid) {
      this.addGrid();
    }
    
    // Always add coordinate system for debugging
    this.addCoordinateSystem();
    
    // Start render loop
    this.animate();
  }

  private setupScene(): void {
    this.scene.background = new THREE.Color(0x87CEEB); // Sky blue
  }

  private setupCamera(): void {
    this.camera.position.set(5, 5, 5);
    this.camera.lookAt(0, 0, 0);
  }

  private setupLighting(): void {
    console.log('💡 SETTING UP IMPROVED LIGHTING SYSTEM...');
    
    // Softer ambient light for natural look
    const ambientLight = new THREE.AmbientLight(0x87CEEB, 0.2); // Sky blue, much lower intensity
    this.scene.add(ambientLight);
    console.log('  ✅ Ambient light: Sky blue, 0.2 intensity');
    
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
    console.log('  ✅ Sun light: White, 1.0 intensity, position(-5, 15, 10)');
    
    // Fill light for softer shadows
    const fillLight = new THREE.DirectionalLight(0x87CEEB, 0.3);
    fillLight.position.set(5, 8, -5); // Opposite side, softer
    // No shadows for fill light to keep performance good
    this.scene.add(fillLight);
    console.log('  ✅ Fill light: Sky blue, 0.3 intensity, position(5, 8, -5)');
    
    // Subtle rim light for better definition
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.2);
    rimLight.position.set(0, 5, -10); // From behind/below
    this.scene.add(rimLight);
    console.log('  ✅ Rim light: White, 0.2 intensity, position(0, 5, -10)');
    
    console.log('💡 LIGHTING SETUP COMPLETE - Much more natural and appealing!');
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

  private addCoordinateSystem(): void {
    console.log('🧭 ADDING COORDINATE SYSTEM TO SCENE...');
    
    // Create LARGE coordinate system visualization at origin
    const axesHelper = new THREE.AxesHelper(10);  // Much bigger
    this.scene.add(axesHelper);
    
    // Add LARGE cones to make axes super visible
    // Red = X, Green = Y, Blue = Z (Three.js convention)
    
    // X-axis (Red) - pointing right - MUCH BIGGER
    const xGeometry = new THREE.ConeGeometry(0.5, 1.0, 8);  // Much bigger cone
    const xMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const xCone = new THREE.Mesh(xGeometry, xMaterial);
    xCone.position.set(10.5, 0, 0);  // Further out
    xCone.rotation.z = -Math.PI / 2;
    this.scene.add(xCone);
    
    // Y-axis (Green) - pointing up - MUCH BIGGER  
    const yGeometry = new THREE.ConeGeometry(0.5, 1.0, 8);  // Much bigger cone
    const yMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const yCone = new THREE.Mesh(yGeometry, yMaterial);
    yCone.position.set(0, 10.5, 0);  // Further out
    this.scene.add(yCone);
    
    // Z-axis (Blue) - pointing toward camera - MUCH BIGGER
    const zGeometry = new THREE.ConeGeometry(0.5, 1.0, 8);  // Much bigger cone
    const zMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });
    const zCone = new THREE.Mesh(zGeometry, zMaterial);
    zCone.position.set(0, 0, 10.5);  // Further out
    zCone.rotation.x = Math.PI / 2;
    this.scene.add(zCone);
    
    // Add some cubes at the origin to make it super obvious
    const originGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const originMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const originCube = new THREE.Mesh(originGeometry, originMaterial);
    originCube.position.set(0, 0, 0);
    this.scene.add(originCube);
    
    console.log('🧭 COORDINATE SYSTEM ADDED TO SCENE:');
    console.log('  🔴 X-axis (RED) points RIGHT (positive X) - BIG RED CONE');
    console.log('  🟢 Y-axis (GREEN) points UP (positive Y) - BIG GREEN CONE');
    console.log('  🔵 Z-axis (BLUE) points TOWARD CAMERA (positive Z) - BIG BLUE CONE');
    console.log('  ⚪ White cube at origin (0,0,0)');
    console.log('  📏 Axes helper lines extend to ±10 units');
    console.log('  This is the Three.js right-handed coordinate system');
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    
    if (this.controls) {
      this.controls.update();
    }
    
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Load STL model and return geometry, transformed from pack CS to Three.js CS
   */
  private async loadSTLModel(modelPath: string, assetPack: AssetPack): Promise<THREE.BufferGeometry> {
    const cacheKey = `${modelPath}_${assetPack.id}`;
    if (this.loadedModels.has(cacheKey)) {
      return this.loadedModels.get(cacheKey)!.clone();
    }

    try {
      const loader = new STLLoader();
      
      return new Promise((resolve, reject) => {
        loader.load(
          modelPath,
          (geometry: THREE.BufferGeometry) => {
            console.log(`\n🔧 LOADING STL MODEL: ${modelPath}`);
            
            // Debug original geometry bounds
            geometry.computeBoundingBox();
            const originalBounds = geometry.boundingBox!;
            console.log(`📏 ORIGINAL BOUNDS:`, {
              min: { x: originalBounds.min.x, y: originalBounds.min.y, z: originalBounds.min.z },
              max: { x: originalBounds.max.x, y: originalBounds.max.y, z: originalBounds.max.z },
              size: {
                x: originalBounds.max.x - originalBounds.min.x,
                y: originalBounds.max.y - originalBounds.min.y,
                z: originalBounds.max.z - originalBounds.min.z
              }
            });
            
            // Check if geometry looks like it's lying flat on XY plane (Z-up)
            const zSize = originalBounds.max.z - originalBounds.min.z;
            const xSize = originalBounds.max.x - originalBounds.min.x;
            const ySize = originalBounds.max.y - originalBounds.min.y;
            
            console.log(`📐 GEOMETRY ANALYSIS:`);
            console.log(`  X-size: ${xSize.toFixed(3)}, Y-size: ${ySize.toFixed(3)}, Z-size: ${zSize.toFixed(3)}`);
            
            if (zSize < Math.max(xSize, ySize) * 0.2) {
              console.log(`  ✅ Geometry appears to be FLAT on XY plane (Z-up orientation)`);
            } else {
              console.log(`  ⚠️  Geometry appears to be TALL - might already be Y-up oriented`);
            }
            
            // Center the geometry
            const center = new THREE.Vector3();
            geometry.boundingBox!.getCenter(center);
            console.log(`📍 CENTERING: Translating by (${-center.x.toFixed(3)}, ${-center.y.toFixed(3)}, ${-center.z.toFixed(3)})`);
            geometry.translate(-center.x, -center.y, -center.z);
            
            // Apply coordinate system transformation from pack to Three.js
            this.transformGeometryFromPackToThreeJS(geometry, assetPack);
            
            // Debug transformed geometry bounds
            geometry.computeBoundingBox();
            const transformedBounds = geometry.boundingBox!;
            console.log(`📏 TRANSFORMED BOUNDS:`, {
              min: { x: transformedBounds.min.x, y: transformedBounds.min.y, z: transformedBounds.min.z },
              max: { x: transformedBounds.max.x, y: transformedBounds.max.y, z: transformedBounds.max.z },
              size: {
                x: transformedBounds.max.x - transformedBounds.min.x,
                y: transformedBounds.max.y - transformedBounds.min.y,
                z: transformedBounds.max.z - transformedBounds.min.z
              }
            });
            
            console.log(`✅ MODEL LOADED AND CACHED: ${cacheKey}\n`);
            
            this.loadedModels.set(cacheKey, geometry);
            resolve(geometry.clone());
          },
          undefined,
          reject
        );
      });
    } catch (error) {
      throw new Error(`Failed to load STL model ${modelPath}: ${error}`);
    }
  }

  /**
   * Transform geometry from pack coordinate system to Three.js coordinate system
   */
  private transformGeometryFromPackToThreeJS(geometry: THREE.BufferGeometry, assetPack: AssetPack): void {
    if (!assetPack.geometry_config) {
      console.log(`⚠️  NO GEOMETRY CONFIG - skipping transformation`);
      return;
    }
    
    const config = assetPack.geometry_config;
    const orientation = this.analyzeGeometryConfig(config);
    
    console.log(`🔄 MODEL COORDINATE SYSTEM TRANSFORMATION:`);
    console.log(`  Pack config: tile_up_axis="${config.tile_up_axis}", parallel_edge_direction="${config.parallel_edge_direction}"`);
    console.log(`  Three.js target: Y-up (positive Y points UP)`);
    console.log(`  Derived orientation: ${orientation.isPointyTop ? 'pointy-top' : 'flat-top'}, plane=${orientation.tilePlane}`);
    
    // Step 1: Transform up-axis to align with Three.js Y-up
    if (orientation.upAxis === 'z' && orientation.upDirection === 1) {
      console.log(`  🔄 STEP 1: Pack Z-up → Three.js Y-up`);
      console.log(`  🔄 APPLYING: -90° rotation around X-axis`);
      geometry.rotateX(-Math.PI / 2);
      console.log(`  ✅ Up-axis rotation applied`);
    } else if (orientation.upAxis === 'y' && orientation.upDirection === 1) {
      console.log(`  ✅ STEP 1: Pack already Y-up, no up-axis transform needed`);
    } else if (orientation.upAxis === 'x' && orientation.upDirection === 1) {
      console.log(`  🔄 STEP 1: Pack X-up → Three.js Y-up`);
      console.log(`  🔄 APPLYING: -90° rotation around Z-axis`);
      geometry.rotateZ(-Math.PI / 2);
      console.log(`  ✅ Up-axis rotation applied`);
    } else {
      console.warn(`  ❌ UNSUPPORTED up-axis: ${config.tile_up_axis}`);
    }
    
    // Step 2: Handle edge alignment transformation
    // After up-axis transform, we may need additional rotation to align edges correctly
    // This ensures the hex edges are oriented as expected in Three.js coordinate system
    
         // Step 2: Handle edge alignment transformation  
     // For hex grids, rotations should be in 30° or 60° increments
     if (orientation.tilePlane === 'xy' && orientation.upAxis === 'z') {
       // Common case: Z-up pack with XY tile plane
       // After Z→Y transform, we might need rotation around Y-axis for edge alignment
       const parallelAxisChar = config.parallel_edge_direction[0] as 'x' | 'y' | 'z';
       
       console.log(`  🔄 STEP 2: Analyzing edge alignment...`);
       console.log(`    Parallel axis: ${parallelAxisChar}, Higher-order: ${orientation.higherOrderAxis}`);
       console.log(`    Hex type: ${orientation.isPointyTop ? 'pointy-top' : 'flat-top'}`);
       
               // TEMPORARILY DISABLED: Edge alignment rotation (might be causing 60° misrotation)
        console.log(`  🚧 STEP 2: Edge alignment rotation temporarily disabled for debugging`);
        console.log(`    This should eliminate the 60° misrotation issue`);
        
        // TODO: Implement correct edge alignment logic after confirming up-axis transform works
        /*
        if (parallelAxisChar === 'y' && orientation.higherOrderAxis === 'x') {
          // Edge alignment rotation logic goes here
        }
        */
     } else {
       console.log(`  📝 STEP 2: Edge alignment for ${orientation.tilePlane} plane not fully implemented`);
     }
    
    console.log(`  ✅ MODEL TRANSFORMATION COMPLETE`);
  }

  /**
   * Analyze geometry config to determine hex grid orientation and coordinate system
   */
  private analyzeGeometryConfig(config: GeometryConfig): HexGridOrientation {
    console.log(`🔍 ANALYZING GEOMETRY CONFIG:`);
    console.log(`  tile_up_axis: "${config.tile_up_axis}"`);
    console.log(`  parallel_edge_direction: "${config.parallel_edge_direction}"`);

    // Parse up axis
    const upAxisChar = config.tile_up_axis[0] as 'x' | 'y' | 'z';
    const upDirection = config.tile_up_axis[1] === '+' ? 1 : -1;
    
    // Parse parallel edge direction  
    const parallelAxisChar = config.parallel_edge_direction[0] as 'x' | 'y' | 'z';
    const parallelDirection = config.parallel_edge_direction[1] === '+' ? 1 : -1;

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

    console.log(`  📐 Derived tile plane: ${tilePlane}`);
    console.log(`  📊 Higher-order axis: ${higherOrderAxis} > ${lowerOrderAxis}`);
    console.log(`  📍 Up axis: ${upAxisChar}${upDirection > 0 ? '+' : '-'}`);

    // Determine if we have pointy-top or flat-top hexes
    // CORRECTED LOGIC: If parallel edges align with a coordinate axis, we have flat-top
    // If parallel edges would require rotation to align with axis, we have pointy-top
    const isPointyTop = parallelAxisChar !== higherOrderAxis;
    
    console.log(`  🔺 Hex orientation: ${isPointyTop ? 'pointy-top' : 'flat-top'}`);
    console.log(`  ↔️  Parallel edges along: ${parallelAxisChar}${parallelDirection > 0 ? '+' : '-'}`);

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

    console.log(`  ✅ Analysis complete`);

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
   * Get or create material for a material type
   */
  private getMaterial(materialType: string): THREE.Material {
    if (this.materialCache.has(materialType)) {
      return this.materialCache.get(materialType)!;
    }

    let material: THREE.Material;

    console.log(`🎨 Creating material: ${materialType}`);

    switch (materialType) {
      case 'grass':
        material = new THREE.MeshStandardMaterial({ 
          color: 0x228B22,
          roughness: 0.8,
          metalness: 0.0
        });
        break;
      case 'water':
        material = new THREE.MeshStandardMaterial({ 
          color: 0x4169E1, 
          transparent: true, 
          opacity: 0.8,
          roughness: 0.1,
          metalness: 0.0
        });
        break;
      case 'sand':
        material = new THREE.MeshStandardMaterial({ 
          color: 0xF4A460,
          roughness: 0.9,
          metalness: 0.0
        });
        break;
      case 'stone':
        material = new THREE.MeshStandardMaterial({ 
          color: 0x696969,
          roughness: 0.7,
          metalness: 0.1
        });
        break;
      case 'road':
        material = new THREE.MeshStandardMaterial({ 
          color: 0x555555,
          roughness: 0.6,
          metalness: 0.0
        });
        break;
      default:
        material = new THREE.MeshStandardMaterial({ 
          color: 0xFFFFFF,
          roughness: 0.5,
          metalness: 0.0
        });
    }

    console.log(`  ✅ ${materialType} material: Standard PBR with appropriate roughness/metalness`);
    this.materialCache.set(materialType, material);
    return material;
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
    console.log(`🧮 HEX-TO-POSITION CONVERSION:`);
    console.log(`  Input: hex(q=${q}, r=${r}), elevation=${elevation}`);
    
    const config = assetPack.geometry_config;
    const orientation = this.analyzeGeometryConfig(config);

    // Calculate hex coordinates in the asset pack's coordinate system
    let hexCoord1: number; // Along higher-order axis in tile plane
    let hexCoord2: number; // Along lower-order axis in tile plane

    if (orientation.isPointyTop) {
      // Pointy-top hexagon math
      hexCoord1 = Math.sqrt(3) * (q + r / 2);
      hexCoord2 = 3/2 * r;
      console.log(`  📐 Using POINTY-TOP hex math`);
    } else {
      // Flat-top hexagon math  
      hexCoord1 = 3/2 * q;
      hexCoord2 = Math.sqrt(3) * (r + q / 2);
      console.log(`  📐 Using FLAT-TOP hex math`);
    }
    
    console.log(`  🔺 ${orientation.isPointyTop ? 'Pointy-top' : 'Flat-top'} hex math:`);
    console.log(`    ${orientation.higherOrderAxis} = ${hexCoord1.toFixed(3)}`);
    console.log(`    ${orientation.lowerOrderAxis} = ${hexCoord2.toFixed(3)}`);
    console.log(`    ${orientation.upAxis} = elevation = ${elevation}`);

    // Now map these coordinates to Three.js coordinate system
    // Three.js always uses Y-up, so we need to transform from asset pack CS to Three.js CS
    const assetPackPosition = new THREE.Vector3();
    
    // Set coordinates in the asset pack's coordinate system
    if (orientation.tilePlane === 'xy') {
      // Asset pack uses XY plane
      if (orientation.higherOrderAxis === 'x') {
        assetPackPosition.set(hexCoord1, hexCoord2, elevation * orientation.upDirection);
      } else {
        assetPackPosition.set(hexCoord2, hexCoord1, elevation * orientation.upDirection);
      }
    } else if (orientation.tilePlane === 'xz') {
      // Asset pack uses XZ plane
      if (orientation.higherOrderAxis === 'x') {
        assetPackPosition.set(hexCoord1, elevation * orientation.upDirection, hexCoord2);
      } else {
        assetPackPosition.set(hexCoord2, elevation * orientation.upDirection, hexCoord1);
      }
    } else { // yz plane
      // Asset pack uses YZ plane
      if (orientation.higherOrderAxis === 'y') {
        assetPackPosition.set(elevation * orientation.upDirection, hexCoord1, hexCoord2);
      } else {
        assetPackPosition.set(elevation * orientation.upDirection, hexCoord2, hexCoord1);
      }
    }

    // Transform from asset pack coordinate system to Three.js coordinate system
    const threeJSPosition = new THREE.Vector3();
    
    if (orientation.upAxis === 'z' && orientation.upDirection === 1) {
      // Asset pack is Z-up, Three.js is Y-up -> rotate -90° around X
      threeJSPosition.set(assetPackPosition.x, assetPackPosition.z, -assetPackPosition.y);
    } else if (orientation.upAxis === 'y' && orientation.upDirection === 1) {
      // Asset pack is already Y-up like Three.js -> no rotation needed
      threeJSPosition.copy(assetPackPosition);
    } else {
      // Other orientations - for now, use a simple mapping
      // TODO: Implement full 3D rotation matrix for all axis combinations
      console.warn(`  ⚠️  Coordinate transformation for ${orientation.upAxis}${orientation.upDirection > 0 ? '+' : '-'} not fully implemented yet`);
      threeJSPosition.copy(assetPackPosition);
    }
    
    console.log(`  📍 Asset pack position: (${assetPackPosition.x.toFixed(3)}, ${assetPackPosition.y.toFixed(3)}, ${assetPackPosition.z.toFixed(3)})`);
    console.log(`  🎯 Three.js position: (${threeJSPosition.x.toFixed(3)}, ${threeJSPosition.y.toFixed(3)}, ${threeJSPosition.z.toFixed(3)})`);
    
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
    
    console.log(`Rendered world with ${world.tiles.length} tiles and ${world.addons.length} addons`);
  }

  private async renderTile(worldTile: any, assetPack: AssetPack): Promise<void> {
    console.log(`\n🏗️  RENDERING TILE: ${worldTile.tile_type} at hex(${worldTile.q}, ${worldTile.r}), elevation=${worldTile.elevation}`);
    
    const tileDefinition = assetPack.tiles.find(t => t.id === worldTile.tile_type);
    if (!tileDefinition) {
      console.warn(`❌ Tile definition '${worldTile.tile_type}' not found`);
      return;
    }

    console.log(`📦 Tile definition found: model="${tileDefinition.model}", material="${tileDefinition.base_material}"`);

    try {
      // Load geometry (now transformed to Three.js coordinate system)
      const geometry = await this.loadSTLModel(`assets/${tileDefinition.model}`, assetPack);
      
      // Get material
      const material = this.getMaterial(tileDefinition.base_material);
      
      // Create mesh
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      
      // Position the tile in Three.js coordinate system
      const position = this.hexToThreeJSPosition(worldTile.q, worldTile.r, worldTile.elevation, assetPack);
      console.log(`📍 POSITIONING TILE: hex(${worldTile.q}, ${worldTile.r}) → world(${position.x.toFixed(3)}, ${position.y.toFixed(3)}, ${position.z.toFixed(3)})`);
      
      mesh.position.copy(position);
      
      console.log(`🎯 FINAL TILE POSITION: (${mesh.position.x.toFixed(3)}, ${mesh.position.y.toFixed(3)}, ${mesh.position.z.toFixed(3)})`);
      console.log(`🎯 FINAL TILE ROTATION: (${mesh.rotation.x.toFixed(3)}, ${mesh.rotation.y.toFixed(3)}, ${mesh.rotation.z.toFixed(3)}) radians`);
      
      // Add to world group
      this.worldGroup.add(mesh);
      
      // Cache the placed tile mesh for add-on positioning
      const tileKey = `${worldTile.q},${worldTile.r}`;
      this.placedTileMeshes.set(tileKey, mesh);
      
      console.log(`✅ TILE ADDED TO SCENE\n`);
      
    } catch (error) {
      console.error(`Failed to render tile ${worldTile.tile_type}:`, error);
      
      // Fallback: create a simple hex shape (already in Three.js coordinate system)
      const geometry = new THREE.CylinderGeometry(1, 1, 0.1, 6);
      const material = this.getMaterial(tileDefinition.base_material);
      const mesh = new THREE.Mesh(geometry, material);
      
      const position = this.hexToThreeJSPosition(worldTile.q, worldTile.r, worldTile.elevation, assetPack);
      mesh.position.copy(position);
      
      this.worldGroup.add(mesh);
      
      // Cache the fallback tile mesh too
      const tileKey = `${worldTile.q},${worldTile.r}`;
      this.placedTileMeshes.set(tileKey, mesh);
    }
  }

  private async renderAddon(worldAddon: any, assetPack: AssetPack, world: World): Promise<void> {
    const addonDefinition = assetPack.addons.find(a => a.id === worldAddon.addon_id);
    if (!addonDefinition) {
      console.warn(`Addon definition '${worldAddon.addon_id}' not found`);
      return;
    }

    try {
      // Load geometry (now transformed to Three.js coordinate system)
      const geometry = await this.loadSTLModel(`assets/${addonDefinition.model}`, assetPack);
      
      // Determine material based on addon type
      let materialType = 'grass'; // default
      if (addonDefinition.tags.includes('tree')) {
        materialType = 'grass'; // Trees are green
      } else if (addonDefinition.tags.includes('rock')) {
        materialType = 'stone'; // Rocks are stone colored
      }
      
      const material = this.getMaterial(materialType);
      
      // Create mesh
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      
      // Find the actual placed tile mesh to get its real surface position
      const tileKey = `${worldAddon.q},${worldAddon.r}`;
      const tileMesh = this.placedTileMeshes.get(tileKey);
      
      let tileSurfacePosition: THREE.Vector3;
      
      if (tileMesh) {
        // Get the actual bounding box of the placed tile mesh
        const tileBox = new THREE.Box3().setFromObject(tileMesh);
        
        console.log(`🔍 DEBUGGING TILE POSITIONING FOR ADD-ON:`);
        console.log(`  Tile mesh position: (${tileMesh.position.x.toFixed(3)}, ${tileMesh.position.y.toFixed(3)}, ${tileMesh.position.z.toFixed(3)})`);
        console.log(`  Tile bounding box: min(${tileBox.min.x.toFixed(3)}, ${tileBox.min.y.toFixed(3)}, ${tileBox.min.z.toFixed(3)}), max(${tileBox.max.x.toFixed(3)}, ${tileBox.max.y.toFixed(3)}, ${tileBox.max.z.toFixed(3)})`);
        
        const tileHeight = tileBox.max.y - tileBox.min.y;
        const tileCenterY = tileMesh.position.y;
        const tileTopY = tileBox.max.y;
        const tileBottomY = tileBox.min.y;
        
        console.log(`  Tile height: ${tileHeight.toFixed(3)}`);
        console.log(`  Tile center Y: ${tileCenterY.toFixed(3)}`);
        console.log(`  Tile bottom Y: ${tileBottomY.toFixed(3)}`);  
        console.log(`  Tile top Y: ${tileTopY.toFixed(3)}`);
        
        // For add-ons, we want to place them on the top surface exactly (no offset needed)
        tileSurfacePosition = new THREE.Vector3(
          tileMesh.position.x,  // Use tile center X
          tileBox.max.y,        // Use actual top surface Y (no offset needed)
          tileMesh.position.z   // Use tile center Z
        );
        
        console.log(`  Final tile surface position: (${tileSurfacePosition.x.toFixed(3)}, ${tileSurfacePosition.y.toFixed(3)}, ${tileSurfacePosition.z.toFixed(3)})`);
      } else {
        // Fallback: calculate position if tile mesh not found
        console.warn(`⚠️  Tile mesh not found at (${worldAddon.q}, ${worldAddon.r}), using fallback positioning`);
        const tile = world.tiles.find(t => t.q === worldAddon.q && t.r === worldAddon.r);
        const tileElevation = tile ? tile.elevation : 0;
        tileSurfacePosition = this.hexToThreeJSPosition(worldAddon.q, worldAddon.r, tileElevation, assetPack);
      }
      
      // Apply local position offset using proper geometry config transformation
      const config = assetPack.geometry_config;
      const orientation = this.analyzeGeometryConfig(config);
      
      console.log(`🔧 ADD-ON LOCAL COORDINATE TRANSFORMATION:`);
      console.log(`  Pack local position: [${worldAddon.local_position.join(', ')}]`);
      console.log(`  Pack orientation: ${orientation.isPointyTop ? 'pointy-top' : 'flat-top'}, plane=${orientation.tilePlane}, up=${orientation.upAxis}${orientation.upDirection > 0 ? '+' : '-'}`);
      
      // Transform local coordinates from asset pack coordinate system to Three.js coordinate system
      const packLocalPos = new THREE.Vector3(
        worldAddon.local_position[0],
        worldAddon.local_position[1], 
        worldAddon.local_position[2]
      );
      
      let threeJSLocalPos = new THREE.Vector3();
      
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
        console.log(`  🔄 Applied Z-up → Y-up transform: [${packLocalPos.x.toFixed(3)}, ${packLocalPos.y.toFixed(3)}, ${packLocalPos.z.toFixed(3)}] → [${threeJSLocalPos.x.toFixed(3)}, ${threeJSLocalPos.y.toFixed(3)}, ${threeJSLocalPos.z.toFixed(3)}]`);
      } else if (orientation.upAxis === 'y' && orientation.upDirection === 1) {
        // Pack already uses Y-up like Three.js - no transformation needed
        threeJSLocalPos.copy(packLocalPos);
        console.log(`  ✅ No transform needed: pack already Y-up`);
      } else if (orientation.upAxis === 'x' && orientation.upDirection === 1) {
        // Asset pack is X-up, Three.js is Y-up -> apply -90° Z rotation transformation  
        // [x, y, z] -> [-y, x, z]
        threeJSLocalPos.set(-packLocalPos.y, packLocalPos.x, packLocalPos.z);
        console.log(`  🔄 Applied X-up → Y-up transform: [${packLocalPos.x.toFixed(3)}, ${packLocalPos.y.toFixed(3)}, ${packLocalPos.z.toFixed(3)}] → [${threeJSLocalPos.x.toFixed(3)}, ${threeJSLocalPos.y.toFixed(3)}, ${threeJSLocalPos.z.toFixed(3)}]`);
      } else {
        // Unsupported orientation - fallback to no transformation
        threeJSLocalPos.copy(packLocalPos);
        console.warn(`  ⚠️  Unsupported orientation for local coordinates: ${orientation.upAxis}${orientation.upDirection > 0 ? '+' : '-'}`);
      }
      
      const offsetX = threeJSLocalPos.x;
      const offsetY = threeJSLocalPos.y;
      const offsetZ = threeJSLocalPos.z;
      
      // CORRECT APPROACH: Position add-on so its BOTTOM sits on tile TOP
      // First, we need to find the add-on's bounding box to know where its bottom is
      geometry.computeBoundingBox();
      const addonBBox = geometry.boundingBox!;
      
      console.log(`📦 Add-on bounding box: min(${addonBBox.min.x.toFixed(3)}, ${addonBBox.min.y.toFixed(3)}, ${addonBBox.min.z.toFixed(3)}), max(${addonBBox.max.x.toFixed(3)}, ${addonBBox.max.y.toFixed(3)}, ${addonBBox.max.z.toFixed(3)})`);
      console.log(`📏 Add-on height: ${(addonBBox.max.y - addonBBox.min.y).toFixed(3)}`);
      console.log(`📍 Add-on bottom relative to center: ${addonBBox.min.y.toFixed(3)}`);
      
      // Calculate the Y position so that add-on bottom = tile top
      // If add-on center is at position.y, then add-on bottom is at position.y + addonBBox.min.y
      // We want: position.y + addonBBox.min.y = tileSurfacePosition.y
      // So: position.y = tileSurfacePosition.y - addonBBox.min.y
      const correctY = tileSurfacePosition.y - addonBBox.min.y + offsetY;
      
      console.log(`🧮 POSITIONING CALCULATION:`);
      console.log(`  Tile top Y: ${tileSurfacePosition.y.toFixed(3)}`);
      console.log(`  Add-on bottom offset: ${addonBBox.min.y.toFixed(3)}`);
      console.log(`  Required add-on center Y: ${(tileSurfacePosition.y - addonBBox.min.y).toFixed(3)}`);
      console.log(`  Add-on local Y offset: ${offsetY.toFixed(3)}`);
      console.log(`  Final add-on center Y: ${correctY.toFixed(3)}`);
      
      mesh.position.set(
        tileSurfacePosition.x + offsetX,
        correctY,
        tileSurfacePosition.z + offsetZ
      );
      
      console.log(`🎯 ADD-ON FINAL POSITION: (${mesh.position.x.toFixed(3)}, ${mesh.position.y.toFixed(3)}, ${mesh.position.z.toFixed(3)})`);
      console.log(`    Tile surface: (${tileSurfacePosition.x.toFixed(3)}, ${tileSurfacePosition.y.toFixed(3)}, ${tileSurfacePosition.z.toFixed(3)})`);
      console.log(`    Local offset: (${offsetX.toFixed(3)}, ${offsetY.toFixed(3)}, ${offsetZ.toFixed(3)})`);
      
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
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.renderer.dispose();
    
    // Dispose of cached materials
    this.materialCache.forEach(material => material.dispose());
    this.materialCache.clear();
    
    // Dispose of cached geometries
    this.loadedModels.forEach(geometry => geometry.dispose());
    this.loadedModels.clear();
    
    if (this.controls) {
      this.controls.dispose();
    }
  }
}