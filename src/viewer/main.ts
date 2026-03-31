import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { safeParseMapModel } from '@shared/validation';
import type { MapModel } from '@shared/types';
import { SceneBuilder } from './SceneBuilder';
import { VehicleInstancer } from './VehicleInstancer';
import { WSClient } from './WSClient';

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const app = document.getElementById('app')!;
const statusEl = document.getElementById('status')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);
renderer.setClearColor(0x0d0d1a);

const scene = new THREE.Scene();

// ---------------------------------------------------------------------------
// Lighting — required for MeshStandardMaterial on vehicles
// ---------------------------------------------------------------------------

const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

// Key light: from viewer-front-above, creates bright top + front faces
const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
keyLight.position.set(1, -0.5, 2);
scene.add(keyLight);

// Fill light: subtle blue from opposite side, lifts shadow darkness
const fillLight = new THREE.DirectionalLight(0x8090ff, 0.3);
fillLight.position.set(-1, 1, 0.5);
scene.add(fillLight);

// ---------------------------------------------------------------------------
// Camera — perspective with a static angle (pan/zoom only, no rotation)
// ---------------------------------------------------------------------------

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 10000);
camera.up.set(0, 0, 1);

function fitCamera(worldW: number, worldH: number) {
  const cx = worldW / 2;
  const cy = worldH / 2;
  const d  = Math.max(worldW, worldH);

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.far    = d * 8;
  camera.near   = 1;
  camera.position.set(cx, cy - d * 0.5, d * 0.65);
  camera.lookAt(cx, cy, 0);
  camera.updateProjectionMatrix();

  controls.target.set(cx, cy, 0);
  controls.update();
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableRotate = true;
controls.enableZoom   = true;
controls.enablePan    = true;
controls.zoomSpeed    = 1.2;

// Default: show a 500×281 world
fitCamera(500, 281);

// ---------------------------------------------------------------------------
// Scene objects — always alive
// ---------------------------------------------------------------------------

const sceneBuilder    = new SceneBuilder();
const vehicleInstancer = new VehicleInstancer(scene);
let currentModel: MapModel | null = null;

function setStatus(msg: string) { statusEl.textContent = msg; }

// ---------------------------------------------------------------------------
// Map loading
// ---------------------------------------------------------------------------

function loadMap(model: MapModel) {
  currentModel = model;
  const { width, height } = model.meta.world;

  sceneBuilder.build(scene, model);

  // Show map's static vehicles immediately (before any WS snapshot arrives)
  vehicleInstancer.reset();
  if (model.vehicles.length > 0) {
    vehicleInstancer.updateFromSnapshot({
      t: 0,
      vehicles: model.vehicles,
    });
  }

  fitCamera(width, height);
  setStatus(
    `Map: ${width}×${height} m | Roads: ${model.roads.length} ` +
    `| Junctions: ${model.junctions.length} | Vehicles: ${model.vehicles.length}`,
  );
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

const mapFileInput = document.getElementById('map-file-input') as HTMLInputElement;
const loadMapBtn   = document.getElementById('load-map-btn')   as HTMLButtonElement;
const wsUrlInput   = document.getElementById('ws-url-input')   as HTMLInputElement;
const connectWsBtn = document.getElementById('connect-ws-btn') as HTMLButtonElement;

loadMapBtn.addEventListener('click', () => mapFileInput.click());

mapFileInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target?.result;
    if (typeof text !== 'string') return;
    try {
      const result = safeParseMapModel(JSON.parse(text));
      if (result.ok) {
        loadMap(result.model);
      } else {
        setStatus(`Invalid map: ${result.error}`);
      }
    } catch {
      setStatus('Failed to parse JSON.');
    }
  };
  reader.readAsText(file);
  (e.target as HTMLInputElement).value = '';
});

const wsClient = new WSClient(setStatus);

connectWsBtn.addEventListener('click', () => {
  wsClient.connect(wsUrlInput.value.trim() || 'ws://localhost:8090/ws');
});

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  const w = currentModel?.meta.world.width  ?? 500;
  const h = currentModel?.meta.world.height ?? 281;
  fitCamera(w, h);
});

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function animate() {
  requestAnimationFrame(animate);

  const snapshot = wsClient.getLatestAndClear();
  if (snapshot) {
    vehicleInstancer.updateFromSnapshot(snapshot);
  }

  controls.update();
  renderer.render(scene, camera);
}

animate();
setStatus('Ready — load a Map JSON or connect WebSocket to begin.');
