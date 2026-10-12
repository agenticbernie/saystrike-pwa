export const GAMEPLAY_CONFIG = {
  bossName: 'Synth Titan MK-II',
  bossHp: 100,
  playerEnergy: 3,
  maxDifficulty: 5,
  minDifficulty: 1,
  ranks: [
    { minimumXp: 0, title: 'Rookie Vocalist' },
    { minimumXp: 200, title: 'Arcade Runner' },
    { minimumXp: 500, title: 'Neon Veteran' },
  ],
  xp: {
    challengeComplete: 20,
    highScoreThreshold: 80,
    highScoreBonus: 5,
    retryImprovement: 5,
    retryBonus: 5,
    sessionGoalBonus: 10,
  },
  difficulty: {
    longHistoryAt: 10,
    shortWindow: 3,
    longWindow: 5,
    successThreshold: 85,
    increaseAverage: 85,
    decreaseAverage: 65,
    successFractionForShortWindow: 2,
    successFractionForLongWindow: 4,
  },
  damagePerHundred: 30,
  weakEnergyCost: 1,
  criticalEnergyCost: 1,
  missEnergyCost: 1,
  // The product brief defines the debuff but no numeric combo bonus. Keep it at zero until playtest config exists.
  comboDamageBonus: 0,
  sessionGoalValidChallenges: 5,
} as const;

export function getRank(xp: number): string {
  return [...GAMEPLAY_CONFIG.ranks].reverse().find((rank) => xp >= rank.minimumXp)?.title ?? GAMEPLAY_CONFIG.ranks[0].title;
}

export type BattleStatus = 'active' | 'victory' | 'defeat';
export type AttackTier = 'strong' | 'normal' | 'weak' | 'critical' | 'miss';

export interface BattleState {
  bossHp: number;
  playerEnergy: number;
  status: BattleStatus;
  brokenRhythm: boolean;
  guardBreak: boolean;
  validAttacks: number;
}

export interface AttackResolution {
  state: BattleState;
  damage: number;
  tier: AttackTier;
  phase: 1 | 2 | 3;
  comboDisabledThisTurn: boolean;
}

export function getBossPhase(hp: number): 1 | 2 | 3 {
  if (hp > 60) return 1;
  if (hp > 30) return 2;
  return 3;
}

export function getAttackTier(score: number): AttackTier {
  if (score === 0) return 'miss';
  if (score < 40) return 'critical';
  if (score < 65) return 'weak';
  if (score < 80) return 'normal';
  return 'strong';
}

export function resolveAttack(state: BattleState, score: number): AttackResolution {
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new RangeError('Speaking score must be an integer from 0 to 100.');
  if (state.status !== 'active') throw new Error('Battle is already finished.');

  const tier = getAttackTier(score);
  const comboDisabledThisTurn = state.brokenRhythm;
  const damage = score === 0 ? 0 : Math.round(GAMEPLAY_CONFIG.damagePerHundred * score / 100);
  const energyCost = tier === 'weak'
    ? GAMEPLAY_CONFIG.weakEnergyCost
    : tier === 'critical'
      ? GAMEPLAY_CONFIG.criticalEnergyCost
      : tier === 'miss'
        ? GAMEPLAY_CONFIG.missEnergyCost
        : 0;
  const bossHp = Math.max(0, state.bossHp - damage);
  const playerEnergy = Math.max(0, state.playerEnergy - energyCost);
  const status: BattleStatus = bossHp === 0 ? 'victory' : playerEnergy === 0 ? 'defeat' : 'active';
  const brokenRhythm = tier === 'critical' || (state.brokenRhythm && score < 65);
  const guardBreak = tier === 'miss';
  const nextState: BattleState = {
    bossHp,
    playerEnergy,
    status,
    brokenRhythm,
    guardBreak,
    validAttacks: state.validAttacks + 1,
  };

  return { state: nextState, damage, tier, phase: getBossPhase(bossHp), comboDisabledThisTurn };
}

export function calculateXp(score: number, isFirstValidChallengeResult: boolean, improvedRetry: boolean): number {
  if (score < 0 || score > 100 || !Number.isInteger(score)) throw new RangeError('Speaking score must be an integer from 0 to 100.');
  let xp = isFirstValidChallengeResult ? GAMEPLAY_CONFIG.xp.challengeComplete : 0;
  if (isFirstValidChallengeResult && score >= GAMEPLAY_CONFIG.xp.highScoreThreshold) xp += GAMEPLAY_CONFIG.xp.highScoreBonus;
  if (!isFirstValidChallengeResult && improvedRetry) xp += GAMEPLAY_CONFIG.xp.retryBonus;
  return xp;
}

export function awardSessionGoal(validChallenges: number, alreadyAwarded: boolean): number {
  return validChallenges >= GAMEPLAY_CONFIG.sessionGoalValidChallenges && !alreadyAwarded ? GAMEPLAY_CONFIG.xp.sessionGoalBonus : 0;
}
