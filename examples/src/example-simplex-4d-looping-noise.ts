import * as g from 'gpucat';
import { d } from 'gpucat';
import { simplex4d } from 'math/noise';
import { createPanel } from './common/dash';
import { grey, ink, isoline, light } from './common/ink';
import { createRenderer } from './common/renderer';
import { clearColor, spectrum } from './common/theme';

// A field of columns whose heights come from math's simplex4d, animated so it loops
// seamlessly. The trick is 4D: the two extra axes trace a circle of radius
// `variation` as the loop phase goes 0 -> 1, so w and z return exactly to their
// start and the whole field repeats with no visible seam. (A 3D field animated
// by just sliding a time offset can never close the loop like this.)

const TAU = Math.PI * 2;
const ACCENT = spectrum[1];
const MAX_GRID = 64;
const SPACING = 0.17;
const TILE = 0.16;
const settings = { grid: 24, loop: 6, height: 1.0, detail: 0.45, variation: 0.8 };

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

/* a grid of tiles on the XZ plane: static transforms + a live per-tile height */

const cols = new Float32Array(MAX_GRID * MAX_GRID * 2);
const instanceMatrices = new Float32Array(MAX_GRID * MAX_GRID * 16);
const matrixBuffer = g.createVertexBuffer(d.vec4f, instanceMatrices);

function rebuildGrid() {
    let idx = 0;
    for (let ix = 0; ix < settings.grid; ix++) {
        for (let iz = 0; iz < settings.grid; iz++) {
            const px = (ix - (settings.grid - 1) / 2) * SPACING;
            const pz = (iz - (settings.grid - 1) / 2) * SPACING;
            cols[idx * 2] = px;
            cols[idx * 2 + 1] = pz;
            const o = idx * 16;
            instanceMatrices[o] = TILE;
            instanceMatrices[o + 5] = TILE;
            instanceMatrices[o + 10] = TILE;
            instanceMatrices[o + 12] = px;
            instanceMatrices[o + 14] = pz;
            instanceMatrices[o + 15] = 1;
            idx++;
        }
    }
    matrixBuffer.needsUpdate = true;
    tiles.count = settings.grid * settings.grid;
    resize();
}

// per-tile height, restreamed each frame from the looping noise
const heights = new Float32Array(MAX_GRID * MAX_GRID);
const heightBuffer = g.createVertexBuffer(d.f32, heights);

const tileGeometry = g.createBoxGeometry(1, 1, 1);

const amp = g.uniform(g.f32(1), 'amp');

const stride = 16 * 4;
const col0 = g.attribute(matrixBuffer, { stride, offset: 0, instanced: true });
const col1 = g.attribute(matrixBuffer, { stride, offset: 16, instanced: true });
const col2 = g.attribute(matrixBuffer, { stride, offset: 32, instanced: true });
const col3 = g.attribute(matrixBuffer, { stride, offset: 48, instanced: true });
const instanceTransform = g.mat4(col0, col1, col2, col3);
const instanceHeight = g.attribute(heightBuffer, { stride: 4, offset: 0, instanced: true });

const pos = g.attribute('position', d.vec3f);
const nrm = g.attribute('normal', d.vec3f);
// Each column grows from the same base as the noise moves through its loop.
const world0 = g.mul(instanceTransform, g.vec4(pos, g.f32(1)));
const columnHeight = g.f32(0.32).add(instanceHeight.add(g.f32(1)).mul(amp).mul(g.f32(1.2)));
const worldPos = g.vec3(world0.x, pos.y.add(g.f32(0.5)).mul(columnHeight).sub(g.f32(1.2)), world0.z);
const clip = g.mul(g.cameraProjectionMatrix, g.mul(g.cameraViewMatrix, g.vec4(worldPos, g.f32(1))));
const vHeight = g.varying(instanceHeight, 'v_h');
const vTop = g.varying(nrm.y.max(g.f32(0)), 'v_top');
const vSide = g.varying(nrm.z.abs(), 'v_side');

// Bright caps and two darker side tones give the columns the film's graphic relief.
const uv = g.varying(g.attribute('uv', d.vec2f), 'v_uv');
const edges = g.max(isoline(uv.x, 0.65), isoline(uv.y, 0.65));
const tinted = g.step(g.f32(0.45), vHeight).mul(vTop);
const face = grey(g.mix(g.f32(0.28).add(vSide.mul(g.f32(0.2))), g.f32(0.9), vTop));
const color = g.mix(g.mix(face, ink(ACCENT), tinted), g.mix(light, grey(g.f32(0.25)), vTop), edges.mul(g.f32(0.22)));
const material = new g.Material({ vertex: clip, fragment: g.vec4(color, g.f32(1)) });

const tiles = new g.Mesh(tileGeometry, material);
rebuildGrid();
scene.add(tiles);
scene.updateWorldMatrix();

/* looping noise */

const gen = simplex4d.create(7);
let phase = 0; // loop position in [0, 1)

/* ui */

const panel = createPanel('simplex 4d looping noise', ACCENT);
panel.add(settings, 'grid', { min: 12, max: MAX_GRID, step: 2, label: 'Grid size' }).onChange(rebuildGrid);
panel.add(settings, 'loop', { min: 2, max: 20, step: 0.1, label: 'Loop (s)' });
panel.add(settings, 'height', { min: 0, max: 3, step: 0.01, label: 'Height' });
panel.add(settings, 'detail', { min: 0.15, max: 1, step: 0.01, label: 'Detail' });
panel.add(settings, 'variation', { min: 0.2, max: 2, step: 0.01, label: 'Variation' });
panel.monitor(() => phase, { label: 'loop', format: (v) => `${Math.round(v * 100)}%` });

/* render loop */

const scenePass = g.pass(scene, camera, { clearColor, samples: 4 });
const outputNode = g.fxaa(scenePass.getTextureNode());
const renderPipeline = new g.RenderPipeline(renderer, outputNode);

let lastT = performance.now();

function frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    amp.value = settings.height;

    // advance the loop phase and walk the two extra axes around a circle, so the
    // field returns exactly to its start as phase wraps 0 -> 1
    phase = (phase + dt / settings.loop) % 1;
    const r = settings.variation;
    const zt = r * Math.cos(phase * TAU);
    const wt = r * Math.sin(phase * TAU);

    const f = settings.detail;
    for (let i = 0; i < tiles.count; i++) {
        heights[i] = simplex4d.sample(gen, cols[i * 2] * f, cols[i * 2 + 1] * f, zt, wt);
    }
    heightBuffer.needsUpdate = true;

    controls.update();
    renderPipeline.render();
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
