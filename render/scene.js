// "Duckling After the Rain" — 15 s musical 3D cartoon.
// Everything is a pure function of time t (seconds), so frames render deterministically.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

const W = window.RENDER_W || 1920, H = window.RENDER_H || 1080;
const LIP = await (await fetch('../audio/out/lipsync.json')).json();
const BEAT = LIP.beat;

// ------------------------------------------------------------------ helpers
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };
const smoother = (u) => { u = clamp(u); return u * u * u * (u * (u * 6 - 15) + 10); };
const seg = (t, t0, t1) => smooth((t - t0) / (t1 - t0));
let seed = 12345;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const lipAt = (arr, t) => {
  const f = t * LIP.fps; const i = Math.floor(f); const a = arr[clamp(i, 0, arr.length - 1)] || 0;
  const b = arr[clamp(i + 1, 0, arr.length - 1)] || 0; return lerp(a, b, f - i);
};

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(31, W / H, 0.1, 200);

// ------------------------------------------------------------------ materials
const mats = {};
const M = (key, opts) => (mats[key] ||= new THREE.MeshPhysicalMaterial(opts));
const std = (color, rough = 0.7, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: rough, ...extra });
const SPH = new THREE.SphereGeometry(1, 48, 32);
const SPH_LO = new THREE.SphereGeometry(1, 20, 14);
function ball(mat, sx, sy, sz, x = 0, y = 0, z = 0, geo = SPH) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy ?? sx, sz ?? sx); m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
const group = (...kids) => { const g = new THREE.Group(); kids.forEach(k => g.add(k)); return g; };

// ------------------------------------------------------------------ lights
const hemi = new THREE.HemisphereLight(0xd2ecff, 0x7fbf5e, 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d2, 2.7);
sun.position.set(-6, 10, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -7; sun.shadow.camera.right = 7;
sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -5;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 30;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 6;
scene.add(sun); scene.add(sun.target);
const fill = new THREE.DirectionalLight(0xd8ecff, 0.7);
fill.position.set(6, 4, 8); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.9);
rim.position.set(2, 5, -8); scene.add(rim);

// ------------------------------------------------------------------ sky
const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: {},
  vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `varying vec3 vP; void main(){
    float h = clamp(vP.y*1.6+0.05, 0., 1.);
    vec3 top = vec3(0.22,0.56,0.96), mid = vec3(0.47,0.76,1.0), hor = vec3(0.85,0.94,1.0);
    vec3 c = mix(hor, mid, smoothstep(0.,0.35,h)); c = mix(c, top, smoothstep(0.35,1.,h));
    // warm glow around the sun (upper left)
    vec3 sd = normalize(vec3(-0.55,0.42,-0.72)); float g = max(dot(vP, sd),0.);
    c += vec3(1.0,0.93,0.7)*pow(g,24.)*0.55 + vec3(1.,0.95,0.8)*pow(g,4.)*0.12;
    gl_FragColor = vec4(c,1.);
    #include <colorspace_fragment>
  }`,
}));
scene.add(sky);

// sun disc (soft, cartoon)
const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), new THREE.MeshBasicMaterial({ color: 0xfff6c9, toneMapped: false, fog: false }));
sunDisc.position.set(-44, 34, -58); sunDisc.lookAt(0, 0, 0); scene.add(sunDisc);

// rainbow (after the rain) — concentric soft arcs far away
{
  const cols = [0xff8a8a, 0xffc078, 0xfff08a, 0x9be59b, 0x8ecbff, 0xc4a5ff];
  const rb = new THREE.Group();
  cols.forEach((c, i) => {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(24 - i * 0.95, 0.5, 8, 96, Math.PI),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.32, depthWrite: false, fog: false }));
    rb.add(arc);
  });
  rb.position.set(14, -4, -62); rb.rotation.y = -0.25;
  scene.add(rb);
}

// clouds
const clouds = [];
function cloud(x, y, z, s) {
  const m = std(0xffffff, 1, { emissive: 0xffffff, emissiveIntensity: 0.35 });
  const g = new THREE.Group();
  [[0, 0, 0, 1.4], [1.4, -0.2, 0, 1.1], [-1.4, -0.25, 0, 1.0], [0.6, 0.6, 0, 1.0], [-0.6, 0.45, 0.1, 0.9], [2.4, -0.4, 0, 0.7], [-2.3, -0.45, 0, 0.65]]
    .forEach(([a, b, c, r]) => { const p = ball(m, r, r * 0.85, r, a, b, c, SPH_LO); p.castShadow = false; g.add(p); });
  g.position.set(x, y, z); g.scale.setScalar(s); scene.add(g); clouds.push({ g, x0: x });
}
cloud(-22, 15, -55, 2.2); cloud(8, 19, -60, 2.6); cloud(30, 13, -58, 2.0); cloud(-6, 11, -48, 1.4);

