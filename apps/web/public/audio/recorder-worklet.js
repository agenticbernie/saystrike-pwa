class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 4096;
    this.chunk = new Float32Array(this.chunkSize);
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'flush') {
        if (this.offset > 0) {
          const finalChunk = this.chunk.slice(0, this.offset);
          this.port.postMessage({ type: 'chunk', samples: finalChunk.buffer }, [finalChunk.buffer]);
          this.chunk = new Float32Array(this.chunkSize);
          this.offset = 0;
        }
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (input) {
      let cursor = 0;
      while (cursor < input.length) {
        const count = Math.min(this.chunkSize - this.offset, input.length - cursor);
        this.chunk.set(input.subarray(cursor, cursor + count), this.offset);
        this.offset += count;
        cursor += count;
        if (this.offset === this.chunkSize) {
          const fullChunk = this.chunk;
          this.port.postMessage({ type: 'chunk', samples: fullChunk.buffer }, [fullChunk.buffer]);
          this.chunk = new Float32Array(this.chunkSize);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('saystrike-pcm-capture', PcmCaptureProcessor);
