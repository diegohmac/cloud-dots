// Blue-noise spacing: drop any candidate closer than minDist to an already-kept
// point. Iteration order is the sampling order (random), so oversampled bright
// regions settle into even packing while sparse regions pass through untouched.
// A spatial hash grid keeps it O(n).
export function poissonFilter(cand, stride, minDist) {
  const r2 = minDist * minDist
  const grid = new Map()
  const hashKey = (ix, iy, iz) => (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)
  const kept = []
  for (let i = 0; i < cand.length; i += stride) {
    const x = cand[i], y = cand[i + 1], z = cand[i + 2]
    const ix = Math.floor(x / minDist), iy = Math.floor(y / minDist), iz = Math.floor(z / minDist)
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
    for (let s = 0; s < stride; s++) kept.push(cand[i + s])
  }
  return kept
}
