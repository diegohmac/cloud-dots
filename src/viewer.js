import * as THREE from 'three'
import { ParticleFace } from './core.js'
import { loadCloud } from './format.js'

const VIEWER_DEFAULTS = {
  fov: 34,
  cameraDistance: 2.1,
  position: [0, 0, 0],      // where the cloud sits in front of the camera
  parallax: { x: 0.32, y: 0.14 }, // radians of tilt at screen edges; false disables
  background: '#0b0b0b',    // or 'transparent'
  maxPixelRatio: 2,
}

/**
 * Turnkey renderer: owns canvas, camera, resize and the render loop.
 * For integrating into an existing three.js scene use ParticleFace directly.
 */
export class ParticleFaceViewer {
  constructor(target, options = {}) {
    this.options = { ...VIEWER_DEFAULTS, ...options }
    const o = this.options

    this.canvas = target instanceof HTMLCanvasElement ? target : document.createElement('canvas')
    if (this.canvas !== target) {
      this.canvas.style.cssText = 'width:100%;height:100%;display:block'
      target.appendChild(this.canvas)
    }

    const transparent = o.background === 'transparent'
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: transparent,
    })
    if (transparent) this.renderer.setClearColor(0x000000, 0)
    else this.renderer.setClearColor(new THREE.Color(o.background), 1)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(o.fov, 1, 0.1, 50)
    this.camera.position.set(0, 0, o.cameraDistance)

    this.face = null
    this._clouds = new Map()
    this._mouse = { x: 0, y: 0 }
    this._disposed = false

    this._onPointerMove = (e) => {
      this._mouse.x = (e.clientX / window.innerWidth) * 2 - 1
      this._mouse.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    if (o.parallax) window.addEventListener('pointermove', this._onPointerMove)

    this._resize = () => {
      const w = this.canvas.clientWidth || 1
      const h = this.canvas.clientHeight || 1
      const dpr = Math.min(window.devicePixelRatio, o.maxPixelRatio)
      this.renderer.setPixelRatio(dpr)
      this.renderer.setSize(w, h, false)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      this.face?.setPixelRatio(dpr)
    }
    this._observer = new ResizeObserver(this._resize)
    this._observer.observe(this.canvas)
    this._resize()

    this._clock = new THREE.Clock()
    const frame = () => {
      if (this._disposed) return
      this._raf = requestAnimationFrame(frame)
      const dt = Math.min(this._clock.getDelta(), 0.05)
      if (this.face) {
        this.face.update(dt)
        if (o.parallax) {
          const damp = 1 - Math.pow(0.002, dt)
          const holder = this.face.object3d
          holder.rotation.y += (this._mouse.x * o.parallax.x - holder.rotation.y) * damp
          holder.rotation.x += (this._mouse.y * o.parallax.y - holder.rotation.x) * damp
        }
      }
      this.renderer.render(this.scene, this.camera)
    }
    frame()

    this.ready = o.src ? this.load(o.src, o.onProgress) : Promise.resolve(null)
  }

  /** Load a .pfc file (cached per URL) and show it, replacing any current cloud. */
  async load(src, onProgress) {
    if (!this._clouds.has(src)) {
      this._clouds.set(src, await loadCloud(src, onProgress))
    }
    const cloud = this._clouds.get(src)
    if (this.face) {
      this.face.setCloud(cloud)
    } else {
      // default focus: the sharp plane sits on the front of the cloud
      const o = this.options
      const focus = o.focus ?? o.cameraDistance - o.position[2] -
        (cloud.bbox.max[2] - cloud.bbox.min[2]) * 0.25
      this.face = new ParticleFace(cloud, { ...o, focus })
      this.face.object3d.position.fromArray(o.position)
      this.face.setPixelRatio(Math.min(window.devicePixelRatio, o.maxPixelRatio))
      this.scene.add(this.face.object3d)
    }
    return this.face
  }

  pulse(strength) {
    this.face?.pulse(strength)
  }

  set(values) {
    this.face?.set(values)
  }

  dispose() {
    this._disposed = true
    cancelAnimationFrame(this._raf)
    this._observer.disconnect()
    window.removeEventListener('pointermove', this._onPointerMove)
    this.face?.dispose()
    this.renderer.dispose()
  }
}
