import { useCallback, useEffect, useRef, useState } from 'react';
import type { Battle, Challenge, EvaluationResult, Progress, SessionReview } from '@saystrike/shared';
import {
  evaluateRecording,
  getBattle,
  getBattleChallenge,
  getHealth,
  getPracticeChallenge,
  getProgress,
  getSession,
  getSessionReview,
  skipPracticeChallenge,
  startBattle,
  startPracticeSession,
} from './api.js';
import { audioController, readAudioSettings, type AudioSettings } from './audioController.js';
import { Icon } from './Icon.js';
import { useRecorder } from './useRecorder.js';

type Route = '/' | '/practice' | '/practice/review' | '/battle' | '/battle/victory' | '/battle/defeat' | '/progress' | '/settings';
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const NAV_ITEMS: Array<{ path: '/' | '/practice' | '/battle' | '/progress' | '/settings'; title: string; icon: 'arena' | 'practice' | 'battle' | 'progress' | 'settings' }> = [
  { path: '/', title: 'Arena', icon: 'arena' },
  { path: '/practice', title: 'Practice', icon: 'practice' },
  { path: '/battle', title: 'Battle', icon: 'battle' },
  { path: '/progress', title: 'Progress', icon: 'progress' },
  { path: '/settings', title: 'Settings', icon: 'settings' },
];

function go(path: string) {
  if (window.location.pathname !== path) window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function readSessionValue(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionValue(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // The current screen remains usable if this browser blocks session storage.
  }
}

function readReducedMotionPreference() {
  try {
    return localStorage.getItem('saystrike-reduced-motion') === 'true';
  } catch {
    return false;
  }
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(date));
}

