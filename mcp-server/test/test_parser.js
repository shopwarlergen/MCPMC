import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import EventEmitter from 'node:events';
import {
  parseSchematic,
  generateTestSchematic,
  formatBlockState,
  isAirBlock,
  packLitematica,
  unpackLitematica,
  encodeVarInt,
  decodeVarInt,
  writeNBT,
  parseNBT,
  nbtInt,
  nbtShort,
  nbtString,
  nbtCompound,
  nbtList,
  nbtLongArray,
  nbtByteArray,
  TAG_COMPOUND
} from '../schematic-parser.js';
import {
  isAttachmentOrFragile,
  sequenceBlocks,
  createWsCaller,
  verifyStructure
} from '../schematic-printer.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    console.error(err.stack);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    console.error(err.stack);
    failed++;
  }
}

console.log('====================================================');
console.log('Running Schematic Parser Test Suite (Tier 1 & Tier 2)');
console.log('====================================================\n');

// ----------------------------------------------------
// Test Group 1: Helper Functions (VarInt & Bit Packing)
// ----------------------------------------------------
console.log('--- Test Group 1: Primitive Encoders & Decoders ---');

test('VarInt roundtrip single-byte and multi-byte values', () => {
  const values = [0, 1, 63, 127, 128, 255, 300, 16384, 2097151];
  for (const v of values) {
    const enc = encodeVarInt(v);
    const { value: dec, bytesRead } = decodeVarInt(enc, 0);
    assert.strictEqual(dec, v, `VarInt mismatch for ${v}`);
    assert.strictEqual(bytesRead, enc.length, `VarInt bytesRead mismatch for ${v}`);
  }
});

test('Litematica bit-packing and unpacking across 64-bit boundaries', () => {
  for (const bits of [2, 3, 5, 7, 9]) {
    const maxVal = (1 << bits) - 1;
    const count = 50;
    const testIndices = [];
    for (let i = 0; i < count; i++) {
      testIndices.push((i * 7 + 3) % (maxVal + 1));
    }
    const packed = packLitematica(testIndices, bits);
    const unpacked = unpackLitematica(packed, count, bits);
    assert.deepStrictEqual(unpacked, testIndices, `Bit unpack failed for bit width ${bits}`);
  }
});

test('formatBlockState canonical sorting and prefixing', () => {
  assert.strictEqual(formatBlockState('stone', {}), 'minecraft:stone');
  assert.strictEqual(formatBlockState('minecraft:stone', null), 'minecraft:stone');
  assert.strictEqual(
    formatBlockState('oak_stairs', { half: 'bottom', facing: 'east', shape: 'straight' }),
    'minecraft:oak_stairs[facing=east,half=bottom,shape=straight]'
  );
});

test('isAirBlock recognition', () => {
  assert.strictEqual(isAirBlock('minecraft:air'), true);
  assert.strictEqual(isAirBlock('minecraft:cave_air'), true);
  assert.strictEqual(isAirBlock('minecraft:void_air'), true);
  assert.strictEqual(isAirBlock('minecraft:stone'), false);
  assert.strictEqual(isAirBlock('minecraft:oak_planks'), false);
});

// ----------------------------------------------------
// Test Group 2: Synthetic Litematica Parsing
// ----------------------------------------------------
console.log('\n--- Test Group 2: Synthetic Litematica (.litematic) ---');

