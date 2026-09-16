import * as g from 'gpucat';
import { d } from 'gpucat';
import { mat4, quat, quat2, type Vec3, vec3 } from 'math';
import { createPanel } from './common/dash';
import { createRenderer } from './common/renderer';

// The candy wrapper, side by side. Two identical tubes are bound to the same
// two bones and twisted by the same angle, and the only difference is how the
// two bone transforms are blended per vertex.
//
// On the left the bones are mat4s, blended by weighted sum - linear blend
// skinning, which is what most skinned meshes still use. Averaging two rotation
// matrices does not give a rotation: halfway through a half turn the sum is a
// matrix that flattens x and z to nothing, so the tube pinches to a thread.
//
// On the right the same bones are quat2s - dual quaternions, which carry a
// rotation and a translation as one number that can be blended. quat2.lerp then
// quat2.normalize is the whole of dual quaternion linear blending, and because
// normalising lands back on a rigid transform the tube keeps its volume all the
// way round.
//
// quat2.lerp takes the straight line between two dual quaternions, so a pair
// pointing opposite ways would blend through the long way. quat2.dot catches
// that and the sign is flipped first, which is why the twist stays smooth past
// half a turn.

const RINGS = 52; // vertex rows along the tube
const SEGMENTS = 28; // around it
const RADIUS = 0.34;
const HEIGHT = 2.6;
const SPLIT = 1.05; // how far each tube sits from the middle
const BANDS = 7; // stripes around the tube, so the twist is legible

type Settings = { twist: number; auto: boolean; rate: number; falloff: number };

const settings: Settings = { twist: 180, auto: true, rate: 0.7, falloff: 0.5 };

/* the tube */

/** A closed tube along y, with enough rows that the weights vary smoothly down it. */
function createTube() {
    const positions: number[] = [];
    const normals: number[] = [];
    // where a vertex started around the tube. A bare cylinder is rotationally
    // symmetric, so without stripes to carry around with it a twist is
    // invisible and only the collapse shows
    const stripes: number[] = [];
    const indices: number[] = [];

    for (let r = 0; r < RINGS; r++) {
        const y = -HEIGHT / 2 + (r / (RINGS - 1)) * HEIGHT;
        for (let s = 0; s < SEGMENTS; s++) {
            const angle = (s / SEGMENTS) * Math.PI * 2;
            const nx = Math.cos(angle);
            const nz = Math.sin(angle);
            positions.push(nx * RADIUS, y, nz * RADIUS);
            normals.push(nx, 0, nz);
            stripes.push(s / SEGMENTS);
        }
    }

    for (let r = 0; r < RINGS - 1; r++) {
        for (let s = 0; s < SEGMENTS; s++) {
            const a = r * SEGMENTS + s;
            const b = r * SEGMENTS + ((s + 1) % SEGMENTS);
            const c = (r + 1) * SEGMENTS + s;
            const e = (r + 1) * SEGMENTS + ((s + 1) % SEGMENTS);
            indices.push(a, c, b, b, c, e);
        }
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        stripes: new Float32Array(stripes),
        indices: new Uint32Array(indices),
    };
}

const rest = createTube();
const VERTICES = rest.positions.length / 3;

/**
 * How much of the second bone each vertex answers to, easing across the middle
 * of the tube. A hard cut would hide the artifact - it only shows where a
 * vertex is genuinely caught between two transforms.
 */
const weights = new Float32Array(VERTICES);
function weigh(falloff: number): void {
    const lower = 0.5 - falloff / 2;
    const span = Math.max(falloff, 1e-4);
    for (let i = 0; i < VERTICES; i++) {
        const along = (rest.positions[i * 3 + 1] + HEIGHT / 2) / HEIGHT;
        const t = Math.min(1, Math.max(0, (along - lower) / span));
        weights[i] = t * t * (3 - 2 * t); // smoothstep
    }
}
weigh(settings.falloff);

/* the two bones */

// both bones share an origin and carry no translation, so what separates the
// two tubes is purely how a rotation is blended
const AXIS: Vec3 = [0, 1, 0];
const ORIGIN: Vec3 = [0, 0, 0];

const boneRotation = quat.create();

const matrixBone = mat4.create();
const matrixRest = mat4.identity(mat4.create());
const blendedMatrix = mat4.create();

