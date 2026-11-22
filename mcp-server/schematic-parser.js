import fs from 'node:fs';
import zlib from 'node:zlib';

// ==========================================
// NBT CONSTANTS & TAG IDENTIFIERS
// ==========================================
export const TAG_END = 0;
export const TAG_BYTE = 1;
export const TAG_SHORT = 2;
export const TAG_INT = 3;
export const TAG_LONG = 4;
export const TAG_FLOAT = 5;
export const TAG_DOUBLE = 6;
export const TAG_BYTE_ARRAY = 7;
export const TAG_STRING = 8;
export const TAG_LIST = 9;
export const TAG_COMPOUND = 10;
export const TAG_INT_ARRAY = 11;
export const TAG_LONG_ARRAY = 12;

// Typed wrappers for serialization
export function nbtByte(v) { return { __nbtType: TAG_BYTE, value: Number(v) }; }
export function nbtShort(v) { return { __nbtType: TAG_SHORT, value: Number(v) }; }
export function nbtInt(v) { return { __nbtType: TAG_INT, value: Number(v) }; }
export function nbtLong(v) { return { __nbtType: TAG_LONG, value: BigInt(v) }; }
export function nbtFloat(v) { return { __nbtType: TAG_FLOAT, value: Number(v) }; }
export function nbtDouble(v) { return { __nbtType: TAG_DOUBLE, value: Number(v) }; }
export function nbtByteArray(v) { return { __nbtType: TAG_BYTE_ARRAY, value: Buffer.isBuffer(v) ? v : Buffer.from(v) }; }
export function nbtString(v) { return { __nbtType: TAG_STRING, value: String(v) }; }
export function nbtList(elemType, items) { return { __nbtType: TAG_LIST, elemType, value: items }; }
export function nbtCompound(v) { return { __nbtType: TAG_COMPOUND, value: v }; }
export function nbtIntArray(v) { return { __nbtType: TAG_INT_ARRAY, value: v }; }
export function nbtLongArray(v) { return { __nbtType: TAG_LONG_ARRAY, value: v }; }

// ==========================================
// NBT PARSER (ZERO-DEPENDENCY)
// ==========================================
export function parseNBT(buf) {
  let offset = 0;

  function readTag(tagType) {
    switch (tagType) {
      case TAG_BYTE: {
        const val = buf.readInt8(offset);
        offset += 1;
        return val;
      }
      case TAG_SHORT: {
        const val = buf.readInt16BE(offset);
        offset += 2;
        return val;
      }
      case TAG_INT: {
        const val = buf.readInt32BE(offset);
        offset += 4;
        return val;
      }
      case TAG_LONG: {
        const val = buf.readBigInt64BE(offset);
        offset += 8;
        return val;
      }
      case TAG_FLOAT: {
        const val = buf.readFloatBE(offset);
        offset += 4;
        return val;
      }
      case TAG_DOUBLE: {
        const val = buf.readDoubleBE(offset);
        offset += 8;
        return val;
      }
      case TAG_BYTE_ARRAY: {
        const len = buf.readInt32BE(offset);
        offset += 4;
        const slice = buf.subarray(offset, offset + len);
        offset += len;
        return slice;
      }
      case TAG_STRING: {
        const len = buf.readUInt16BE(offset);
        offset += 2;
        const str = buf.toString('utf8', offset, offset + len);
        offset += len;
        return str;
      }
      case TAG_LIST: {
        const elemType = buf.readUInt8(offset);
        offset += 1;
        const len = buf.readInt32BE(offset);
        offset += 4;
        const list = [];
        for (let i = 0; i < len; i++) {
          list.push(readTag(elemType));
        }
        return list;
      }
      case TAG_COMPOUND: {
        const compound = {};
        while (offset < buf.length) {
          const type = buf.readUInt8(offset);
          offset += 1;
          if (type === TAG_END) break;
          const nameLen = buf.readUInt16BE(offset);
          offset += 2;
          const name = buf.toString('utf8', offset, offset + nameLen);
          offset += nameLen;
          compound[name] = readTag(type);
        }
        return compound;
      }
      case TAG_INT_ARRAY: {
        const len = buf.readInt32BE(offset);
        offset += 4;
        const arr = new Int32Array(len);
        for (let i = 0; i < len; i++) {
          arr[i] = buf.readInt32BE(offset + i * 4);
        }
        offset += len * 4;
        return arr;
      }
      case TAG_LONG_ARRAY: {
        const len = buf.readInt32BE(offset);
        offset += 4;
        const arr = new BigInt64Array(len);
        for (let i = 0; i < len; i++) {
          arr[i] = buf.readBigInt64BE(offset + i * 8);
        }
        offset += len * 8;
        return arr;
      }
      default:
        throw new Error(`Unknown NBT tag type: ${tagType} at offset ${offset}`);
    }
  }

  if (buf.length < 3) throw new Error("Buffer too short for valid NBT");
  const rootType = buf.readUInt8(offset);
  offset += 1;
  if (rootType !== TAG_COMPOUND) {
    throw new Error(`Expected root tag ${TAG_COMPOUND} (Compound), got ${rootType}`);
  }
  const rootNameLen = buf.readUInt16BE(offset);
  offset += 2;
  const rootName = buf.toString('utf8', offset, offset + rootNameLen);
  offset += rootNameLen;
  const value = readTag(TAG_COMPOUND);
  return { name: rootName, value };
}

