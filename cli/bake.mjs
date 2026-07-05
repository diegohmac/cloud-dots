#!/usr/bin/env node
// Bakes an FBX mesh into a .pfc point-cloud file for cloud-dots.
//
//   cloud-dots-bake <model.fbx> -o <out.pfc> [options]
//
//   -o, --out <file>      output path (default: <input>.pfc)
//   -t, --texture <file>  basecolor texture (jpg). Default: first jpg found
//                         in the sibling <input>.fbm/ folder
//   --no-texture          flat brightness instead of texture luminance
//   --poisson             blue-noise spacing pass (even, bubble-like packing)
//   --candidates <n>      surface samples tried (default 3.6M, 12M with --poisson)
//   --target <n>          kept-point goal in poisson mode (default 400000)
//   --gamma <n>           luminance -> keep-probability curve (default 1.45)
//   --floor <n>           minimum keep probability in dark areas (default 0.012)
//   --seed <n>            RNG seed (default 1337)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeCloud } from '../src/format.js'

function fail(msg) {
  console.error(`cloud-dots-bake: ${msg}`)
  process.exit(1)
}

// ---- args ----
const argv = process.argv.slice(2)
const args = { _: [] }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '-o' || a === '--out') args.out = argv[++i]
  else if (a === '-t' || a === '--texture') args.texture = argv[++i]
  else if (a === '--no-texture') args.noTexture = true
  else if (a === '--poisson') args.poisson = true
  else if (a === '--candidates') args.candidates = +argv[++i]
  else if (a === '--target') args.target = +argv[++i]
  else if (a === '--gamma') args.gamma = +argv[++i]
  else if (a === '--floor') args.floor = +argv[++i]
  else if (a === '--seed') args.seed = +argv[++i]
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0) }
  else if (a.startsWith('-')) fail(`unknown option ${a}`)
  else args._.push(a)
}

const INPUT = args._[0]
if (!INPUT) fail('usage: cloud-dots-bake <model.fbx> -o <out.pfc> [--poisson]')
if (!fs.existsSync(INPUT)) fail(`input not found: ${INPUT}`)
if (path.extname(INPUT).toLowerCase() !== '.fbx') fail('only .fbx input is supported for now')

const OUT = args.out || INPUT.replace(/\.fbx$/i, '.pfc')
const POISSON = !!args.poisson
const CANDIDATES = args.candidates || (POISSON ? 12_000_000 : 3_600_000)
const TARGET = args.target || 400_000
const GAMMA = args.gamma ?? 1.45
const FLOOR = args.floor ?? 0.012

// ---- texture ----
let sampleLum = () => 0.7
if (!args.noTexture) {
  let texPath = args.texture
  if (!texPath) {
    const fbm = INPUT.replace(/\.fbx$/i, '.fbm')
    if (fs.existsSync(fbm)) {
      texPath = fs.readdirSync(fbm)
        .filter((f) => /\.jpe?g$/i.test(f))
        .map((f) => path.join(fbm, f))[0]
    }
  }
  if (!texPath) fail('no texture found; pass -t <file.jpg> or --no-texture')
  const { default: jpeg } = await import('jpeg-js')
  console.log(`Decoding texture ${texPath}...`)
  const tex = jpeg.decode(fs.readFileSync(texPath), { useTArray: true, maxMemoryUsageInMB: 4096 })
  console.log(`  ${tex.width}x${tex.height}`)
  sampleLum = (u, v) => {
    u = u - Math.floor(u)
    v = v - Math.floor(v)
    const x = Math.min(tex.width - 1, Math.floor(u * tex.width))
    const y = Math.min(tex.height - 1, Math.floor((1 - v) * tex.height))
    const i = (y * tex.width + x) * 4
    return (0.2126 * tex.data[i] + 0.7152 * tex.data[i + 1] + 0.0722 * tex.data[i + 2]) / 255
  }
}

// ---- parse FBX (three's loader expects a browser; geometry only needs stubs) ----
globalThis.self = globalThis
globalThis.window = globalThis
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} }),
  createElement: () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {}, getContext: () => null }),
}
const THREE = await import('three')
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')

console.log(`Parsing ${INPUT}...`)
const buf = fs.readFileSync(INPUT)
let group
try {
  group = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
} catch (e) {
  fail(`FBX parse failed: ${e.message}`)
}
group.updateMatrixWorld(true)

const tris = []
const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3()
const nA = new THREE.Vector3(), nB = new THREE.Vector3(), nC = new THREE.Vector3()
const cb = new THREE.Vector3(), ab = new THREE.Vector3()
const nm = new THREE.Matrix3()

