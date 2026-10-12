import { z } from 'zod';

const providerScoreSchema = z.object({
  accuracy: z.number().int().min(0).max(40),
  clarity: z.number().int().min(0).max(35),
  fluency: z.number().int().min(0).max(25),
}).strict();

const providerValidSchema = z.object({
  status: z.literal('valid'),
  transcript: z.string().trim().min(1).max(1000),
  scores: providerScoreSchema,
  evidence: z.object({
    accuracy: z.string().trim().min(1).max(500),
    clarity: z.string().trim().min(1).max(500),
    fluency: z.string().trim().min(1).max(500),
  }).strict(),
  feedback: z.object({
    strength: z.string().trim().min(1).max(280),
    priorityIssue: z.string().trim().min(1).max(280),
    actionableTip: z.string().trim().min(1).max(280),
    retryTarget: z.string().trim().min(1).max(280),
  }).strict(),
}).strict();

const providerInsufficientSchema = z.object({
  status: z.literal('insufficient_evidence'),
  transcript: z.string().trim().max(1000).nullable(),
  reason: z.string().trim().min(1).max(500),
  scores: z.object({
    accuracy: z.number().int().min(0).max(40).nullable(),
    clarity: z.number().int().min(0).max(35).nullable(),
    fluency: z.number().int().min(0).max(25).nullable(),
  }).strict().optional(),
  evidence: z.object({
    accuracy: z.string().trim().max(500).nullable(),
    clarity: z.string().trim().max(500).nullable(),
    fluency: z.string().trim().max(500).nullable(),
  }).strict().optional(),
}).strict();

const providerAssessmentSchema = z.discriminatedUnion('status', [providerValidSchema, providerInsufficientSchema]);
const providerEnvelopeSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable().optional() }).passthrough(),
  }).passthrough()).min(1),
}).passthrough();

export type ProviderAssessment = z.infer<typeof providerAssessmentSchema>;

export interface SpeechEvaluator {
  readonly provider: string;
  readonly model: string;
  evaluate(input: { wav: Buffer; targetText: string; signal: AbortSignal }): Promise<ProviderAssessment>;
}

export class ProviderConfigurationError extends Error {
  constructor(message = 'Speech evaluation is not configured on this server.') {
    super(message);
    this.name = 'ProviderConfigurationError';
  }
}

export class ProviderResponseError extends Error {
  constructor(message = 'The speech evaluation service returned an unusable response.') {
    super(message);
    this.name = 'ProviderResponseError';
  }
}

export class OpenAiSpeechEvaluator implements SpeechEvaluator {
  readonly provider = 'OpenAI';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async evaluate(input: { wav: Buffer; targetText: string; signal: AbortSignal }): Promise<ProviderAssessment> {
    if (!this.apiKey) throw new ProviderConfigurationError();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([input.signal, timeout]);
    let response: Response;
    try {
      response = await this.fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          modalities: ['text'],
          store: false,
          messages: [
            {
              role: 'system',
              content: [
                'You are an evidence-based English speaking practice evaluator. Listen to the submitted audio and assess only what is audible.',
                'Do not penalize accent, dialect, or regional speech variation. Do not claim phoneme-level precision.',
                'Compare the spoken content to the exact target sentence. Score content match from 0-40, intelligibility from 0-35, and fluency from 0-25.',
                'Clarity means whether the spoken words are understandable in this recording, not whether the speaker has a preferred accent.',
                'If speech is absent, too short, unintelligible, or a criterion cannot be supported, return status insufficient_evidence, explain why, and include any supported partial subscores/evidence; use null for every unsupported criterion. Never guess a score or invent a transcript.',
                'For a valid result, provide a faithful transcript, integer component scores within those ranges, a concise audio-grounded evidence note for each score, one specific strength, one priority issue, one actionable tip, and a retry target.',
                'Return exactly one JSON object and no markdown. Do not include a total score; the server calculates it.',
              ].join(' '),
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: `Target sentence: ${input.targetText}` },
                {
                  type: 'input_audio',
                  input_audio: { data: input.wav.toString('base64'), format: 'wav' },
                },
              ],
            },
          ],
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new ProviderResponseError('The speech evaluation service timed out. Please retry.');
      }
      throw new ProviderResponseError('The speech evaluation service could not be reached. Please retry.');
    }

    if (!response.ok) {
      const safeMessage = response.status === 401 || response.status === 403
        ? 'Speech evaluation credentials were rejected by the provider.'
        : response.status === 404
          ? 'The configured speech evaluation model is unavailable.'
          : response.status === 429
            ? 'The speech evaluation service is busy. Please retry shortly.'
            : 'The speech evaluation service is temporarily unavailable.';
      throw new ProviderResponseError(safeMessage);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderResponseError();
    }
    const parsedEnvelope = providerEnvelopeSchema.safeParse(payload);
    if (!parsedEnvelope.success) throw new ProviderResponseError();
    const content = parsedEnvelope.data.choices[0]?.message.content;
    if (typeof content !== 'string') throw new ProviderResponseError();

    let decoded: unknown;
    try {
      decoded = JSON.parse(content.trim());
    } catch {
      throw new ProviderResponseError();
    }
    const parsed = providerAssessmentSchema.safeParse(decoded);
    if (!parsed.success) throw new ProviderResponseError();
    if (parsed.data.status === 'valid') {
      const total = parsed.data.scores.accuracy + parsed.data.scores.clarity + parsed.data.scores.fluency;
      if (total > 100) throw new ProviderResponseError();
    }
    return parsed.data;
  }
}

export class UnconfiguredSpeechEvaluator implements SpeechEvaluator {
  readonly provider = 'unconfigured';
  readonly model = 'none';

  async evaluate(): Promise<ProviderAssessment> {
    throw new ProviderConfigurationError();
  }
}
