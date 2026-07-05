import GUI from 'lil-gui'
import { ParticleFaceViewer } from 'cloud-dots'

const query = new URLSearchParams(location.search)
const snap = query.has('snap')

// Try your own bake: put it in example/public/ and open /?src=/yourfile.pfc
// Face scans usually want framing options like:
//   rotationY: -Math.PI / 2, offset: [0, -0.25, 0], position: [0, 0.12, 0.72],
//   fade: { start: -0.38, end: 0, power: 1.6 }
const viewer = new ParticleFaceViewer(document.getElementById('stage'), {
  src: query.get('src') || '/demo.pfc',
  position: [0, 0, 0.2],
  assemble: snap ? 0 : 2.6,
})

await viewer.ready

const params = {
  size: 1.7,
  drift: 0.0042,
  focus: viewer.face.options.focus,
  dof: 1,
  density: 1,
  color: '#f5f2ed',
  pulse: () => viewer.pulse(2),
  replay: () => viewer.face.replay(),
}
const gui = new GUI({ title: 'CLOUD-DOTS' })
gui.add(params, 'size', 0.4, 5, 0.05).onChange((v) => viewer.set({ size: v }))
gui.add(params, 'drift', 0, 0.02, 0.0005).onChange((v) => viewer.set({ drift: v }))
gui.add(params, 'focus', 0.6, 2.2, 0.01).onChange((v) => viewer.set({ focus: v }))
gui.add(params, 'dof', 0, 1, 0.01).onChange((v) => viewer.set({ dof: v }))
gui.add(params, 'density', 0.05, 1, 0.01).onChange((v) => viewer.set({ density: v }))
gui.addColor(params, 'color').onChange((v) => viewer.set({ color: v }))
gui.add(params, 'pulse')
gui.add(params, 'replay')
