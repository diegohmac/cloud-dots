import * as THREE from 'three'

const VERT = /* glsl */ `
  attribute float aBrightness;
  attribute vec3 aNormal;

  uniform float uTime;
  uniform float uProgress;
  uniform float uScatter;
  uniform float uPixelRatio;
  uniform float uFocus;
  uniform float uSize;
  uniform float uDrift;
  uniform float uDof;
  uniform float uStyle; // assemble style: 0 scatter, 1 burst, 2 rain, 3 vortex, 4 dissolve
  uniform vec3 uFade; // fadeStart, fadeEnd, fadePower (local Y dissolve)

  varying float vBrightness;
  varying float vAlpha;
  varying float vSoft;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    float h = hash(position);
    vec3 dir = normalize(vec3(
      hash(position + 1.7),
      hash(position + 3.1),
      hash(position + 5.3)
    ) - 0.5);

    // staggered assemble-in; dissolve uses a wider per-dot lag so dots pop
    // in one by one instead of arriving together
    float isDissolve = step(3.5, uStyle);
    float prog = mix(
      clamp(uProgress * 1.25 - h * 0.25, 0.0, 1.0),
      clamp(uProgress * 2.0 - h, 0.0, 1.0),
      isDissolve
    );
    float ease = 1.0 - pow(1.0 - prog, 3.0);
    float back = 1.0 - ease; // how far from settled this dot still is

    vec3 pos = position;
    if (uStyle < 0.5) {
      // scatter: fly in from a random direction (the classic swarm)
      pos += dir * back * (0.9 + 1.4 * h);
    } else if (uStyle < 1.5) {
      // burst: compressed at the core, exploding outward into place
      pos = position * mix(0.04, 1.0, ease) + dir * back * 0.08;
    } else if (uStyle < 2.5) {
      // rain: drop in from above in a staggered curtain
      pos.y += back * (1.1 + 0.9 * h);
      pos.x += dir.x * back * 0.12;
    } else if (uStyle < 3.5) {
      // vortex: spiral in around Y while the angle unwinds
      float ang = back * (2.5 + 3.5 * h);
      float ca = cos(ang);
      float sa = sin(ang);
      pos.xz = mat2(ca, -sa, sa, ca) * pos.xz;
      pos *= 1.0 + back * 0.45;
    }
    // dissolve (4): no displacement, dots materialize in place

    // idle drift: every dot floats on its own little orbit
    float ph = h * 6.2831;
    pos += uDrift * vec3(
      sin(uTime * (0.6 + h * 0.8) + position.y * 21.0 + ph),
      cos(uTime * (0.5 + h * 0.7) + position.x * 18.0 + ph * 0.7),
      sin(uTime * (0.7 + h * 0.6) + position.z * 16.0)
    );

    // ripple impulse
    pos += dir * uScatter * (0.4 + 0.6 * h) * 0.045;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mv.z;

    // hide the inside: fade out points whose surface faces away from the camera
    vec3 n = normalize(normalMatrix * aNormal);
    vec3 viewDir = normalize(-mv.xyz);
    float facing = dot(n, viewDir);
    float vis = smoothstep(-0.08, 0.28, facing);

    // front lighting with falloff so grazing surfaces sink into shadow
    float light = 0.3 + 0.7 * pow(max(facing, 0.0), 1.4);

    // fake depth of field: sharp at uFocus, soft + dim away from it
    float coc = abs(dist - uFocus);
    float blur = smoothstep(0.02, 0.6, coc) * uDof;

    gl_PointSize = uSize * (0.55 + 0.85 * aBrightness) * (1.0 + blur * 2.4)
      * (0.35 + 0.65 * vis)
      * uPixelRatio / dist;

    // optional dissolve along local Y (e.g. let a bust's chest melt away)
    float bodyFade = uFade.z <= 0.0
      ? 1.0
      : pow(smoothstep(uFade.x, uFade.y, position.y), uFade.z);

    vBrightness = aBrightness * light;
    vSoft = blur;
    vAlpha = ease * vis * bodyFade * mix(1.0, 0.14, blur);

    gl_Position = projectionMatrix * mv;
  }
`

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uColor;

  varying float vBrightness;
  varying float vAlpha;
  varying float vSoft;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float edge = mix(0.12, 0.5, vSoft);
    float a = (1.0 - smoothstep(0.5 - edge, 0.5, d)) * vAlpha;
    if (a < 0.02) discard;
    vec3 col = uColor * (0.3 + 0.85 * vBrightness);
    gl_FragColor = vec4(col, a);
  }