export function App() {
  const [path, setPath] = useState<Route>((window.location.pathname as Route) || '/');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [evaluationReady, setEvaluationReady] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [battle, setBattle] = useState<Battle | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => readSessionValue('saystrike-current-session'));
  const [summary, setSummary] = useState<SessionReview | null>(null);
  const [settings, setSettings] = useState<AudioSettings>(readAudioSettings);
  const [reducedMotion, setReducedMotion] = useState(readReducedMotionPreference);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refreshProgress = useCallback(async () => {
    try {
      const [nextProgress, session, health] = await Promise.all([getProgress(), getSession(), getHealth()]);
      setProgress(nextProgress);
      setEvaluationReady(session.evaluationReady && health.evaluationReady);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'SayStrike API is unavailable.');
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setPath((window.location.pathname as Route) || '/');
    const onApiError = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setConnectionError(typeof detail === 'string' ? detail : 'Speech evaluation could not complete.');
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('saystrike-api-error', onApiError);
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', onInstall);
    void refreshProgress();
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('saystrike-api-error', onApiError);
      window.removeEventListener('beforeinstallprompt', onInstall);
      audioController.dispose();
    };
  }, [refreshProgress]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false));
    try {
      localStorage.setItem('saystrike-reduced-motion', String(reducedMotion));
    } catch {
      // Respect the in-memory setting when persistent browser storage is disabled.
    }
  }, [reducedMotion]);

  useEffect(() => {
    if (path !== '/battle' || challenge || battle || busy) return;
    const savedBattleId = readSessionValue('saystrike-active-battle');
    if (!savedBattleId) return;
    setBusy(true);
    void (async () => {
      try {
        const resumedBattle = await getBattle(savedBattleId);
        setBattle(resumedBattle);
        setSessionId(resumedBattle.sessionId);
        if (resumedBattle.status === 'active') setChallenge(await getBattleChallenge(resumedBattle.id));
        else setPath(resumedBattle.status === 'victory' ? '/battle/victory' : '/battle/defeat');
      } catch {
        writeSessionValue('saystrike-active-battle', null);
        setConnectionError('That battle could not be resumed. Start a new match when you are ready.');
      } finally {
        setBusy(false);
      }
    })();
  }, [path, challenge, battle, busy]);

  const startPractice = async () => {
    setBusy(true);
    setEvaluation(null);
    setBattle(null);
    setSummary(null);
    try {
      const session = await startPracticeSession();
      setSessionId(session.id);
      writeSessionValue('saystrike-current-session', session.id);
      const nextChallenge = await getPracticeChallenge(session.id);
      setChallenge(nextChallenge);
      audioController.playEffect('uiTap');
      audioController.playMusic('practice');
      go('/practice');
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Practice could not start.');
    } finally {
      setBusy(false);
    }
  };

  const startNewBattle = async () => {
    setBusy(true);
    setEvaluation(null);
    setSummary(null);
    try {
      const savedBattleId = readSessionValue('saystrike-active-battle');
      const activeBattleId = battle?.status === 'active' ? battle.id : savedBattleId;
      const activeBattle = activeBattleId ? await getBattle(activeBattleId).catch(() => null) : null;
      if (activeBattle?.status === 'active') {
        const firstChallenge = await getBattleChallenge(activeBattle.id);
        setBattle(activeBattle);
        setSessionId(activeBattle.sessionId);
        setChallenge(firstChallenge);
        writeSessionValue('saystrike-active-battle', activeBattle.id);
        writeSessionValue('saystrike-current-session', activeBattle.sessionId);
        go('/battle');
        return;
      }
      writeSessionValue('saystrike-active-battle', null);
      const createdBattle = await startBattle();
      const firstChallenge = await getBattleChallenge(createdBattle.id);
      setBattle(createdBattle);
      setSessionId(createdBattle.sessionId);
      setChallenge(firstChallenge);
      writeSessionValue('saystrike-active-battle', createdBattle.id);
      writeSessionValue('saystrike-current-session', createdBattle.sessionId);
      audioController.playEffect('uiTap');
      audioController.playMusic('arena');
      go('/battle');
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Battle could not start.');
    } finally {
      setBusy(false);
    }
  };

  const onEvaluated = async (result: EvaluationResult) => {
    setEvaluation(result);
    if (result.status === 'valid') {
      if (result.battle) {
        setBattle({
          ...result.battle,
          bossName: battle?.bossName ?? 'Synth Titan MK-II',
          playerXp: result.battle.playerXp,
        });
        if (result.battle.attackApplied && (result.battle.status === 'victory' || result.battle.status === 'defeat')) {
          writeSessionValue('saystrike-active-battle', null);
          try {
            if (sessionId) setSummary(await getSessionReview(sessionId));
          } catch {
            setSummary(null);
          }
          audioController.playEffect(result.battle.status === 'victory' ? 'victory' : 'defeat');
          go(result.battle.status === 'victory' ? '/battle/victory' : '/battle/defeat');
        } else if (result.battle.attackApplied && result.battle.tier) {
          audioController.playEffect(result.battle.tier === 'strong' ? 'strongHit' : result.battle.tier === 'normal' ? 'standardHit' : result.battle.tier === 'weak' ? 'weakHit' : result.battle.tier === 'critical' ? 'criticalFailure' : 'guardBreak');
          if (result.battle.phase !== battle?.phase) audioController.playEffect('phaseTransition');
          if (result.battle.playerEnergy === 0) audioController.playEffect('energyDepleted');
        }
      } else {
        audioController.playEffect('strongHit');
        go('/practice/review');
      }
    } else if (result.status === 'audio_error' || result.status === 'evaluation_error') {
      setToast(result.reason);
      window.setTimeout(() => setToast(null), 5500);
      if (result.status === 'audio_error') audioController.playEffect('criticalFailure');
    } else {
      setToast(result.reason);
      window.setTimeout(() => setToast(null), 5500);
    }
    await refreshProgress();
  };

  const nextPracticeChallenge = async () => {
    if (!sessionId || !challenge) return;
    setBusy(true);
    try {
      if (evaluation?.status === 'valid') {
        const review = await getSessionReview(sessionId);
        setSummary(review);
      }
      const nextChallenge = await getPracticeChallenge(sessionId);
      setChallenge(nextChallenge);
      setEvaluation(null);
      go('/practice');
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'The next challenge could not load.');
    } finally {
      setBusy(false);
    }
  };

  const skipPractice = async () => {
    if (!sessionId || !challenge) return;
    setBusy(true);
    try {
      await skipPracticeChallenge(sessionId, challenge.id);
      setEvaluation(null);
      setChallenge(await getPracticeChallenge(sessionId));
      audioController.playEffect('uiTap');
      go('/practice');
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'This challenge could not be skipped.');
    } finally {
      setBusy(false);
    }
  };

  const nextBattleTurn = async () => {
    if (!battle) return;
    setBusy(true);
    try {
      setChallenge(await getBattleChallenge(battle.id));
      setEvaluation(null);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'The next battle turn could not load.');
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const retryChallenge = () => {
    setEvaluation(null);
    go(challenge?.mode === 'battle' ? '/battle' : '/practice');
  };

  const showSessionProgress = async () => {
    const selectedSession = sessionId ?? readSessionValue('saystrike-current-session');
    if (selectedSession) {
      try {
        setSummary(await getSessionReview(selectedSession));
      } catch {
        setSummary(null);
      }
    }
    go('/progress');
  };

  const updateSettings = (change: Partial<AudioSettings>) => {
    const next = { ...settings, ...change };
    setSettings(next);
    audioController.updateSettings(next);
    audioController.playEffect('uiTap');
  };

  const requestInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const activeTab = path.startsWith('/practice') ? '/practice'
    : path.startsWith('/battle') ? '/battle'
      : path === '/progress' ? '/progress'
        : path === '/settings' ? '/settings'
          : '/';

  return (
    <div className="app-backdrop">
      <div className="app-shell">
        <header className="topbar">
          <button className="brand-button" onClick={() => go('/')} aria-label="SayStrike home">
            <img src="/images/saystrike-mark.png" alt="" className="brand-mark" />
            <span className="brand-word">SAYSTRIKE</span>
          </button>
          <div className="topbar-meta">
            <span className="xp-chip"><Icon name="bolt" size={14} /> {progress?.xp ?? 0} XP</span>
            <button className="profile-dot" onClick={showSessionProgress} aria-label="Open progress"><Icon name="progress" size={16} /></button>
          </div>
        </header>

        <main className="screen" id="main-content" tabIndex={-1}>
          {connectionError && <div className="notice notice-error" role="alert"><Icon name="help" size={17} /><span>{connectionError}</span><button className="icon-button" onClick={() => { setConnectionError(null); void refreshProgress(); }} aria-label="Retry connection"><Icon name="retry" size={17} /></button></div>}
          {path === '/' && <HomeScreen progress={progress} onPractice={startPractice} onBattle={startNewBattle} busy={busy} onInstall={requestInstall} showInstall={Boolean(installPrompt)} evaluationReady={evaluationReady} />}
          {path === '/practice' && (challenge?.mode === 'practice'
            ? <ChallengeScreen key={challenge.id} challenge={challenge} battle={null} evaluation={evaluation} evaluationReady={evaluationReady} busy={busy} onEvaluated={onEvaluated} onSkip={skipPractice} onNext={nextPracticeChallenge} onRetry={retryChallenge} />
            : <EmptyRoute title="Practice" detail="Start a new practice session to get a sentence." action="Start practice" onAction={startPractice} busy={busy} />)}
          {path === '/practice/review' && evaluation && challenge && <ReviewScreen challenge={challenge} result={evaluation} busy={busy} onRetry={retryChallenge} onNext={nextPracticeChallenge} onSkip={skipPractice} onExit={() => go('/')} />}
          {path === '/practice/review' && !evaluation && <EmptyRoute title="Review" detail="There is no completed evaluation to review yet." action="Return to practice" onAction={() => go('/practice')} busy={busy} />}
          {path === '/battle' && (challenge?.mode === 'battle' && battle
            ? <ChallengeScreen key={challenge.id} challenge={challenge} battle={battle} evaluation={evaluation} evaluationReady={evaluationReady} busy={busy} onEvaluated={onEvaluated} onSkip={() => undefined} onNext={nextBattleTurn} onRetry={retryChallenge} />
            : <EmptyRoute title="Arena" detail="Start a battle to meet the Synth Titan." action="Enter the arena" onAction={startNewBattle} busy={busy} />)}
          {(path === '/battle/victory' || path === '/battle/defeat') && <BattleReview battle={battle} review={summary} victory={path === '/battle/victory'} onPractice={startPractice} onBattle={startNewBattle} busy={busy} />}
          {path === '/progress' && <ProgressScreen progress={progress} summary={summary} onPractice={startPractice} />}
          {path === '/settings' && <SettingsScreen settings={settings} onUpdate={updateSettings} reducedMotion={reducedMotion} onReducedMotion={setReducedMotion} />}
        </main>

        <nav className="bottom-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => <button key={item.path} className={`nav-item ${activeTab === item.path ? 'active' : ''}`} aria-current={activeTab === item.path ? 'page' : undefined} onClick={() => {
            if (item.path === '/practice') void startPractice();
            else if (item.path === '/battle') void startNewBattle();
            else if (item.path === '/progress') void showSessionProgress();
            else go(item.path);
          }}><Icon name={item.icon} size={20} /><span>{item.title}</span></button>)}
        </nav>
        {toast && <div className="toast" role="status"><Icon name="shield" size={17} /><span>{toast}</span><button className="icon-button" aria-label="Dismiss" onClick={() => setToast(null)}><Icon name="close" size={16} /></button></div>}
      </div>
    </div>
  );
}

