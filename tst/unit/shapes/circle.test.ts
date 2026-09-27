import { describe, expect, it } from 'vitest';
import type { Circle } from '../../../src/shapes';
import { circle } from '../../../src/shapes';

describe('circle', () => {
    describe('setFromPoints', () => {
        it('should center on the bounding box and reach the farthest point', () => {
            const out = circle.create();
            circle.setFromPoints(out, [1, 1, 5, 1, 1, 3], 3);

            expect(out.center).toEqual([3, 2]);
            expect(out.radius).toBeCloseTo(Math.sqrt(5));
        });

        it('should read only the first n points', () => {
            const out: Circle = { center: [9, 9], radius: 9 };

            expect(circle.setFromPoints(out, [0, 0, 2, 0, 100, 100], 2)).toBe(out);
            expect(out.center).toEqual([1, 0]);
            expect(out.radius).toBe(1);
        });

        it('should set the origin with radius 0 for no points', () => {
            const out: Circle = { center: [9, 9], radius: 9 };
            circle.setFromPoints(out, [], 0);

            expect(out.center).toEqual([0, 0]);
            expect(out.radius).toBe(0);
        });
    });
});
