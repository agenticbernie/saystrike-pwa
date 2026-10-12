import { GAMEPLAY_CONFIG } from './game.js';

export interface DifficultyDecision {
  current: number;
  next: number;
  windowSize: number;
  reason: 'increase' | 'hold' | 'decrease' | 'insufficient_data';
  average: number | null;
}

export function adjustDifficulty(current: number, allScores: number[]): DifficultyDecision {
  const clamped = Math.max(GAMEPLAY_CONFIG.minDifficulty, Math.min(GAMEPLAY_CONFIG.maxDifficulty, Math.trunc(current)));
  const windowSize = allScores.length >= GAMEPLAY_CONFIG.difficulty.longHistoryAt
    ? GAMEPLAY_CONFIG.difficulty.longWindow
    : GAMEPLAY_CONFIG.difficulty.shortWindow;
  const recent = allScores.slice(-windowSize);

  if (recent.length < windowSize) {
    return { current: clamped, next: clamped, windowSize, reason: 'insufficient_data', average: null };
  }

  const average = recent.reduce((sum, score) => sum + score, 0) / recent.length;
  const successes = recent.filter((score) => score >= GAMEPLAY_CONFIG.difficulty.successThreshold).length;
  const requiredSuccesses = windowSize === GAMEPLAY_CONFIG.difficulty.shortWindow
    ? GAMEPLAY_CONFIG.difficulty.successFractionForShortWindow
    : GAMEPLAY_CONFIG.difficulty.successFractionForLongWindow;

  if (average >= GAMEPLAY_CONFIG.difficulty.increaseAverage && successes >= requiredSuccesses) {
    return { current: clamped, next: Math.min(GAMEPLAY_CONFIG.maxDifficulty, clamped + 1), windowSize, reason: 'increase', average };
  }
  if (average < GAMEPLAY_CONFIG.difficulty.decreaseAverage) {
    return { current: clamped, next: Math.max(GAMEPLAY_CONFIG.minDifficulty, clamped - 1), windowSize, reason: 'decrease', average };
  }
  return { current: clamped, next: clamped, windowSize, reason: 'hold', average };
}
