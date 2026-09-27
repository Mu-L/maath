import type { Vec2 } from '../core/vec2';

/** A circle in 2D space */
export type Circle = { center: Vec2; radius: number };


export function create(): Circle {
    return { center: [0, 0], radius: 0 };
}

/**
 * Sets the circle to enclose a set of points. The center is the center of the points' bounding box
 * and the radius is the distance to the farthest point. This is fast and always encloses every point,
 * but is not the minimal enclosing circle.
 *
 * With no points the circle is set to the origin with radius 0.
 *
 * @param out the circle to store the result
 * @param points points as a flat array `[x0, y0, x1, y1, ...]`
 * @param n number of points to read from `points`
 * @returns out
 */
export function setFromPoints(out: Circle, points: readonly number[], n: number): Circle {
    if (n === 0) {
        out.center[0] = 0;
        out.center[1] = 0;
        out.radius = 0;
        return out;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < n; i++) {
        const x = points[i * 2];
        const y = points[i * 2 + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;

    let maxSq = 0;
    for (let i = 0; i < n; i++) {
        const dx = points[i * 2] - cx;
        const dy = points[i * 2 + 1] - cy;
        const sq = dx * dx + dy * dy;
        if (sq > maxSq) maxSq = sq;
    }

    out.center[0] = cx;
    out.center[1] = cy;
    out.radius = Math.sqrt(maxSq);
    return out;
}
