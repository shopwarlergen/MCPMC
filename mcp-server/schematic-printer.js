import { randomUUID } from 'node:crypto';
import { parseSchematic, isAirBlock } from './schematic-parser.js';

// ==========================================
// BLOCK CLASSIFICATION & SEQUENCING
// ==========================================

const SOLID_BLOCKS_OVERRIDE = new Set([
  'bedrock',
  'redstone_block',
  'redstone_lamp',
  'redstone_ore',
  'deepslate_redstone_ore',
  'grass_block',
  'amethyst_block',
  'budding_amethyst'
]);

const ATTACHMENT_KEYWORDS = [
  'torch', 'lantern', 'lever', 'button', 'sign', 'banner',
  'carpet', 'repeater', 'comparator', 'redstone', 'rail',
  'door', 'trapdoor', 'bed', 'ladder', 'vine', 'stairs',
  'slab', 'glass', 'fence', 'wall', 'gate', 'pot', 'sapling',
  'flower', 'plant', 'grass', 'spore', 'amethyst', 'candle',
  'chain', 'bell', 'tripwire', 'scaffolding',
  'dandelion', 'poppy', 'orchid', 'allium', 'bluet', 'tulip',
  'daisy', 'cornflower', 'lily', 'rose', 'sunflower', 'lilac',
  'peony', 'wheat', 'carrot', 'potato', 'beetroot', 'wart',
  'bush', 'cocoa', 'cane', 'bamboo', 'cactus', 'kelp', 'pickle',
  'dripstone'
];

/**
 * Check whether a block state is an attachment, fragile, or orientation-dependent block.
 * @param {string} blockState
 * @returns {boolean}
 */
export function isAttachmentOrFragile(blockState) {
  if (!blockState) return false;
  const baseName = blockState.split('[')[0].replace('minecraft:', '').toLowerCase();

  // Solid blocks override
  if (SOLID_BLOCKS_OVERRIDE.has(baseName)) {
    return false;
  }

  return ATTACHMENT_KEYWORDS.some(kw => {
    // Ensure keyword 'bed' does NOT match 'bedrock'
    if (kw === 'bed') {
      return baseName.includes('bed') && !baseName.includes('bedrock');
    }
    return baseName.includes(kw);
  });
}

/**
 * Sequence blocks for safe world placement:
 * 1. Bottom-to-top (Y-ascending)
 * 2. Within each Y layer: solids/foundations (Pass 1) before attachments/fragile (Pass 2)
 * 3. Spatial order: Z ascending, then X ascending
 *
 * @param {Array<ParsedBlock>} blocks
 * @param {boolean} skipAir
 * @returns {Array<ParsedBlock>}
 */
export function sequenceBlocks(blocks, skipAir = true) {
  const filtered = skipAir ? blocks.filter(b => !b.isAir) : [...blocks];

  filtered.sort((a, b) => {
    // 1. Bottom-to-top
    if (a.y !== b.y) return a.y - b.y;

    // 2. Solids before attachments
    const prioA = isAttachmentOrFragile(a.blockState) ? 1 : 0;
    const prioB = isAttachmentOrFragile(b.blockState) ? 1 : 0;
    if (prioA !== prioB) return prioA - prioB;

    // 3. Coordinate tie-breakers
    if (a.z !== b.z) return a.z - b.z;
    return a.x - b.x;
  });

  return filtered;
}

// ==========================================
// WEBSOCKET RPC ADAPTER
// ==========================================

const WS_CALLERS = new WeakMap();

/**
 * Creates a unified RPC caller regardless of whether ws is a raw WebSocket
 * or an object with custom bridge dispatch methods.
 */