function HomeScreen({
  progress, onPractice, onBattle, busy, onInstall, showInstall, evaluationReady,
}: {
  progress: Progress | null; onPractice: () => void; onBattle: () => void; busy: boolean;
  onInstall: () => void; showInstall: boolean; evaluationReady: boolean | null;
}) {
  return (
    <section className="home-page" aria-labelledby="home-title">
      <div className="welcome-row">
        <div><p className="eyebrow">VOICE TRAINING SYSTEM</p><h1 id="home-title">Ready to <span className="text-cyan">strike?</span></h1></div>
        <div className="level-seal" aria-label={`Difficulty level ${progress?.difficulty ?? 1}`}><span>LVL</span><strong>{progress?.difficulty ?? 1}</strong></div>
      </div>
      <section className="progress-strip" aria-label="Training summary">
        <div><span className="metric-label">SPEAKING XP</span><strong>{progress?.xp ?? 0}</strong></div>
        <div><span className="metric-label">VALID ROUNDS</span><strong>{progress?.validAttempts ?? 0}</strong></div>
        <div><span className="metric-label">AVG SCORE</span><strong>{progress?.averageScore == null ? '—' : Math.round(progress.averageScore)}</strong></div>
      </section>
      {evaluationReady === false && <div className="notice notice-warning"><Icon name="help" size={17} /><span>Speech evaluation is not configured on this server. Practice and battle screens are available, but speaking scores need an API key.</span></div>}
      <div className="mode-heading"><div><p className="eyebrow">CHOOSE YOUR MODE</p><h2>Pick your next run</h2></div><span className="signal"><i /> READY</span></div>
      <button className="mode-card battle-card" onClick={onBattle} disabled={busy}>
        <span className="mode-art"><img src="/images/synth-titan.jpg" alt="Synth Titan, the arena boss" /></span>
        <span className="mode-copy"><span className="mode-tag magenta">BOSS BATTLE</span><strong>Face the Synth Titan</strong><small>3 energy cores · 100 boss HP</small></span>
        <span className="mode-go"><Icon name="arrow" /></span>
      </button>
      <button className="mode-card practice-card" onClick={onPractice} disabled={busy}>
        <span className="mode-art practice-art"><Icon name="practice" size={26} /></span>
        <span className="mode-copy"><span className="mode-tag cyan">DAILY PRACTICE</span><strong>Build your speaking flow</strong><small>One sentence at a time · retry anytime</small></span>
        <span className="mode-go"><Icon name="arrow" /></span>
      </button>
      <section className="progress-card">
        <div className="section-title"><span className="section-icon"><Icon name="progress" size={18} /></span><div><p className="eyebrow">YOUR TRAINING</p><h2>Progress signal</h2></div><span className="difficulty-chip">{progress?.difficulty ?? 1} / 5</span></div>
        {progress?.validAttempts ? <>
          <div className="progress-copy"><span>{progress.strongestSkill ? `${progress.strongestSkill} is leading` : 'Your practice history is growing'}</span><strong>{Math.round(progress.averageScore ?? 0)} avg</strong></div>
          <div className="bar-track"><span style={{ width: `${Math.max(0, Math.min(100, progress.averageScore ?? 0))}%` }} /></div>
          <p className="muted-copy">{progress.recurringIssue ? `Next focus: ${progress.recurringIssue}` : 'Keep practicing to reveal a recurring focus.'}</p>
        </> : <div className="empty-inline"><span className="empty-orbit"><Icon name="sound" size={18} /></span><div><strong>Your first round is waiting</strong><p>Complete a valid speaking challenge to start your progress history.</p></div></div>}
        <button className="text-action" onClick={() => go('/progress')}>Open progress review <Icon name="arrow" size={16} /></button>
      </section>
      {showInstall && <button className="install-button" onClick={onInstall}>Install SayStrike on this device <Icon name="arrow" size={16} /></button>}
      <p className="home-footnote"><Icon name="shield" size={15} /> Audio errors never cost energy or XP.</p>
    </section>
  );
}

