import { z } from 'zod';

export const evaluationStatusSchema = z.enum([
  'valid',
  'insufficient_evidence',
  'audio_error',
  'evaluation_error',
]);

export const scoreBreakdownSchema = z.object({
  accuracy: z.number().int().min(0).max(40).nullable(),
  clarity: z.number().int().min(0).max(35).nullable(),
  fluency: z.number().int().min(0).max(25).nullable(),
  total: z.number().int().min(0).max(100).nullable(),
});

export const evidenceSchema = z.object({
  accuracy: z.string().nullable(),
  clarity: z.string().nullable(),
  fluency: z.string().nullable(),
});

export const feedbackSchema = z.object({
  strength: z.string().nullable(),
  priorityIssue: z.string().nullable(),
  actionableTip: z.string().nullable(),
  retryTarget: z.string().nullable(),
});

export const evaluationResultSchema = z.discriminatedUnion('status', [
  z.object({
    id: z.string().uuid(),
    challengeId: z.string().uuid(),
    status: z.literal('valid'),
    transcript: z.string().min(1),
    scores: scoreBreakdownSchema.extend({
      accuracy: z.number().int().min(0).max(40),
      clarity: z.number().int().min(0).max(35),
      fluency: z.number().int().min(0).max(25),
      total: z.number().int().min(0).max(100),
    }),
    evidence: evidenceSchema.extend({
      accuracy: z.string().min(1),
      clarity: z.string().min(1),
      fluency: z.string().min(1),
    }),
    feedback: feedbackSchema.extend({
      strength: z.string().min(1),
      priorityIssue: z.string().min(1),
      actionableTip: z.string().min(1),
      retryTarget: z.string().min(1),
    }),
    retryComparison: z.object({
      previousScore: z.number().int().min(0).max(100),
      improvedBy: z.number().int(),
    }).nullable(),
    battle: z.object({
      id: z.string().uuid(),
      attemptId: z.string().uuid().nullable(),
      attackApplied: z.boolean(),
      status: z.enum(['active', 'victory', 'defeat']),
      bossName: z.string(),
      bossHp: z.number().int().min(0).max(100),
      playerEnergy: z.number().int().min(0).max(3),
      phase: z.number().int().min(1).max(3),
      brokenRhythm: z.boolean(),
      guardBreak: z.boolean(),
      validAttacks: z.number().int().nonnegative(),
      playerXp: z.number().int().nonnegative(),
      difficulty: z.number().int().min(1).max(5),
      sessionId: z.string().uuid(),
      damage: z.number().int().min(0).max(30),
      tier: z.enum(['strong', 'normal', 'weak', 'critical', 'miss']).nullable(),
      xpAwarded: z.number().int().nonnegative(),
    }).nullable(),
    xpAwarded: z.number().int().nonnegative(),
    difficulty: z.number().int().min(1).max(5),
  }),
  z.object({
    id: z.string().uuid(),
    challengeId: z.string().uuid(),
    status: z.literal('insufficient_evidence'),
    transcript: z.string().nullable(),
    reason: z.string().min(1),
    scores: scoreBreakdownSchema,
    evidence: evidenceSchema,
    feedback: feedbackSchema,
    retryComparison: z.null(),
    battle: z.null(),
    xpAwarded: z.literal(0),
    difficulty: z.number().int().min(1).max(5),
  }),
  z.object({
    id: z.string().uuid(),
    challengeId: z.string().uuid(),
    status: z.enum(['audio_error', 'evaluation_error']),
    reason: z.string().min(1),
    scores: scoreBreakdownSchema,
    evidence: evidenceSchema,
    feedback: feedbackSchema,
    retryComparison: z.null(),
    battle: z.null(),
    xpAwarded: z.literal(0),
    difficulty: z.number().int().min(1).max(5),
  }),
]);

export const challengeSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  battleId: z.string().uuid().nullable(),
  mode: z.enum(['practice', 'battle']),
  targetId: z.string(),
  targetText: z.string().min(1),
  category: z.string().min(1),
  difficulty: z.number().int().min(1).max(5),
  difficultyLabel: z.string().min(1),
  turnNumber: z.number().int().positive().nullable(),
});

export const battleSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['active', 'victory', 'defeat']),
  bossName: z.string(),
  bossHp: z.number().int().min(0).max(100),
  playerEnergy: z.number().int().min(0).max(3),
  phase: z.number().int().min(1).max(3),
  brokenRhythm: z.boolean(),
  guardBreak: z.boolean(),
  validAttacks: z.number().int().nonnegative(),
  playerXp: z.number().int().nonnegative(),
  difficulty: z.number().int().min(1).max(5),
  sessionId: z.string().uuid(),
});

export const progressSchema = z.object({
  xp: z.number().int().nonnegative(),
  rank: z.string(),
  difficulty: z.number().int().min(1).max(5),
  validAttempts: z.number().int().nonnegative(),
  averageScore: z.number().min(0).max(100).nullable(),
  strongestSkill: z.string().nullable(),
  recurringIssue: z.string().nullable(),
  recentScores: z.array(z.object({ score: z.number().int().min(0).max(100), createdAt: z.string() })),
  lastBattle: z.object({ status: z.enum(['victory', 'defeat']), createdAt: z.string(), validAttacks: z.number().int() }).nullable(),
});

export const sessionReviewSchema = z.object({
  id: z.string().uuid(),
  mode: z.enum(['practice', 'battle']),
  validChallenges: z.number().int().nonnegative(),
  averageScore: z.number().min(0).max(100).nullable(),
  bestScore: z.number().int().min(0).max(100).nullable(),
  trend: z.enum(['up', 'down', 'steady', 'not_enough_data']),
  strongestSkill: z.string().nullable(),
  recurringIssue: z.string().nullable(),
  nextGoal: z.string(),
  xpAwarded: z.number().int().nonnegative(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
});

export const sessionSchema = z.object({
  player: z.object({
    xp: z.number().int().nonnegative(),
    difficulty: z.number().int().min(1).max(5),
    validAttempts: z.number().int().nonnegative(),
  }),
  evaluationReady: z.boolean(),
});

export const healthSchema = z.object({
  status: z.literal('ok'),
  evaluationReady: z.boolean(),
  provider: z.string().nullable(),
  database: z.literal('sqlite'),
});

export type EvaluationStatus = z.infer<typeof evaluationStatusSchema>;
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type Challenge = z.infer<typeof challengeSchema>;
export type Battle = z.infer<typeof battleSchema>;
export type Progress = z.infer<typeof progressSchema>;
export type SessionReview = z.infer<typeof sessionReviewSchema>;
export type PlayerSession = z.infer<typeof sessionSchema>;
export type ApiHealth = z.infer<typeof healthSchema>;
