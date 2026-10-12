import { useCallback, useEffect, useRef, useState } from 'react';

const OUTPUT_SAMPLE_RATE = 24_000;

export function encodePcmWav(input: Float32Array, inputSampleRate: number): Blob {
  const outputLength = Math.max(1, Math.floor(input.length * OUTPUT_SAMPLE_RATE / inputSampleRate));
  const pcm = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * inputSampleRate / OUTPUT_SAMPLE_RATE;
    const left = Math.floor(sourcePosition);
    const right = Math.min(input.length - 1, left + 1);
    const mix = sourcePosition - left;
    const value = input[left]! * (1 - mix) + input[right]! * mix;
    const clamped = Math.max(-1, Math.min(1, value));
    pcm[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, OUTPUT_SAMPLE_RATE, true);
  view.setUint32(28, OUTPUT_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  new Int16Array(buffer, 44).set(pcm);
  return new Blob([buffer], { type: 'audio/wav' });
}

type RecorderStatus = 'idle' | 'recording';

export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [amplitude, setAmplitude] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const samplesRef = useRef<Float32Array[]>([]);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const release = useCallback(async () => {
    if (animationRef.current !== null) window.clearInterval(animationRef.current);
    animationRef.current = null;
    workletRef.current?.disconnect();
    workletRef.current = null;
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== 'closed') await context.close().catch(() => undefined);
  }, []);

  const start = useCallback(async () => {
    if (status === 'recording') return false;
    setError(null);
    samplesRef.current = [];
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot access a microphone. Try a recent mobile browser over HTTPS.');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const context = new AudioContext();
      contextRef.current = context;
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      const silence = context.createGain();
      silence.gain.value = 0;
      if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        await context.audioWorklet.addModule('/audio/recorder-worklet.js');
        const worklet = new AudioWorkletNode(context, 'saystrike-pcm-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        worklet.port.onmessage = (event: MessageEvent<{ type: string; samples?: ArrayBuffer }>) => {
          if (event.data.type === 'chunk' && event.data.samples) samplesRef.current.push(new Float32Array(event.data.samples));
        };
        source.connect(worklet);
        worklet.connect(silence);
        workletRef.current = worklet;
      } else {
        const scriptProcessor = context.createScriptProcessor(4096, 1, 1);
        scriptProcessor.onaudioprocess = (event) => {
          samplesRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
          event.outputBuffer.getChannelData(0).fill(0);
        };
        source.connect(scriptProcessor);
        scriptProcessor.connect(silence);
        scriptProcessorRef.current = scriptProcessor;
      }
      silence.connect(context.destination);
      animationRef.current = window.setInterval(() => {
        const currentAnalyser = analyserRef.current;
        if (!currentAnalyser || !mountedRef.current) return;
        const values = new Uint8Array(currentAnalyser.fftSize);
        currentAnalyser.getByteTimeDomainData(values);
        const rms = Math.sqrt(values.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / values.length);
        setAmplitude(Math.min(1, rms * 4));
      }, 90);
      if (mountedRef.current) setStatus('recording');
      return true;
    } catch (cause) {
      await release();
      const name = cause instanceof DOMException ? cause.name : '';
      const message = name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Microphone permission was denied. Allow microphone access in your browser settings and try again.'
        : name === 'NotFoundError'
          ? 'No microphone was found on this device.'
          : 'Microphone could not start. Check the device and retry.';
      if (mountedRef.current) {
        setError(message);
        setAmplitude(0);
      }
      return false;
    }
  }, [release, status]);

  const stop = useCallback(async () => {
    const context = contextRef.current;
    if (!context || status !== 'recording') return null;
    const worklet = workletRef.current;
    if (worklet) {
      await new Promise<void>((resolve) => {
        const previousHandler = worklet.port.onmessage;
        const timeout = window.setTimeout(resolve, 150);
        worklet.port.onmessage = (event: MessageEvent<{ type: string; samples?: ArrayBuffer }>) => {
          if (event.data.type === 'chunk' && event.data.samples) samplesRef.current.push(new Float32Array(event.data.samples));
          if (event.data.type === 'flushed') {
            window.clearTimeout(timeout);
            worklet.port.onmessage = previousHandler;
            resolve();
          }
        };
        worklet.port.postMessage({ type: 'flush' });
      });
    }
    const chunks = samplesRef.current;
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    const recording = length ? encodePcmWav(combined, context.sampleRate) : null;
    await release();
    if (mountedRef.current) {
      setStatus('idle');
      setAmplitude(0);
      if (!recording || recording.size < 24_000) setError('That recording was too short to evaluate. Please speak for at least a moment and try again.');
    }
    return recording && recording.size >= 24_000 ? recording : null;
  }, [release, status]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void release();
    };
  }, [release]);

  return { status, error, amplitude, start, stop, clearError: () => setError(null) };
}
