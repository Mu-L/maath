import * as g from 'gpucat';
import { d } from 'gpucat';
import { quat } from 'math';
import { ridged, simplex2d } from 'math/noise';
import { createPanel } from './common/dash';
import { grey, ink, isoline, light } from './common/ink';
import { createRenderer } from './common/renderer';
import { clearColor, spectrum } from './common/theme';

// A compact voxel landscape whose mountains come from math's ridged fBm (ridged
// folds each octave into sharp crests). It's turned into a mesh by a tiny
// "culled mesher" - it emits a quad only for a solid voxel face whose neighbour
// is empty, so the interior of the block is never drawn. Being one block type,
// three flat face tones and fine column seams describe the relief. Only
// the tops of the tallest columns catch the accent.

const settings = { grid: 24, seed: 1337, height: 20, detail: 1, spin: false };
const GY = 48;
const VOXEL = 0.16;
const ACCENT = spectrum[0];
const BASE = 4; // minimum terrain height
const H_FREQ = 0.09; // terrain horizontal frequency

// the six cube faces: outward normal, neighbour offset, and 4 corner offsets
const FACES = [
    {
        n: [1, 0, 0],
        d: [1, 0, 0],
        c: [
            [1, 0, 0],
            [1, 1, 0],
            [1, 1, 1],
            [1, 0, 1],
        ],
    },
    {
        n: [-1, 0, 0],
        d: [-1, 0, 0],
        c: [
            [0, 0, 1],
            [0, 1, 1],
            [0, 1, 0],
            [0, 0, 0],
        ],
    },
    {
        n: [0, 1, 0],
        d: [0, 1, 0],
        c: [
            [0, 1, 1],
            [1, 1, 1],
            [1, 1, 0],
            [0, 1, 0],
        ],
    },
    {
        n: [0, -1, 0],
        d: [0, -1, 0],
        c: [
            [0, 0, 0],
            [1, 0, 0],
            [1, 0, 1],
            [0, 0, 1],
        ],
    },
    {
        n: [0, 0, 1],
        d: [0, 0, 1],
        c: [
            [1, 0, 1],
            [1, 1, 1],
            [0, 1, 1],
            [0, 0, 1],
        ],
    },
    {
        n: [0, 0, -1],
        d: [0, 0, -1],
        c: [
            [0, 0, 0],
            [0, 1, 0],
            [1, 1, 0],
            [1, 0, 0],
        ],
    },
] as const;

const idx = (x: number, y: number, z: number) => (x * GY + y) * settings.grid + z;

/* voxel field: a ridged-fBm heightfield, solid below the surface */

function buildSolid(seed: number, height: number, detail: number): Uint8Array {
    const hgen = simplex2d.create(seed);
    const solid = new Uint8Array(settings.grid * GY * settings.grid);

    for (let x = 0; x < settings.grid; x++) {
        for (let z = 0; z < settings.grid; z++) {
            // Keep the existing terrain centered as new columns are added around it.
            const px = (x - (settings.grid - 24) / 2) * H_FREQ * detail;
            const pz = (z - (settings.grid - 24) / 2) * H_FREQ * detail;
            const r = ridged((f) => simplex2d.sample(hgen, px * f, pz * f), 4, 2, 0.5);
            const h = BASE + height * r;
            for (let y = 0; y < GY && y < h; y++) {
                solid[idx(x, y, z)] = 1;
            }
        }
    }
    return solid;
}

const solidAt = (solid: Uint8Array, x: number, y: number, z: number) =>
    x >= 0 && x < settings.grid && y >= 0 && y < GY && z >= 0 && z < settings.grid && solid[idx(x, y, z)] === 1;

/* culled mesher: one quad per exposed solid face */