function ChallengeScreen({
  challenge, battle, evaluation, evaluationReady, busy, onEvaluated, onSkip, onNext, onRetry,
}: {
  challenge: Challenge; battle: Battle | null; evaluation: EvaluationResult | null; evaluationReady: boolean | null; busy: boolean;
  onEvaluated: (result: EvaluationResult) => Promise<void>; onSkip: () => void; onNext: () => void; onRetry: () => void;
}) {
  const recorder = useRecorder();
  type BattleFlowState = 'idle' | 'recording' | 'processing' | 'result' | 'attack' | 'next_turn';
  const [flowState, setFlowState] = useState<BattleFlowState>(evaluation ? (evaluation.status === 'valid' && evaluation.battle?.attackApplied ? 'attack' : 'result') : 'idle');
  const [latestEvaluation, setLatestEvaluation] = useState<EvaluationResult | null>(evaluation);
  const [seconds, setSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [audioPreview, setAudioPreview] = useState<Blob | null>(null);
  const startedAt = useRef<number | null>(null);
  const stopRef = useRef<() => Promise<void>>(async () => undefined);

  const finishAndSubmit = useCallback(async () => {
    if (flowState === 'processing' || flowState === 'next_turn' || recorder.status !== 'recording') return;
    setSubmitting(true);
    setFlowState('processing');
    audioController.playEffect('audioSubmitted');
    const blob = await recorder.stop();
    if (!blob) {
      setSubmitting(false);
      setFlowState('idle');
      return;
    }
    setAudioPreview(blob);
    audioController.playEffect('processing');
    try {
      const result = await evaluateRecording(challenge.id, blob);
      await onEvaluated(result);
      setLatestEvaluation(result);
      setFlowState(result.status === 'valid' && result.battle?.attackApplied ? 'attack' : 'result');
    } catch (error) {
      setFlowState('result');
      window.dispatchEvent(new CustomEvent('saystrike-api-error', { detail: error instanceof Error ? error.message : 'Evaluation could not complete.' }));
    } finally {
      setSubmitting(false);
      setSeconds(0);
    }
  }, [challenge.id, flowState, onEvaluated, recorder, submitting]);
  stopRef.current = finishAndSubmit;

  useEffect(() => {
    audioController.setRecording(recorder.status === 'recording');
    return () => audioController.setRecording(false);
  }, [recorder.status]);

  useEffect(() => {
    if (recorder.status !== 'recording') {
      startedAt.current = null;
      return;
    }
    startedAt.current = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000);
      setSeconds(elapsed);
      if (elapsed >= 10) void stopRef.current();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recorder.status]);

  const startOrStopRecording = async () => {
    if (recorder.status === 'recording') {
      await finishAndSubmit();
      return;
    }
    setLatestEvaluation(null);
    setAudioPreview(null);
    audioController.playEffect('recordingStart');
    const started = await recorder.start();
    if (started === true) setFlowState('recording');
  };

  const playPrompt = () => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      window.dispatchEvent(new CustomEvent('saystrike-api-error', { detail: 'Spoken prompts are unavailable in this browser. Read the target sentence on screen and continue.' }));
      return;
    }
    const speech = window.speechSynthesis;
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(challenge.targetText);
    utterance.lang = 'en-US';
    utterance.rate = 0.88;
    speech.speak(utterance);
  };

  const displayedEvaluation = flowState === 'result' || flowState === 'attack' ? latestEvaluation : null;
  const validResult = displayedEvaluation?.status === 'valid' ? displayedEvaluation : null;
  const attack = validResult?.battle;
  const elapsedLabel = `00:${String(seconds).padStart(2, '0')} / 00:10`;
  const advanceBattleTurn = async () => {
    setFlowState('next_turn');
    try {
      await onNext();
    } catch {
      setFlowState('attack');
    }
  };
  const retryCurrentSentence = () => {
    setLatestEvaluation(null);
    setFlowState('idle');
    onRetry();
  };

  return (
    <section className="challenge-page" aria-labelledby="challenge-title">
      <div className="page-heading"><div><p className="eyebrow">{challenge.mode === 'battle' ? 'ARENA / ACTIVE TURN' : 'VOCAL DRILL / DAILY RUN'}</p><h1 id="challenge-title">{challenge.mode === 'battle' ? 'Speak to strike.' : 'Find your rhythm.'}</h1></div>{battle && <span className="turn-chip">TURN {Math.max(1, battle.validAttacks + (attack ? 0 : 1))}</span>}</div>
      {battle && <BattleHud battle={battle} />}
      <section className="target-card" aria-label="Speaking target">
        <div className="target-top"><span className="mode-tag cyan">{challenge.category}</span><button className="listen-button" onClick={playPrompt}><Icon name="play" size={15} /> Hear target</button></div>
        <p className="target-sentence">“{challenge.targetText}”</p>
        <div className="target-bottom"><span><Icon name="bolt" size={14} /> LEVEL {challenge.difficulty} · {challenge.difficultyLabel.toUpperCase()}</span><span className="target-note">Speak naturally</span></div>
      </section>
      <section className={`recording-card ${recorder.status === 'recording' ? 'is-recording' : ''}`} aria-label="Microphone recording">
        <div className="recording-head"><div><span className={`live-dot ${flowState === 'recording' ? 'on' : ''}`} /><span>{flowState === 'processing' || flowState === 'next_turn' ? 'PROCESSING AUDIO' : flowState === 'recording' ? 'RECORDING LIVE' : flowState === 'attack' ? 'ATTACK RESOLVED' : flowState === 'result' ? 'REVIEW RESULT' : 'VOICE CAPTURE'}</span></div><strong>{flowState === 'recording' ? elapsedLabel : flowState === 'processing' || flowState === 'next_turn' ? 'CHECKING' : 'MAX 10 SEC'}</strong></div>
        <div className="waveform" aria-label={recorder.status === 'recording' ? 'Microphone signal active' : 'Microphone idle'}>
          {Array.from({ length: 27 }, (_, index) => {
            const variation = recorder.status === 'recording' ? (0.2 + recorder.amplitude * ((index % 5 + 1) / 5)) : 0.16 + (index % 4) * 0.035;
            return <span key={index} style={{ height: `${Math.max(8, variation * (18 + ((index * 13) % 18)))}px` }} />;
          })}
        </div>
      <div className="recording-foot"><span><Icon name="volume" size={14} /> Mic level visualizer</span><span>Voice stays foreground</span></div>
      </section>
      {recorder.error && <div className="notice notice-error" role="alert"><Icon name="help" size={17} /><span>{recorder.error}</span><button className="icon-button" aria-label="Dismiss microphone message" onClick={recorder.clearError}><Icon name="close" size={16} /></button></div>}
      {evaluationReady === false && <div className="notice notice-warning"><Icon name="help" size={17} /><span>Speech evaluation needs server configuration. You can still record and review the local audio preview; no score or battle change will be made.</span></div>}
      {displayedEvaluation && displayedEvaluation.status !== 'valid' && <div className={`notice ${displayedEvaluation.status === 'insufficient_evidence' ? 'notice-warning' : 'notice-error'}`} role="status"><Icon name="shield" size={17} /><span>{displayedEvaluation.reason}{challenge.mode === 'battle' ? ' No damage or energy was applied.' : ''}</span></div>}
      {validResult && attack && <div className={`turn-result ${attack.tier ? `tier-${attack.tier}` : ''}`} role="status">{attack.attackApplied ? <div className="turn-result-top"><span>{attack.tier?.replace('_', ' ').toUpperCase()}</span><strong>{attack.damage} DMG</strong></div> : <strong>Practice retry saved. Battle state unchanged.</strong>}<p>Boss HP {attack.bossHp} · Energy {attack.playerEnergy}/3 · {attack.xpAwarded} XP earned</p>{attack.attackApplied && attack.brokenRhythm && <small>Broken Rhythm clears when a valid next score reaches 65 or higher.</small>}{attack.attackApplied && attack.guardBreak && <small>Guard Break — protection is down for the next turn.</small>}{attack.attackApplied && battle && attack.phase !== battle.phase && <small>Phase transition: the arena has shifted to phase {attack.phase}.</small>}{attack.status === 'active' && <button className="button button-primary button-full" onClick={() => void advanceBattleTurn()} disabled={busy || flowState === 'next_turn'}>Next battle turn <Icon name="arrow" size={17} /></button>}</div>}
      {validResult && !attack && <div className="notice notice-success" role="status"><Icon name="check" size={17} /><span>Speaking evaluation complete. Your round has been added to progress.</span></div>}
      <div className="record-controls">
        <button className={`mic-trigger ${recorder.status === 'recording' ? 'recording' : ''}`} onClick={() => void startOrStopRecording()} disabled={busy || submitting} aria-label={recorder.status === 'recording' ? 'Stop recording and submit' : 'Start recording'}>
          <span className="mic-rings" /><Icon name={recorder.status === 'recording' ? 'close' : 'practice'} size={28} />
        </button>
        <p className="mic-instruction">{submitting ? 'Checking your recording…' : recorder.status === 'recording' ? 'Tap to finish and submit' : evaluationReady === false ? 'Record now · scores need server setup' : 'Tap to start · tap again to finish'}</p>
      </div>
      <div className="challenge-actions">
        {audioPreview && <button className="button button-quiet" onClick={() => audioController.playVoicePreview(audioPreview)}><Icon name="play" size={16} /> Hear my recording</button>}
        {displayedEvaluation && displayedEvaluation.status !== 'valid' && <button className="button button-quiet" onClick={retryCurrentSentence} disabled={busy || submitting || recorder.status === 'recording'}><Icon name="retry" size={16} /> Retry this sentence</button>}
        {validResult && attack?.status === 'active' && <button className="button button-quiet" onClick={retryCurrentSentence} disabled={busy || submitting}><Icon name="retry" size={16} /> Retry without a battle turn</button>}
        {challenge.mode === 'practice'
          ? <button className="button button-quiet" onClick={onSkip} disabled={busy || submitting || recorder.status === 'recording'}>Skip sentence <Icon name="arrow" size={16} /></button>
          : <button className="button button-quiet" onClick={() => go('/')} disabled={submitting || recorder.status === 'recording'}>Leave arena</button>}
        {validResult && !attack && <button className="button button-primary" onClick={() => go('/practice/review')}>Open review <Icon name="arrow" size={16} /></button>}
        {validResult && attack && attack.status !== 'active' && <button className="button button-primary" onClick={() => go(attack.status === 'victory' ? '/battle/victory' : '/battle/defeat')}>Open battle review <Icon name="arrow" size={16} /></button>}
      </div>
    </section>
  );
}

