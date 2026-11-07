/** 16 kHz mono s16le, the format of the job's PCM tap. */
export const RATE = 16000
export const BYTES_PER_SEC = RATE * 2
const FRAME = BYTES_PER_SEC / 10 // 100 ms

/** RMS of a s16le buffer, 0..1. */
export function rms(buf: Buffer): number {
  let sum = 0
  const n = buf.length >> 1
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(i * 2) / 32768
    sum += v * v
  }
  return n ? Math.sqrt(sum / n) : 0
}

export interface Chunk {
  /** Media time (s) of the first sample. */
  start: number
  end: number
  pcm: Buffer
  /** Overall level; near-silent chunks are worth skipping. */
  level: number
}

/**
 * Cuts a PCM stream at short pauses (energy-based, adaptive noise floor),
 * never shorter than minSec unless flushed and never longer than maxSec.
 * Both speech providers use it: the local one transcribes each chunk, the
 * online one streams audio continuously and commits a turn at each cut.
 */
export class PauseChunker {
  private buf: Buffer = Buffer.alloc(0)
  /** Media time (s) of buf[0]. */
  private bufStart = 0
  /** Bytes of buf already examined. */
  private scanned = 0
  private floor = 0.01
  private quietFrames = 0

  constructor(private readonly minSec: number, private readonly maxSec: number, private readonly onChunk: (chunk: Chunk) => void) {}

  /** Media time (s) at the end of everything pushed so far. */
  get now(): number {
    return this.bufStart + this.buf.length / BYTES_PER_SEC
  }

  /** Media time (s) where the chunk being collected started. */
  get openStart(): number {
    return this.bufStart
  }

  push(pcm: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, pcm]) : pcm
    while (this.scanned + FRAME <= this.buf.length) {
      const level = rms(this.buf.subarray(this.scanned, this.scanned + FRAME))
      // Noise floor follows the quietest recent frames.
      this.floor = level < this.floor ? level : this.floor * 0.995 + level * 0.005
      this.quietFrames = level < Math.max(this.floor * 2.2, 0.004) ? this.quietFrames + 1 : 0
      this.scanned += FRAME
      const sec = this.scanned / BYTES_PER_SEC
      if ((sec >= this.minSec && this.quietFrames >= 3) || sec >= this.maxSec) this.cut(this.scanned)
    }
  }

  /** Emit whatever is left (at least `minBytes`), e.g. when the stream ends. */
  flush(minSec = 0.5): void {
    if (this.buf.length >= minSec * BYTES_PER_SEC) this.cut(this.buf.length)
  }

  private cut(bytes: number): void {
    const pcm = Buffer.from(this.buf.subarray(0, bytes))
    const start = this.bufStart
    const end = start + bytes / BYTES_PER_SEC
    this.buf = this.buf.subarray(bytes)
    this.bufStart = end
    this.scanned = 0
    this.quietFrames = 0
    this.onChunk({ start, end, pcm, level: rms(pcm) })
  }
}