`

export function buildGeometry(cloud) {
  const interleaved = new THREE.InterleavedBuffer(cloud.data, cloud.stride)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 0))
  geometry.setAttribute('aBrightness', new THREE.InterleavedBufferAttribute(interleaved, 1, 3))
  geometry.setAttribute('aNormal', new THREE.InterleavedBufferAttribute(interleaved, 3, 4))
  const size = Math.max(
    cloud.bbox.max[0] - cloud.bbox.min[0],
    cloud.bbox.max[1] - cloud.bbox.min[1],
    cloud.bbox.max[2] - cloud.bbox.min[2]
  )
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), size * 1.5)
  return geometry
}

/** Entrance styles: how dots travel to their spot while assembling. */
export const ASSEMBLE_STYLES = {
  scatter: 0,  // fly in from random directions (default)
  burst: 1,    // explode outward from the core
  rain: 2,     // drop in from above
  vortex: 3,   // spiral in around the Y axis
  dissolve: 4, // materialize in place, dot by dot
}

export const DEFAULTS = {
  size: 1.7,          // dot size in CSS px at 1 world unit
  drift: 0.0042,      // idle float amplitude (world units)
  focus: 1.4,         // camera distance of the sharp plane
  dof: 1,             // 0 disables the fake depth of field
  density: 1,         // fraction of baked points drawn
  color: '#f5f2ed',
  offset: [0, 0, 0],  // shifts the cloud after bbox centering (pick the pivot)
  rotationY: 0,       // base orientation fix, e.g. -Math.PI / 2
  fade: null,         // { start, end, power } dissolve along local Y, or null
  assemble: 2.6,      // seconds for the entrance; 0 skips it
  assembleStyle: 'scatter', // one of ASSEMBLE_STYLES
}

/**
 * Scene-level building block: owns the THREE.Points + shader material.
 * Add `face.object3d` to any scene and call `face.update(dt)` per frame.
 */
export class ParticleFace {
  constructor(cloud, options = {}) {
    this.options = { ...DEFAULTS, ...options }
    const o = this.options

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: o.assemble > 0 ? 0 : 1 },
        uScatter: { value: 0 },
        uPixelRatio: { value: 1 },
        uFocus: { value: o.focus },
        uSize: { value: o.size },
        uDrift: { value: o.drift },
        uDof: { value: o.dof },
        uStyle: { value: ASSEMBLE_STYLES[o.assembleStyle] ?? 0 },
        uColor: { value: new THREE.Color(o.color) },
        uFade: {
          value: o.fade
            ? new THREE.Vector3(o.fade.start, o.fade.end, o.fade.power ?? 1)
            : new THREE.Vector3(0, 0, 0),
        },
      },
    })

    this.points = new THREE.Points(undefined, this.material)
    this.pivot = new THREE.Group()
    this.pivot.rotation.y = o.rotationY
    this.pivot.add(this.points)
    this.object3d = new THREE.Group()
    this.object3d.add(this.pivot)

    this._elapsed = 0
    this._scatter = 0
    this.setCloud(cloud)
  }

  setCloud(cloud) {
    const old = this.points.geometry
    this.cloud = cloud
    this.points.geometry = buildGeometry(cloud)
    this._applyDensity()
    const o = this.options
    const c = cloud.bbox
    this.points.position.set(
      -(c.min[0] + c.max[0]) / 2 + o.offset[0],
      -(c.min[1] + c.max[1]) / 2 + o.offset[1],
      -(c.min[2] + c.max[2]) / 2 + o.offset[2]
    )
    if (old) old.dispose()
  }

  /** Advance animation; call once per rendered frame. */
  update(dt) {
    this._elapsed += dt
    const u = this.material.uniforms
    u.uTime.value = this._elapsed
    if (this.options.assemble > 0 && u.uProgress.value < 1) {
      u.uProgress.value = Math.min(1, u.uProgress.value + dt / this.options.assemble)
    }
    this._scatter *= Math.pow(0.04, dt)
    u.uScatter.value = this._scatter
  }

  /** Send a ripple through the cloud. */
  pulse(strength = 1.6) {
    this._scatter = strength
  }

  /** Restart the assemble-in entrance. */
  replay() {
    this.material.uniforms.uProgress.value = 0
  }

  /** Update visual knobs: size, drift, focus, dof, density, color, fade, assembleStyle. */
  set(values) {
    const u = this.material.uniforms
    const map = { size: 'uSize', drift: 'uDrift', focus: 'uFocus', dof: 'uDof' }
    for (const [key, value] of Object.entries(values)) {
      this.options[key] = value
      if (map[key]) u[map[key]].value = value
      else if (key === 'color') u.uColor.value.set(value)
      else if (key === 'density') this._applyDensity()
      else if (key === 'assembleStyle') u.uStyle.value = ASSEMBLE_STYLES[value] ?? 0
      else if (key === 'fade') {
        u.uFade.value.set(value?.start ?? 0, value?.end ?? 0, value ? value.power ?? 1 : 0)
      }
    }
  }

  /** The viewer (or host app) reports the renderer's pixel ratio here. */
  setPixelRatio(dpr) {
    this.material.uniforms.uPixelRatio.value = dpr
  }

  _applyDensity() {
    this.points.geometry.setDrawRange(0, Math.floor(this.cloud.count * this.options.density))
  }

  dispose() {
    this.points.geometry.dispose()
    this.material.dispose()
    this.object3d.removeFromParent()
  }
}