function BattleHud({ battle }: { battle: Battle }) {
  const segments = Array.from({ length: 10 }, (_, index) => index < Math.ceil(battle.bossHp / 10));
  return (
    <section className="boss-hud" aria-label="Boss battle status">
      <div className="boss-identity"><div className="boss-avatar"><img src="/images/synth-titan.jpg" alt="" /></div><div><span className="eyebrow">SYNTH TITAN MK-II</span><strong>PHASE {battle.phase}</strong></div><span className="boss-hp-number">{battle.bossHp}<small> HP</small></span></div>
      <div className="hp-track" role="meter" aria-label="Boss health" aria-valuemin={0} aria-valuemax={100} aria-valuenow={battle.bossHp}>{segments.map((filled, index) => <span key={index} className={filled ? 'filled' : ''} />)}</div>
      <div className="boss-status-row"><span>{battle.status === 'active' ? 'ARENA LIVE' : battle.status.toUpperCase()}</span><span>{battle.validAttacks} VALID ATTACKS</span></div>
      <div className="energy-row"><span className="metric-label">PLAYER ENERGY</span><div className="energy-cells" aria-label={`${battle.playerEnergy} of 3 energy remaining`}>{[0, 1, 2].map((cell) => <span key={cell} className={cell < battle.playerEnergy ? 'charged' : ''} />)}</div>{battle.brokenRhythm && <span className="debuff-chip">BROKEN RHYTHM</span>}{battle.guardBreak && <span className="debuff-chip danger">GUARD BREAK</span>}</div>
    </section>
  );
}

