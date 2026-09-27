import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../src';
import type { Sphere } from '../../../src/shapes';
import { sphere } from '../../../src/shapes';

describe('sphere', () => {
    describe('create', () => {
        it('should create a unit sphere at the origin', () => {
            const s = sphere.create();

            expect(s.center).toEqual([0, 0, 0]);
            expect(s.radius).toBe(1);
        });
    });

    describe('setFromPoints', () => {
        it('should center on the bounding box and reach the farthest point', () => {
            const out = sphere.create();
            sphere.setFromPoints(out, [1, 1, 1, 5, 1, 1, 1, 3, 1, 1, 1, 7], 4);

            expect(out.center).toEqual([3, 2, 4]);
            expect(out.radius).toBeCloseTo(Math.sqrt(14));
        });

        it('should contain the farthest point despite sqrt rounding down', () => {
            // sqrt(0.75) squared is just under 0.75
            const out = sphere.setFromPoints(sphere.create(), [0, 0, 0, 1, 1, 1], 2);

            expect(sphere.containsPoint(out, [0, 0, 0])).toBe(true);
            expect(sphere.containsPoint(out, [1, 1, 1])).toBe(true);
        });

        it('should set the origin with radius 0 for no points', () => {
            const out: Sphere = { center: [9, 9, 9], radius: 9 };
            sphere.setFromPoints(out, [], 0);

            expect(out.center).toEqual([0, 0, 0]);
            expect(out.radius).toBe(0);
        });
    });

    describe('containsPoint', () => {
        it('should return true when the point is inside the sphere', () => {
            const s: Sphere = { center: [0, 0, 0], radius: 2 };
            const point: Vec3 = [1, 1, 0];

            expect(sphere.containsPoint(s, point)).toBe(true);
        });

        it('should return true when the point is exactly on the surface', () => {
            const s: Sphere = { center: [0, 0, 0], radius: 2 };
            const point: Vec3 = [2, 0, 0];

            expect(sphere.containsPoint(s, point)).toBe(true);
        });

        it('should return false when the point is outside the sphere', () => {
            const s: Sphere = { center: [0, 0, 0], radius: 2 };
            const point: Vec3 = [2, 2, 2];

            expect(sphere.containsPoint(s, point)).toBe(false);
        });

        it('should respect a non-origin center', () => {
            const s: Sphere = { center: [5, 0, 0], radius: 1 };

            expect(sphere.containsPoint(s, [5.5, 0, 0])).toBe(true);
            expect(sphere.containsPoint(s, [0, 0, 0])).toBe(false);
        });
    });
});
