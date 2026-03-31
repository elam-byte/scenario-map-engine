/**
 * mock-sim.js — Standalone WebSocket mock simulator
 * Broadcasts WorldSnapshot at 20 Hz to test viewer.html without NATS/real sim.
 *
 * Usage:  node mock-sim.js [port]   (default port: 8090)
 *
 * Vehicles drive in simple circles so motion is immediately visible.
 */

import { WebSocketServer } from 'ws';

const PORT = Number(process.argv[2] ?? 8090);
const TICK_MS = 50; // 20 Hz

// --- Vehicle state ---
const vehicles = [
  { id: 'veh-1', cx: 250, cy: 250, r: 80,  theta: 0,            speed: 0.04, length: 4.5, width: 2.0, color: '#22c55e' },
  { id: 'veh-2', cx: 250, cy: 250, r: 120, theta: Math.PI,      speed: 0.03, length: 4.5, width: 2.0, color: '#3b82f6' },
  { id: 'veh-3', cx: 250, cy: 250, r: 160, theta: Math.PI / 2,  speed: 0.025, length: 4.5, width: 2.0, color: '#f59e0b' },
  { id: 'veh-4', cx: 300, cy: 200, r: 50,  theta: 0,            speed: 0.06, length: 3.0, width: 1.6, color: '#ec4899' },
];

function tick(t) {
  return vehicles.map(v => {
    v.theta += v.speed;
    const x = v.cx + v.r * Math.cos(v.theta);
    const y = v.cy + v.r * Math.sin(v.theta);
    // heading: tangent to circle (perpendicular to radius, CCW positive)
    const heading = v.theta + Math.PI / 2;
    return { id: v.id, x, y, heading, length: v.length, width: v.width, color: v.color };
  });
}

// --- WebSocket server ---
const wss = new WebSocketServer({ port: PORT, path: '/ws' });
console.log(`Mock sim listening on ws://localhost:${PORT}/ws`);

let t = 0;
setInterval(() => {
  t += TICK_MS;
  const snapshot = JSON.stringify({ t, vehicles: tick(t) });
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(snapshot);
    }
  }
}, TICK_MS);

wss.on('connection', ws => {
  console.log('Client connected');
  ws.on('close', () => console.log('Client disconnected'));
  // Optionally log VehicleCommand messages from viewer
  ws.on('message', raw => {
    try { console.log('cmd:', JSON.parse(raw.toString())); } catch {}
  });
});
