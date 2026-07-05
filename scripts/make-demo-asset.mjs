// Generates the demo .pfc used by the example and the landing page:
// a torus knot with fbm-noise brightness, Poisson-spaced like a real bake.
// No external assets involved. Output is deterministic.
//
//   node scripts/make-demo-asset.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { encodeCloud } from '../src/format.js'
import { poissonFilter } from '../src/sample.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTS = [
  path.join(root, 'site/public/demo.pfc'),
  path.join(root, 'example/public/demo.pfc'),
]

const CANDIDATES = 4_000_000
const TARGET = 280_000
const STRIDE = 7

// deterministic RNG
let seed = 4242
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

// value-noise fbm for organic brightness patches
function vhash(x, y, z) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return h - Math.floor(h)
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = x - xi, yf = y - yi, zf = z - zi
  const s = (t) => t * t * (3 - 2 * t)
  const u = s(xf), v = s(yf), w = s(zf)
  let acc = 0
  for (let dx = 0; dx <= 1; dx++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dz = 0; dz <= 1; dz++) {
        acc += vhash(xi + dx, yi + dy, zi + dz) *
          (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w)
      }
  return acc
}
function fbm(x, y, z) {
  return 0.5 * vnoise(x, y, z) + 0.3 * vnoise(x * 2.1, y * 2.1, z * 2.1) +
    0.2 * vnoise(x * 4.3, y * 4.3, z * 4.3)
}

const geo = new THREE.TorusKnotGeometry(0.42, 0.14, 512, 96)
const pos = geo.attributes.position
const nor = geo.attributes.normal
const idx = geo.index

const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3()
const nA = new THREE.Vector3(), nB = new THREE.Vector3(), nC = new THREE.Vector3()
const cb = new THREE.Vector3(), ab = new THREE.Vector3()

const tris = []
for (let t = 0; t < idx.count / 3; t++) {
  const i0 = idx.getX(t * 3), i1 = idx.getX(t * 3 + 1), i2 = idx.getX(t * 3 + 2)
  vA.fromBufferAttribute(pos, i0)
  vB.fromBufferAttribute(pos, i1)
  vC.fromBufferAttribute(pos, i2)
  cb.subVectors(vC, vB)
  ab.subVectors(vA, vB)
  const area = cb.cross(ab).length() * 0.5
  if (!(area > 0)) continue
  tris.push({ i0, i1, i2, area })
}

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

console.log(`Sampling ${CANDIDATES} candidates on the torus knot...`)
const cand = []
const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }

for (let i = 0; i < CANDIDATES; i++) {
  const tri = pickTri(rand())
  let r1 = rand(), r2 = rand()
  if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2 }
  const r0 = 1 - r1 - r2
  vA.fromBufferAttribute(pos, tri.i0)
  vB.fromBufferAttribute(pos, tri.i1)
  vC.fromBufferAttribute(pos, tri.i2)
  const x = r0 * vA.x + r1 * vB.x + r2 * vC.x
  const y = r0 * vA.y + r1 * vB.y + r2 * vC.y
  const z = r0 * vA.z + r1 * vB.z + r2 * vC.z
  const lum = Math.min(1, Math.max(0.06, fbm(x * 4.5 + 7.3, y * 4.5, z * 4.5) * 1.35))
  if (rand() > 0.02 + 0.98 * Math.pow(lum, 1.3)) continue
  nA.fromBufferAttribute(nor, tri.i0)
  nB.fromBufferAttribute(nor, tri.i1)
  nC.fromBufferAttribute(nor, tri.i2)
  let nx = r0 * nA.x + r1 * nB.x + r2 * nC.x
  let ny = r0 * nA.y + r1 * nB.y + r2 * nC.y
  let nz = r0 * nA.z + r1 * nB.z + r2 * nC.z
  const nl = Math.hypot(nx, ny, nz) || 1
  nx /= nl; ny /= nl; nz /= nl
  cand.push(x, y, z, Math.min(1, 0.3 + lum), nx, ny, nz)
  if (x < bbox.min[0]) bbox.min[0] = x
  if (y < bbox.min[1]) bbox.min[1] = y
  if (z < bbox.min[2]) bbox.min[2] = z
  if (x > bbox.max[0]) bbox.max[0] = x
  if (y > bbox.max[1]) bbox.max[1] = y
  if (z > bbox.max[2]) bbox.max[2] = z
}
console.log(`${cand.length / STRIDE} candidates survived rejection`)

// this surface is mostly bright, so no half-area discount like the CLI uses
const r = Math.sqrt((0.55 * total) / TARGET)
console.log(`Poisson filter, min spacing ${r.toFixed(5)}...`)
const kept = poissonFilter(cand, STRIDE, r)
const count = kept.length / STRIDE
console.log(`Kept ${count} points`)

const encoded = encodeCloud({ count, stride: STRIDE, bbox, data: new Float32Array(kept) })
for (const out of OUTS) {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, Buffer.from(encoded))
  console.log(`Wrote ${path.relative(root, out)} (${(encoded.byteLength / 1e6).toFixed(1)} MB)`)
}