// ==========================================
// NBT SERIALIZER (ZERO-DEPENDENCY)
// ==========================================
function getTagType(val) {
  if (val && typeof val === 'object' && val.__nbtType !== undefined) {
    return val.__nbtType;
  }
  if (typeof val === 'string') return TAG_STRING;
  if (typeof val === 'bigint') return TAG_LONG;
  if (typeof val === 'boolean') return TAG_BYTE;
  if (typeof val === 'number') return Number.isInteger(val) ? TAG_INT : TAG_DOUBLE;
  if (Buffer.isBuffer(val) || val instanceof Uint8Array) return TAG_BYTE_ARRAY;
  if (val instanceof Int32Array) return TAG_INT_ARRAY;
  if (val instanceof BigInt64Array) return TAG_LONG_ARRAY;
  if (Array.isArray(val)) return TAG_LIST;
  if (typeof val === 'object' && val !== null) return TAG_COMPOUND;
  throw new Error(`Cannot determine NBT tag type for: ${val}`);
}

function getRawValue(val) {
  if (val && typeof val === 'object' && val.__nbtType !== undefined) {
    return val.value;
  }
  if (typeof val === 'boolean') return val ? 1 : 0;
  return val;
}

export class NbtSerializer {
  constructor() {
    this.chunks = [];
  }

