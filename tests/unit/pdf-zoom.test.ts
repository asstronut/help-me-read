import { expect, test } from 'vitest';
import { zoomStep } from '../../src/lib/reader/pdf-zoom';

test('a fitted page between two steps moves to the nearest step on either side', () => {
  expect(zoomStep(1.18, 1)).toBe(1.25);
  expect(zoomStep(1.18, -1)).toBe(1.1);
});

test('a page on a step moves a whole step', () => {
  expect(zoomStep(1, 1)).toBe(1.1);
  expect(zoomStep(1, -1)).toBe(0.9);
  expect(zoomStep(1.002, 1)).toBe(1.1);
});

test('there is no step past either end', () => {
  expect(zoomStep(4, 1)).toBeNull();
  expect(zoomStep(0.25, -1)).toBeNull();
  expect(zoomStep(0.2, -1)).toBeNull();
});