// ------------------------------------------------------------------ ground
{
  const geo = new THREE.PlaneGeometry(80, 60, 160, 120);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position; const col = [];
  const c1 = new THREE.Color(0x86cf55), c2 = new THREE.Color(0x63b646), c3 = new THREE.Color(0x9ad862);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const far = clamp((-z - 4) / 10);
    const h = far * (0.9 * Math.sin(x * 0.18) + 0.6 * Math.cos(x * 0.11 + z * 0.2) + 1.2) * 0.9;
    pos.setY(i, h);
    const n = 0.5 + 0.5 * Math.sin(x * 1.7 + Math.cos(z * 1.3) * 2) * Math.cos(z * 1.1 - x * 0.4);
    const c = c2.clone().lerp(c1, n).lerp(c3, far * 0.5);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  ground.receiveShadow = true; scene.add(ground);
}

// ------------------------------------------------------------------ puddle (real reflection)
const PUD = { x: 0.05, z: 0.45, rx: 0.95, rz: 0.6 };
const puddleShape = new THREE.Shape();
{
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 1 + 0.07 * Math.sin(a * 3 + 1) + 0.04 * Math.cos(a * 5);
    const x = Math.cos(a) * PUD.rx * r, y = Math.sin(a) * PUD.rz * r;
    i ? puddleShape.lineTo(x, y) : puddleShape.moveTo(x, y);
  }
}
const puddleGeo = new THREE.ShapeGeometry(puddleShape, 32);
puddleGeo.rotateX(-Math.PI / 2);
const mirror = new Reflector(puddleGeo, { textureWidth: W / 2, textureHeight: H / 2, color: 0xa8d8f8, clipBias: 0.003 });
mirror.position.set(PUD.x, 0.012, PUD.z);
scene.add(mirror);
// blue water tint + soft wet rim
const tint = new THREE.Mesh(puddleGeo, new THREE.MeshBasicMaterial({ color: 0x4fb2ef, transparent: true, opacity: 0.38, depthWrite: false }));
tint.position.set(PUD.x, 0.016, PUD.z); scene.add(tint);
const rimMesh = new THREE.Mesh(puddleGeo, new THREE.MeshStandardMaterial({ color: 0x5ea64b, roughness: 0.4, transparent: true, opacity: 0.55 }));
rimMesh.scale.set(1.12, 1, 1.16); rimMesh.position.set(PUD.x, 0.008, PUD.z); rimMesh.receiveShadow = true; scene.add(rimMesh);

// ripples
const ripples = [];
const ringGeo = new THREE.RingGeometry(0.92, 1, 64); ringGeo.rotateX(-Math.PI / 2);
for (let i = 0; i < 9; i++) {
  const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  r.position.y = 0.02; scene.add(r); ripples.push(r);
}
// [time, x, z, strength]
const RIPPLE_EVENTS = [[5.05, 0.72, 0.45, 0.8], [9.2, 0.05, 0.5, 1.0], [9.2, 0.05, 0.5, 0.6], [12.0, 0.05, 0.5, 0.25], [13.65, 0.05, 0.5, 0.3]];

// splash droplets
const DROP_MAT = new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, roughness: 0.05, transmission: 0.2, clearcoat: 1, emissive: 0x9fd8ff, emissiveIntensity: 0.25 });
const SPLASHES = [];
function makeSplash(t0, x, z, n, power) {
  seed = Math.floor(t0 * 1000);
  const drops = [];
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, sp = (0.5 + rand() * 0.7) * power;
    const m = ball(DROP_MAT, 0.025 + rand() * 0.025, undefined, undefined, 0, 0, 0, SPH_LO);
    m.castShadow = false; scene.add(m);
    drops.push({ m, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp * 0.8, vy: (1.6 + rand() * 1.2) * power });
  }
  SPLASHES.push({ t0, x, z, drops });
}
makeSplash(5.05, 0.72, 0.45, 14, 0.7);
makeSplash(9.2, 0.05, 0.5, 22, 0.95);
makeSplash(9.2, 1.18, 0.5, 8, 0.5);