  writeTagPayload(tagType, val, listElemType = null) {
    const raw = getRawValue(val);
    switch (tagType) {
      case TAG_BYTE: {
        const b = Buffer.alloc(1);
        b.writeInt8(raw, 0);
        this.chunks.push(b);
        break;
      }
      case TAG_SHORT: {
        const b = Buffer.alloc(2);
        b.writeInt16BE(raw, 0);
        this.chunks.push(b);
        break;
      }
      case TAG_INT: {
        const b = Buffer.alloc(4);
        b.writeInt32BE(raw, 0);
        this.chunks.push(b);
        break;
      }
      case TAG_LONG: {
        const b = Buffer.alloc(8);
        b.writeBigInt64BE(BigInt(raw), 0);
        this.chunks.push(b);
        break;
      }
      case TAG_FLOAT: {
        const b = Buffer.alloc(4);
        b.writeFloatBE(raw, 0);
        this.chunks.push(b);
        break;
      }
      case TAG_DOUBLE: {
        const b = Buffer.alloc(8);
        b.writeDoubleBE(raw, 0);
        this.chunks.push(b);
        break;
      }
      case TAG_BYTE_ARRAY: {
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        const len = Buffer.alloc(4);
        len.writeInt32BE(buf.length, 0);
        this.chunks.push(len, buf);
        break;
      }
      case TAG_STRING: {
        const strBuf = Buffer.from(String(raw), 'utf8');
        const len = Buffer.alloc(2);
        len.writeUInt16BE(strBuf.length, 0);
        this.chunks.push(len, strBuf);
        break;
      }
      case TAG_LIST: {
        const arr = raw;
        let elemType = listElemType;
        if (elemType === null) {
          elemType = (val && val.elemType !== undefined) ? val.elemType : (arr.length > 0 ? getTagType(arr[0]) : TAG_END);
        }
        const hdr = Buffer.alloc(5);
        hdr.writeUInt8(elemType, 0);
        hdr.writeInt32BE(arr.length, 1);
        this.chunks.push(hdr);
        for (let i = 0; i < arr.length; i++) {
          this.writeTagPayload(elemType, arr[i]);
        }
        break;
      }
      case TAG_COMPOUND: {
        for (const [key, propVal] of Object.entries(raw)) {
          if (propVal === undefined) continue;
          const propType = getTagType(propVal);
          const typeBuf = Buffer.alloc(1);
          typeBuf.writeUInt8(propType, 0);
          this.chunks.push(typeBuf);

          const keyBuf = Buffer.from(key, 'utf8');
          const keyLen = Buffer.alloc(2);
          keyLen.writeUInt16BE(keyBuf.length, 0);
          this.chunks.push(keyLen, keyBuf);

          const elemType = (propVal && propVal.__nbtType === TAG_LIST) ? propVal.elemType : null;
          this.writeTagPayload(propType, propVal, elemType);
        }
        this.chunks.push(Buffer.from([TAG_END]));
        break;
      }
      case TAG_INT_ARRAY: {
        const arr = raw;
        const len = Buffer.alloc(4);
        len.writeInt32BE(arr.length, 0);
        this.chunks.push(len);
        const data = Buffer.alloc(arr.length * 4);
        for (let i = 0; i < arr.length; i++) data.writeInt32BE(arr[i], i * 4);
        this.chunks.push(data);
        break;
      }
      case TAG_LONG_ARRAY: {
        const arr = raw;
        const len = Buffer.alloc(4);
        len.writeInt32BE(arr.length, 0);
        this.chunks.push(len);
        const data = Buffer.alloc(arr.length * 8);
        for (let i = 0; i < arr.length; i++) data.writeBigInt64BE(BigInt(arr[i]), i * 8);
        this.chunks.push(data);
        break;
      }
      default:
        throw new Error(`Unsupported NBT serialization tag type: ${tagType}`);
    }
  }

  serializeRoot(rootName, rootCompound) {
    this.chunks = [];
    const typeBuf = Buffer.from([TAG_COMPOUND]);
    const nameBuf = Buffer.from(rootName, 'utf8');
    const nameLen = Buffer.alloc(2);
    nameLen.writeUInt16BE(nameBuf.length, 0);
    this.chunks.push(typeBuf, nameLen, nameBuf);
    this.writeTagPayload(TAG_COMPOUND, rootCompound);
    return Buffer.concat(this.chunks);
  }
}

export function writeNBT(rootName, rootCompound) {
  const serializer = new NbtSerializer();
  return serializer.serializeRoot(rootName, rootCompound);
}