test('Generate and parse synthetic .litematic multi-block structure', () => {
  const buf = generateTestSchematic('litematic');
  assert.ok(Buffer.isBuffer(buf), 'Generated schematic should be a Buffer');
  assert.ok(buf.length > 50, 'Buffer should have content');

  const parsed = parseSchematic(buf);
  assert.strictEqual(parsed.format, 'litematic');
  assert.strictEqual(parsed.width, 3);
  assert.strictEqual(parsed.height, 3);
  assert.strictEqual(parsed.length, 3);
  assert.strictEqual(parsed.totalBlocks, 27);
  assert.strictEqual(parsed.nonAirBlocks, 26); // exactly 1 air block inside (1,1,1)

  // Verify specific blocks
  const baseCenter = parsed.blocks.find(b => b.x === 1 && b.y === 0 && b.z === 1);
  assert.ok(baseCenter, 'Base center block exists');
  assert.strictEqual(baseCenter.blockState, 'minecraft:smooth_stone');

  const interiorAir = parsed.blocks.find(b => b.x === 1 && b.y === 1 && b.z === 1);
  assert.ok(interiorAir, 'Interior air block exists');
  assert.strictEqual(interiorAir.isAir, true);

  const glassWindow = parsed.blocks.find(b => b.x === 1 && b.y === 1 && b.z === 0);
  assert.ok(glassWindow, 'Glass block exists');
  assert.strictEqual(glassWindow.blockState, 'minecraft:glass');

  const stairRoof = parsed.blocks.find(b => b.x === 0 && b.y === 2 && b.z === 0);
  assert.ok(stairRoof, 'Stair block exists');
  assert.strictEqual(
    stairRoof.blockState,
    'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]'
  );
});

// ----------------------------------------------------
// Test Group 3: Synthetic Sponge Parsing
// ----------------------------------------------------
console.log('\n--- Test Group 3: Synthetic Sponge (.schem) ---');

test('Generate and parse synthetic .schem multi-block structure', () => {
  const buf = generateTestSchematic('schem');
  assert.ok(Buffer.isBuffer(buf), 'Generated schematic should be a Buffer');

  const parsed = parseSchematic(buf);
  assert.strictEqual(parsed.format, 'schem');
  assert.strictEqual(parsed.width, 3);
  assert.strictEqual(parsed.height, 3);
  assert.strictEqual(parsed.length, 3);
  assert.strictEqual(parsed.totalBlocks, 27);
  assert.strictEqual(parsed.nonAirBlocks, 26);

  const slabBlock = parsed.blocks.find(b => b.x === 1 && b.y === 1 && b.z === 2);
  assert.ok(slabBlock, 'Slab block exists');
  assert.strictEqual(slabBlock.blockState, 'minecraft:oak_slab[type=bottom,waterlogged=false]');

  const interiorAir = parsed.blocks.find(b => b.x === 1 && b.y === 1 && b.z === 1);
  assert.ok(interiorAir, 'Interior air exists');
  assert.strictEqual(interiorAir.isAir, true);
});

// ----------------------------------------------------
// Test Group 4: Real-World Schematic Parsing
// ----------------------------------------------------
console.log('\n--- Test Group 4: Real-World Schematics ---');

const realSchematicPath = 'D:/ModrinthApp/profiles/1.21.11/schematics/test lava.litematic';

test('Parse real-world test lava.litematic file', () => {
  if (!fs.existsSync(realSchematicPath)) {
    console.log('    [SKIP] test lava.litematic not found on disk');
    return;
  }
  const parsed = parseSchematic(realSchematicPath);
  assert.strictEqual(parsed.format, 'litematic');
  assert.strictEqual(parsed.width, 3);
  assert.strictEqual(parsed.height, 2);
  assert.strictEqual(parsed.length, 5);
  assert.strictEqual(parsed.totalBlocks, 30);
  assert.strictEqual(parsed.nonAirBlocks, 15);

  // Check palette
  assert.ok(parsed.palette.includes('minecraft:cobbled_deepslate'));
  assert.ok(parsed.palette.some(p => p.startsWith('minecraft:lava')));

  // Check negative coordinate normalization
  assert.ok(parsed.blocks.every(b => b.x >= 0 && b.x < 3));
  assert.ok(parsed.blocks.every(b => b.y >= 0 && b.y < 2));
  assert.ok(parsed.blocks.every(b => b.z >= 0 && b.z < 5));
});

// ----------------------------------------------------
// Test Group 5: Boundary & Error Conditions
// ----------------------------------------------------
console.log('\n--- Test Group 5: Boundary & Error Handling ---');