export function createWsCaller(ws) {
  // If already provides a dispatch function
  if (typeof ws.sendWsRequest === 'function') {
    return (method, params) => ws.sendWsRequest(method, params);
  }
  if (typeof ws.callBridge === 'function') {
    return (method, params) => ws.callBridge(method, params);
  }

  // Prevent duplicate message listener registration on raw WebSocket
  if (WS_CALLERS.has(ws)) {
    return WS_CALLERS.get(ws);
  }

  // Raw WebSocket instance
  const pending = new Map();

  const handleMessage = (raw) => {
    try {
      const str = typeof raw === 'string' ? raw : raw.toString('utf8');
      const res = JSON.parse(str);
      if (!res || !res.id) return;

      const p = pending.get(res.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(res.id);
        if (res.ok) {
          p.resolve(res.data);
        } else {
          const err = res.error || {};
          p.reject(new Error(err.message || err.code || 'Lỗi không xác định từ Minecraft WebSocket'));
        }
      }
    } catch {
      // Ignore parse errors from unrelated frames
    }
  };

  if (typeof ws.on === 'function') {
    ws.on('message', handleMessage);
  } else if (typeof ws.addEventListener === 'function') {
    ws.addEventListener('message', (evt) => handleMessage(evt.data));
  }

  const caller = function call(method, params = {}, timeoutMs = 4500) {
    return new Promise((resolve, reject) => {
      if (!ws || (ws.readyState !== undefined && ws.readyState !== 1)) {
        return reject(new Error("WebSocket is not connected (readyState != OPEN)"));
      }

      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`WebSocket request '${method}' timed out after ${timeoutMs}ms (id: ${id})`));
      }, timeoutMs);

      pending.set(id, { resolve, reject, timer });

      const payload = JSON.stringify({ id, method, params });
      try {
        ws.send(payload);
      } catch (sendErr) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error(`Failed to send WebSocket frame: ${sendErr.message}`));
      }
    });
  };

  WS_CALLERS.set(ws, caller);
  return caller;
}

// ==========================================
// SCHEMATIC PRINTER ENGINE
// ==========================================

/**
 * Print a schematic into the Minecraft world.
 *
 * @param {WebSocket|object} ws - Active WebSocket connection
 * @param {ParsedSchematic|string|Buffer} schematic - Parsed schematic or path/buffer
 * @param {number} originX - Target world X coordinate
 * @param {number} originY - Target world Y coordinate
 * @param {number} originZ - Target world Z coordinate
 * @param {object} options
 * @param {boolean} [options.skipAir=true] - Skip placing air blocks
 * @param {boolean} [options.clearArea=false] - Clear target volume with /fill air before printing
 * @param {number} [options.delayMs=120] - Pacing delay between block placement commands
 * @param {number} [options.drainDelayMs=500] - Post-placement drain pause to allow game loop commit
 * @param {boolean} [options.dryRun=false] - If true, calculates placement plan without modifying world
 * @param {number} [options.maxRetries=3] - Max retries per failed block placement
 * @returns {Promise<PrintResult>}
 */