// ==========================================
// VARINT ENCODING & DECODING (SPONGE SCHEMATIC)
// ==========================================
export function encodeVarInt(value) {
  const bytes = [];
  let v = value;
  while ((v & -128) !== 0) {
    bytes.push((v & 0x7F) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7F);
  return Buffer.from(bytes);
}

export function decodeVarInt(buf, offset) {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;
  while (true) {
    if (offset + bytesRead >= buf.length) {
      throw new Error(`Unexpected EOF reading VarInt at offset ${offset}`);
    }
    const b = buf[offset + bytesRead++];
    result |= (b & 0x7F) << shift;
    shift += 7;
    if ((b & 0x80) === 0) break;
  }
  return { value: result, bytesRead };
}

// ==========================================
// BIT-PACKING & UNPACKING (LITEMATICA)
// ==========================================
export function packLitematica(indices, bitsPerEntry) {
  const B = BigInt(bitsPerEntry);
  const totalBits = BigInt(indices.length) * B;
  const numLongs = Number((totalBits + 63n) / 64n);
  const longs = new BigInt64Array(numLongs);
  for (let i = 0; i < indices.length; i++) {
    const val = BigInt(indices[i]);
    const startBit = BigInt(i) * B;
    const startLong = Number(startBit / 64n);
    const bitOffset = startBit % 64n;
    let w0 = BigInt.asUintN(64, longs[startLong]);
    if (bitOffset + B <= 64n) {
      w0 |= (val & ((1n << B) - 1n)) << bitOffset;
      longs[startLong] = BigInt.asIntN(64, w0);
    } else {
      const bits1 = 64n - bitOffset;
      w0 |= (val & ((1n << bits1) - 1n)) << bitOffset;
      longs[startLong] = BigInt.asIntN(64, w0);
      let w1 = BigInt.asUintN(64, longs[startLong + 1]);
      const bits2 = B - bits1;
      w1 |= ((val >> bits1) & ((1n << bits2) - 1n));
      longs[startLong + 1] = BigInt.asIntN(64, w1);
    }
  }
  return longs;
}

export function unpackLitematica(longs, count, bitsPerEntry) {
  const B = BigInt(bitsPerEntry);
  const indices = [];
  const mask = (1n << B) - 1n;
  for (let i = 0; i < count; i++) {
    const startBit = BigInt(i) * B;
    const startLong = Number(startBit / 64n);
    const bitOffset = startBit % 64n;
    const w0 = BigInt.asUintN(64, longs[startLong]);
    if (bitOffset + B <= 64n) {
      indices.push(Number((w0 >> bitOffset) & mask));
    } else {
      const bits1 = 64n - bitOffset;
      const part1 = (w0 >> bitOffset) & ((1n << bits1) - 1n);
      const w1 = BigInt.asUintN(64, longs[startLong + 1]);
      const bits2 = B - bits1;
      const part2 = (w1 & ((1n << bits2) - 1n)) << bits1;
      indices.push(Number(part1 | part2));
    }
  }
  return indices;
}

// ==========================================
// CANONICAL BLOCK STATE FORMATTING
// ==========================================
export function formatBlockState(name, properties) {
  const cleanName = name.startsWith('minecraft:') ? name : `minecraft:${name}`;
  if (!properties || Object.keys(properties).length === 0) {
    return cleanName;
  }
  const keys = Object.keys(properties).sort();
  const propList = keys.map(k => `${k}=${properties[k]}`).join(',');
  return `${cleanName}[${propList}]`;
}

export function isAirBlock(blockState) {
  if (!blockState) return true;
  const lower = blockState.toLowerCase();
  return (
    lower === 'minecraft:air' ||
    lower === 'minecraft:cave_air' ||
    lower === 'minecraft:void_air' ||
    lower.startsWith('minecraft:air[') ||
    lower.startsWith('minecraft:cave_air[') ||
    lower.startsWith('minecraft:void_air[')
  );
}

// ==========================================
// SCHEMATIC PARSERS
// ==========================================

/**
 * Parse Litematica NBT compound
 */
function parseLitematicCompound(root) {
  const regions = root.Regions;
  if (!regions || typeof regions !== 'object') {
    throw new Error("Litematica schematic missing 'Regions' compound");
  }

  const regionEntries = Object.entries(regions);
  if (regionEntries.length === 0) {
    throw new Error("Litematica schematic has 0 regions");
  }

  // Calculate normalized coordinate bounds across all regions
  const parsedRegions = [];
  let minWorldX = Infinity, minWorldY = Infinity, minWorldZ = Infinity;
  let maxWorldX = -Infinity, maxWorldY = -Infinity, maxWorldZ = -Infinity;

  for (const [regionName, regionData] of regionEntries) {
    const pos = regionData.Position || { x: 0, y: 0, z: 0 };
    const size = regionData.Size || { x: 0, y: 0, z: 0 };

    const rx = size.x < 0 ? pos.x + size.x + 1 : pos.x;
    const ry = size.y < 0 ? pos.y + size.y + 1 : pos.y;
    const rz = size.z < 0 ? pos.z + size.z + 1 : pos.z;

    const sx = Math.abs(size.x);
    const sy = Math.abs(size.y);
    const sz = Math.abs(size.z);

    if (rx < minWorldX) minWorldX = rx;
    if (ry < minWorldY) minWorldY = ry;
    if (rz < minWorldZ) minWorldZ = rz;

    if (rx + sx - 1 > maxWorldX) maxWorldX = rx + sx - 1;
    if (ry + sy - 1 > maxWorldY) maxWorldY = ry + sy - 1;
    if (rz + sz - 1 > maxWorldZ) maxWorldZ = rz + sz - 1;

    parsedRegions.push({ regionName, regionData, rx, ry, rz, sx, sy, sz });
  }

  const width = maxWorldX - minWorldX + 1;
  const height = maxWorldY - minWorldY + 1;
  const length = maxWorldZ - minWorldZ + 1;

  const blocks = [];
  const globalPaletteSet = new Set();
  let nonAirBlocks = 0;

  for (const { regionData, rx, ry, rz, sx, sy, sz } of parsedRegions) {
    const rawPalette = regionData.BlockStatePalette || [];
    const palette = rawPalette.map(entry => formatBlockState(entry.Name, entry.Properties));
    for (const p of palette) globalPaletteSet.add(p);

    const bitsPerEntry = Math.max(2, Math.ceil(Math.log2(palette.length)));
    const totalRegionBlocks = sx * sy * sz;
    const blockStates = regionData.BlockStates || new BigInt64Array(0);

    const indices = blockStates.length > 0
      ? unpackLitematica(blockStates, totalRegionBlocks, bitsPerEntry)
      : new Array(totalRegionBlocks).fill(0);

    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; x++) {
          const index = (y * sz + z) * sx + x;
          const paletteIndex = indices[index] !== undefined ? indices[index] : 0;
          const blockState = palette[paletteIndex] || 'minecraft:air';
          const isAir = isAirBlock(blockState);
          if (!isAir) nonAirBlocks++;

          blocks.push({
            x: rx - minWorldX + x,
            y: ry - minWorldY + y,
            z: rz - minWorldZ + z,
            blockState,
            isAir
          });
        }
      }
    }
  }

  return {
    format: 'litematic',
    width,
    height,
    length,
    totalBlocks: blocks.length,
    nonAirBlocks,
    blocks,
    palette: Array.from(globalPaletteSet)
  };
}

