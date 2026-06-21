/**
 * Manual test: TradeUp Simulator Engine
 * Run with: npx tsx tests/manual/test-simulator.ts
 */
import { simulateTradeUp, type SimInputItem } from '../../src/main/services/tradeup-simulator';

// Helper: create a test item
function makeItem(overrides: Partial<SimInputItem> = {}): SimInputItem {
  return {
    name: 'Test Skin',
    rarity: '军规级',
    rarityZh: '军规级',
    paintIndex: 44,
    defIndex: 7,
    wearFloat: 0.12,
    minFloat: 0.00,
    maxFloat: 0.70,
    collection: 'The Overpass Collection',
    isStatTrak: false,
    isSouvenir: false,
    ...overrides,
  };
}

function assert(condition: boolean, msg: string) {
  console.log(`   ${condition ? '✅' : '❌'} ${msg}`);
  if (!condition) process.exitCode = 1;
}

console.log('=== TradeUp Simulator Test ===\n');

// Test 1: Valid simulation — 10 identical items
console.log('1. Valid simulation (10 identical Mil-Spec items)...');
const items1 = Array.from({ length: 10 }, () => makeItem());
const result1 = simulateTradeUp(items1);
assert(result1.success, 'Should succeed');
assert(result1.targetRarityZh === '受限级', `Target rarity should be 受限级, got: ${result1.targetRarityZh}`);
assert(result1.collectionsUsed.length === 1, `Should use 1 collection, got: ${result1.collectionsUsed.length}`);
assert(result1.outcomes.length > 0, `Should have outcomes, got: ${result1.outcomes.length}`);
assert(Math.abs(result1.avgWearNorm - 0.17) < 0.02, `Wear norm ~0.17, got: ${result1.avgWearNorm.toFixed(4)}`);
console.log(`   → Target: ${result1.targetRarityZh}, Collections: ${result1.collectionsUsed.length}, Outcomes: ${result1.outcomes.length}, AvgNorm: ${(result1.avgWearNorm * 100).toFixed(1)}%`);

// Test 2: Not enough items
console.log('\n2. Validation: insufficient items...');
const result2 = simulateTradeUp(items1.slice(0, 5));
assert(!result2.success, 'Should fail with < 10 items');
assert(result2.error?.includes('10'), `Error should mention 10, got: ${result2.error}`);

// Test 3: Mixed rarities
console.log('\n3. Validation: mixed rarities...');
const items3 = [
  ...Array.from({ length: 5 }, () => makeItem()),
  ...Array.from({ length: 5 }, () => makeItem({ rarity: '受限级', rarityZh: '受限级' })),
];
const result3 = simulateTradeUp(items3);
assert(!result3.success, 'Should fail with mixed rarities');
assert(result3.error?.includes('同一稀有度'), `Error should mention same rarity, got: ${result3.error}`);

// Test 4: StatTrak simulation
console.log('\n4. StatTrak simulation...');
const items4 = Array.from({ length: 10 }, () => makeItem({ isStatTrak: true }));
const result4 = simulateTradeUp(items4);
assert(result4.success, 'Should succeed');
assert(result4.allStatTrak, 'Should detect all StatTrak');

// Test 5: Mixed StatTrak + non-StatTrak
console.log('\n5. Validation: mixed StatTrak...');
const items5 = [
  ...Array.from({ length: 5 }, () => makeItem()),
  ...Array.from({ length: 5 }, () => makeItem({ isStatTrak: true })),
];
const result5 = simulateTradeUp(items5);
assert(!result5.success, 'Should fail with mixed StatTrak');

// Test 6: Multi-collection
console.log('\n6. Multi-collection simulation...');
const items6 = [
  ...Array.from({ length: 5 }, () => makeItem({ collection: 'The Overpass Collection' })),
  ...Array.from({ length: 5 }, () => makeItem({ collection: 'The Cobblestone Collection' })),
];
const result6 = simulateTradeUp(items6);
assert(result6.success, 'Should succeed');
assert(result6.collectionsUsed.length === 2, `Should use 2 collections, got: ${result6.collectionsUsed.length}`);
// Total probability should be ~1.0
const totalProb = result6.outcomes.reduce((s, o) => s + o.probability, 0);
assert(Math.abs(totalProb - 1.0) < 0.01, `Total probability should be ~1.0, got: ${totalProb.toFixed(3)}`);

// Test 7: Float normalization (edge cases)
console.log('\n7. Float normalization...');
const items7 = Array.from({ length: 10 }, () => makeItem({
  wearFloat: 0.00,  // Best possible
}));
const result7 = simulateTradeUp(items7);
assert(Math.abs(result7.avgWearNorm) < 0.01, `Min wear norm should be ~0, got: ${result7.avgWearNorm.toFixed(4)}`);

const items7b = Array.from({ length: 10 }, () => makeItem({
  wearFloat: 0.70,  // Worst possible for this skin (max=0.70)
}));
const result7b = simulateTradeUp(items7b);
assert(Math.abs(result7b.avgWearNorm - 1.0) < 0.01, `Max wear norm should be ~1, got: ${result7b.avgWearNorm.toFixed(4)}`);

// Test 8: Top rarity cannot be traded up
console.log('\n8. Validation: top rarity...');
const items8 = Array.from({ length: 10 }, () => makeItem({ rarity: '隐秘级', rarityZh: '隐秘级' }));
const result8 = simulateTradeUp(items8);
assert(!result8.success, 'Should fail — 隐秘级 cannot trade up');

// Test 9: Probability distribution
console.log('\n9. Probability distribution...');
const items9 = [
  ...Array.from({ length: 7 }, () => makeItem({ collection: 'Collection A' })),
  ...Array.from({ length: 3 }, () => makeItem({ collection: 'Collection B' })),
];
const result9 = simulateTradeUp(items9);
const probsByColl: Record<string, number> = {};
for (const o of result9.outcomes) {
  probsByColl[o.collection] = (probsByColl[o.collection] || 0) + o.probability;
}
assert(Math.abs((probsByColl['Collection A'] || 0) - 0.7) < 0.01, `Coll A should be 0.7, got: ${probsByColl['Collection A']?.toFixed(3)}`);
assert(Math.abs((probsByColl['Collection B'] || 0) - 0.3) < 0.01, `Coll B should be 0.3, got: ${probsByColl['Collection B']?.toFixed(3)}`);

console.log('\n=== Simulator Test: ' + (process.exitCode ? 'FAILURES FOUND' : 'ALL PASSED') + ' ===');