function ReviewScreen({ challenge, result, busy, onRetry, onNext, onSkip, onExit }: {
  challenge: Challenge; result: EvaluationResult; busy: boolean; onRetry: () => void; onNext: () => void; onSkip: () => void; onExit: () => void;
}) {
  if (result.status !== 'valid') {
    const isUncertain = result.status === 'insufficient_evidence';
    return <section className="review-page" aria-labelledby="review-title">
      <button className="back-link" onClick={() => go('/practice')}><Icon name="back" size={17} /> PRACTICE</button>
      <p className="eyebrow">FAIR PLAY REVIEW</p><h1 id="review-title">{isUncertain ? 'No score this round.' : 'Your turn is safe.'}</h1>
      <div className={`notice ${isUncertain ? 'notice-warning' : 'notice-error'}`}><Icon name="shield" size={18} /><span>{result.reason}</span></div>
      {result.status === 'insufficient_evidence' && (result.scores.accuracy !== null || result.scores.clarity !== null || result.scores.fluency !== null) && <section className="score-card"><div className="section-title"><div><p className="eyebrow">SUPPORTED EVIDENCE</p><h2>Partial review</h2></div></div><ScoreRow title="Content accuracy" score={result.scores.accuracy} maximum={40} color="cyan" evidence={result.evidence.accuracy} /><ScoreRow title="Clarity & intelligibility" score={result.scores.clarity} maximum={35} color="magenta" evidence={result.evidence.clarity} /><ScoreRow title="Fluency & rhythm" score={result.scores.fluency} maximum={25} color="mint" evidence={result.evidence.fluency} /></section>}
      <p className="muted-copy">This attempt did not change energy, boss HP, difficulty, or XP. Try again when you are ready.</p>
      <div className="review-actions"><button className="button button-primary button-full" onClick={onRetry}><Icon name="retry" size={17} /> Retry this sentence</button><button className="button button-quiet button-full" onClick={onSkip} disabled={busy}>Skip to another sentence <Icon name="arrow" size={16} /></button><button className="button button-quiet button-full" onClick={onExit}>Exit practice</button></div>
    </section>;
  }

  return <section className="review-page" aria-labelledby="review-title">
    <button className="back-link" onClick={() => go('/practice')}><Icon name="back" size={17} /> INSTANT REVIEW</button>
    <div className="review-score-head"><div><p className="eyebrow">VALID SPEAKING EVALUATION</p><h1 id="review-title">Your voice landed.</h1></div><div className="score-orb"><strong>{result.scores.total}</strong><span>/ 100</span></div></div>
    <div className="review-prompt">“{challenge.targetText}”</div>
    <div className="transcript-card"><span className="metric-label">HEARD TRANSCRIPT</span><p>{result.transcript}</p></div>
    <section className="score-card"><div className="section-title"><div><p className="eyebrow">WEIGHTED BREAKDOWN</p><h2>Speaking score</h2></div></div>
      <ScoreRow title="Content accuracy" score={result.scores.accuracy} maximum={40} color="cyan" evidence={result.evidence.accuracy} />
      <ScoreRow title="Clarity & intelligibility" score={result.scores.clarity} maximum={35} color="magenta" evidence={result.evidence.clarity} />
      <ScoreRow title="Fluency & rhythm" score={result.scores.fluency} maximum={25} color="mint" evidence={result.evidence.fluency} />
    </section>
    <section className="feedback-card"><p className="eyebrow">EVIDENCE-BASED FEEDBACK</p><div className="feedback-item positive"><span><Icon name="check" size={16} /></span><div><strong>Strength</strong><p>{result.feedback.strength}</p></div></div><div className="feedback-item priority"><span><Icon name="bolt" size={16} /></span><div><strong>Priority focus</strong><p>{result.feedback.priorityIssue}</p></div></div><div className="tip-box"><span className="metric-label">TRY THIS NEXT</span><p>{result.feedback.actionableTip}</p><small>Retry target: {result.feedback.retryTarget}</small></div></section>
    {result.retryComparison && <div className="retry-comparison"><Icon name="retry" size={17} /> Previous {result.retryComparison.previousScore} · {result.retryComparison.improvedBy >= 0 ? '+' : ''}{result.retryComparison.improvedBy} points</div>}
    <p className="review-footnote">The MVP score is a practice signal, not a certified language assessment. Accent differences are not scored as errors.</p>
    <div className="review-actions"><button className="button button-quiet button-full" onClick={onRetry}><Icon name="retry" size={17} /> Retry without battle penalty</button><button className="button button-primary button-full" onClick={onNext} disabled={busy}>Next challenge <Icon name="arrow" size={17} /></button><button className="button button-quiet button-full" onClick={onExit}>Exit to arena</button></div>
  </section>;
}