const dualBone = quat2.create();
const dualRest = quat2.identity(quat2.create());
const flippedBone = quat2.create();
const blendedDual = quat2.create();
const blendedReal = quat.create();

/** Rebuilds both representations of the twisted bone for this frame. */
function setBone(angle: number): void {
    quat.setAxisAngle(boneRotation, AXIS, angle);
    mat4.fromRotationTranslation(matrixBone, boneRotation, ORIGIN);
    quat2.fromRotationTranslation(dualBone, boneRotation, ORIGIN);
}

const _skin_position = vec3.create();
const _skin_normal = vec3.create();

/** Linear blend skinning: average the matrices, then transform. */
function skinWithMatrices(positions: Float32Array, normals: Float32Array): void {
    for (let i = 0; i < VERTICES; i++) {
        const w = weights[i];
        // a weighted sum of two rotation matrices, which is not itself a
        // rotation - at w = 0.5 of a half turn it scales x and z to zero
        mat4.multiplyScalar(blendedMatrix, matrixRest, 1 - w);
        mat4.multiplyScalarAndAdd(blendedMatrix, blendedMatrix, matrixBone, w);

        vec3.set(_skin_position, rest.positions[i * 3], rest.positions[i * 3 + 1], rest.positions[i * 3 + 2]);
        vec3.transformMat4(_skin_position, _skin_position, blendedMatrix);
        vec3.set(_skin_normal, rest.normals[i * 3], rest.normals[i * 3 + 1], rest.normals[i * 3 + 2]);
        // the bones carry no translation, so the same transform serves for
        // directions. Normalising afterwards hides none of the collapse, since
        // that shows in the silhouette rather than the shading
        vec3.transformMat4(_skin_normal, _skin_normal, blendedMatrix);
        vec3.normalize(_skin_normal, _skin_normal);

        write(positions, normals, i, _skin_position, _skin_normal);
    }
}

/** Dual quaternion linear blending: lerp the dual quats, normalise, then transform. */
function skinWithDualQuaternions(positions: Float32Array, normals: Float32Array): void {
    // a dual quaternion and its negation are the same transform, so blending
    // toward the wrong sign takes the long way round. One dot decides it, and
    // the fix is to negate the operand - negating the weight instead is a
    // different expression entirely, and jumps the moment the sign changes
    const target = quat2.dot(dualRest, dualBone) < 0 ? quat2.scale(flippedBone, dualBone, -1) : dualBone;

    for (let i = 0; i < VERTICES; i++) {
        const w = weights[i];
        quat2.lerp(blendedDual, dualRest, target, w);
        // lerp lands off the unit hypersphere, most at w = 0.5. Normalising is
        // what pulls it back onto a rigid transform, and is why nothing squashes
        quat2.normalize(blendedDual, blendedDual);

        quat2.getReal(blendedReal, blendedDual);
        quat2.getTranslation(_skin_position, blendedDual);

        vec3.set(_skin_normal, rest.positions[i * 3], rest.positions[i * 3 + 1], rest.positions[i * 3 + 2]);
        vec3.transformQuat(_skin_normal, _skin_normal, blendedReal);
        vec3.add(_skin_position, _skin_normal, _skin_position);

        vec3.set(_skin_normal, rest.normals[i * 3], rest.normals[i * 3 + 1], rest.normals[i * 3 + 2]);
        vec3.transformQuat(_skin_normal, _skin_normal, blendedReal);

        write(positions, normals, i, _skin_position, _skin_normal);
    }
}

function write(positions: Float32Array, normals: Float32Array, i: number, p: Vec3, n: Vec3): void {
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
    normals[i * 3] = n[0];
    normals[i * 3 + 1] = n[1];
    normals[i * 3 + 2] = n[2];
}

/* renderer */

const renderer = await createRenderer({ antialias: true });

const canvas = renderer.domElement as HTMLCanvasElement;
document.body.appendChild(canvas);
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
canvas.style.touchAction = 'none';

const scene = new g.Scene();

const camera = new g.PerspectiveCamera(Math.PI / 4, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position[1] = 0.6;
camera.position[2] = 4.4;
scene.add(camera);

const controls = new g.OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.1;

window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});

/* the two tubes */