function mesh(solid: Uint8Array): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const ox = (settings.grid / 2) * VOXEL;
    const oy = 1.8;
    const oz = (settings.grid / 2) * VOXEL;

    for (let x = 0; x < settings.grid; x++) {
        for (let y = 0; y < GY; y++) {
            for (let z = 0; z < settings.grid; z++) {
                if (solid[idx(x, y, z)] !== 1) continue;
                for (const face of FACES) {
                    if (solidAt(solid, x + face.d[0], y + face.d[1], z + face.d[2])) continue; // hidden face
                    const base = positions.length / 3;
                    for (const corner of face.c) {
                        positions.push((x + corner[0]) * VOXEL - ox, (y + corner[1]) * VOXEL - oy, (z + corner[2]) * VOXEL - oz);
                        normals.push(face.n[0], face.n[1], face.n[2]);
                    }
                    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
                }
            }
        }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

/* renderer */

const renderer = await createRenderer({ antialias: true });

const canvas = renderer.domElement as HTMLCanvasElement;
document.body.appendChild(canvas);
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new g.Scene();

const camera = new g.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
camera.position[0] = 8;
camera.position[1] = 6;
camera.position[2] = 8;
scene.add(camera);

const controls = new g.OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.1;

function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    const aspect = window.innerWidth / window.innerHeight;
    const height = (4 * Math.max(1, settings.grid / 24)) / Math.min(1, aspect);
    camera.left = -height * aspect;
    camera.right = height * aspect;
    camera.top = height;
    camera.bottom = -height;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/* flat material, shared across geometry rebuilds */

// model-space height above which a top face takes the accent, set from each rebuild's crests
const peak = g.uniform(g.f32(0), 'peak');

function makeMaterial(): g.Material {
    const pos = g.attribute('position', d.vec3f);
    const nrm = g.attribute('normal', d.vec3f);
    const world = g.mul(g.modelWorldMatrix, g.vec4(pos, g.f32(1)));
    const clip = g.mul(g.cameraProjectionMatrix, g.mul(g.cameraViewMatrix, world));
    const vHeight = g.varying(pos.y, 'v_h'); // model-space height, stable while spinning
    const vTop = g.varying(nrm.y.max(g.f32(0)), 'v_top');
    const vSide = g.varying(nrm.z.abs(), 'v_side');
    const clay = grey(g.mix(g.f32(0.28).add(vSide.mul(g.f32(0.2))), g.f32(0.9), vTop));
    // Vertical seams and cap borders describe columns without gridding every voxel face.
    const grid = g.varying(pos.div(g.f32(VOXEL)), 'v_grid');
    const xEdge = isoline(grid.x, 0.65);
    const zEdge = isoline(grid.z, 0.65);
    const edges = g.mix(g.mix(zEdge, xEdge, vSide), g.max(xEdge, zEdge), vTop);
    const crest = ink(ACCENT);
    const tinted = g.step(peak, vHeight).mul(vTop);
    const face = g.mix(clay, crest, tinted);
    const color = g.mix(face, g.mix(light, grey(g.f32(0.25)), vTop), edges.mul(g.f32(0.22)));
    return new g.Material({ vertex: clip, fragment: g.vec4(color, g.f32(1)) });
}
const material = makeMaterial();

let chunk: g.Mesh | null = null;

function rebuild() {
    const solid = buildSolid(settings.seed, settings.height, settings.detail);
    const m = mesh(solid);
    const geometry = new g.Geometry();
    geometry.setBuffer('position', g.createVertexBuffer(d.vec3f, m.positions));
    geometry.setBuffer('normal', g.createVertexBuffer(d.vec3f, m.normals));
    geometry.setIndex(g.createIndexBuffer(m.indices));
    if (chunk) {
        scene.remove(chunk);
        chunk.geometry.dispose();
    }
    chunk = new g.Mesh(geometry, material);
    // Only the highest caps carry the accent
    let top = -Infinity;
    for (let i = 1; i < m.positions.length; i += 3) top = Math.max(top, m.positions[i]);
    peak.value = top - VOXEL * 0.5;
    scene.add(chunk);
    scene.updateWorldMatrix();
    faceCount = m.indices.length / 6;
}

/* ui */

let faceCount = 0;

const panel = createPanel('ridged noise voxel terrain', ACCENT);
panel.add(settings, 'grid', { min: 12, max: 64, step: 2, label: 'Grid size' }).onChange(() => {
    rebuild();
    resize();
});
panel.add(settings, 'height', { min: 6, max: 36, step: 0.1, label: 'Mountains' }).onChange(rebuild);
panel.add(settings, 'detail', { min: 0.5, max: 2, step: 0.01, label: 'Detail' }).onChange(rebuild);
panel.add(settings, 'spin', { label: 'Auto-spin' });
panel.button('↻ Reshuffle', () => {
    settings.seed = (Math.imul(settings.seed, 1664525) + 1013904223) >>> 0;
    rebuild();
});
panel.monitor(() => faceCount, { label: 'faces' });

rebuild();

/* render loop */

const scenePass = g.pass(scene, camera, { clearColor, samples: 4 });
const outputNode = g.fxaa(scenePass.getTextureNode());
const renderPipeline = new g.RenderPipeline(renderer, outputNode);

let spinAngle = 0;
let lastT = performance.now();

function frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    if (settings.spin && chunk) {
        spinAngle += dt * 0.2;
        quat.setAxisAngle(chunk.quaternion, [0, 1, 0], spinAngle);
    }

    controls.update();
    scene.updateWorldMatrix();
    renderPipeline.render();
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
