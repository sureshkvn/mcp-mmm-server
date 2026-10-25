import type { LevelId, MaturityLevel } from './level.js';
import { level0 } from './level0.js';
import { level1 } from './level1.js';
import { level2 } from './level2.js';
import { level3 } from './level3.js';
import { level4 } from './level4.js';

export const LEVELS: Record<LevelId, MaturityLevel> = {
  0: level0,
  1: level1,
  2: level2,
  3: level3,
  4: level4,
};

export function parseLevel(value: string | undefined, fallback: LevelId = 4): LevelId {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 4 ? (n as LevelId) : fallback;
}