// ------------------------------------------------------------------ garden dressing
const greens = [0x4e9f3a, 0x418f33, 0x58ab43, 0x4a9a3e];
function bush(x, z, s, flowers = 0) {
  const g = new THREE.Group();
  const gm = std(greens[Math.floor(rand() * greens.length)], 0.85, { sheen: 0.6, sheenColor: 0xc8ffb0 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, r = i ? 0.45 : 0;
    g.add(ball(gm, 0.42 + rand() * 0.2, undefined, undefined, Math.cos(a) * r, 0.35 + rand() * 0.25 + (i ? 0 : 0.25), Math.sin(a) * r * 0.6, SPH_LO));
  }
  const fc = [0xff8fb8, 0xffffff, 0xffd166, 0xc9a2ff][Math.floor(rand() * 4)];
  const fm = std(fc, 0.6);
  for (let i = 0; i < flowers; i++) {
    const a = rand() * Math.PI * 2, b = rand() * 1.2;
    g.add(ball(fm, 0.07, undefined, undefined, Math.cos(a) * 0.62 * Math.cos(b), 0.55 + Math.sin(b) * 0.45, Math.sin(a) * 0.4 + 0.18, SPH_LO));
  }
  g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g); return g;
}
const petalGeo = new THREE.SphereGeometry(1, 20, 12);
const stemMat = std(0x4f9e3a, 0.8);
const leafMat = std(0x5cb547, 0.7);
const centerMat = std(0xffc93c, 0.6);
const swayers = [];
function flower(x, z, h, color, kind = 0, s = 1) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, h, 8), stemMat);
  stem.position.y = h / 2; stem.castShadow = true; g.add(stem);
  const leaf = ball(leafMat, 0.12, 0.03, 0.05, 0.08, h * 0.35, 0); leaf.rotation.z = 0.5; g.add(leaf);
  const head = new THREE.Group(); head.position.y = h;
  const pm = std(color, 0.55, { sheen: 0.5, sheenColor: 0xffffff });
  if (kind === 0) { // daisy-ish round petals
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      head.add(ball(pm, 0.085, 0.035, 0.06, Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09, petalGeo));
      head.children.at(-1).rotation.y = -a;
    }
    head.add(ball(centerMat, 0.055, 0.04, 0.055, 0, 0.015, 0, petalGeo));
    head.rotation.x = 0.9; // face the camera
  } else { // tulip: rounded cup
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const p = ball(pm, 0.065, 0.12, 0.06, Math.cos(a) * 0.035, 0.06, Math.sin(a) * 0.035, petalGeo);
      p.rotation.z = Math.cos(a) * 0.25; p.rotation.x = -Math.sin(a) * 0.25; head.add(p);
    }
  }
  // raindrop sparkle on some flowers
  if (rand() < 0.35) head.add(ball(DROP_MAT, 0.022, 0.022, 0.022, 0.05, 0.05, 0.08, SPH_LO));
  g.add(head);
  g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g);
  swayers.push({ g, ph: rand() * 6.28, amp: 0.03 + rand() * 0.03 });
  return g;
}
const flowerCols = [0xff8fb1, 0xc39bff, 0xffb347, 0xffffff, 0xff7b7b, 0xffe066, 0x8ecbff];
seed = 777;
// back flower bed in front of the fence
for (let i = 0; i < 70; i++) {
  const x = -7 + rand() * 15, z = -2.2 - rand() * 1.1;
  flower(x, z, 0.35 + rand() * 0.35, flowerCols[Math.floor(rand() * flowerCols.length)], rand() < 0.4 ? 1 : 0, 1.1);
}
// side and foreground flowers (kept away from the action area)
for (let i = 0; i < 46; i++) {
  let x = -6 + rand() * 13, z = -1.6 + rand() * 4.6;
  if (z > -1.2 && z < 1.7 && x > -4.4 && x < 3.4) continue;
  if (z > 1.2 && x > -3.4 && x < 3.2) continue;
  flower(x, z, 0.22 + rand() * 0.25, flowerCols[Math.floor(rand() * flowerCols.length)], rand() < 0.35 ? 1 : 0, 1);
}
// bushes
bush(-5.6, -1.6, 1.3, 9); bush(-3.6, -2.1, 1.0, 7); bush(3.4, -1.3, 1.25, 9); bush(5.3, -2.0, 1.1, 6);
bush(-0.6, -3.0, 0.9, 6); bush(1.6, -3.1, 0.8, 5);
// fence
{
  const pm = std(0xfffaf0, 0.6);
  const g = new THREE.Group();
  for (let x = -9; x <= 9; x += 0.42) {
    const p = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 6, 12), pm);
    p.position.set(x, 0.45, -3.6); p.scale.z = 0.5; p.castShadow = true; g.add(p);
  }
  [0.3, 0.62].forEach(y => { const r = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.08, 0.05), pm); r.position.set(0, y, -3.66); g.add(r); });
  scene.add(g);
}
// trees in the distance
function tree(x, z, s) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 12), std(0x9a6b45, 0.9));
  trunk.position.y = 0.8; trunk.castShadow = true; g.add(trunk);
  const cm = std([0x4a9f3c, 0x3f9136, 0x55ad46][Math.floor(rand() * 3)], 0.9, { sheen: 0.5, sheenColor: 0xd6ffc0 });
  [[0, 2.2, 0, 1.0], [0.7, 1.9, 0.1, 0.75], [-0.7, 1.95, 0, 0.75], [0.2, 2.75, 0, 0.7], [-0.3, 2.6, 0.3, 0.6]]
    .forEach(([a, b, c, r]) => g.add(ball(cm, r, undefined, undefined, a, b, c, SPH_LO)));
  // little round fruit
  const fm = std(0xff6f6f, 0.5);
  for (let i = 0; i < 6; i++) g.add(ball(fm, 0.08, undefined, undefined, -0.8 + rand() * 1.6, 1.8 + rand() * 1.1, 0.75, SPH_LO));
  g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g);
}
seed = 99;
tree(-7.5, -7, 1.5); tree(-3.2, -9, 1.3); tree(2.8, -8, 1.45); tree(7.8, -7.5, 1.6); tree(11, -11, 1.4); tree(-11, -11, 1.5);
for (let i = 0; i < 12; i++) bush(-14 + i * 2.5 + rand(), -5 - rand() * 2, 1.2 + rand() * 0.5, 4);