export async function printSchematic(ws, schematic, originX, originY, originZ, options = {}) {
  const startTime = Date.now();
  const {
    skipAir = true,
    clearArea = false,
    delayMs = 120,
    drainDelayMs = 500,
    dryRun = false,
    maxRetries = 3
  } = options;

  // Resolve schematic
  const parsed = (schematic && typeof schematic === 'object' && schematic.blocks)
    ? schematic
    : parseSchematic(schematic);

  const { width, height, length, format } = parsed;
  const orderedBlocks = sequenceBlocks(parsed.blocks, skipAir);

  const result = {
    success: true,
    format,
    origin: { x: originX, y: originY, z: originZ },
    dimensions: { width, height, length },
    totalBlocks: parsed.totalBlocks,
    placedCount: 0,
    skippedAirCount: parsed.totalBlocks - orderedBlocks.length,
    retriedCount: 0,
    failedBlocks: [],
    durationMs: 0
  };

  if (dryRun) {
    result.durationMs = Date.now() - startTime;
    result.dryRun = true;
    return result;
  }

  const rpcCall = createWsCaller(ws);

  // Optional: Pre-clear bounding box using /fill air
  if (clearArea) {
    const x1 = originX;
    const y1 = originY;
    const z1 = originZ;
    const x2 = originX + width - 1;
    const y2 = originY + height - 1;
    const z2 = originZ + length - 1;
    const fillCmd = `/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} minecraft:air`;

    try {
      await rpcCall("send_chat_or_command", { message: fillCmd });
      // Small pause after fill to let server tick clear volume
      await new Promise(r => setTimeout(r, 50));
    } catch (clearErr) {
      console.warn(`[SchematicPrinter] Warning: Clear area /fill failed: ${clearErr.message}`);
    }
  }

  // Execute placement sequence
  for (const block of orderedBlocks) {
    const targetX = originX + block.x;
    const targetY = originY + block.y;
    const targetZ = originZ + block.z;
    const cmd = `/setblock ${targetX} ${targetY} ${targetZ} ${block.blockState} replace`;

    let attempts = 0;
    let placed = false;
    let lastErr = null;

    while (attempts < maxRetries && !placed) {
      attempts++;
      try {
        await rpcCall("send_chat_or_command", { message: cmd });
        placed = true;
        result.placedCount++;
        if (attempts > 1) {
          result.retriedCount++;
        }
      } catch (err) {
        lastErr = err;
        if (attempts < maxRetries) {
          await new Promise(r => setTimeout(r, 40 * attempts));
        }
      }
    }

    if (!placed) {
      result.failedBlocks.push({
        x: targetX,
        y: targetY,
        z: targetZ,
        blockState: block.blockState,
        error: lastErr ? lastErr.message : "Unknown placement failure"
      });
      result.success = false;
    }

    if (delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  // Drain delay to allow Minecraft main game thread to fully execute and commit all /setblock commands
  if (drainDelayMs > 0) {
    await new Promise(r => setTimeout(r, drainDelayMs));
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

// ==========================================
// IN-GAME STRUCTURE VERIFICATION
// ==========================================

function parseCanonicalState(stateStr) {
  let id = stateStr;
  const properties = {};
  const bracket = stateStr.indexOf('[');
  if (bracket !== -1) {
    id = stateStr.slice(0, bracket);
    const propStr = stateStr.slice(bracket + 1, stateStr.length - 1);
    for (const pair of propStr.split(',')) {
      const [k, v] = pair.split('=');
      if (k && v !== undefined) properties[k] = v;
    }
  }
  if (!id.startsWith('minecraft:')) id = `minecraft:${id}`;
  return { id, properties };
}

/**
 * Verify blocks placed in the Minecraft world against the schematic specification.
 *
 * @param {WebSocket|object} ws
 * @param {ParsedSchematic|string|Buffer} schematic
 * @param {number} originX
 * @param {number} originY
 * @param {number} originZ
 * @param {object} [options]
 * @param {boolean} [options.skipAir=true]
 * @param {number} [options.queryDelayMs=5]
 * @returns {Promise<VerificationResult>}
 */
export async function verifyStructure(ws, schematic, originX, originY, originZ, options = {}) {
  const { skipAir = true, queryDelayMs = 5 } = options;

  const parsed = (schematic && typeof schematic === 'object' && schematic.blocks)
    ? schematic
    : parseSchematic(schematic);

  const rpcCall = createWsCaller(ws);
  const blocksToCheck = skipAir ? parsed.blocks.filter(b => !b.isAir) : parsed.blocks;

  let matchedCount = 0;
  let mismatchedCount = 0;
  const mismatches = [];

  for (const block of blocksToCheck) {
    const targetX = originX + block.x;
    const targetY = originY + block.y;
    const targetZ = originZ + block.z;

    try {
      const contextRes = await rpcCall("get_block_context", {
        x: targetX,
        y: targetY,
        z: targetZ
      });

      const actualTarget = contextRes?.target || {};
      const actualId = actualTarget.blockId || '';
      const actualProps = actualTarget.properties || {};

      const expected = parseCanonicalState(block.blockState);

      // Check ID match
      let isMatch = (actualId === expected.id);

      // Check property matches (e.g. facing, half, shape)
      if (isMatch && Object.keys(expected.properties).length > 0) {
        for (const [k, v] of Object.entries(expected.properties)) {
          if (actualProps[k] === undefined || actualProps[k] !== v) {
            isMatch = false;
            break;
          }
        }
      }

      if (isMatch) {
        matchedCount++;
      } else {
        mismatchedCount++;
        mismatches.push({
          pos: { x: targetX, y: targetY, z: targetZ },
          relativePos: { x: block.x, y: block.y, z: block.z },
          expected: block.blockState,
          actual: {
            blockId: actualId,
            properties: actualProps
          }
        });
      }
    } catch (queryErr) {
      mismatchedCount++;
      mismatches.push({
        pos: { x: targetX, y: targetY, z: targetZ },
        relativePos: { x: block.x, y: block.y, z: block.z },
        expected: block.blockState,
        error: queryErr.message
      });
    }

    if (queryDelayMs > 0) {
      await new Promise(r => setTimeout(r, queryDelayMs));
    }
  }

  const total = matchedCount + mismatchedCount;
  const accuracy = total > 0 ? (matchedCount / total) * 100 : 100;

  return {
    totalExpected: total,
    matchedCount,
    mismatchedCount,
    accuracy: Math.round(accuracy * 100) / 100, // 2 decimal places
    passed: mismatchedCount === 0,
    mismatches
  };
}