function ScoreRow({ title, score, maximum, color, evidence }: { title: string; score: number | null; maximum: number; color: 'cyan' | 'magenta' | 'mint'; evidence: string | null }) {
  const value = score ?? 0;
  return <div className="score-row"><div className="score-row-head"><span>{title}</span><strong className={`text-${color}`}>{score === null ? '—' : value}<small> / {maximum}</small></strong></div><div className="score-track"><span className={`fill-${color}`} style={{ width: `${Math.max(0, Math.min(100, value / maximum * 100))}%` }} /></div><p>{evidence ?? 'No reliable evidence for this criterion in the recording.'}</p></div>;
}

function BattleReview({ battle, review, victory, onPractice, onBattle, busy }: {
  battle: Battle | null; review: SessionReview | null; victory: boolean; onPractice: () => void; onBattle: () => void; busy: boolean;
}) {
  const [loadedReview, setLoadedReview] = useState<SessionReview | null>(review);
  useEffect(() => {
    if (!review && battle?.sessionId) void getSessionReview(battle.sessionId).then(setLoadedReview).catch(() => setLoadedReview(null));
  }, [battle?.sessionId, review]);
  const currentReview = review ?? loadedReview;
  return <section className={`battle-review ${victory ? 'victory' : 'defeat'}`} aria-labelledby="battle-review-title">
    <div className="battle-review-emblem"><img src="/images/synth-titan.jpg" alt="Synth Titan" /><span>{victory ? <Icon name="check" size={19} /> : <Icon name="shield" size={19} />}</span></div>
    <p className="eyebrow">{victory ? 'ARENA CLEARED' : 'BOSS DEBRIEF'}</p>
    <h1 id="battle-review-title">{victory ? 'Core down.' : 'Reset and return.'}</h1>
    <p className="battle-review-copy">{victory ? 'You brought the Synth Titan to zero HP. Your practice history and earned XP are saved.' : 'The arena run ended when your energy reached zero. Your valid practice rounds and XP remain saved.'}</p>
    <div className="battle-summary-grid"><div><span className="metric-label">VALID ATTACKS</span><strong>{battle?.validAttacks ?? currentReview?.validChallenges ?? 0}</strong></div><div><span className="metric-label">AVG SPEAKING</span><strong>{currentReview?.averageScore == null ? '—' : Math.round(currentReview.averageScore)}</strong></div><div><span className="metric-label">BEST SCORE</span><strong>{currentReview?.bestScore ?? '—'}</strong></div><div><span className="metric-label">XP EARNED</span><strong>+{currentReview?.xpAwarded ?? 0}</strong></div></div>
    <div className="tip-box"><span className="metric-label">NEXT PRACTICE GOAL</span><p>{currentReview?.nextGoal ?? 'Your saved valid rounds will shape the next practice recommendation.'}</p><small>{currentReview?.strongestSkill ? `Strongest skill: ${currentReview.strongestSkill}.` : 'More valid rounds will reveal your strongest skill.'} {currentReview?.recurringIssue ? `Focus next: ${currentReview.recurringIssue}` : ''}</small></div>
    <div className="review-actions"><button className="button button-primary button-full" onClick={onPractice} disabled={busy}>Practice your next sentence <Icon name="arrow" size={17} /></button><button className="button button-quiet button-full" onClick={onBattle} disabled={busy}>Try another battle</button><button className="button button-quiet button-full" onClick={() => go('/')}>Return to arena hub</button></div>
  </section>;
}

