import assert from 'node:assert';
import WebSocket from 'ws';
import {
  generateTestSchematic,
  parseSchematic
} from '../schematic-parser.js';
import {
  printSchematic,
  verifyStructure,
  createWsCaller,
  sequenceBlocks
} from '../schematic-printer.js';

const WS_URL = process.env.MC_MCP_WS_URL || "ws://127.0.0.1:8765";

// Safe coordinates from TEST_INFRA.md and explorer survey
const SAFE_X = -65;
const SAFE_Y = -58;
const SAFE_Z = -15;

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    console.log(`\n▶ Running Scenario: ${name}`);
    await fn();
    console.log(`  ✔ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✖ [FAIL] ${name}: ${err.message}`);
    console.error(err.stack);
    failed++;
  }
}

async function main() {
  console.log('================================================================');
  console.log('Autonomous In-Game Schematic Printer Test Suite (Live Game E2E)');
  console.log(`Target WebSocket: ${WS_URL}`);
  console.log(`Safe Test Coordinates: X=${SAFE_X}, Y=${SAFE_Y}, Z=${SAFE_Z}`);
  console.log('================================================================');

  // Establish WebSocket connection to live Minecraft client
  const ws = new WebSocket(WS_URL);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out connecting to Minecraft WebSocket at ${WS_URL}`));
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      console.log(`Connected to live Minecraft bridge on ${WS_URL}`);
      resolve();
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket connection error: ${err.message}`));
    });
  });

  const rpc = createWsCaller(ws);

  // Pre-flight check: ensure player is in world and get coordinates
  const playerStatus = await rpc('get_player_status', {});
  console.log(`Player '${playerStatus.rotation?.facing || 'unknown'}' in world at (${playerStatus.position.x}, ${playerStatus.position.y}, ${playerStatus.position.z})`);

  // Generate synthetic test schematics
  console.log('\nGenerating synthetic test schematics...');
  const litematicBuf = generateTestSchematic('litematic');
  const schemBuf = generateTestSchematic('schem');
  const parsedLitematic = parseSchematic(litematicBuf);
  const parsedSchem = parseSchematic(schemBuf);
  console.log(`Litematic: ${parsedLitematic.width}x${parsedLitematic.height}x${parsedLitematic.length}, total: ${parsedLitematic.totalBlocks}, nonAir: ${parsedLitematic.nonAirBlocks}`);
  console.log(`Sponge: ${parsedSchem.width}x${parsedSchem.height}x${parsedSchem.length}, total: ${parsedSchem.totalBlocks}, nonAir: ${parsedSchem.nonAirBlocks}`);

  // Scenario 1: Dry-run printing mode
  await runTest('Scenario 1: Dry-run mode produces placement plan without world modifications', async () => {
    const dryRunResult = await printSchematic(ws, parsedLitematic, SAFE_X, SAFE_Y, SAFE_Z, {
      dryRun: true,
      skipAir: true
    });

    assert.strictEqual(dryRunResult.dryRun, true);
    assert.strictEqual(dryRunResult.dimensions.width, 3);
    assert.strictEqual(dryRunResult.dimensions.height, 3);
    assert.strictEqual(dryRunResult.dimensions.length, 3);
    assert.strictEqual(dryRunResult.totalBlocks, 27);
    assert.strictEqual(dryRunResult.skippedAirCount, 1);
    assert.strictEqual(dryRunResult.placedCount, 0, 'dryRun should place 0 blocks');
  });

  // Scenario 2: Pre-clear bounding box and verify air volume
  await runTest('Scenario 2: Clear area prior to placement and verify air replacement', async () => {
    // Place a marker block at safe coords
    await rpc('send_chat_or_command', {
      message: `/setblock ${SAFE_X} ${SAFE_Y} ${SAFE_Z} minecraft:dirt replace`
    });
    // Pacing delay to let Minecraft tick process placement command (safe for 10 FPS tickrate)
    await new Promise(r => setTimeout(r, 500));

    // Check block is dirt
    let checkDirt = await rpc('get_block_context', { x: SAFE_X, y: SAFE_Y, z: SAFE_Z });
    if (checkDirt.target?.blockId !== 'minecraft:dirt') {
      await new Promise(r => setTimeout(r, 300));
      checkDirt = await rpc('get_block_context', { x: SAFE_X, y: SAFE_Y, z: SAFE_Z });
    }
    assert.strictEqual(checkDirt.target?.blockId, 'minecraft:dirt', 'Marker dirt block should be present');

    // Clear test envelope using fill air
    await rpc('send_chat_or_command', {
      message: `/fill ${SAFE_X} ${SAFE_Y} ${SAFE_Z} ${SAFE_X + 2} ${SAFE_Y + 2} ${SAFE_Z + 2} minecraft:air`
    });
    // Pacing delay to let Minecraft tick process fill command and update client world
    await new Promise(r => setTimeout(r, 500));

    // Check marker is now air
    let checkAir = await rpc('get_block_context', { x: SAFE_X, y: SAFE_Y, z: SAFE_Z });
    if (checkAir.target?.blockId !== 'minecraft:air') {
      await new Promise(r => setTimeout(r, 300));
      checkAir = await rpc('get_block_context', { x: SAFE_X, y: SAFE_Y, z: SAFE_Z });
    }
    assert.strictEqual(checkAir.target?.blockId, 'minecraft:air', 'Marker position should now be air');
  });

  // Scenario 3: End-to-End Print & Verification of Litematica Structure
  await runTest('Scenario 3: Print synthetic Litematica structure and verify 100% placement fidelity', async () => {
    console.log(`  Printing synthetic Litematica structure at (${SAFE_X}, ${SAFE_Y}, ${SAFE_Z})...`);
    const printResult = await printSchematic(ws, parsedLitematic, SAFE_X, SAFE_Y, SAFE_Z, {
      skipAir: true,
      clearArea: true,
      delayMs: 120,
      maxRetries: 3
    });

    console.log(`  Print completed: placed ${printResult.placedCount} blocks, skipped ${printResult.skippedAirCount} air, ${printResult.retriedCount} retries, duration: ${printResult.durationMs}ms`);
    assert.strictEqual(printResult.success, true, 'Print should succeed');
    assert.strictEqual(printResult.placedCount, 26, 'Should place all 26 non-air blocks');
    assert.strictEqual(printResult.failedBlocks.length, 0, 'Zero failed blocks');

    // Explicit post-placement drain pause before verification to ensure game loop commits all blocks
    await new Promise(r => setTimeout(r, 500));

    console.log('  Verifying structure via get_block_context...');
    const verifyResult = await verifyStructure(ws, parsedLitematic, SAFE_X, SAFE_Y, SAFE_Z, {
      skipAir: true,
      queryDelayMs: 10
    });

    console.log(`  Verification result: matched ${verifyResult.matchedCount}/${verifyResult.totalExpected} blocks (Accuracy: ${verifyResult.accuracy}%)`);
    if (verifyResult.mismatches.length > 0) {
      console.error('  Mismatches:', JSON.stringify(verifyResult.mismatches, null, 2));
    }
    assert.strictEqual(verifyResult.passed, true, 'All blocks must pass verification');
    assert.strictEqual(verifyResult.accuracy, 100, 'Placement accuracy must be 100%');
    assert.strictEqual(verifyResult.mismatchedCount, 0, 'Zero block mismatches');
  });

  // Scenario 4: End-to-End Print & Verification of Sponge Structure
  await runTest('Scenario 4: Print synthetic Sponge structure and verify 100% placement fidelity', async () => {
    // Offset slightly by +5 blocks on Z for clean separation
    const spongeZ = SAFE_Z + 5;
    console.log(`  Printing synthetic Sponge structure at (${SAFE_X}, ${SAFE_Y}, ${spongeZ})...`);
    const printResult = await printSchematic(ws, parsedSchem, SAFE_X, SAFE_Y, spongeZ, {
      skipAir: true,
      clearArea: true,
      delayMs: 120,
      maxRetries: 3
    });

    assert.strictEqual(printResult.success, true);
    assert.strictEqual(printResult.placedCount, 26);
    assert.strictEqual(printResult.failedBlocks.length, 0);

    // Explicit post-placement drain pause before verification to ensure game loop commits all blocks
    await new Promise(r => setTimeout(r, 500));

    console.log('  Verifying Sponge structure via get_block_context...');
    const verifyResult = await verifyStructure(ws, parsedSchem, SAFE_X, SAFE_Y, spongeZ, {
      skipAir: true,
      queryDelayMs: 10
    });

    console.log(`  Verification result: matched ${verifyResult.matchedCount}/${verifyResult.totalExpected} blocks (Accuracy: ${verifyResult.accuracy}%)`);
    assert.strictEqual(verifyResult.passed, true);
    assert.strictEqual(verifyResult.accuracy, 100);
    assert.strictEqual(verifyResult.mismatchedCount, 0);

    // Clean up sponge structure
    await rpc('send_chat_or_command', {
      message: `/fill ${SAFE_X} ${SAFE_Y} ${spongeZ} ${SAFE_X + 2} ${SAFE_Y + 2} ${spongeZ + 2} minecraft:air`
    });
  });

  // Scenario 5: Cleanup and tear-down verification
  await runTest('Scenario 5: Cleanup test envelope and confirm zero residual blocks', async () => {
    // Clear both test envelopes
    await rpc('send_chat_or_command', {
      message: `/fill ${SAFE_X} ${SAFE_Y} ${SAFE_Z} ${SAFE_X + 2} ${SAFE_Y + 2} ${SAFE_Z + 10} minecraft:air`
    });
    // Pacing delay to let server tick process fill command and synchronize chunk cache
    await new Promise(r => setTimeout(r, 500));

    // Verify key test locations are air
    let check1 = await rpc('get_block_context', { x: SAFE_X, y: SAFE_Y, z: SAFE_Z });
    if (check1.target?.blockId !== 'minecraft:air') {
      await new Promise(r => setTimeout(r, 300));
      check1 = await rpc('get_block_context', { x: SAFE_X, y: SAFE_Y, z: SAFE_Z });
    }

    let check2 = await rpc('get_block_context', { x: SAFE_X + 1, y: SAFE_Y + 1, z: SAFE_Z + 1 });
    if (check2.target?.blockId !== 'minecraft:air') {
      await new Promise(r => setTimeout(r, 300));
      check2 = await rpc('get_block_context', { x: SAFE_X + 1, y: SAFE_Y + 1, z: SAFE_Z + 1 });
    }

    let check3 = await rpc('get_block_context', { x: SAFE_X + 2, y: SAFE_Y + 2, z: SAFE_Z + 2 });
    if (check3.target?.blockId !== 'minecraft:air') {
      await new Promise(r => setTimeout(r, 300));
      check3 = await rpc('get_block_context', { x: SAFE_X + 2, y: SAFE_Y + 2, z: SAFE_Z + 2 });
    }

    assert.strictEqual(check1.target?.blockId, 'minecraft:air');
    assert.strictEqual(check2.target?.blockId, 'minecraft:air');
    assert.strictEqual(check3.target?.blockId, 'minecraft:air');
    console.log('  Test envelope cleanly restored to air.');
  });

  // Close WebSocket cleanly
  ws.close();

  console.log('\n================================================================');
  console.log(`Live Game E2E Test Suite Results: ${passed} passed, ${failed} failed`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal unhandled error in test suite:', err);
  process.exit(1);
});
