import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { World, AssetPack } from '../types/index.js';
import { AssetPackManager } from '../core/AssetPackManager.js';
import { HexCoordinates } from '../core/HexCoordinates.js';

export interface RendererConfig {
  container: HTMLElement;
  width?: number;
  height?: number;
  enableControls?: boolean;
  showGrid?: boolean;
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
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    this.scene.add(ambientLight);
    
    // Directional light (sun)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -10;
    directionalLight.shadow.camera.right = 10;
    directionalLight.shadow.camera.top = 10;
    directionalLight.shadow.camera.bottom = -10;
    this.scene.add(directionalLight);
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
    
    console.log(`🔄 COORDINATE SYSTEM TRANSFORMATION:`);
    console.log(`  Pack config: tile_up_axis="${config.tile_up_axis}", parallel_edge_direction="${config.parallel_edge_direction}"`);
    console.log(`  Three.js uses: Y-up (positive Y points UP)`);
    
    if (config.tile_up_axis === 'z+') {
      console.log(`  🔄 TRANSFORM: Pack uses Z-up → Three.js uses Y-up`);
      console.log(`  🔄 APPLYING: -90° rotation around X-axis`);
      console.log(`     This should rotate Z-up → Y-up (fix upside-down issue)`);
      console.log(`     Before: Z points up, After: Y points up`);
      
      geometry.rotateX(-Math.PI / 2);
      
      console.log(`  ✅ ROTATION APPLIED`);
    } else if (config.tile_up_axis === 'y+') {
      console.log(`  ✅ NO TRANSFORM NEEDED - pack already uses Y-up like Three.js`);
    } else {
      console.warn(`  ❌ UNSUPPORTED tile_up_axis: ${config.tile_up_axis}`);
    }
    
