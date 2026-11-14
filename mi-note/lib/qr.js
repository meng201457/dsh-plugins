/**
 * Minimal QR Code encoder (byte mode, versions 1-20, EC levels L and M).
 *
 * Self-contained on purpose: the bundle must render a Xiaomi login QR without
 * a network round trip to an image service and without an npm dependency, and
 * the browser half only receives the finished module matrix.
 *
 * The output is the module matrix plus the chosen version and EC level; the
 * client draws one <rect> per dark module, so nothing here is HTML.
 *
 * `selfTest()` proves the encoder against the QR specification without a
 * scanner: it checks every Reed-Solomon block's syndromes, round-trips the
 * format information, and extracts the data codewords back out of a masked
 * matrix to compare them with the encoded bitstream.
 */

/* ------------------------------------------------------------ GF(256) math */

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if ((x & 0x100) !== 0) x ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]
}

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

/** Generator polynomial for `n` ECC codewords, highest-degree coefficient first. */
function rsGenerator(n) {
  let poly = [1]
  for (let i = 0; i < n; i += 1) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

/** Remainder of `data` * x^n divided by the generator polynomial. */
function rsRemainder(data, n) {
  const gen = rsGenerator(n)
  const work = new Uint8Array(data.length + n)
  work.set(data)
  for (let i = 0; i < data.length; i += 1) {
    const factor = work[i]
    if (factor === 0) continue
    for (let j = 0; j < gen.length; j += 1) work[i + j] ^= gfMul(gen[j], factor)
  }
  return work.subarray(data.length)
}

/* --------------------------------------------------------------- capacity */

/** Total codewords per symbol version, versions 1-20. */
const TOTAL_CODEWORDS = [
  0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
  404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
]

/** Per version: [ecCodewordsPerBlock, shortBlocks, longBlocks] for each level. */
const ECC_BLOCKS = {
  L: [
    null, [7, 1, 0], [10, 1, 0], [15, 1, 0], [20, 1, 0], [26, 1, 0],
    [18, 2, 0], [20, 2, 0], [24, 2, 0], [30, 2, 0], [18, 2, 2],
    [20, 4, 0], [24, 2, 2], [26, 4, 0], [30, 3, 1], [22, 5, 1],
    [24, 5, 1], [28, 1, 5], [30, 5, 1], [28, 3, 4], [28, 3, 5],
  ],
  M: [
    null, [10, 1, 0], [16, 1, 0], [26, 1, 0], [18, 2, 0], [24, 2, 0],
    [16, 4, 0], [18, 4, 0], [22, 2, 2], [22, 3, 2], [26, 4, 1],
    [30, 1, 4], [22, 6, 2], [22, 8, 1], [24, 4, 5], [24, 5, 5],
    [28, 7, 3], [28, 10, 1], [26, 9, 4], [26, 3, 11], [26, 3, 13],
  ],
}

const MAX_VERSION = 20

/** Alignment pattern centre coordinates per version. */
const ALIGNMENT = [
  null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
  [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
  [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
  [6, 34, 62, 90],
]

/** Remainder bits appended after the last codeword. */
function remainderBits(version) {
  if (version === 1) return 0
  if (version <= 6) return 7
  if (version <= 13) return 0
  return 3
}

function ecLevelBits(level) {
  if (level === 'L') return 0b01
  if (level === 'M') return 0b00
  throw new Error('mi-note qr: unsupported EC level ' + level)
}

/** Data codeword count for one version and level, or -1 when unknown. */
function dataCodewordCount(version, level) {
  const spec = ECC_BLOCKS[level]?.[version]
  if (spec === undefined || spec === null) return -1
  const [ec, shortBlocks, longBlocks] = spec
  return TOTAL_CODEWORDS[version] - ec * (shortBlocks + longBlocks)
}

function charCountBits(version) {
  return version <= 9 ? 8 : 16
}

/* ------------------------------------------------------------- bit stream */

class BitBuffer {
  constructor() {
    this.bits = []
  }

  put(value, length) {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1)
  }

  get length() {
    return this.bits.length
  }
}

/** Encode text into the interleaved final codeword bit sequence. */
function encodeCodewords(bytes, version, level) {
  const capacityBits = dataCodewordCount(version, level) * 8
  if (capacityBits < 0) throw new Error('mi-note qr: no capacity data for this version')
  const buffer = new BitBuffer()
  buffer.put(0b0100, 4)
  buffer.put(bytes.length, charCountBits(version))
  for (const byte of bytes) buffer.put(byte, 8)
  if (buffer.length > capacityBits) throw new Error('mi-note qr: payload does not fit')

  const terminator = Math.min(4, capacityBits - buffer.length)
  buffer.put(0, terminator)
  while (buffer.length % 8 !== 0) buffer.bits.push(0)

  const dataCodewords = new Uint8Array(capacityBits / 8)
  for (let i = 0; i < buffer.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | buffer.bits[i + j]
    dataCodewords[i / 8] = byte
  }
  const pads = [0xec, 0x11]
  for (let i = buffer.length / 8, k = 0; i < dataCodewords.length; i += 1, k += 1) {
    dataCodewords[i] = pads[k % 2]
  }

  const [ec, shortBlocks, longBlocks] = ECC_BLOCKS[level][version]
  const blockCount = shortBlocks + longBlocks
  const totalData = dataCodewords.length
  const shortLength = Math.floor(totalData / blockCount)
  const longCount = totalData % blockCount
  if (longCount !== longBlocks) throw new Error('mi-note qr: inconsistent block table')

  const dataBlocks = []
  const ecBlocks = []
  let offset = 0
  for (let index = 0; index < blockCount; index += 1) {
    const length = shortLength + (index >= blockCount - longCount ? 1 : 0)
    const block = dataCodewords.subarray(offset, offset + length)
    offset += length
    dataBlocks.push(block)
    ecBlocks.push(rsRemainder(block, ec))
  }
  if (offset !== totalData) throw new Error('mi-note qr: block split mismatch')

  const out = []
  const longest = Math.max(...dataBlocks.map(block => block.length))
  for (let i = 0; i < longest; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i])
  }
  for (let i = 0; i < ec; i += 1) {
    for (const block of ecBlocks) out.push(block[i])
  }

  const bits = []
  for (const codeword of out) {
    for (let i = 7; i >= 0; i -= 1) bits.push((codeword >>> i) & 1)
  }
  for (let i = 0; i < remainderBits(version); i += 1) bits.push(0)
  return bits
}

