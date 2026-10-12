import { describe, expect, it } from 'vitest';
import { encodePcmWav } from '../src/useRecorder.js';

describe('PCM recorder WAV encoder', () => {
  it('writes mono PCM16 WAV with resampling and clamped samples', async () => {
    const wav = encodePcmWav(new Float32Array([-2, 0.5, 2]), 24_000);
    expect(wav.type).toBe('audio/wav');
    expect(wav.size).toBe(50);
    const bytes = new DataView(await wav.arrayBuffer());
    expect(String.fromCharCode(...new Uint8Array(bytes.buffer, 0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...new Uint8Array(bytes.buffer, 8, 4))).toBe('WAVE');
    expect(bytes.getUint16(20, true)).toBe(1);
    expect(bytes.getUint16(22, true)).toBe(1);
    expect(bytes.getUint32(24, true)).toBe(24_000);
    expect(bytes.getUint16(34, true)).toBe(16);
    expect(bytes.getInt16(44, true)).toBe(-32768);
    expect(bytes.getInt16(46, true)).toBe(16383);
    expect(bytes.getInt16(48, true)).toBe(32767);
  });

  it('resamples a 48kHz input to the API 24kHz format', async () => {
    const wav = encodePcmWav(new Float32Array(480), 48_000);
    const bytes = new DataView(await wav.arrayBuffer());
    expect(bytes.getUint32(24, true)).toBe(24_000);
    expect(bytes.getUint32(40, true)).toBe(480);
  });
});
