import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProgress: vi.fn(),
  getSession: vi.fn(),
  getHealth: vi.fn(),
  startPracticeSession: vi.fn(),
  getPracticeChallenge: vi.fn(),
  evaluateRecording: vi.fn(),
}));

vi.mock('../src/api.js', () => ({
  getProgress: mocks.getProgress,
  getSession: mocks.getSession,
  getHealth: mocks.getHealth,
  startPracticeSession: mocks.startPracticeSession,
  getPracticeChallenge: mocks.getPracticeChallenge,
  evaluateRecording: mocks.evaluateRecording,
  getBattle: vi.fn(),
  getBattleChallenge: vi.fn(),
  getSessionReview: vi.fn(),
  skipPracticeChallenge: vi.fn(),
  startBattle: vi.fn(),
}));

const challengeId = 'f0f16015-d0b4-4e26-a955-aec951a5a48e';
const sessionId = 'c2f5f0a8-3d54-48bc-8aae-4eb4096e3c39';

describe('SayStrike app shell and microphone recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    localStorage.clear();
    history.replaceState({}, '', '/');
    mocks.getProgress.mockResolvedValue({ xp: 0, rank: 'Rookie Vocalist', difficulty: 1, validAttempts: 0, averageScore: null, strongestSkill: null, recurringIssue: null, recentScores: [], lastBattle: null });
    mocks.getSession.mockResolvedValue({ player: { xp: 0, difficulty: 1, validAttempts: 0 }, evaluationReady: true });
    mocks.getHealth.mockResolvedValue({ status: 'ok', evaluationReady: true, provider: 'OpenAI', database: 'sqlite' });
    mocks.startPracticeSession.mockResolvedValue({ id: sessionId, mode: 'practice' });
    mocks.getPracticeChallenge.mockResolvedValue({ id: challengeId, sessionId, battleId: null, mode: 'practice', targetId: 'sample', targetText: 'We keep learning through practice.', category: 'Daily routine', difficulty: 1, difficultyLabel: 'Warm-up', turnNumber: null });
  });

  it('renders the arena navigation and opens a live practice challenge', async () => {
    const { App } = await import('../src/App.js');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /ready to strike/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /build your speaking flow/i }));
    expect(await screen.findByRole('heading', { name: /find your rhythm/i })).toBeInTheDocument();
    expect(screen.getByText(/we keep learning through practice/i)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
  });

  it('explains microphone denial and does not upload audio', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    const { App } = await import('../src/App.js');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /build your speaking flow/i }));
    fireEvent.click(await screen.findByRole('button', { name: /start recording/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/microphone permission was denied/i);
    expect(mocks.evaluateRecording).not.toHaveBeenCalled();
  });

  it('keeps local recording available when server speech evaluation is not configured', async () => {
    mocks.getSession.mockResolvedValue({ player: { xp: 0, difficulty: 1, validAttempts: 0 }, evaluationReady: false });
    mocks.getHealth.mockResolvedValue({ status: 'ok', evaluationReady: false, provider: null, database: 'sqlite' });
    const { App } = await import('../src/App.js');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /build your speaking flow/i }));
    const mic = await screen.findByRole('button', { name: /start recording/i });
    expect(mic).toBeEnabled();
    expect(screen.getByText(/record and review the local audio preview/i)).toBeInTheDocument();
  });
});
