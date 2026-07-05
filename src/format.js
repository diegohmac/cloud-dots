// The .pfc ("particle face cloud") single-file binary format.
//
// Layout (little-endian):
//   bytes  0-3   magic "PFC1"
//   bytes  4-7   uint32  format version (1)
//   bytes  8-11  uint32  point count
//   bytes 12-15  uint32  stride (floats per point; 7 = x,y,z,brightness,nx,ny,nz)
//   bytes 16-39  float32[6] bbox: minX,minY,minZ,maxX,maxY,maxZ
//   bytes 40-    float32[count*stride] point data

const MAGIC = 0x31434650 // "PFC1" read as LE uint32
const HEADER_BYTES = 40

export function encodeCloud({ count, stride, bbox, data }) {
  const buf = new ArrayBuffer(HEADER_BYTES + data.length * 4)
  const view = new DataView(buf)
  view.setUint32(0, MAGIC, true)
  view.setUint32(4, 1, true)
  view.setUint32(8, count, true)
  view.setUint32(12, stride, true)
  const flat = [...bbox.min, ...bbox.max]
  for (let i = 0; i < 6; i++) view.setFloat32(16 + i * 4, flat[i], true)
  new Float32Array(buf, HEADER_BYTES).set(data)
  return buf
}

export function decodeCloud(buf) {
  const view = new DataView(buf)
  if (buf.byteLength < HEADER_BYTES || view.getUint32(0, true) !== MAGIC) {
    throw new Error('cloud-dots: not a .pfc file (bad magic)')
  }
  const version = view.getUint32(4, true)
  if (version !== 1) {
    throw new Error(`cloud-dots: unsupported .pfc version ${version}`)
  }
  const count = view.getUint32(8, true)
  const stride = view.getUint32(12, true)
  const b = []
  for (let i = 0; i < 6; i++) b.push(view.getFloat32(16 + i * 4, true))
  const bbox = { min: b.slice(0, 3), max: b.slice(3) }
  const expected = HEADER_BYTES + count * stride * 4
  if (buf.byteLength < expected) {
    throw new Error(`cloud-dots: truncated .pfc file (${buf.byteLength} < ${expected} bytes)`)
  }
  const data = new Float32Array(buf, HEADER_BYTES, count * stride)
  return { count, stride, bbox, data }
}

export async function loadCloud(url, onProgress) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`cloud-dots: failed to fetch ${url} (${res.status})`)
  if (!onProgress || !res.body) {
    return decodeCloud(await res.arrayBuffer())
  }
  const total = +res.headers.get('content-length') || 0
  const reader = res.body.getReader()
  const chunks = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total) onProgress(Math.min(1, received / total))
  }
  const buf = new Uint8Array(received)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.length
  }
  onProgress(1)
  return decodeCloud(buf.buffer)
}