// butterflies
const butterflies = [];
function butterfly(color, ph) {
  const g = new THREE.Group();
  const wm = std(color, 0.5, { side: THREE.DoubleSide });
  const wl = new THREE.Group(), wr = new THREE.Group();
  wl.add(ball(wm, 0.09, 0.012, 0.07, -0.08, 0, 0)); wr.add(ball(wm, 0.09, 0.012, 0.07, 0.08, 0, 0));
  wl.add(ball(wm, 0.06, 0.012, 0.05, -0.06, 0, 0.08)); wr.add(ball(wm, 0.06, 0.012, 0.05, 0.06, 0, 0.08));
  g.add(wl, wr, ball(std(0x55473d), 0.018, 0.018, 0.09));
  scene.add(g); butterflies.push({ g, wl, wr, ph });
}
butterfly(0xffa3c7, 0); butterfly(0x9fd3ff, 2.1);

// ------------------------------------------------------------------ the duckling
const YELLOW = std(0xffc81a, 0.8, { sheen: 0.7, sheenColor: 0xfff0a0, sheenRoughness: 0.4 });
const ORANGE = std(0xff9a2e, 0.45, { clearcoat: 0.3 });
const BLACK_EYE = std(0x1d1a2e, 0.15, { clearcoat: 1, clearcoatRoughness: 0.05 });
const WHITE_HL = new THREE.MeshBasicMaterial({ color: 0xffffff });
const PINK = std(0xff8fa3, 0.8, { transparent: true, opacity: 0.6 });
const BOOT = std(0x52b4f5, 0.22, { clearcoat: 1, clearcoatRoughness: 0.1 });
const SOLE = std(0xf4fbff, 0.4);
const MOUTH_IN = std(0xb8394f, 0.6);
const TONGUE = std(0xff7f96, 0.6);

function makeEye(mat, lidMat, r, depthScale = 0.6) {
  const g = new THREE.Group();
  const eye = ball(mat, r * 0.82, r, r * depthScale);
  const hl1 = ball(WHITE_HL, r * 0.3, r * 0.3, r * 0.15, r * 0.25, r * 0.38, r * depthScale * 0.85);
  const hl2 = ball(WHITE_HL, r * 0.13, r * 0.13, r * 0.07, -r * 0.25, -r * 0.3, r * depthScale * 0.9);
  hl1.castShadow = hl2.castShadow = false;
  const lid = new THREE.Group(); // upper eyelid: half-sphere rotating down
  const lidMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), lidMat);
  lidMesh.scale.set(r * 0.92, r * 1.1, r * depthScale * 1.15); lid.add(lidMesh);
  lid.rotation.x = -1.75; // open
  const lowLid = new THREE.Group(); // lower lid (for happy squint)
  const lm = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), lidMat);
  lm.scale.set(r * 0.92, r * 1.1, r * depthScale * 1.15); lm.rotation.x = Math.PI; lowLid.add(lm);
  lowLid.rotation.x = 1.75;
  g.add(eye, hl1, hl2, lid, lowLid);
  return { g, lid, lowLid, eye };
}

const duck = new THREE.Group();
const duckBody = new THREE.Group(); duck.add(duckBody); // squash/roll pivot at feet
// boots
const boots = [];
for (const s of [-1, 1]) {
  const leg = new THREE.Group(); leg.position.set(0.14 * s, 0, 0.02);
  const shaft = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.12, 8, 20), BOOT);
  shaft.position.y = 0.16; shaft.castShadow = true; leg.add(shaft);
  const toe = ball(BOOT, 0.11, 0.08, 0.15, 0, 0.07, 0.07); leg.add(toe);
  const sole = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.12, 0.035, 24), SOLE);
  sole.scale.z = 1.35; sole.position.set(0, 0.018, 0.04); sole.castShadow = true; leg.add(sole);
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.025, 10, 28), BOOT);
  cuff.rotation.x = Math.PI / 2; cuff.position.y = 0.28; leg.add(cuff);
  const dot = ball(SOLE, 0.03, 0.03, 0.012, 0.0, 0.2, 0.103); leg.add(dot); // little white button
  const legTop = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10), ORANGE);
  legTop.position.y = 0.32; leg.add(legTop);
  duckBody.add(leg); boots.push(leg);
}
const torso = new THREE.Group(); torso.position.y = 0.32; duckBody.add(torso);
torso.add(ball(YELLOW, 0.42, 0.38, 0.43, 0, 0.26, 0));
// fluffy chest & tail tufts