/* ---------------------------------------------------------------- matrix */

const MASKS = [
  (row, col) => (row + col) % 2 === 0,
  (row, col) => row % 2 === 0,
  (row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
]

/** BCH(15,5) format information with the mandatory 0x5412 mask. */
function formatBits(level, mask) {
  const data = (ecLevelBits(level) << 3) | mask
  let remainder = data
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537)
  return ((data << 10) | remainder) ^ 0x5412
}

/** BCH(18,6) version information for versions 7 and above. */
function versionBits(version) {
  let remainder = version
  for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ (((remainder >>> 11) & 1) * 0x1f25)
  return (version << 12) | remainder
}

function createMatrix(version) {
  const size = 17 + version * 4
  const modules = Array.from({ length: size }, () => new Int8Array(size).fill(-1))
  const reserved = Array.from({ length: size }, () => new Uint8Array(size))
  const mark = (row, col, dark) => {
    modules[row][col] = dark ? 1 : 0
    reserved[row][col] = 1
  }

  const drawFinder = (rowOrigin, colOrigin) => {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const row = rowOrigin + dr
        const col = colOrigin + dc
        if (row < 0 || row >= size || col < 0 || col >= size) continue
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6
        const dark = inside
          && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4))
        mark(row, col, dark)
      }
    }
  }

  drawFinder(0, 0)
  drawFinder(0, size - 7)
  drawFinder(size - 7, 0)

  for (let i = 8; i <= size - 9; i += 1) {
    const dark = i % 2 === 0
    mark(6, i, dark)
    mark(i, 6, dark)
  }

  for (const rowCentre of ALIGNMENT[version]) {
    for (const colCentre of ALIGNMENT[version]) {
      const nearFinder = (rowCentre <= 8 && colCentre <= 8)
        || (rowCentre <= 8 && colCentre >= size - 9)
        || (rowCentre >= size - 9 && colCentre <= 8)
      if (nearFinder) continue
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1
          mark(rowCentre + dr, colCentre + dc, dark)
        }
      }
    }
  }

  // Reserve the format areas (real bits are written after masking).
  for (let i = 0; i < 9; i += 1) {
    if (!reserved[8][i]) mark(8, i, false)
    if (!reserved[i][8]) mark(i, 8, false)
  }
  for (let i = 0; i < 8; i += 1) {
    if (!reserved[8][size - 1 - i]) mark(8, size - 1 - i, false)
    if (!reserved[size - 1 - i][8]) mark(size - 1 - i, 8, false)
  }
  mark(size - 8, 8, true)

  if (version >= 7) {
    const bits = versionBits(version)
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) !== 0
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      mark(b, a, dark)
      mark(a, b, dark)
    }
  }

  return { size, modules, reserved }
}

