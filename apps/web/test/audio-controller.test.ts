import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioController } from '../src/audioController.js';

describe('audio controller effect playback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reuses effect instances, rate-limits duplicates, and disposes playback', async () => {
    const instances: Array<{ src: string; volume: number; currentTime: number; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; removeAttribute: ReturnType<typeof vi.fn> }> = [];
    class MockAudio {
      src: string;
      volume = 1;
      currentTime = 0;
      play = vi.fn(async () => undefined);
      pause = vi.fn();
      removeAttribute = vi.fn(() => { this.src = ''; });
      constructor(src = '') { this.src = src; instances.push(this); }
    }
    vi.stubGlobal('Audio', MockAudio);
    const controller = new AudioController();
    controller.playEffect('uiTap');
    controller.playEffect('uiTap');
    await Promise.resolve();
    expect(instances).toHaveLength(1);
    expect(instances[0]?.src).toBe('/audio/click_001.ogg');
    expect(instances[0]?.play).toHaveBeenCalledTimes(1);
    controller.dispose();
    expect(instances[0]?.pause).toHaveBeenCalledTimes(1);
  });
});