function ProgressScreen({ progress, summary, onPractice }: { progress: Progress | null; summary: SessionReview | null; onPractice: () => void }) {
  return <section className="progress-page" aria-labelledby="progress-title">
    <p className="eyebrow">PLAYER PROFILE / TRAINING LOG</p><h1 id="progress-title">Progress review</h1>
    <div className="progress-hero"><div><span className="metric-label">CURRENT XP</span><strong>{progress?.xp ?? 0}</strong><small>{progress?.rank ?? 'Rookie Vocalist'}</small></div><div className="level-seal"><span>LEVEL</span><strong>{progress?.difficulty ?? 1}</strong></div></div>
    <section className="progress-card"><div className="section-title"><span className="section-icon"><Icon name="progress" size={18} /></span><div><p className="eyebrow">VALID PRACTICE</p><h2>Speaking trend</h2></div></div>
      {progress?.recentScores.length ? <div className="score-bars" aria-label="Recent valid speaking scores">{progress.recentScores.map((entry, index) => <div className="score-bar-column" key={`${entry.createdAt}-${index}`}><div className="score-bar" style={{ height: `${Math.max(8, entry.score)}%` }} title={`${entry.score} points`} /><span>{formatDate(entry.createdAt)}</span></div>)}</div> : <div className="empty-inline"><span className="empty-orbit"><Icon name="sound" size={18} /></span><div><strong>No valid rounds yet</strong><p>Your score trend appears after the evaluator returns enough evidence.</p></div></div>}
    </section>
    {summary && <section className="progress-card"><div className="section-title"><span className="section-icon mint-icon"><Icon name="check" size={18} /></span><div><p className="eyebrow">LATEST SESSION</p><h2>{summary.mode === 'battle' ? 'Battle debrief' : 'Practice recap'}</h2></div></div><div className="progress-copy"><span>{summary.validChallenges} valid challenges</span><strong>{summary.averageScore == null ? '—' : Math.round(summary.averageScore)} avg</strong></div><p className="muted-copy">{summary.strongestSkill ? `Strongest skill: ${summary.strongestSkill}.` : 'Complete more valid challenges to reveal a strongest skill.'}</p><p className="muted-copy">{summary.recurringIssue ? `Recurring focus: ${summary.recurringIssue}` : summary.nextGoal}</p></section>}
    <section className="skill-grid"><div><span className="metric-label">STRONGEST SKILL</span><strong>{progress?.strongestSkill ?? '—'}</strong></div><div><span className="metric-label">REPEATED FOCUS</span><strong>{progress?.recurringIssue ?? '—'}</strong></div><div><span className="metric-label">DIFFICULTY</span><strong>{progress?.difficulty ?? 1} / 5</strong></div><div><span className="metric-label">VALID ROUNDS</span><strong>{progress?.validAttempts ?? 0}</strong></div></section>
    <button className="button button-primary button-full" onClick={onPractice}>Practice the next sentence <Icon name="arrow" size={17} /></button>
  </section>;
}

function SettingsScreen({ settings, onUpdate, reducedMotion, onReducedMotion }: {
  settings: AudioSettings; onUpdate: (change: Partial<AudioSettings>) => void; reducedMotion: boolean; onReducedMotion: (value: boolean) => void;
}) {
  return <section className="settings-page" aria-labelledby="settings-title">
    <p className="eyebrow">PLAYER OPTIONS / SOUND LAB</p><h1 id="settings-title">Sound Lab</h1>
    <section className="settings-card"><div className="section-title"><span className="section-icon"><Icon name="sound" size={18} /></span><div><p className="eyebrow">AUDIO MIXER</p><h2>Level controls</h2></div></div>
      <label className="setting-row setting-disabled"><span><strong>Music</strong><small>No soundtrack file is present yet. Music remains silent.</small></span><input type="range" min="0" max="100" value={Math.round(settings.music * 100)} disabled aria-label="Music volume" /></label>
      <label className="setting-row"><span><strong>Sound effects</strong><small>Buttons, hits and arena feedback</small></span><input type="range" min="0" max="100" value={Math.round(settings.sfx * 100)} onChange={(event) => onUpdate({ sfx: Number(event.currentTarget.value) / 100 })} aria-label="Sound effects volume" /></label>
      <label className="setting-row"><span><strong>Voice preview</strong><small>Playback of your most recent recording</small></span><input type="range" min="0" max="100" value={Math.round(settings.voice * 100)} onChange={(event) => onUpdate({ voice: Number(event.currentTarget.value) / 100 })} aria-label="Voice preview volume" /></label>
      <button className="toggle-row" aria-pressed={settings.muted} onClick={() => onUpdate({ muted: !settings.muted })}><span><strong>{settings.muted ? 'Sound muted' : 'Mute all sound'}</strong><small>Music, sound effects and voice playback</small></span><span className={`toggle ${settings.muted ? 'enabled' : ''}`} /></button>
    </section>
    <section className="settings-card"><div className="section-title"><span className="section-icon mint-icon"><Icon name="help" size={18} /></span><div><p className="eyebrow">COMFORT & ACCESSIBILITY</p><h2>Motion and privacy</h2></div></div>
      <button className="toggle-row" aria-pressed={reducedMotion} onClick={() => onReducedMotion(!reducedMotion)}><span><strong>Reduce motion</strong><small>Also follows your device preference</small></span><span className={`toggle ${reducedMotion ? 'enabled' : ''}`} /></button>
      <div className="privacy-note"><Icon name="shield" size={17} /><p>SayStrike does not save raw recordings on the server. A recording is sent only after you finish it. Evaluation history stores the transcript, score evidence, and feedback for this anonymous profile.</p></div>
      <div className="privacy-note"><Icon name="help" size={17} /><p>Speech evaluation and battle updates need an internet connection. The offline app shell cannot submit recordings or resolve turns.</p></div>
    </section>
    <p className="review-footnote">Audio samples are provided by the supplied Ogg Vorbis asset collection. Music controls activate when a licensed soundtrack is installed.</p>
  </section>;
}

function EmptyRoute({ title, detail, action, onAction, busy }: { title: string; detail: string; action: string; onAction: () => void; busy: boolean }) {
  return <section className="empty-route"><span className="empty-orbit"><Icon name="bolt" size={22} /></span><p className="eyebrow">SAYSTRIKE</p><h1>{title}</h1><p>{detail}</p><button className="button button-primary button-full" onClick={onAction} disabled={busy}>{busy ? 'Connecting…' : action} <Icon name="arrow" size={17} /></button></section>;
}