function placeData(state, bits) {
  const { size, modules, reserved } = state
  let index = 0
  let upward = true
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step
      for (let k = 0; k < 2; k += 1) {
        const target = col - k
        if (reserved[row][target] === 1) continue
        modules[row][target] = index < bits.length ? bits[index] : 0
        index += 1
      }
    }
    upward = !upward
  }
}

function applyMask(state, maskIndex) {
  const { size, modules, reserved } = state
  const test = MASKS[maskIndex]
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (reserved[row][col] === 1) continue
      if (test(row, col)) modules[row][col] ^= 1
    }
  }
}

function writeFormat(state, level, maskIndex) {
  const { size, modules } = state
  const bits = formatBits(level, maskIndex)
  const bit = i => ((bits >>> i) & 1) !== 0
  for (let i = 0; i < 6; i += 1) modules[i][8] = bit(i) ? 1 : 0
  modules[7][8] = bit(6) ? 1 : 0
  modules[8][8] = bit(7) ? 1 : 0
  modules[8][7] = bit(8) ? 1 : 0
  for (let i = 9; i < 15; i += 1) modules[8][14 - i] = bit(i) ? 1 : 0
  for (let i = 0; i < 8; i += 1) modules[8][size - 1 - i] = bit(i) ? 1 : 0
  for (let i = 8; i < 15; i += 1) modules[size - 15 + i][8] = bit(i) ? 1 : 0
  modules[size - 8][8] = 1
}

/** Penalty score of the four specification rules; lower is more readable. */
function penalty(modules) {
  const size = modules.length
  let score = 0

  const runScore = line => {
    let total = 0
    let runLength = 1
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) runLength += 1
      else {
        if (runLength >= 5) total += 3 + (runLength - 5)
        runLength = 1
      }
    }
    if (runLength >= 5) total += 3 + (runLength - 5)
    return total
  }

  for (let row = 0; row < size; row += 1) score += runScore(Array.from(modules[row]))
  for (let col = 0; col < size; col += 1) {
    const column = []
    for (let row = 0; row < size; row += 1) column.push(modules[row][col])
    score += runScore(column)
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const value = modules[row][col]
      if (value === modules[row][col + 1] && value === modules[row + 1][col] && value === modules[row + 1][col + 1]) {
        score += 3
      }
    }
  }

  const patternA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
  const patternB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
  const matches = line => {
    let found = 0
    for (let i = 0; i + 11 <= line.length; i += 1) {
      let a = true
      let b = true
      for (let k = 0; k < 11; k += 1) {
        if (line[i + k] !== patternA[k]) a = false
        if (line[i + k] !== patternB[k]) b = false
      }
      if (a) found += 1
      if (b) found += 1
    }
    return found
  }
  for (let row = 0; row < size; row += 1) score += 40 * matches(Array.from(modules[row]))
  for (let col = 0; col < size; col += 1) {
    const column = []
    for (let row = 0; row < size; row += 1) column.push(modules[row][col])
    score += 40 * matches(column)
  }

  let dark = 0
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) dark += modules[row][col]
  }
  const ratio = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10
  return score
}

