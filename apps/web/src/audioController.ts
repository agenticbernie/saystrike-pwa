import audioMap from './audio-map.json';

export type AudioSettings = {
  music: number;
  sfx: number;
  voice: number;
  muted: boolean;
};

export type SoundEffect = keyof typeof audioMap.effects;
// The supplied asset inventory has no soundtrack files yet. Keep the known
// transition states typed while allowing the manifest to map them later.
export type MusicState = 'menu' | 'practice' | 'arena';

const SETTINGS_KEY = 'saystrike-audio-settings-v1';
const initialSettings: AudioSettings = { music: 0.65, sfx: 0.72, voice: 0.85, muted: false };

export function readAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return initialSettings;
    const value = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      music: clampVolume(value.music, initialSettings.music),
      sfx: clampVolume(value.sfx, initialSettings.sfx),
      voice: clampVolume(value.voice, initialSettings.voice),
      muted: Boolean(value.muted),
    };
  } catch {
    return initialSettings;
  }
}

function clampVolume(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

export class AudioController {
  private settings = initialSettings;
  private readonly effects = new Map<SoundEffect, HTMLAudioElement>();
  private readonly lastEffectAt = new Map<SoundEffect, number>();
  private music: HTMLAudioElement | null = null;
  private musicContext: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private voice: HTMLAudioElement | null = null;
  private voiceUrl: string | null = null;
  private recording = false;

  constructor() {
    if (typeof window !== 'undefined') this.settings = readAudioSettings();
  }

  getSettings() {
    return this.settings;
  }

  updateSettings(settings: AudioSettings) {
    this.settings = {
      music: clampVolume(settings.music, initialSettings.music),
      sfx: clampVolume(settings.sfx, initialSettings.sfx),
      voice: clampVolume(settings.voice, initialSettings.voice),
      muted: Boolean(settings.muted),
    };
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      } catch {
        // Volume controls stay usable if this browser blocks persistent storage.
      }
    }
    if (this.musicGain && this.musicContext) this.applyMusicGain(0.16);
    for (const effect of this.effects.values()) effect.volume = this.settings.muted ? 0 : this.settings.sfx;
    if (this.voice) this.voice.volume = this.settings.muted ? 0 : this.settings.voice;
  }

  playEffect(name: SoundEffect) {
    if (this.settings.muted || this.settings.sfx === 0) return;
    const file = audioMap.effects[name];
    if (!file) return;
    const now = performance.now();
    if (now - (this.lastEffectAt.get(name) ?? 0) < 110) return;
    this.lastEffectAt.set(name, now);
    let effect = this.effects.get(name);
    if (!effect) {
      effect = new Audio(`/audio/${file}`);
      effect.preload = 'auto';
      this.effects.set(name, effect);
    }
    effect.volume = this.settings.sfx;
    effect.currentTime = 0;
    void effect.play()?.catch(() => undefined);
  }

  async playMusic(state: MusicState) {
    const file = (audioMap.music as Partial<Record<MusicState, string>>)[state];
    if (!file || this.settings.muted || this.settings.music === 0) return;
    if (this.music?.src.endsWith(file)) return;
    this.stopMusic();
    const audio = new Audio(`/audio/${file}`);
    audio.loop = true;
    audio.preload = 'metadata';
    const context = new AudioContext();
    const source = context.createMediaElementSource(audio);
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(context.destination);
    this.music = audio;
    this.musicContext = context;
    this.musicGain = gain;
    await context.resume().catch(() => undefined);
    this.applyMusicGain(0.35);
    await audio.play()?.catch(() => undefined);
  }

  stopMusic() {
    if (this.music) {
      this.music.pause();
      this.music.removeAttribute('src');
      this.music.load();
    }
    this.music = null;
    this.musicGain?.disconnect();
    this.musicGain = null;
    const context = this.musicContext;
    this.musicContext = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }

  setRecording(recording: boolean) {
    this.recording = recording;
    this.applyMusicGain(recording ? 0.08 : 0.24);
  }

  playVoicePreview(blob: Blob) {
    if (this.settings.muted || this.settings.voice === 0) return;
    this.voice?.pause();
    if (this.voiceUrl) URL.revokeObjectURL(this.voiceUrl);
    const url = URL.createObjectURL(blob);
    const voice = new Audio(url);
    voice.volume = this.settings.voice;
    voice.onended = () => {
      URL.revokeObjectURL(url);
      if (this.voiceUrl === url) this.voiceUrl = null;
    };
    this.voiceUrl = url;
    this.voice = voice;
    void voice.play()?.catch(() => {
      URL.revokeObjectURL(url);
      if (this.voiceUrl === url) this.voiceUrl = null;
    });
  }

  dispose() {
    this.stopMusic();
    this.voice?.pause();
    if (this.voiceUrl) URL.revokeObjectURL(this.voiceUrl);
    this.voiceUrl = null;
    for (const effect of this.effects.values()) {
      effect.pause();
      effect.removeAttribute('src');
    }
    this.effects.clear();
  }

  private applyMusicGain(timeConstant: number) {
    if (!this.musicGain || !this.musicContext) return;
    const duckFactor = this.recording ? 0.2 : 1;
    const volume = this.settings.muted ? 0 : this.settings.music * duckFactor;
    const gain = this.musicGain.gain;
    const now = this.musicContext.currentTime;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(volume, now, timeConstant);
  }
}

export const audioController = new AudioController();