    // TODO: Handle parallel_edge_direction if it affects individual model orientation
    console.log(`  📝 TODO: parallel_edge_direction handling not implemented yet`);
  }

  /**
   * Get or create material for a material type
   */
  private getMaterial(materialType: string): THREE.Material {
    if (this.materialCache.has(materialType)) {
      return this.materialCache.get(materialType)!;
    }

    let material: THREE.Material;

    switch (materialType) {
      case 'grass':
        material = new THREE.MeshLambertMaterial({ color: 0x228B22 });
        break;
      case 'water':
        material = new THREE.MeshLambertMaterial({ 
          color: 0x4169E1, 
          transparent: true, 
          opacity: 0.8 
        });
        break;
      case 'sand':
        material = new THREE.MeshLambertMaterial({ color: 0xF4A460 });
        break;
      case 'stone':
        material = new THREE.MeshLambertMaterial({ color: 0x696969 });
        break;
      case 'road':
        material = new THREE.MeshLambertMaterial({ color: 0x555555 });
        break;
      default:
        material = new THREE.MeshLambertMaterial({ color: 0xFFFFFF });
    }

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
  private hexToThreeJSPosition(q: number, r: number, elevation: number = 0): THREE.Vector3 {
    console.log(`🧮 HEX-TO-POSITION CONVERSION:`);
    console.log(`  Input: hex(q=${q}, r=${r}), elevation=${elevation}`);
    
    // Standard hex-to-cartesian conversion for pointy-top hexagons
    const hexX = Math.sqrt(3) * (q + r / 2);
    const hexZ = 3/2 * r;
    
    console.log(`  Hex math: X = √3 * (${q} + ${r}/2) = ${hexX.toFixed(3)}`);
    console.log(`  Hex math: Z = 3/2 * ${r} = ${hexZ.toFixed(3)}`);
    console.log(`  Y = elevation = ${elevation}`);
    
    // Three.js uses Y-up coordinate system
    const result = new THREE.Vector3(hexX, elevation, hexZ);
    console.log(`  Result: Three.js position (${result.x.toFixed(3)}, ${result.y.toFixed(3)}, ${result.z.toFixed(3)})`);
    
    return result;
  }

  /**
   * Render a world
   */
  async renderWorld(world: World): Promise<void> {
    // Clear existing world
    this.worldGroup.clear();
    
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
      const position = this.hexToThreeJSPosition(worldTile.q, worldTile.r, worldTile.elevation);
      console.log(`📍 POSITIONING TILE: hex(${worldTile.q}, ${worldTile.r}) → world(${position.x.toFixed(3)}, ${position.y.toFixed(3)}, ${position.z.toFixed(3)})`);
      
      mesh.position.copy(position);
      
      console.log(`🎯 FINAL TILE POSITION: (${mesh.position.x.toFixed(3)}, ${mesh.position.y.toFixed(3)}, ${mesh.position.z.toFixed(3)})`);
      console.log(`🎯 FINAL TILE ROTATION: (${mesh.rotation.x.toFixed(3)}, ${mesh.rotation.y.toFixed(3)}, ${mesh.rotation.z.toFixed(3)}) radians`);
      
      // Add to world group
      this.worldGroup.add(mesh);
      
      console.log(`✅ TILE ADDED TO SCENE\n`);
      
    } catch (error) {
      console.error(`Failed to render tile ${worldTile.tile_type}:`, error);
      
      // Fallback: create a simple hex shape (already in Three.js coordinate system)
      const geometry = new THREE.CylinderGeometry(1, 1, 0.1, 6);
      const material = this.getMaterial(tileDefinition.base_material);
      const mesh = new THREE.Mesh(geometry, material);
      
      const position = this.hexToThreeJSPosition(worldTile.q, worldTile.r, worldTile.elevation);
      mesh.position.copy(position);
      
      this.worldGroup.add(mesh);
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
      
      // Find the tile this addon is placed on to get its elevation and type
      const tile = world.tiles.find(t => t.q === worldAddon.q && t.r === worldAddon.r);
      const tileElevation = tile ? tile.elevation : 0;
      
      // Get tile definition and calculate actual tile height
      const tileDefinition = tile ? assetPack.tiles.find(t => t.id === tile.tile_type) : null;
      let tileHeight = 0;
      
      if (tileDefinition) {
        try {
          // Load the tile geometry to get its actual height
          const tileGeometry = await this.loadSTLModel(`assets/${tileDefinition.model}`, assetPack);
          tileGeometry.computeBoundingBox();
          if (tileGeometry.boundingBox) {
            // Get the height (Y dimension in Three.js coordinate system after transformation)
            tileHeight = tileGeometry.boundingBox.max.y - tileGeometry.boundingBox.min.y;
            console.log(`📏 Calculated tile height for ${tileDefinition.id}: ${tileHeight.toFixed(3)}`);
          }
        } catch (error) {
          console.warn(`Failed to calculate tile height for ${tileDefinition.id}, using default`);
          tileHeight = 0.1; // Fallback
        }
      }
      
      // Position the addon at the tile's base position first
      const tileBasePosition = this.hexToThreeJSPosition(worldAddon.q, worldAddon.r, tileElevation);
      
      // Create the tile surface position by adding the tile height to Y coordinate
      const tilePosition = new THREE.Vector3(
        tileBasePosition.x,
        tileBasePosition.y + tileHeight, // Add tile height to Y to get surface position
        tileBasePosition.z
      );
      
      console.log(`📍 Add-on positioning: base Y=${tileBasePosition.y.toFixed(3)}, tile height=${tileHeight.toFixed(3)}, surface Y=${tilePosition.y.toFixed(3)}`);
      
      // Apply local position offset in Three.js coordinate system
      // Convert pack-relative offsets to Three.js coordinate system
      const config = assetPack.geometry_config;
      let offsetX, offsetY, offsetZ;
      
      if (config?.tile_up_axis === 'z+') {
        // Pack coordinates: [x, y, z] -> Three.js coordinates: [x, -z, y]
        // Note: With -90° X rotation, pack Y becomes Three.js Z, pack Z becomes Three.js -Y
        offsetX = worldAddon.local_position[0];
        offsetY = -worldAddon.local_position[2]; // Pack Z becomes Three.js -Y (due to -90° rotation)
        offsetZ = worldAddon.local_position[1]; // Pack Y becomes Three.js Z
      } else {
        // Pack already uses Y-up like Three.js
        offsetX = worldAddon.local_position[0];
        offsetY = worldAddon.local_position[1];
        offsetZ = worldAddon.local_position[2];
      }
      
      mesh.position.set(
        tilePosition.x + offsetX,
        tilePosition.y + offsetY,
        tilePosition.z + offsetZ
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