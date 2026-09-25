/**
 * Screenshot automation for examples.
 *
 * Starts `pnpm run dev` (Vite dev server), navigates Playwright Chromium to
 * each example, hides overlays, and frames the rendered content with a little margin,
 * and writes PNGs to examples/public/screenshots/<key>.png.
 *
 * Usage:
 *   pnpm run screenshot                  (from examples/)
 *   pnpm run screenshot <example-key>    (a single example)
 *   SCREENSHOT_TIMEOUT=2000 pnpm run screenshot
 */

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(__dirname, '..');

const TIMEOUT_MS = Number(process.env.SCREENSHOT_TIMEOUT ?? 2000);
const VIEWPORT = { width: 1280, height: 720 };

// ---------------------------------------------------------------------------
// Read example registry
// ---------------------------------------------------------------------------

const examples = JSON.parse(
    readFileSync(resolve(examplesDir, 'src/examples.json'), 'utf8'),
);
// Optionally screenshot a single example: `node scripts/screenshot.js <key>`
const onlyKey = process.argv[2];
const exampleKeys = onlyKey ? Object.keys(examples).filter((k) => k === onlyKey) : Object.keys(examples);
if (onlyKey && exampleKeys.length === 0) {
    throw new Error(`Unknown example key: ${onlyKey}`);
}

// ---------------------------------------------------------------------------
// Ensure output directory exists
// ---------------------------------------------------------------------------

const screenshotsDir = resolve(examplesDir, 'public/screenshots');
mkdirSync(screenshotsDir, { recursive: true });

// ---------------------------------------------------------------------------
// Start Vite dev server and wait until it's ready
// ---------------------------------------------------------------------------

function startDevServer() {
    return new Promise((resolve, reject) => {
        const proc = spawn('pnpm', ['exec', 'vite', '--port', '5199', '--strictPort'], {
            cwd: examplesDir,
            env: { ...process.env, BROWSER: 'none' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let resolved = false;

        const onData = (data) => {
            const text = data.toString();
            process.stdout.write(`[vite] ${text}`);

            // Vite prints "Local: http://localhost:<port>/" when ready
            const match = text.match(/Local:\s+(http:\/\/localhost:\d+)/);
            if (match && !resolved) {
                resolved = true;
                resolve({ proc, url: match[1] });
            }
        };

        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);

        proc.on('error', reject);
        proc.on('exit', (code) => {
            if (!resolved) reject(new Error(`Vite exited early with code ${code}`));
        });
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let viteProc = null;
let browser = null;

/** Keep the drawing centered in a 16:9 frame with room around its outermost marks. */
async function frameDrawing(screenshot, outPath) {
    const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let left = info.width, top = info.height, right = -1, bottom = -1;
    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
            const offset = (y * info.width + x) * info.channels;
            // The warm background is #14120e. Ignore near-background antialiasing.
            if (Math.max(Math.abs(data[offset] - 20), Math.abs(data[offset + 1] - 18), Math.abs(data[offset + 2] - 14)) <= 8) continue;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
        }
    }
    if (right < left) throw new Error(`No visible drawing for ${outPath}`);
    const units = Math.min(
        Math.floor(info.width / 16),
        Math.floor(info.height / 9),
        Math.ceil(Math.max((right - left + 1) / 16, (bottom - top + 1) / 9) / 0.84),
    );
    const width = units * 16;
    const height = units * 9;
    await sharp(screenshot).extract({
        left: Math.max(0, Math.min(info.width - width, Math.round((left + right - width) / 2))),
        top: Math.max(0, Math.min(info.height - height, Math.round((top + bottom - height) / 2))),
        width,
        height,
    }).resize(VIEWPORT.width, VIEWPORT.height).png().toFile(outPath);
}

try {
    console.log('Starting Vite dev server...');
    const { proc, url } = await startDevServer();
    viteProc = proc;
    console.log(`Vite ready at ${url}`);

    browser = await chromium.launch({
        // Headless by default so the run doesn't steal desktop focus.
        // Set HEADED=1 to watch it drive a real window.
        headless: process.env.HEADED !== '1',
        // Enable WebGPU in headless Chromium (some examples use gpucat's WebGPU
        // backend); --use-angle=metal is the best GPU path on macOS. Shove any
        // headed fallback window far offscreen so it can't cover work.
        args: [
            '--use-angle=metal',
            '--enable-unsafe-webgpu',
            '--window-position=-10000,-10000',
        ],
    });

    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 3 });
    const page = await context.newPage();

    // Surface any page errors so we know if an example fails to init
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
        if (msg.type() === 'error') console.error(`[console error] ${msg.text()}`);
    });

    for (const key of exampleKeys) {
        const pageUrl = `${url}/${key}.html`;
        console.log(`\n→ ${key}`);

        await page.goto(pageUrl, { waitUntil: 'networkidle' });
        await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
        await page.waitForTimeout(TIMEOUT_MS);
        if (errors.length) throw new Error(`${key}: ${errors.join('\n')}`);

        if (key === 'example-spring') {
            // Stretch the tail so its individual wireframe beads are visible.
            await page.mouse.move(VIEWPORT.width * 0.28, VIEWPORT.height * 0.65);
            await page.waitForTimeout(400);
            await page.mouse.move(VIEWPORT.width * 0.72, VIEWPORT.height * 0.35);
            await page.waitForTimeout(75);
        }

        const canvas = page.locator('canvas').first();
        const box = await canvas.boundingBox();

        if (!box) {
            throw new Error(`${key}: no canvas found`);
        }

        const outPath = resolve(screenshotsDir, `${key}.png`);
        await frameDrawing(await page.screenshot({ clip: box }), outPath);
        console.log(`  Saved → ${outPath}`);
    }

    console.log('\nAll screenshots captured.');
} finally {
    if (browser) await browser.close();
    if (viteProc) {
        viteProc.kill('SIGTERM');
    }
}
