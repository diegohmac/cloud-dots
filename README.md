# cloud-dots

Render pre-baked 3D scans as animated particle clouds — the "dotted face" effect
seen on studio team pages. A scan becomes ~370k tiny dots whose density and
brightness follow the model's texture, with fake depth of field, per-dot idle
drift, an assemble-in entrance, ripple pulses, and mouse parallax.

**Live demo: https://diegohmac.github.io/cloud-dots/**

Runtime input is **pre-baked `.pfc` binaries only** (fast to load, one file);
the bundled CLI turns an FBX + texture into one.

## Install

```sh
npm i github:diegohmac/cloud-dots three
```

`three` is a peer dependency (>= 0.160).

## 1. Bake your model once

```sh
npx cloud-dots-bake model.fbx -o public/face.pfc --poisson
```

Samples millions of candidate points on the mesh surface (area-weighted),
keeps them with probability proportional to the basecolor texture's luminance
(bright skin = dense dots, shadows = sparse), and writes a single `.pfc` file
with positions, brightness, and normals.

- The texture is auto-detected in the sibling `model.fbm/` folder, or pass
  `-t texture.jpg` (jpg only), or `--no-texture` for flat brightness.
- `--poisson` adds a blue-noise spacing pass: oversamples 12M candidates, then
  drops any point closer than a minimum distance to an already-kept one, so
  bright areas pack evenly (bubbly stipple) instead of clumping. Slower bake,
  nicer result.
- More knobs: `--candidates`, `--target`, `--gamma`, `--floor`, `--seed`
  (bakes are deterministic for a given seed).

## 2a. Drop-in viewer (no three.js setup needed)

```js
import { ParticleFaceViewer } from 'cloud-dots'

const viewer = new ParticleFaceViewer(containerOrCanvas, {
  src: '/face.pfc',
  background: '#0b0b0b',        // or 'transparent' to overlay your page
  position: [0, 0.12, 0.72],    // push the cloud toward/away from the camera
  rotationY: -Math.PI / 2,      // orientation fix if the scan doesn't face +Z
  offset: [0, -0.25, 0],        // move the pivot (e.g. rotate around the face)
  fade: { start: -0.38, end: 0, power: 1.6 }, // dissolve chest along local Y
  parallax: { x: 0.32, y: 0.14 }, // radians at screen edges; false disables
})

await viewer.ready
viewer.pulse()                  // ripple through the cloud
viewer.set({ size: 2.2 })       // any visual knob, live
viewer.load('/other.pfc')       // swap clouds (cached per URL)
viewer.dispose()
```

The viewer owns the canvas, camera, resize handling (ResizeObserver), pixel
ratio, and the render loop.

## 2b. Inside an existing three.js scene

```js
import { ParticleFace, loadCloud } from 'cloud-dots'

const cloud = await loadCloud('/face.pfc', (p) => console.log(p))
const face = new ParticleFace(cloud, { size: 1.7, fade: null })
scene.add(face.object3d)
face.setPixelRatio(renderer.getPixelRatio())

// in your render loop:
face.update(dt)
```

Works the same under React Three Fiber — create the `ParticleFace` in a memo,
add `face.object3d` via `<primitive>`, call `face.update(dt)` in `useFrame`.

## Visual knobs

| Option | Default | Meaning |
| --- | --- | --- |
| `size` | `1.7` | dot size (CSS px at 1 world unit away) |
| `drift` | `0.0042` | idle float amplitude — the "alive" wobble |
| `focus` | front of cloud | camera distance of the sharp plane |
| `dof` | `1` | fake depth-of-field strength, `0` = off |
| `density` | `1` | fraction of baked points drawn (uniform thinning) |
| `color` | `#f5f2ed` | dot tint |
| `fade` | `null` | `{ start, end, power }` dissolve along local Y |
| `assemble` | `2.6` | entrance duration in seconds, `0` = skip |
| `rotationY` | `0` | base orientation fix |
| `offset` | `[0,0,0]` | pivot shift after bbox centering |

All except `assemble`/`rotationY`/`offset` can be changed live via `set()`.

## The .pfc format

Little-endian binary: magic `PFC1`, uint32 version, uint32 count, uint32 stride
(7), float32[6] bbox, then `count * stride` float32s — per point: x, y, z,
brightness, nx, ny, nz. Normals let the shader hide back-facing points (so the
cloud reads as a solid, not a see-through shell) and drive soft front lighting.
Encode/decode helpers are exported (`encodeCloud`, `decodeCloud`, `loadCloud`).

## Example

```sh
npm install
npm run dev
```

Serves `example/` — a full-screen cloud with a lil-gui panel exposing every
knob. The demo asset is a procedurally generated torus knot (regenerate it with
`node scripts/make-demo-asset.mjs`); no scan data ships with this repo. To view
your own bake, drop the file into `example/public/` and open
`/?src=/yourfile.pfc`.

The landing page in `site/` runs on the same library (`npm run dev:site`) and
deploys to GitHub Pages from `.github/workflows/deploy.yml`.

## Notes

- Bake input is FBX only for now (three's FBXLoader runs headless in Node with
  small DOM stubs). GLB support would need texture-decode work in Node.
- Point order in `.pfc` is sampling order (effectively random), which is what
  makes `density` thinning uniform — preserve that if you generate files
  yourself.