const tail = group(ball(YELLOW, 0.1, 0.08, 0.14, 0, 0, 0), ball(YELLOW, 0.06, 0.05, 0.1, 0, 0.06, -0.06));
tail.position.set(0, 0.36, -0.42); tail.rotation.x = -0.6; torso.add(tail);
// wings (pivot at shoulder)
const wings = [];
for (const s of [-1, 1]) {
  const w = new THREE.Group(); w.position.set(0.37 * s, 0.38, -0.02);
  const m = ball(YELLOW, 0.09, 0.2, 0.22, 0.03 * s, -0.14, 0); m.rotation.z = 0.25 * s; w.add(m);
  const tip = ball(YELLOW, 0.07, 0.09, 0.1, 0.05 * s, -0.3, 0.06); w.add(tip);
  torso.add(w); wings.push(w);
}
// neck ruff (fluff)
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2;
  torso.add(ball(YELLOW, 0.065, 0.055, 0.065, Math.cos(a) * 0.19, 0.57, Math.sin(a) * 0.19, SPH_LO));
}
// head
const duckHead = new THREE.Group(); duckHead.position.set(0, 0.6, 0.04); torso.add(duckHead);
const DH = new THREE.Group(); DH.position.y = 0.29; DH.scale.setScalar(1.15); duckHead.add(DH);
DH.add(ball(YELLOW, 0.34, 0.32, 0.32, 0, 0, 0));
// head tuft
[[0, 0.33, 0.02, 0.07, 0.13, -0.3], [0.06, 0.31, -0.03, 0.05, 0.11, 0.5], [-0.06, 0.31, -0.02, 0.05, 0.1, -0.7]].forEach(([x, y, z, r, h, rz]) => {
  const t = ball(YELLOW, r, h, r, x, y, z); t.rotation.z = rz; DH.add(t);
});
const duckEyes = [];
for (const s of [-1, 1]) {
  const e = makeEye(BLACK_EYE, YELLOW, 0.085, 0.55);
  e.g.position.set(0.13 * s, 0.07, 0.27); e.g.rotation.y = 0.32 * s; e.g.rotation.x = -0.05;
  DH.add(e.g); duckEyes.push(e);
}
for (const s of [-1, 1]) { const c = ball(PINK, 0.075, 0.045, 0.03, 0.23 * s, -0.05, 0.22); c.rotation.y = 0.6 * s; c.castShadow = false; DH.add(c); }
// beak: upper fixed, lower on a hinge
const beak = new THREE.Group(); beak.position.set(0, -0.07, 0.27); DH.add(beak);
const upperBeak = ball(ORANGE, 0.15, 0.06, 0.13, 0, 0.01, 0.07); beak.add(upperBeak);
const mouthIn = ball(MOUTH_IN, 0.12, 0.05, 0.08, 0, -0.03, 0.04); beak.add(mouthIn);
const jaw = new THREE.Group(); jaw.position.set(0, -0.015, -0.02); beak.add(jaw);
jaw.add(ball(ORANGE, 0.13, 0.04, 0.12, 0, -0.025, 0.08));
jaw.add(ball(TONGUE, 0.07, 0.02, 0.06, 0, -0.005, 0.06));
duck.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
scene.add(duck);

