import { describe, expect, it, vi } from 'vitest';
import { OpenAiSpeechEvaluator, ProviderResponseError, UnconfiguredSpeechEvaluator } from '../src/services/evaluator.js';

const assessment = {
  status: 'valid',
  transcript: 'We keep learning through practice.',
  scores: { accuracy: 36, clarity: 30, fluency: 20 },
  evidence: { accuracy: 'The key phrase is present.', clarity: 'Words are intelligible.', fluency: 'Delivery is continuous.' },
  feedback: { strength: 'Clear key phrase.', priorityIssue: 'One pause.', actionableTip: 'Link the middle words.', retryTarget: 'Speak the phrase in one smooth breath.' },
};

function response(content: unknown, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('OpenAI speech adapter boundary', () => {
  it('sends server-side audio, asks for evidence, and validates output including a supported zero score', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => response(JSON.stringify({ ...assessment, scores: { accuracy: 0, clarity: 0, fluency: 0 } })));
    const evaluator = new OpenAiSpeechEvaluator('test-secret', 'gpt-audio-1.5', 10_000, fetchMock as typeof fetch);
    const result = await evaluator.evaluate({ wav: Buffer.from('sample'), targetText: 'We keep learning.', signal: new AbortController().signal });
    expect(result.status).toBe('valid');
    expect(result.status === 'valid' && result.scores).toEqual({ accuracy: 0, clarity: 0, fluency: 0 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-secret');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: 'gpt-audio-1.5', store: false, modalities: ['text'] });
    expect(body.messages[1].content[1].type).toBe('input_audio');
    expect(JSON.stringify(body)).toContain('Do not penalize accent');
  });

  it('rejects malformed provider responses and normalizes provider outages', async () => {
    const malformed = new OpenAiSpeechEvaluator('key', 'gpt-audio-1.5', 10_000, vi.fn(async () => response('{not json')) as typeof fetch);
    await expect(malformed.evaluate({ wav: Buffer.from('x'), targetText: 'target', signal: new AbortController().signal })).rejects.toBeInstanceOf(ProviderResponseError);
    const outage = new OpenAiSpeechEvaluator('key', 'gpt-audio-1.5', 10_000, vi.fn(async () => response('', 503)) as typeof fetch);
    await expect(outage.evaluate({ wav: Buffer.from('x'), targetText: 'target', signal: new AbortController().signal })).rejects.toThrow('temporarily unavailable');
    const timedOut = new OpenAiSpeechEvaluator('key', 'gpt-audio-1.5', 10_000, vi.fn(async () => { throw new DOMException('Timed out', 'TimeoutError'); }) as typeof fetch);
    await expect(timedOut.evaluate({ wav: Buffer.from('x'), targetText: 'target', signal: new AbortController().signal })).rejects.toThrow('timed out');
  });

  it('keeps unsupported subscores and evidence explicitly null when only partial evidence exists', async () => {
    const partial = {
      status: 'insufficient_evidence',
      transcript: 'The response begins clearly.',
      reason: 'There was not enough audio to judge fluency.',
      scores: { accuracy: 32, clarity: 29, fluency: null },
      evidence: { accuracy: 'The target opening was audible.', clarity: 'Words were understandable.', fluency: null },
    };
    const evaluator = new OpenAiSpeechEvaluator('key', 'gpt-audio-1.5', 10_000, vi.fn(async () => response(JSON.stringify(partial))) as typeof fetch);
    await expect(evaluator.evaluate({ wav: Buffer.from('x'), targetText: 'target', signal: new AbortController().signal })).resolves.toEqual(partial);
  });

  it('keeps provider configuration failure explicit', async () => {
    await expect(new UnconfiguredSpeechEvaluator().evaluate({ wav: Buffer.from('x'), targetText: 'target', signal: new AbortController().signal })).rejects.toThrow('not configured');
  });
});