/**
 * Parse Sponge NBT compound (.schem v2 or v3)
 */
function parseSpongeCompound(root) {
  // Support both direct root or wrapped inside 'Schematic'
  const schem = root.Schematic && typeof root.Schematic === 'object' ? root.Schematic : root;

  const width = Number(schem.Width);
  const height = Number(schem.Height);
  const length = Number(schem.Length);

  if (!width || !height || !length || width <= 0 || height <= 0 || length <= 0) {
    throw new Error(`Invalid Sponge schematic dimensions: ${width}x${height}x${length}`);
  }

  const rawPalette = schem.Palette;
  if (!rawPalette || typeof rawPalette !== 'object') {
    throw new Error("Sponge schematic missing 'Palette' compound");
  }

  // Invert palette: index -> blockState string
  const palette = [];
  for (const [stateStr, idxVal] of Object.entries(rawPalette)) {
    const idx = Number(idxVal);
    palette[idx] = stateStr.startsWith('minecraft:') ? stateStr : `minecraft:${stateStr}`;
  }

  const rawBlockData = schem.BlockData;
  if (!rawBlockData || (!Buffer.isBuffer(rawBlockData) && !(rawBlockData instanceof Uint8Array))) {
    throw new Error("Sponge schematic missing 'BlockData' byte array");
  }

  const blockDataBuf = Buffer.isBuffer(rawBlockData) ? rawBlockData : Buffer.from(rawBlockData);
  const totalBlocks = width * height * length;
  const blocks = [];
  let nonAirBlocks = 0;
  let offset = 0;

  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        const { value: paletteIndex, bytesRead } = decodeVarInt(blockDataBuf, offset);
        offset += bytesRead;

        const blockState = palette[paletteIndex] || 'minecraft:air';
        const isAir = isAirBlock(blockState);
        if (!isAir) nonAirBlocks++;

        blocks.push({
          x,
          y,
          z,
          blockState,
          isAir
        });
      }
    }
  }

  return {
    format: 'schem',
    width,
    height,
    length,
    totalBlocks,
    nonAirBlocks,
    blocks,
    palette: palette.filter(Boolean)
  };
}