/* ------------------------------------------------------------------- api */

/**
 * Encode `text` as a QR symbol.
 * @param {string} text - payload, encoded as UTF-8 bytes.
 * @param {{ level?: 'L'|'M' }} [options] - error-correction level; 'M' is used when it fits.
 * @returns {{ version: number, level: 'L'|'M', size: number, modules: number[][] }}
 */
export function createQr(text, options = {}) {
  if (typeof text !== 'string' || text === '') throw new Error('mi-note qr: empty payload')
  const bytes = Buffer.from(text, 'utf8')
  const preferred = options.level === 'L' ? 'L' : 'M'
  const levels = preferred === 'M' ? ['M', 'L'] : ['L']

  for (const level of levels) {
    for (let version = 1; version <= MAX_VERSION; version += 1) {
      const capacityBits = dataCodewordCount(version, level) * 8
      const needed = 4 + charCountBits(version) + bytes.length * 8
      if (needed > capacityBits) continue

      const bits = encodeCodewords(bytes, version, level)
      const state = createMatrix(version)
      placeData(state, bits)

      let best = null
      for (let maskIndex = 0; maskIndex < 8; maskIndex += 1) {
        applyMask(state, maskIndex)
        writeFormat(state, level, maskIndex)
        const score = penalty(state.modules)
        if (best === null || score < best.score) best = { maskIndex, score }
        applyMask(state, maskIndex)
      }
      applyMask(state, best.maskIndex)
      writeFormat(state, level, best.maskIndex)

      const modules = state.modules.map(row => Array.from(row))
      return { version, level, size: state.size, modules, mask: best.maskIndex }
    }
  }
  throw new Error('mi-note qr: payload too long (' + bytes.length + ' bytes)')
}

/* -------------------------------------------------------------- self test */

/**
 * Syndromes of one Reed-Solomon codeword. The generator polynomial's roots are
 * a^0 .. a^(ecCount-1), so a valid block evaluates to zero at exactly those
 * powers; checking a shifted set would report false failures.
 */
function syndromes(block, ecCount) {
  const values = []
  for (let i = 0; i < ecCount; i += 1) {
    let sum = 0
    for (const byte of block) sum = gfMul(sum, EXP[i]) ^ byte
    values.push(sum)
  }
  return values
}

/** Read the 15 format bits back out of a finished matrix. */
function readFormat(modules) {
  const size = modules.length
  let bits = 0
  for (let i = 0; i < 6; i += 1) bits |= modules[i][8] << i
  bits |= modules[7][8] << 6
  bits |= modules[8][8] << 7
  bits |= modules[8][7] << 8
  for (let i = 9; i < 15; i += 1) bits |= modules[8][14 - i] << i
  return bits ^ 0x5412
}

/**
 * Prove the encoder on the specification's own terms.
 * @returns {{ ok: boolean, checks: Array<{ name: string, ok: boolean, detail?: string }> }}
 */
