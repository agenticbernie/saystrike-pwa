import { describe, expect, it } from 'vitest';
import { adjustDifficulty } from '../src/domain/difficulty.js';
import { awardSessionGoal, calculateXp, getAttackTier, getBossPhase, getRank, resolveAttack } from '../src/domain/game.js';

const state = {
  bossHp: 100,
  playerEnergy: 3,
  status: 'active' as const,
  brokenRhythm: false,
  guardBreak: false,
  validAttacks: 0,
};

describe('authoritative battle rules', () => {
  it.each([[100, 'strong'], [80, 'strong'], [79, 'normal'], [65, 'normal'], [64, 'weak'], [40, 'weak'], [39, 'critical'], [1, 'critical'], [0, 'miss']] as const)(
    'assigns score %i to tier %s', (score, tier) => expect(getAttackTier(score)).toBe(tier),
  );

  it('uses configured base damage and exact boss phase thresholds', () => {
    expect(resolveAttack(state, 83).damage).toBe(25);
    expect([100, 61, 60, 31, 30, 0].map(getBossPhase)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(resolveAttack({ ...state, bossHp: 61 }, 100)).toMatchObject({ state: { bossHp: 31 }, phase: 2 });
    expect(resolveAttack({ ...state, bossHp: 60 }, 100)).toMatchObject({ state: { bossHp: 30 }, phase: 3 });
  });

  it('deducts energy by score tier, applies debuffs, and terminates on zero energy', () => {
    expect(resolveAttack(state, 64).state.playerEnergy).toBe(2);
    const critical = resolveAttack(state, 39);
    expect(critical.state).toMatchObject({ playerEnergy: 2, brokenRhythm: true, status: 'active' });
    const followup = resolveAttack(critical.state, 65);
    expect(followup.comboDisabledThisTurn).toBe(true);
    expect(followup.state.brokenRhythm).toBe(false);
    const miss = resolveAttack(state, 0);
    expect(miss).toMatchObject({ damage: 0, tier: 'miss', state: { playerEnergy: 2, guardBreak: true } });
    const defeat = resolveAttack({ ...state, playerEnergy: 1 }, 40);
    expect(defeat.state.status).toBe('defeat');
  });

  it('handles victory and rejects impossible scores or finished battles', () => {
    const victory = resolveAttack({ ...state, bossHp: 20 }, 100);
    expect(victory.state).toMatchObject({ bossHp: 0, status: 'victory' });
    expect(() => resolveAttack(state, 101)).toThrow(RangeError);
    expect(() => resolveAttack({ ...state, status: 'victory' }, 100)).toThrow('already finished');
  });

  it('keeps broken rhythm active below 65 and clears at 65', () => {
    const broken = { ...state, brokenRhythm: true };
    expect(resolveAttack(broken, 64).state.brokenRhythm).toBe(true);
    expect(resolveAttack(broken, 65).state.brokenRhythm).toBe(false);
  });
});

describe('progression rules', () => {
  it('adjusts difficulty on only sufficiently populated valid-score windows', () => {
    expect(adjustDifficulty(2, [100, 100, 70])).toMatchObject({ next: 3, reason: 'increase' });
    expect(adjustDifficulty(2, [60, 60, 60])).toMatchObject({ next: 1, reason: 'decrease' });
    expect(adjustDifficulty(2, [70, 70, 70])).toMatchObject({ next: 2, reason: 'hold' });
    expect(adjustDifficulty(5, [100, 100, 100])).toMatchObject({ next: 5, reason: 'increase' });
    expect(adjustDifficulty(1, [40, 40, 40])).toMatchObject({ next: 1, reason: 'decrease' });
    expect(adjustDifficulty(2, [100, 100])).toMatchObject({ next: 2, reason: 'insufficient_data' });
    expect(adjustDifficulty(3, [90, 90, 90, 90, 90, 90, 90, 90, 100, 100])).toMatchObject({ next: 4, windowSize: 5 });
  });

  it('separates XP from speaking score and centralizes ranks', () => {
    expect(calculateXp(80, true, false)).toBe(25);
    expect(calculateXp(0, true, false)).toBe(20);
    expect(calculateXp(90, false, true)).toBe(5);
    expect(calculateXp(90, false, false)).toBe(0);
    expect(getRank(0)).toBe('Rookie Vocalist');
    expect(getRank(200)).toBe('Arcade Runner');
    expect(getRank(500)).toBe('Neon Veteran');
    expect(awardSessionGoal(4, false)).toBe(0);
    expect(awardSessionGoal(5, false)).toBe(10);
    expect(awardSessionGoal(5, true)).toBe(0);
  });
});