// ------------------------------------------------------------------ the frog
const GREEN = std(0x5cc444, 0.55, { sheen: 0.4, sheenColor: 0xe0ffd0, clearcoat: 0.25 });
const BELLY = std(0xd9f5a8, 0.7);
const FROG_PUPIL = BLACK_EYE;
const EYE_WHITE = std(0xffffff, 0.3, { clearcoat: 0.6 });
const frog = new THREE.Group();
const frogBody = new THREE.Group(); frog.add(frogBody);
frogBody.add(ball(GREEN, 0.48, 0.4, 0.42, 0, 0.42, 0));
frogBody.add(ball(BELLY, 0.34, 0.25, 0.2, 0, 0.29, 0.26));
// spots
const SPOT = std(0x58b545, 0.6);
[[0.25, 0.7, -0.1], [-0.3, 0.62, -0.05], [0.05, 0.78, -0.2]].forEach(([x, y, z]) => frogBody.add(ball(SPOT, 0.07, 0.03, 0.07, x, y, z)));
// back legs
for (const s of [-1, 1]) {
  frogBody.add(ball(GREEN, 0.2, 0.15, 0.27, 0.36 * s, 0.17, -0.02));
  const foot = ball(GREEN, 0.13, 0.04, 0.16, 0.36 * s, 0.03, 0.2); frogBody.add(foot);
}
// arms (wave)
const frogArms = [];
for (const s of [-1, 1]) {
  const a = new THREE.Group(); a.position.set(0.33 * s, 0.42, 0.18);
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 6, 12), GREEN); arm.position.y = -0.12; a.add(arm);
  const hand = ball(GREEN, 0.08, 0.04, 0.07, 0, -0.26, 0.02); a.add(hand);
  a.rotation.z = 0.25 * s; frogBody.add(a); frogArms.push(a);
}
// eyes on top
const frogEyes = [];
for (const s of [-1, 1]) {
  const sock = ball(GREEN, 0.16, 0.15, 0.15, 0.2 * s, 0.78, 0.05); frogBody.add(sock);
  const w = ball(EYE_WHITE, 0.125, 0.13, 0.08, 0.2 * s, 0.8, 0.15); frogBody.add(w);
  const e = makeEye(FROG_PUPIL, GREEN, 0.075, 0.5);
  e.g.position.set(0.2 * s, 0.8, 0.205); e.g.rotation.y = 0.2 * s; frogBody.add(e.g);
  frogEyes.push(e);
}
for (const s of [-1, 1]) { const c = ball(PINK, 0.08, 0.045, 0.03, 0.33 * s, 0.5, 0.29); c.rotation.y = 0.75 * s; c.castShadow = false; frogBody.add(c); }
// mouth: a smile line + an opening that grows when singing
const frogMouth = new THREE.Group(); frogMouth.position.set(0, 0.55, 0.402); frogBody.add(frogMouth);
{ // smile that hugs the body surface (ellipsoid 0.48 x 0.40 x 0.42 centred at y=0.42)
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const x = -0.19 + 0.38 * i / 24;
    const y = 0.515 + 0.075 * (x / 0.19) ** 2;
    const z = 0.42 * Math.sqrt(Math.max(0, 1 - (x / 0.48) ** 2 - ((y - 0.42) / 0.4) ** 2)) + 0.004;
    pts.push(new THREE.Vector3(x, y - 0.55, z - 0.402));
  }
  const smileLine = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.014, 8), std(0x2f6b2a, 0.5));
  frogMouth.add(smileLine);
}
const frogOpen = new THREE.Group(); frogMouth.add(frogOpen);
frogOpen.add(ball(MOUTH_IN, 0.12, 0.08, 0.03, 0, -0.035, 0.0));
frogOpen.add(ball(TONGUE, 0.065, 0.035, 0.02, 0, -0.07, 0.012));
frog.traverse(o => { if (o.isMesh) o.castShadow = true; });
frog.scale.setScalar(1.0);
scene.add(frog);

// ------------------------------------------------------------------ choreography
const JUMP = (t, t0, t1, h) => { const u = (t - t0) / (t1 - t0); return (u > 0 && u < 1) ? h * 4 * u * (1 - u) : 0; };
const air = (t, t0, t1) => t > t0 && t < t1;
// landing squash: soft, short
const squash = (t, tl, amt = 0.1, dur = 0.3) => { const u = (t - tl) / dur; return (u > 0 && u < 1) ? amt * Math.sin(Math.PI * u) * (1 - u * 0.3) : 0; };
const beatBounce = (t) => 0.5 - 0.5 * Math.cos(2 * Math.PI * t / BEAT);

// shared "together" jumps (on the words Jump, jump, splash)
const TJ = [[7.47, 7.93, 0.28], [8.01, 8.47, 0.28], [8.6, 9.2, 0.48]];

function duckPose(t) {
  let x, y = 0, rotY, sq = 0, roll = 0, pitch = 0, headPitch = 0, headRoll = 0;
  const walkU = clamp(t / 2.5);
  const xWalk = -3.7 + 2.45 * (1 - (1 - walkU) * (1 - walkU));
  const speed = (1 - walkU) * (t < 2.5 ? 1 : 0);
  const phase = (xWalk + 3.7) / 0.3 * Math.PI;
  x = xWalk;
  // walking waddle
  roll += Math.sin(phase) * 0.12 * clamp(speed * 2.2);
  y += Math.abs(Math.sin(phase)) * 0.045 * clamp(speed * 2.2);
  boots[0].position.y = Math.max(0, Math.sin(phase)) * 0.07 * clamp(speed * 2.2);
  boots[1].position.y = Math.max(0, -Math.sin(phase)) * 0.07 * clamp(speed * 2.2);
  boots[0].position.z = 0.02 + Math.cos(phase) * 0.06 * clamp(speed * 2.2);
  boots[1].position.z = 0.02 - Math.cos(phase) * 0.06 * clamp(speed * 2.2);
  rotY = lerp(1.0, 0.55, seg(t, 1.8, 2.6));
  // notices the puddle: looks down at it, then back up singing
  headPitch += 0.32 * seg(t, 1.7, 2.2) * (1 - seg(t, 2.9, 3.4));
  // hop over the puddle
  sq += squash(t, 4.12, 0.1, 0.32);         // crouch
  if (t >= 4.42) x = lerp(-1.25, 0.72, smoother((t - 4.42) / 0.62));
  y += JUMP(t, 4.42, 5.04, 0.5);
  rotY = lerp(rotY, 1.15, seg(t, 4.0, 4.4));
  sq += squash(t, 5.04, 0.13, 0.36);
  pitch -= 0.15 * Math.sin(Math.PI * clamp((t - 4.42) / 0.62));
  // turn to camera, then towards the frog when it arrives
  rotY = lerp(rotY, 0.2, seg(t, 5.3, 6.1));
  rotY = lerp(rotY, 0.75, seg(t, 6.75, 7.25));
  // jump together
  TJ.forEach(([a, b, h], i) => { y += JUMP(t, a, b, h); sq += squash(t, b, 0.11, 0.3); sq += i === 2 ? squash(t, a - 0.22, 0.08, 0.22) : 0; });
  if (t >= TJ[2][0]) x = lerp(0.72, 0.02, smoother((t - TJ[2][0]) / (TJ[2][1] - TJ[2][0])));
  rotY = lerp(rotY, 0.12, seg(t, 9.4, 10.3));
  // musical sway when standing
  const standing = 1 - clamp(speed * 3);
  const notAir = (air(t, 4.42, 5.04) || TJ.some(([a, b]) => air(t, a, b))) ? 0 : 1;
  roll += standing * notAir * 0.06 * Math.sin(Math.PI * t / BEAT);
  y += standing * notAir * 0.018 * beatBounce(t);
  headRoll = standing * 0.08 * Math.sin(Math.PI * t / BEAT + 0.6);
  // "one, two, three" nods
  [12.55, 13.09, 13.64].forEach(tb => { headPitch += 0.12 * Math.sin(Math.PI * clamp((t - tb + 0.08) / 0.3)); });
  return { x, y, rotY, sq, roll, pitch, headPitch, headRoll };
}