/**
 * Primary export: Parse a schematic from file path or Buffer.
 * @param {string|Buffer} filePathOrBuffer
 * @returns {ParsedSchematic}
 */
export function parseSchematic(filePathOrBuffer) {
  let buf;
  if (typeof filePathOrBuffer === 'string') {
    if (!fs.existsSync(filePathOrBuffer)) {
      throw new Error(`Schematic file not found: ${filePathOrBuffer}`);
    }
    buf = fs.readFileSync(filePathOrBuffer);
  } else if (Buffer.isBuffer(filePathOrBuffer)) {
    buf = filePathOrBuffer;
  } else {
    throw new TypeError("Expected file path string or Buffer");
  }

  // Decompress if gzipped or deflated
  let decompressed;
  try {
    decompressed = zlib.gunzipSync(buf);
  } catch {
    try {
      decompressed = zlib.inflateSync(buf);
    } catch {
      // Already uncompressed or raw NBT
      decompressed = buf;
    }
  }

  const { value: root } = parseNBT(decompressed);

  // Format detection
  if (root.Regions || root.Metadata) {
    return parseLitematicCompound(root);
  }
  if (root.Palette || root.BlockData || root.Schematic || (root.Width && root.Height && root.Length)) {
    return parseSpongeCompound(root);
  }

  throw new Error("Unrecognized schematic format. Expected Litematica (.litematic) or Sponge (.schem)");
}

// ==========================================
// SYNTHETIC TEST SCHEMATIC GENERATOR
// ==========================================

/**
 * Standard test structure: 3x3x3 with solid base, walls, glass, stairs, slab, air.
 */
function createSynthetic3x3x3BlockGrid() {
  const blocks = [];
  // Layer 0: solid smooth stone foundation
  for (let z = 0; z < 3; z++) {
    for (let x = 0; x < 3; x++) {
      blocks.push({ x, y: 0, z, blockState: 'minecraft:smooth_stone' });
    }
  }

  // Layer 1: oak planks corners, glass walls, slab front, air interior
  const layer1 = [
    ['minecraft:oak_planks', 'minecraft:glass', 'minecraft:oak_planks'],
    ['minecraft:glass',      'minecraft:air',   'minecraft:glass'],
    ['minecraft:oak_planks', 'minecraft:oak_slab[type=bottom,waterlogged=false]', 'minecraft:oak_planks']
  ];
  for (let z = 0; z < 3; z++) {
    for (let x = 0; x < 3; x++) {
      blocks.push({ x, y: 1, z, blockState: layer1[z][x] });
    }
  }

  // Layer 2: decorative stairs roof and glass skylight
  const layer2 = [
    ['minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', 'minecraft:glass', 'minecraft:oak_stairs[facing=west,half=bottom,shape=straight,waterlogged=false]'],
    ['minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', 'minecraft:glass', 'minecraft:oak_stairs[facing=west,half=bottom,shape=straight,waterlogged=false]'],
    ['minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', 'minecraft:glass', 'minecraft:oak_stairs[facing=west,half=bottom,shape=straight,waterlogged=false]']
  ];
  for (let z = 0; z < 3; z++) {
    for (let x = 0; x < 3; x++) {
      blocks.push({ x, y: 2, z, blockState: layer2[z][x] });
    }
  }

  return blocks;
}

/**
 * Generate a synthetic test schematic buffer.
 * @param {'litematic'|'schem'} format
 * @returns {Buffer} - GZipped schematic buffer
 */
