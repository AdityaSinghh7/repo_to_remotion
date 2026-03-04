import { describe, expect, it } from 'vitest';
import {
  DETERMINISTIC_SCREENSHOT_NAMES,
  buildDeterministicScreenshotNames,
} from '../src/capture/screenshot-capture-service.js';

describe('buildDeterministicScreenshotNames', () => {
  it('returns first screenshot for minimum count', () => {
    expect(buildDeterministicScreenshotNames(1)).toEqual(['01-landing.png']);
  });

  it('caps at known deterministic name set', () => {
    expect(buildDeterministicScreenshotNames(999)).toEqual([...DETERMINISTIC_SCREENSHOT_NAMES]);
  });

  it('defaults to one name when count is zero', () => {
    expect(buildDeterministicScreenshotNames(0)).toEqual(['01-landing.png']);
  });
});