group.traverse((obj) => {
  if (!obj.isMesh) return
  const geo = obj.geometry
  if (!geo.attributes.normal) geo.computeVertexNormals()
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const nor = geo.attributes.normal
  console.log(`  mesh "${obj.name}": ${pos.count} verts, uv: ${!!uv}, indexed: ${!!geo.index}`)
  const m = obj.matrixWorld
  nm.getNormalMatrix(m)
  const idx = geo.index
  const triCount = idx ? idx.count / 3 : pos.count / 3
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
    vA.fromBufferAttribute(pos, i0).applyMatrix4(m)
    vB.fromBufferAttribute(pos, i1).applyMatrix4(m)
    vC.fromBufferAttribute(pos, i2).applyMatrix4(m)
    nA.fromBufferAttribute(nor, i0).applyMatrix3(nm)
    nB.fromBufferAttribute(nor, i1).applyMatrix3(nm)
    nC.fromBufferAttribute(nor, i2).applyMatrix3(nm)
    cb.subVectors(vC, vB)
    ab.subVectors(vA, vB)
    const area = cb.cross(ab).length() * 0.5
    if (!(area > 0)) continue
    tris.push({
      ax: vA.x, ay: vA.y, az: vA.z,
      bx: vB.x, by: vB.y, bz: vB.z,
      cx: vC.x, cy: vC.y, cz: vC.z,
      nax: nA.x, nay: nA.y, naz: nA.z,
      nbx: nB.x, nby: nB.y, nbz: nB.z,
      ncx: nC.x, ncy: nC.y, ncz: nC.z,
      ua: uv ? uv.getX(i0) : 0, va: uv ? uv.getY(i0) : 0,
      ub: uv ? uv.getX(i1) : 0, vb: uv ? uv.getY(i1) : 0,
      uc: uv ? uv.getX(i2) : 0, vc: uv ? uv.getY(i2) : 0,
      area,
    })
  }
})

if (!tris.length) fail('no triangles found in FBX')
console.log(`  ${tris.length} triangles`)

// area-weighted CDF
const cdf = new Float64Array(tris.length)
let total = 0
for (let i = 0; i < tris.length; i++) { total += tris[i].area; cdf[i] = total }

function pickTri(r) {
  let lo = 0, hi = cdf.length - 1
  const target = r * total
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cdf[mid] < target) lo = mid + 1
    else hi = mid
  }
  return tris[lo]
}

// deterministic RNG so re-bakes are stable
let seed = args.seed ?? 1337
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

console.log(`Sampling ${CANDIDATES} candidates...`)
const STRIDE = 7
const cand = []
const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }

for (let i = 0; i < CANDIDATES; i++) {
  const tri = pickTri(rand())
  let r1 = rand(), r2 = rand()
  if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2 }
  const r0 = 1 - r1 - r2
  const u = r0 * tri.ua + r1 * tri.ub + r2 * tri.uc
  const v = r0 * tri.va + r1 * tri.vb + r2 * tri.vc
  const lum = sampleLum(u, v)
  // density follows luminance: bright areas = dense dots, shadow = sparse
  if (rand() > FLOOR + (1 - FLOOR) * Math.pow(lum, GAMMA)) continue
  const x = r0 * tri.ax + r1 * tri.bx + r2 * tri.cx
  const y = r0 * tri.ay + r1 * tri.by + r2 * tri.cy
  const z = r0 * tri.az + r1 * tri.bz + r2 * tri.cz
  let nx = r0 * tri.nax + r1 * tri.nbx + r2 * tri.ncx
  let ny = r0 * tri.nay + r1 * tri.nby + r2 * tri.ncy
  let nz = r0 * tri.naz + r1 * tri.nbz + r2 * tri.ncz
  const nl = Math.hypot(nx, ny, nz) || 1
  nx /= nl; ny /= nl; nz /= nl
  cand.push(x, y, z, Math.min(1, 0.25 + lum), nx, ny, nz)
  if (x < bbox.min[0]) bbox.min[0] = x
  if (y < bbox.min[1]) bbox.min[1] = y
  if (z < bbox.min[2]) bbox.min[2] = z
  if (x > bbox.max[0]) bbox.max[0] = x
  if (y > bbox.max[1]) bbox.max[1] = y
  if (z > bbox.max[2]) bbox.max[2] = z
}
console.log(`${cand.length / STRIDE} candidates survived luminance rejection`)

let kept = cand
if (POISSON) {
  // Blue-noise spacing: drop any candidate closer than r to an already-kept
  // point. Bright (oversampled) regions settle into even packing; dark regions
  // stay sparse. Spatial hash grid keeps it O(n).
  const r = Math.sqrt((0.55 * total * 0.5) / TARGET)
  const r2 = r * r
  console.log(`Poisson filter, min spacing ${r.toFixed(5)}...`)
  const grid = new Map()
  const hashKey = (ix, iy, iz) => (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)
  kept = []
  for (let i = 0; i < cand.length; i += STRIDE) {
    const x = cand[i], y = cand[i + 1], z = cand[i + 2]
    const ix = Math.floor(x / r), iy = Math.floor(y / r), iz = Math.floor(z / r)
    let ok = true
    outer: for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(hashKey(ix + dx, iy + dy, iz + dz))
          if (!bucket) continue
          for (const j of bucket) {
            const ddx = cand[j] - x, ddy = cand[j + 1] - y, ddz = cand[j + 2] - z
            if (ddx * ddx + ddy * ddy + ddz * ddz < r2) { ok = false; break outer }
          }
        }
    if (!ok) continue
    const k = hashKey(ix, iy, iz)
    let bucket = grid.get(k)
    if (!bucket) { bucket = []; grid.set(k, bucket) }
    bucket.push(i)
    for (let s = 0; s < STRIDE; s++) kept.push(cand[i + s])
  }
}

const count = kept.length / STRIDE
console.log(`Kept ${count} points`)

const encoded = encodeCloud({ count, stride: STRIDE, bbox, data: new Float32Array(kept) })
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
fs.writeFileSync(OUT, Buffer.from(encoded))
console.log(`Wrote ${OUT} (${(encoded.byteLength / 1e6).toFixed(1)} MB)`)
