import type { Const } from '../core/const';
import type { Vec3 } from '../core/vec3';

/** A sphere in 3D space */
export type Sphere = { center: Vec3; radius: number };


/**
 * Creates a new sphere with a default center 0,0,0 and radius 1
 * @returns A new sphere.
 */
export function create(): Sphere {
    return { center: [0, 0, 0], radius: 1 };
}

/**
 * Sets the sphere to enclose a set of points. The center is the center of the points' bounding box
 * and the radius is the distance to the farthest point. This is fast and always encloses every point,
 * but is not the minimal enclosing sphere.
 *
 * With no points (n <= 0) the sphere is set to the origin with radius 0.
 *
 * @param out the sphere to store the result
 * @param points points as a flat array `[x0, y0, z0, x1, y1, z1, ...]`
 * @param n number of points to read from `points`
 * @returns out
 */
export function setFromPoints(out: Sphere, points: readonly number[], n: number): Sphere {
    if (n <= 0) {
        out.center[0] = 0;
        out.center[1] = 0;
        out.center[2] = 0;
        out.radius = 0;
        return out;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < n; i++) {
        const x = points[i * 3];
        const y = points[i * 3 + 1];
        const z = points[i * 3 + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;

    let maxSq = 0;
    for (let i = 0; i < n; i++) {
        const dx = points[i * 3] - cx;
        const dy = points[i * 3 + 1] - cy;
        const dz = points[i * 3 + 2] - cz;
        const sq = dx * dx + dy * dy + dz * dz;
        if (sq > maxSq) maxSq = sq;
    }

    out.center[0] = cx;
    out.center[1] = cy;
    out.center[2] = cz;
    // sqrt can round down so that radius * radius < maxSq and the farthest point tests as outside.
    // one relative epsilon step up is enough to cover that rounding.
    const radius = Math.sqrt(maxSq);
    out.radius = radius * radius < maxSq ? radius * (1 + Number.EPSILON) : radius;
    return out;
}

/**
 * Returns true if a point lies inside (or on the surface of) the sphere.
 *
 * @param sphere the sphere
 * @param point the point to test
 * @returns true if the point is within the sphere's radius
 */
export function containsPoint(sphere: Const<Sphere>, point: Const<Vec3>): boolean {
    const dx = point[0] - sphere.center[0];
    const dy = point[1] - sphere.center[1];
    const dz = point[2] - sphere.center[2];
    return dx * dx + dy * dy + dz * dz <= sphere.radius * sphere.radius;
}
