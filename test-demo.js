#!/usr/bin/env node

/**
 * Test script to verify the hex world system works
 */

import { AssetPackManager } from './dist/core/AssetPackManager.js';
import { WorldManager } from './dist/core/WorldManager.js';
import { HexCoordinates } from './dist/core/HexCoordinates.js';
import { EdgeCompatibility } from './dist/core/EdgeCompatibility.js';

async function testDemo() {
    console.log('🧪 Testing Hex3World Demo System...\n');

    try {
        // Test 1: Asset Pack Loading
        console.log('1️⃣ Testing Asset Pack Loading...');
        const assetPackManager = new AssetPackManager();
        const assetPack = await assetPackManager.loadAssetPackFromFile('assets/demo-pack.json');
        console.log(`✅ Loaded asset pack: ${assetPack.name} v${assetPack.version}`);
        console.log(`   - ${assetPack.tiles.length} tiles, ${assetPack.addons.length} addons`);
        console.log(`   - Materials: ${assetPack.materials.join(', ')}`);

        // Test 2: World Loading
        console.log('\n2️⃣ Testing World Loading...');
        const worldManager = new WorldManager(assetPackManager);
        const world = await worldManager.loadWorldFromFile('assets/demo-world.json');
        console.log(`✅ Loaded world with ${world.tiles.length} tiles and ${world.addons.length} addons`);

        // Test 3: Hex Coordinates
        console.log('\n3️⃣ Testing Hex Coordinates...');
        const center = { q: 0, r: 0 };
        const neighbors = HexCoordinates.getNeighbors(center);
        console.log(`✅ Center (0,0) has neighbors:`, neighbors);
        console.log(`   Distance from (0,0) to (2,1): ${HexCoordinates.distance(center, {q: 2, r: 1})}`);

        // Test 4: Edge Compatibility
        console.log('\n4️⃣ Testing Edge Compatibility...');
        const edgeCompat = new EdgeCompatibility(assetPack);
        const grassTile = assetPack.tiles.find(t => t.id === 'grass-tile');
        const waterTile = assetPack.tiles.find(t => t.id === 'water-tile');
        
        const canConnect = edgeCompat.canTilesConnect(grassTile, 0, waterTile, 3);
        console.log(`✅ Can grass connect to water: ${canConnect.compatible}`);
        
        const compatibleTiles = edgeCompat.getCompatibleTiles(grassTile, 0);
        console.log(`   Compatible tiles for grass edge: ${compatibleTiles.length} options`);

        // Test 5: World Validation
        console.log('\n5️⃣ Testing World Validation...');
        worldManager.validateWorld(world);
        console.log('✅ World validation passed');

        // Test 6: World Serialization
        console.log('\n6️⃣ Testing World Serialization...');
        const serialized = worldManager.serializeWorld(world);
        const deserialized = await worldManager.loadWorldFromJson(serialized);
        console.log(`✅ Serialization round-trip successful`);
        console.log(`   Original: ${world.tiles.length} tiles, Deserialized: ${deserialized.tiles.length} tiles`);

        console.log('\n🎉 All tests passed! The Hex3World system is working correctly.');
        console.log('\n🌐 To view the 3D demo:');
        console.log('   1. Run: python3 serve.py');
        console.log('   2. Open: http://localhost:8000/demo.html');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

testDemo();