test('Negative region dimension normalization formula', () => {
  // Region with negative size: pos = {x: 5, y: 10, z: -2}, size = {x: -3, y: -4, z: 2}
  // min corner should be: x = 5 + (-3) + 1 = 3, y = 10 + (-4) + 1 = 7, z = -2
  // dimensions should be: 3, 4, 2
  const fakeRegion = {
    Position: nbtCompound({ x: nbtInt(5), y: nbtInt(10), z: nbtInt(-2) }),
    Size: nbtCompound({ x: nbtInt(-3), y: nbtInt(-4), z: nbtInt(2) }),
    BlockStatePalette: nbtList(TAG_COMPOUND, [
      nbtCompound({ Name: nbtString('minecraft:stone') })
    ]),
    BlockStates: nbtLongArray(new BigInt64Array(1))
  };

  const fakeLitematic = {
    Version: nbtInt(7),
    MinecraftDataVersion: nbtInt(4671),
    Metadata: nbtCompound({
      Name: nbtString("NegDimTest"),
      RegionCount: nbtInt(1)
    }),
    Regions: nbtCompound({
      NegRegion: nbtCompound(fakeRegion)
    })
  };

  const serialized = writeNBT("Litematica", fakeLitematic);
  const parsed = parseSchematic(serialized);
  assert.strictEqual(parsed.width, 3);
  assert.strictEqual(parsed.height, 4);
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed.totalBlocks, 24);
  assert.strictEqual(parsed.nonAirBlocks, 24);
  assert.ok(parsed.blocks.every(b => b.x >= 0 && b.x < 3));
  assert.ok(parsed.blocks.every(b => b.y >= 0 && b.y < 4));
  assert.ok(parsed.blocks.every(b => b.z >= 0 && b.z < 2));
});

test('Error on missing file', () => {
  assert.throws(() => {
    parseSchematic('D:/non_existent_path_to_schematic.litematic');
  }, /Schematic file not found/);
});

test('Error on invalid/corrupted NBT buffer', () => {
  assert.throws(() => {
    parseSchematic(Buffer.from([1, 2, 3, 4, 5]));
  }, /Expected root tag 10/);
});

test('Error on unrecognized schematic root', () => {
  const dummyNBT = writeNBT("Unknown", { Foo: nbtString("Bar") });
  assert.throws(() => {
    parseSchematic(dummyNBT);
  }, /Unrecognized schematic format/);
});

test('Reject negative or zero dimensions in Sponge schematics', () => {
  const invalidDims = [
    { width: 0, height: 3, length: 3 },
    { width: 3, height: -1, length: 3 },
    { width: 3, height: 3, length: 0 }
  ];

  for (const { width, height, length } of invalidDims) {
    const schemCompound = {
      Width: nbtShort(width),
      Height: nbtShort(height),
      Length: nbtShort(length),
      Palette: nbtCompound({ 'minecraft:stone': nbtInt(0) }),
      BlockData: nbtByteArray(Buffer.from([0]))
    };
    const serialized = writeNBT("Schematic", schemCompound);
    assert.throws(() => {
      parseSchematic(serialized);
    }, /Invalid Sponge schematic dimensions/);
  }
});

test('Decompression fallback supports zlib.inflateSync', () => {
  const buf = generateTestSchematic('schem');
  // Decompress the gzip buffer to get raw NBT
  const rawNbt = zlib.gunzipSync(buf);
  // Compress using zlib.deflateSync (zlib/deflate format, not gzip)
  const deflatedNbt = zlib.deflateSync(rawNbt);
  const parsed = parseSchematic(deflatedNbt);
  assert.strictEqual(parsed.format, 'schem');
  assert.strictEqual(parsed.totalBlocks, 27);
  assert.strictEqual(parsed.nonAirBlocks, 26);
});

// ----------------------------------------------------
// Test Group 6: Attachment Classification & Placement Sequencing
// ----------------------------------------------------
console.log('\n--- Test Group 6: Attachment Classification & Placement Sequencing ---');

