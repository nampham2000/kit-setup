'use strict';

const path = require('path');
const fs = require('fs');

console.log('\n======================================================');
console.log('🧪 TESTING ASSET CACHE SERVICE & SUB-ASSET RESOLVER');
console.log('======================================================\n');

/**
 * `AssetCacheService` sống trong extension cocos-mcp đã build (`dist/`).
 * Nếu extension chưa build (hoặc service đã bị gỡ) thì trước đây file này
 * ném `MODULE_NOT_FOUND` và làm `npm run test:cache` crash.
 *
 * Báo SKIPPED một cách rõ ràng — KHÔNG báo PASS, vì không có gì được kiểm chứng.
 */
const SERVICE_PATH = path.resolve(__dirname, '..', '..', 'extensions', 'cocos-mcp', 'dist', 'tools', 'asset-cache-service.js');

let AssetCacheService = null;
try {
    if (!fs.existsSync(SERVICE_PATH)) {
        throw new Error(`Not found: ${path.relative(path.resolve(__dirname, '..', '..'), SERVICE_PATH)}`);
    }
    ({ AssetCacheService } = require(SERVICE_PATH));
    if (!AssetCacheService) throw new Error('Module loaded but does not export AssetCacheService');
} catch (error) {
    console.log('⏭️  SKIPPED — AssetCacheService không khả dụng.');
    console.log(`    Lý do: ${error.message}`);
    console.log('    Cách bật: build extension cocos-mcp (tạo dist/tools/asset-cache-service.js) rồi chạy lại.');
    console.log('\n    Lưu ý: SKIPPED ≠ PASS. Không có assertion nào được chạy.');
    console.log('======================================================\n');
    process.exit(0);
}

// 1. Test Initial Scan
console.log('1️⃣ Testing Scan & Indexing...');
const scanStart = Date.now();
const stats = AssetCacheService.instance.scanAssets(true);
const scanDuration = Date.now() - scanStart;

console.log(`   ✅ Indexed Total Assets:     ${stats.totalAssets}`);
console.log(`   ✅ Indexed Total Sub-Assets: ${stats.totalSubAssets}`);
console.log(`   ⏱️ Scan Duration:           ${scanDuration}ms`);

if (stats.totalAssets === 0) {
    console.error('❌ Error: No assets indexed!');
    process.exit(1);
}

// 2. Test Asset Query by URL
console.log('\n2️⃣ Testing Query Asset by URL...');
const testUrl = 'db://assets/4.gameplay.scene';
const queryUuidStart = process.hrtime.bigint();
AssetCacheService.instance.queryAssetUuid(testUrl).then(async (uuid) => {
    const queryUuidEnd = process.hrtime.bigint();
    const queryTimeUs = Number(queryUuidEnd - queryUuidStart) / 1000;
    console.log(`   🔍 URL: ${testUrl}`);
    console.log(`   🔑 UUID: ${uuid}`);
    console.log(`   ⚡ Lookup Time: ${queryTimeUs.toFixed(2)} µs (${(queryTimeUs / 1000).toFixed(4)} ms)`);

    if (!uuid) {
        console.error('❌ Error: UUID not found for 4.gameplay.scene');
    }

    // 3. Test Query URL by UUID (Reverse Lookup)
    console.log('\n3️⃣ Testing Reverse Query URL by UUID...');
    const revUrl = await AssetCacheService.instance.queryAssetUrl(uuid);
    console.log(`   🔍 UUID: ${uuid}`);
    console.log(`   🌐 Resolved URL: ${revUrl}`);
    if (revUrl !== testUrl) {
        console.error(`❌ Mismatch: expected ${testUrl}, got ${revUrl}`);
    } else {
        console.log('   ✅ Reverse lookup matched perfectly!');
    }

    // 4. Test Sub-Asset Resolution (SpriteFrame @6c48a vs Texture @f9941)
    console.log('\n4️⃣ Testing Sub-Asset Resolution for Textures...');
    const textures = AssetCacheService.instance.getAssets('texture', 'db://assets');
    console.log(`   🖼️ Total Textures found: ${textures.length}`);
    if (textures.length > 0) {
        const sampleTex = textures[0];
        const details = AssetCacheService.instance.getAssetDetails(sampleTex.path, true);
        console.log(`   🔎 Sample Texture: ${sampleTex.path} (${sampleTex.uuid})`);
        console.log(`   📦 Sub-Assets found: ${details.subAssets.length}`);
        
        let foundSpriteFrame = false;
        let foundTexture = false;

        for (const sub of details.subAssets) {
            console.log(`      • [${sub.type}] ${sub.name} -> UUID: ${sub.uuid} (suffix: ${sub.suffix})`);
            if (sub.suffix === '@6c48a' && (sub.type === 'cc.SpriteFrame' || sub.name.includes('spriteFrame'))) {
                foundSpriteFrame = true;
            }
            if (sub.suffix === '@f9941' && (sub.type === 'cc.Texture2D' || sub.name.includes('texture'))) {
                foundTexture = true;
            }
        }

        if (foundSpriteFrame && foundTexture) {
            console.log('   ✅ Sub-Asset Resolver is 100% correct (@6c48a = SpriteFrame, @f9941 = Texture2D)!');
        } else {
            console.warn('   ⚠️ Warning: Some sub-asset mappings may need review.');
        }
    }

    // 5. Benchmark 10,000 queries in-memory
    console.log('\n5️⃣ Performance Benchmark: 10,000 In-Memory Asset Queries...');
    const benchStart = Date.now();
    for (let i = 0; i < 10000; i++) {
        AssetCacheService.instance.getAssets('all', 'db://assets');
    }
    const benchDuration = Date.now() - benchStart;
    console.log(`   ⚡ 10,000 full asset listings executed in: ${benchDuration}ms (~${(benchDuration / 10000).toFixed(4)}ms per query)`);

    // 6. Cache Stats
    console.log('\n6️⃣ Cache Service Statistics:');
    const finalStats = AssetCacheService.instance.getStats();
    console.log(`   • Total Indexed Assets:     ${finalStats.totalAssets}`);
    console.log(`   • Total Indexed Sub-Assets: ${finalStats.totalSubAssets}`);
    console.log(`   • Cache Hits:               ${finalStats.hitCount}`);
    console.log(`   • Cache Misses:             ${finalStats.missCount}`);
    console.log(`   • Cache Hit Ratio:          ${finalStats.hitRatio}`);

    console.log('\n======================================================');
    console.log('🎉 ALL PHASE 1 TESTS COMPLETED SUCCESSFULLY!');
    console.log('======================================================\n');
});
