import { ParticleFaceViewer } from 'cloud-dots'

const query = new URLSearchParams(location.search)
const snap = query.has('snap')
if (snap) {
  document.body.classList.add('snap')
  document.documentElement.style.scrollBehavior = 'auto'
  if (query.has('nohero')) document.body.classList.add('nohero')
}

const viewer = new ParticleFaceViewer(document.getElementById('stage'), {
  src: `${import.meta.env.BASE_URL}demo.pfc`,
  position: [0.32, 0.02, -0.08],
  focus: 1.7,
  fade: null,
  assemble: snap ? 0 : 2.6,
})

// slow ambient spin so the knot never sits still
viewer.ready.then((face) => {
  const spin = () => {
    face.pivot.rotation.y += 0.0016
    requestAnimationFrame(spin)
  }
  spin()
})

// ---- live controls ----
const bind = (id, key) => {
  document.getElementById(id).addEventListener('input', (e) => {
    viewer.set({ [key]: +e.target.value })
  })
}
bind('ctlSize', 'size')
bind('ctlDrift', 'drift')
bind('ctlFocus', 'focus')
bind('ctlDensity', 'density')

document.getElementById('ctlEntrance').addEventListener('change', (e) => {
  viewer.set({ assembleStyle: e.target.value })
  viewer.face?.replay()
})

document.getElementById('ctlPulse').addEventListener('click', () => viewer.pulse(2))
document.getElementById('ctlReplay').addEventListener('click', () => viewer.face?.replay())

// ---- copy install command ----
const copyBtn = document.getElementById('copyBtn')
copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(document.getElementById('installCmd').textContent)
  copyBtn.textContent = 'COPIED'
  copyBtn.classList.add('done')
  setTimeout(() => {
    copyBtn.textContent = 'COPY'
    copyBtn.classList.remove('done')
  }, 1600)
})
