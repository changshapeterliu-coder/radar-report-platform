import { describe, it, expect } from 'vitest';

describe('Project setup', () => {
  it('should have vitest configured correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('should support TypeScript', () => {
    const greeting: string = 'Hello, Radar Report Platform!';
    expect(greeting).toContain('Radar Report');
  });

  it('should support fast-check', async () => {
    const fc = await import('fast-check');
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
      { numRuns: 100 }
    );
  });
});