function frogPose(t) {
  const visible = t > 6.6;
  let x = 3.35, z = -0.55, y = -0.3, rotY = -0.95, sq = 0;
  // pops up from behind the bush, then hops over next to the duck
  y = lerp(-0.6, 0, smooth((t - 6.6) / 0.25));
  if (t >= 6.85) { const u = smoother((t - 6.85) / 0.55); x = lerp(3.35, 2.0, u); z = lerp(-0.55, 0.45, u); }
  y += JUMP(t, 6.85, 7.4, 0.55);
  sq += squash(t, 7.4, 0.14, 0.3);
  TJ.forEach(([a, b, h], i) => { y += JUMP(t, a, b, h); sq += squash(t, b, 0.12, 0.3); });
  if (t >= TJ[2][0]) x = lerp(2.0, 1.22, smoother((t - TJ[2][0]) / (TJ[2][1] - TJ[2][0])));
  rotY = lerp(rotY, -0.15, seg(t, 9.5, 10.4));
  const notAir = TJ.some(([a, b]) => air(t, a, b)) || air(t, 6.85, 7.4) ? 0 : 1;
  const roll = notAir * 0.06 * Math.sin(Math.PI * t / BEAT + Math.PI) * seg(t, 7.4, 8);
  y += notAir * 0.02 * beatBounce(t) * seg(t, 7.4, 8);
  [12.55, 13.09, 13.64].forEach(tb => { sq += squash(t, tb - 0.05, 0.06, 0.3); });
  return { visible, x, y, z, rotY, sq, roll };
}

function blink(t, times) {
  let v = 0;
  for (const b of times) v = Math.max(v, Math.sin(Math.PI * clamp((t - b) / 0.2)));
  return v;
}

function setEyes(eyes, t, blinks, widen, happy) {
  const bl = blink(t, blinks);
  for (const e of eyes) {
    e.lid.rotation.x = lerp(-1.75, -0.05, Math.max(bl, happy * 0.0));
    e.lowLid.rotation.x = lerp(1.75, 0.55, happy);
    e.eye.scale.y = e.eye.scale.x / 0.82 * (1 + widen * 0.12);
    e.g.scale.setScalar(1 + widen * 0.08);
  }
}

