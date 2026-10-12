import {
  apiErrorSchema,
  battleSchema,
  challengeSchema,
  evaluationResultSchema,
  healthSchema,
  progressSchema,
  sessionReviewSchema,
  sessionSchema,
  type Battle,
  type Challenge,
  type EvaluationResult,
  type Progress,
  type SessionReview,
} from '@saystrike/shared';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const apiRoot = `${baseUrl}/api/v1`;

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly retryable: boolean, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiRoot}${path}`, {
      credentials: 'include',
      ...init,
    });
  } catch {
    throw new ApiError('The server is offline. Reconnect and try again.', 'network_error', true, 0);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('The server returned an unreadable response.', 'invalid_response', true, response.status);
  }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) throw new ApiError(parsed.data.error.message, parsed.data.error.code, parsed.data.error.retryable, response.status);
    throw new ApiError('The request could not be completed.', 'request_failed', response.status >= 500, response.status);
  }
  return payload as T;
}

export async function getSession() {
  return sessionSchema.parse(await request('/session'));
}

export async function getProgress(): Promise<Progress> {
  return progressSchema.parse(await request('/progress'));
}

export async function startPracticeSession(): Promise<{ id: string; mode: 'practice' }> {
  return request('/practice-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}

export async function getPracticeChallenge(sessionId: string): Promise<Challenge> {
  return challengeSchema.parse(await request(`/practice-sessions/${sessionId}/challenges`, { method: 'POST' }));
}

export async function skipPracticeChallenge(sessionId: string, challengeId: string): Promise<void> {
  await request(`/practice-sessions/${sessionId}/challenges/${challengeId}/skip`, { method: 'POST' });
}

export async function startBattle(): Promise<Battle> {
  const response = await request<{ battle: unknown }>('/battles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return battleSchema.parse(response.battle);
}

export async function getBattle(battleId: string): Promise<Battle> {
  const response = await request<{ battle: unknown }>(`/battles/${battleId}`);
  return battleSchema.parse(response.battle);
}

export async function getBattleChallenge(battleId: string): Promise<Challenge> {
  return challengeSchema.parse(await request(`/battles/${battleId}/challenges`, { method: 'POST' }));
}

export async function evaluateRecording(challengeId: string, audio: Blob): Promise<EvaluationResult> {
  const form = new FormData();
  form.set('idempotencyKey', crypto.randomUUID());
  form.set('audio', new File([audio], 'saystrike-recording.wav', { type: 'audio/wav' }));
  return evaluationResultSchema.parse(await request(`/challenges/${challengeId}/evaluate`, { method: 'POST', body: form }));
}

export async function getSessionReview(sessionId: string): Promise<SessionReview> {
  return sessionReviewSchema.parse(await request(`/sessions/${sessionId}/review`));
}

export async function getHealth() {
  return healthSchema.parse(await request('/health'));
}