export function generateTestSchematic(format = 'litematic') {
  const blockList = createSynthetic3x3x3BlockGrid();
  const width = 3, height = 3, length = 3;

  if (format === 'schem') {
    // Unique palette
    const paletteMap = {};
    const paletteEntries = [];
    for (const b of blockList) {
      if (paletteMap[b.blockState] === undefined) {
        const id = paletteEntries.length;
        paletteMap[b.blockState] = id;
        paletteEntries.push(b.blockState);
      }
    }

    // VarInt encoded BlockData
    const varIntChunks = [];
    for (let y = 0; y < height; y++) {
      for (let z = 0; z < length; z++) {
        for (let x = 0; x < width; x++) {
          const b = blockList.find(item => item.x === x && item.y === y && item.z === z);
          const state = b ? b.blockState : 'minecraft:air';
          const pId = paletteMap[state];
          varIntChunks.push(encodeVarInt(pId));
        }
      }
    }
    const blockData = Buffer.concat(varIntChunks);

    const paletteCompound = {};
    for (const [k, v] of Object.entries(paletteMap)) {
      paletteCompound[k] = nbtInt(v);
    }

    const schemCompound = {
      Version: nbtInt(2),
      DataVersion: nbtInt(4671),
      Width: nbtShort(width),
      Height: nbtShort(height),
      Length: nbtShort(length),
      PaletteMax: nbtInt(paletteEntries.length),
      Palette: nbtCompound(paletteCompound),
      BlockData: nbtByteArray(blockData)
    };

    const rootNbt = writeNBT("Schematic", schemCompound);
    return zlib.gzipSync(rootNbt);
  }

  if (format === 'litematic') {
    // Parse block state strings into Name and Properties
    const paletteMap = {};
    const paletteList = [];
    for (const b of blockList) {
      if (paletteMap[b.blockState] === undefined) {
        const id = paletteList.length;
        paletteMap[b.blockState] = id;

        let name = b.blockState;
        let props = null;
        const bracketIdx = b.blockState.indexOf('[');
        if (bracketIdx !== -1) {
          name = b.blockState.slice(0, bracketIdx);
          const propStr = b.blockState.slice(bracketIdx + 1, b.blockState.length - 1);
          props = {};
          for (const pair of propStr.split(',')) {
            const [k, v] = pair.split('=');
            if (k && v) props[k] = nbtString(v);
          }
        }

        const entry = { Name: nbtString(name) };
        if (props) entry.Properties = nbtCompound(props);
        paletteList.push(nbtCompound(entry));
      }
    }

    const bitsPerEntry = Math.max(2, Math.ceil(Math.log2(paletteList.length)));
    const indices = [];
    for (let y = 0; y < height; y++) {
      for (let z = 0; z < length; z++) {
        for (let x = 0; x < width; x++) {
          const b = blockList.find(item => item.x === x && item.y === y && item.z === z);
          const state = b ? b.blockState : 'minecraft:air';
          indices.push(paletteMap[state]);
        }
      }
    }

    const packedLongs = packLitematica(indices, bitsPerEntry);

    const regionCompound = {
      Position: nbtCompound({ x: nbtInt(0), y: nbtInt(0), z: nbtInt(0) }),
      Size: nbtCompound({ x: nbtInt(width), y: nbtInt(height), z: nbtInt(length) }),
      BlockStatePalette: nbtList(TAG_COMPOUND, paletteList),
      BlockStates: nbtLongArray(packedLongs)
    };

    const rootCompound = {
      Version: nbtInt(7),
      MinecraftDataVersion: nbtInt(4671),
      Metadata: nbtCompound({
        Name: nbtString("SyntheticTestSchematic"),
        Author: nbtString("MCPMC"),
        Description: nbtString("Autonomous Test Structure"),
        RegionCount: nbtInt(1),
        TotalVolume: nbtInt(width * height * length),
        TotalBlocks: nbtInt(blockList.filter(b => !isAirBlock(b.blockState)).length),
        EnclosingSize: nbtCompound({ x: nbtInt(width), y: nbtInt(height), z: nbtInt(length) })
      }),
      Regions: nbtCompound({
        MainRegion: nbtCompound(regionCompound)
      })
    };

    const rootNbt = writeNBT("Litematica", rootCompound);
    return zlib.gzipSync(rootNbt);
  }

  throw new Error(`Unsupported test schematic format: ${format}`);
}