function createTubeMesh(tint: [number, number, number], x: number) {
    const positions = new Float32Array(rest.positions);
    const normals = new Float32Array(rest.normals);
    const positionBuffer = g.createVertexBuffer(d.vec3f, positions);
    const normalBuffer = g.createVertexBuffer(d.vec3f, normals);

    const geometry = new g.Geometry();
    geometry.setBuffer('position', positionBuffer);
    geometry.setBuffer('normal', normalBuffer);
    // the stripe rides along with its vertex and is never rewritten, so the
    // bands spiral exactly as far as the skinning carried them
    geometry.setBuffer('stripe', g.createVertexBuffer(d.f32, rest.stripes));
    geometry.setIndex(g.createIndexBuffer(rest.indices));

    const localPosition = g.attribute('position', d.vec3f);
    const localNormal = g.attribute('normal', d.vec3f);
    const world = g.mul(g.modelWorldMatrix, g.vec4(localPosition, g.f32(1)));
    const clip = g.mul(g.cameraProjectionMatrix, g.mul(g.cameraViewMatrix, world));
    const vNormal = g.varying(g.normalize(localNormal), 'v_n');
    const vStripe = g.varying(g.attribute('stripe', d.f32), 'v_stripe');
    const diffuse = g.Var('diffuse', vNormal.dot(g.vec3(0.4, 0.75, 0.55).normalize()).abs());
    const band = g.Var('band', g.step(g.f32(0.5), g.fract(g.mul(vStripe, g.f32(BANDS)))));
    const lit = g.Var(
        'lit',
        g
            .f32(0.32)
            .add(diffuse.mul(g.f32(0.72)))
            .mul(g.f32(0.45).add(band.mul(g.f32(0.55)))),
    );
    const mesh = new g.Mesh(
        geometry,
        new g.Material({
            vertex: clip,
            fragment: g.vec4(g.vec3(tint[0], tint[1], tint[2]).mul(lit), g.f32(1)),
            cullMode: 'none',
        }),
    );
    mesh.position[0] = x;
    scene.add(mesh);

    return { positions, normals, positionBuffer, normalBuffer };
}

const matrixTube = createTubeMesh([0.35, 0.62, 1], -SPLIT);
const dualTube = createTubeMesh([1, 0.3, 0.62], SPLIT);

/* panel */

const panel = createPanel('dual quaternion skinning');
panel.add(settings, 'twist', { min: -360, max: 360, step: 1, label: 'Twist' });
panel.add(settings, 'auto', { label: 'Animate' });
panel.add(settings, 'rate', { min: 0.05, max: 3, step: 0.05, label: 'Rate' });
panel
    .add(settings, 'falloff', { min: 0.05, max: 1, step: 0.01, label: 'Weight falloff' })
    .onChange(() => weigh(settings.falloff));
panel.monitor(() => 'mat4 blend', { label: 'left' });
panel.monitor(() => 'quat2 blend', { label: 'right' });
panel.monitor(() => VERTICES * 2, { label: 'vertices skinned' });

/* render */

scene.updateWorldMatrix();
camera.updateViewMatrix();

const scenePass = g.pass(scene, camera);
const outputNode = g.fxaa(scenePass.getTextureNode());
const renderPipeline = new g.RenderPipeline(renderer, outputNode);

let clock = 0;
let last = -1;

function frame(tms: number) {
    const t = tms / 1000;
    if (last < 0) last = t;
    const delta = Math.min(t - last, 0.05);
    last = t;

    if (settings.auto) {
        // the twist eases between a half turn each way and never crosses one.
        // A blend along the shortest arc has to change its mind at exactly half
        // a turn - one side of it a half-weighted vertex is carried most of the
        // way round, the other side it is carried the same distance the other
        // way - so a bone that wraps past 180 tears every partly weighted
        // vertex, while the fully weighted ends sit still. Staying inside that
        // is what keeps this loop continuous, and 180 is where the two blends
        // disagree most anyway
        clock += delta * settings.rate;
        settings.twist = Math.sin(clock) * 175;
    }

    setBone((settings.twist * Math.PI) / 180);
    skinWithMatrices(matrixTube.positions, matrixTube.normals);
    skinWithDualQuaternions(dualTube.positions, dualTube.normals);
    matrixTube.positionBuffer.needsUpdate = true;
    matrixTube.normalBuffer.needsUpdate = true;
    dualTube.positionBuffer.needsUpdate = true;
    dualTube.normalBuffer.needsUpdate = true;

    controls.update();
    scene.updateWorldMatrix();
    camera.updateViewMatrix();
    renderPipeline.render();
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