// ------------------------------------------------------------------ frame
function renderAt(t) {
  // camera: one continuous, slow move — follows the friends, gentle dolly-in at the end
  const camX = lerp(-1.55, 0.6, smoother(t / 10.5));
  const dz = seg(t, 10.8, 15) * 0.65;
  camera.position.set(camX - 0.12, 1.42 - dz * 0.12 + 0.03 * Math.sin(t * 0.7), 6.1 - dz);
  camera.lookAt(camX, 0.86 - dz * 0.06, 0.3);

  // duck
  const d = duckPose(t);
  duck.position.set(d.x, d.y, 0.45);
  duck.rotation.y = d.rotY;
  duckBody.scale.set(1 + d.sq * 0.6, 1 - d.sq, 1 + d.sq * 0.6);
  duckBody.rotation.z = d.roll; duckBody.rotation.x = d.pitch;
  duckHead.rotation.x = d.headPitch; duckHead.rotation.z = d.headRoll;
  const duckSing = lipAt(LIP.duck, t);
  jaw.rotation.x = duckSing * 0.55;
  mouthIn.scale.y = 0.05 + duckSing * 0.04;
  // wings: flap on jumps, wave at the end
  const flap = Math.max(...[[4.42, 5.04], ...TJ].map(([a, b]) => Math.sin(Math.PI * clamp((t - a) / (b - a)))));
  const wave = seg(t, 11.0, 11.5);
  wings[0].rotation.z = -0.1 - flap * 0.9 - 0.05 * Math.sin(t * 3);
  wings[1].rotation.z = 0.1 + flap * 0.9 + wave * (1.9 + 0.35 * Math.sin((t - 11) * Math.PI * 2 / BEAT));
  wings[1].rotation.x = -wave * 0.3;
  // pre-wave little wing bops with the music
  wings[0].rotation.z -= 0.12 * beatBounce(t) * seg(t, 0.5, 1.2);
  setEyes(duckEyes, t, [1.15, 3.35, 6.3, 10.0, 12.2], seg(t, 1.6, 1.9) * (1 - seg(t, 2.8, 3.3)) + 0.6 * seg(t, 6.7, 6.95) * (1 - seg(t, 7.6, 8.0)), seg(t, 13.7, 14.1) * 0.9 + seg(t, 3.9, 4.1) * (1 - seg(t, 4.3, 4.45)) * 0.5);

  // frog
  const f = frogPose(t);
  frog.visible = f.visible;
  frog.position.set(f.x, f.y, f.z);
  frog.rotation.y = f.rotY;
  frogBody.scale.set(1 + f.sq * 0.6, 1 - f.sq, 1 + f.sq * 0.6);
  frogBody.rotation.z = f.roll;
  const frogSing = lipAt(LIP.frog, t);
  frogOpen.scale.set(1 + frogSing * 0.1, 0.05 + frogSing * 1.0, 1);
  frogOpen.position.y = -0.005 * frogSing;
  const fwave = seg(t, 11.0, 11.5);
  const fflap = Math.max(...[[6.85, 7.4], ...TJ].map(([a, b]) => Math.sin(Math.PI * clamp((t - a) / (b - a)))));
  frogArms[0].rotation.z = -0.25 - fflap * 0.8 - fwave * (2.0 + 0.35 * Math.sin((t - 11) * Math.PI * 2 / BEAT + 1));
  frogArms[1].rotation.z = 0.25 + fflap * 0.8;
  frogArms[0].rotation.x = -fwave * 0.3;
  setEyes(frogEyes, t, [8.9, 10.6, 12.9], 0.6 * seg(t, 6.9, 7.1) * (1 - seg(t, 7.5, 7.9)), seg(t, 13.7, 14.1) * 0.9);

  // ripples
  ripples.forEach(r => r.material.opacity = 0);
  let ri = 0;
  for (const [t0, x, z, s] of RIPPLE_EVENTS) for (let k = 0; k < 2 && ri < ripples.length; k++) {
    const age = t - t0 - k * 0.22;
    const r = ripples[ri++];
    if (age > 0 && age < 1.6) {
      const rad = 0.08 + age * 0.55 * s;
      r.scale.set(rad, 1, rad * 0.95); r.position.x = x; r.position.z = z;
      r.material.opacity = 0.55 * s * (1 - age / 1.6) * clamp((PUD.rx * 1.05 - rad) / 0.3);
    }
  }
  // splash droplets (ballistic)
  for (const S of SPLASHES) for (const dr of S.drops) {
    const a = t - S.t0;
    dr.m.visible = a > 0 && a < 0.9;
    if (dr.m.visible) {
      const yy = dr.vy * a - 4.5 * a * a;
      if (yy < -0.02) dr.m.visible = false;
      dr.m.position.set(S.x + dr.vx * a * 0.6, 0.03 + yy * 0.45, S.z + dr.vz * a * 0.6);
    }
  }
  // gentle life in the garden
  swayers.forEach(s => { s.g.rotation.z = s.amp * Math.sin(t * 1.6 + s.ph); s.g.rotation.x = s.amp * 0.6 * Math.cos(t * 1.3 + s.ph); });
  clouds.forEach((c, i) => c.g.position.x = c.x0 + t * (0.12 + i * 0.03));
  butterflies.forEach((b, i) => {
    const ph = b.ph + t * 0.55;
    b.g.position.set(-2.5 + i * 4.2 + Math.sin(ph) * 1.4, 1.3 + Math.sin(ph * 2.3) * 0.25 + i * 0.25, -1.6 + Math.cos(ph) * 0.6);
    b.g.rotation.y = Math.atan2(Math.cos(ph) * 1.4, -Math.sin(ph) * 0.6);
    const fl = Math.sin(t * 22 + i) * 0.9;
    b.wl.rotation.z = fl; b.wr.rotation.z = -fl;
  });

  renderer.render(scene, camera);
}

window.renderAt = renderAt;
window.READY = true;