test('isAttachmentOrFragile returns false for solid blocks override and true for delicate plants/attachments', () => {
  // Must return false for solid overrides
  assert.strictEqual(isAttachmentOrFragile('minecraft:bedrock'), false, 'bedrock should be solid (false)');
  assert.strictEqual(isAttachmentOrFragile('minecraft:redstone_block'), false, 'redstone_block should be solid (false)');
  assert.strictEqual(isAttachmentOrFragile('minecraft:redstone_lamp'), false, 'redstone_lamp should be solid (false)');
  assert.strictEqual(isAttachmentOrFragile('minecraft:redstone_ore'), false, 'redstone_ore should be solid (false)');
  assert.strictEqual(isAttachmentOrFragile('minecraft:deepslate_redstone_ore'), false, 'deepslate_redstone_ore should be solid (false)');
  assert.strictEqual(isAttachmentOrFragile('minecraft:grass_block'), false, 'grass_block should be solid (false)');
  assert.strictEqual(isAttachmentOrFragile('minecraft:amethyst_block'), false, 'amethyst_block should be solid (false)');
  assert.strictEqual(isAttachmentOrFragile('minecraft:budding_amethyst'), false, 'budding_amethyst should be solid (false)');

  // Must return true for flora, crops, and attachments
  assert.strictEqual(isAttachmentOrFragile('minecraft:dandelion'), true, 'dandelion should be fragile/attachment (true)');
  assert.strictEqual(isAttachmentOrFragile('minecraft:poppy'), true, 'poppy should be fragile/attachment (true)');
  assert.strictEqual(isAttachmentOrFragile('minecraft:wheat[age=7]'), true, 'wheat should be fragile/crop (true)');
  assert.strictEqual(isAttachmentOrFragile('minecraft:cactus'), true, 'cactus should be fragile/attachment (true)');
  assert.strictEqual(isAttachmentOrFragile('minecraft:lever[face=wall]'), true, 'lever should be attachment (true)');
  assert.strictEqual(isAttachmentOrFragile('minecraft:torch'), true, 'torch should be attachment (true)');
  assert.strictEqual(isAttachmentOrFragile('minecraft:white_bed[part=foot]'), true, 'bed should be attachment (true)');
});

test('Confirm supporting wall at same Y (redstone_block at Z=5, lever at Z=4) is sequenced with the wall block placed first', () => {
  const blocks = [
    { x: 0, y: 0, z: 4, blockState: 'minecraft:lever[face=wall,facing=north]', isAir: false },
    { x: 0, y: 0, z: 5, blockState: 'minecraft:redstone_block', isAir: false }
  ];
  const sequenced = sequenceBlocks(blocks, true);
  assert.strictEqual(sequenced.length, 2);
  assert.strictEqual(sequenced[0].blockState, 'minecraft:redstone_block', 'Solid wall block should be sequenced first');
  assert.strictEqual(sequenced[0].z, 5);
  assert.strictEqual(sequenced[1].blockState, 'minecraft:lever[face=wall,facing=north]', 'Attachment lever should be sequenced second');
  assert.strictEqual(sequenced[1].z, 4);
});

test('createWsCaller does not duplicate message listeners on same raw WebSocket', () => {
  const fakeWs = new EventEmitter();
  fakeWs.readyState = 1;
  const caller1 = createWsCaller(fakeWs);
  const caller2 = createWsCaller(fakeWs);
  assert.strictEqual(caller1, caller2, 'Repeated calls must return same caller instance');
  assert.strictEqual(fakeWs.listenerCount('message'), 1, 'Only 1 message listener should be registered on raw WebSocket');
});

await testAsync('verifyStructure treats missing expected properties as mismatch', async () => {
  const fakeWs = {
    sendWsRequest: async (method, params) => {
      if (method === 'get_block_context') {
        return {
          target: {
            blockId: 'minecraft:oak_stairs',
            properties: { half: 'bottom' } // missing 'facing' and 'shape'
          }
        };
      }
      return {};
    }
  };
  const fakeSchem = {
    blocks: [
      { x: 0, y: 0, z: 0, blockState: 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight]', isAir: false }
    ]
  };
  const res = await verifyStructure(fakeWs, fakeSchem, 0, 0, 0, { queryDelayMs: 0 });
  assert.strictEqual(res.passed, false, 'Should fail verification due to missing properties');
  assert.strictEqual(res.mismatchedCount, 1, 'Should record 1 mismatch');
});

console.log('\n====================================================');
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('====================================================');

if (failed > 0) {
  process.exit(1);
}