export function selfTest() {
  const checks = []
  const record = (name, ok, detail) => checks.push(detail === undefined ? { name, ok } : { name, ok, detail })

  // 1. Reed-Solomon blocks of a real symbol have all-zero syndromes.
  try {
    const sample = Buffer.from('https://account.xiaomi.com/longPolling/confirm?_qrsize=240&sid=notes', 'utf8')
    const version = 6
    const level = 'M'
    const [ec, shortBlocks, longBlocks] = ECC_BLOCKS[level][version]
    const total = dataCodewordCount(version, level)
    const blockCount = shortBlocks + longBlocks
    const shortLength = Math.floor(total / blockCount)
    const longCount = total % blockCount
    const data = new Uint8Array(total)
    data.set(sample.subarray(0, Math.min(sample.length, total)))
    let offset = 0
    let allZero = true
    let reported = ''
    for (let index = 0; index < blockCount; index += 1) {
      const length = shortLength + (index >= blockCount - longCount ? 1 : 0)
      const block = data.subarray(offset, offset + length)
      offset += length
      const ecBytes = rsRemainder(block, ec)
      const codeword = new Uint8Array(length + ec)
      codeword.set(block)
      codeword.set(ecBytes, length)
      for (const value of syndromes(codeword, ec)) {
        if (value !== 0) {
          allZero = false
          reported = 'block ' + index + ' syndrome ' + value
        }
      }
    }
    record('reed-solomon syndromes are zero', allZero, allZero ? undefined : reported)
  } catch (error) {
    record('reed-solomon syndromes are zero', false, error?.message ?? String(error))
  }

  // 2. A generated symbol round-trips its own format information.
  try {
    const qr = createQr('https://i.mi.com/note/h5#/', { level: 'M' })
    const decoded = readFormat(qr.modules)
    const expected = (ecLevelBits(qr.level) << 3) | qr.mask
    record('format information round trip', decoded >>> 10 === expected, 'decoded ' + (decoded >>> 10) + ' expected ' + expected)
  } catch (error) {
    record('format information round trip', false, error?.message ?? String(error))
  }

  // 3. The data codewords can be read back out of the finished matrix.
  try {
    const payload = 'mi-note self test payload 0123456789'
    const bytes = Buffer.from(payload, 'utf8')
    const expectedBits = encodeCodewords(bytes, 4, 'M')
    const state = createMatrix(4)
    placeData(state, expectedBits)
    applyMask(state, 3)
    writeFormat(state, 'M', 3)

    const size = state.size
    const extracted = []
    let upward = true
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5
      for (let step = 0; step < size; step += 1) {
        const row = upward ? size - 1 - step : step
        for (let k = 0; k < 2; k += 1) {
          const target = col - k
          if (state.reserved[row][target] === 1) continue
          const dark = state.modules[row][target] ^ (MASKS[3](row, target) ? 1 : 0)
          extracted.push(dark)
        }
      }
      upward = !upward
    }
    let same = true
    for (let i = 0; i < expectedBits.length; i += 1) {
      if (extracted[i] !== expectedBits[i]) {
        same = false
        break
      }
    }
    record('data bits survive masking', same, same ? undefined : 'bit mismatch')
  } catch (error) {
    record('data bits survive masking', false, error?.message ?? String(error))
  }

  // 4. Long payloads escalate to a larger version instead of failing.
  try {
    const long = 'x'.repeat(200)
    const qr = createQr(long, { level: 'M' })
    record('long payload escalates version', qr.version > 6, 'version ' + qr.version)
  } catch (error) {
    record('long payload escalates version', false, error?.message ?? String(error))
  }

  // 5. A payload beyond every supported version fails loudly.
  try {
    createQr('x'.repeat(4000), { level: 'L' })
    record('oversized payload is rejected', false, 'no error raised')
  } catch {
    record('oversized payload is rejected', true)
  }

  // 6. Version information reads back from both copies on a version-10 symbol.
  try {
    const qr = createQr('x'.repeat(200), { level: 'M' })
    const size = qr.size
    const readCopy = swapped => {
      let bits = 0
      for (let i = 0; i < 18; i += 1) {
        const a = size - 11 + (i % 3)
        const b = Math.floor(i / 3)
        const dark = swapped ? qr.modules[b][a] : qr.modules[a][b]
        if (dark === 1) bits |= 1 << i
      }
      return bits >>> 12
    }
    const both = readCopy(false) === qr.version && readCopy(true) === qr.version
    record('version information round trip', both, 'version ' + qr.version + ' copies ' + readCopy(false) + '/' + readCopy(true))
  } catch (error) {
    record('version information round trip', false, error?.message ?? String(error))
  }

  return { ok: checks.every(check => check.ok), checks }
}
