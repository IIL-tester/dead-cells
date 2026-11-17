import { ASSET_MANIFEST, resolveAssetUrl } from "../data/assetManifest";

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private lastPlayed = new Map<string, number>();
  public muted = false;

  async preload(): Promise<void> {
    // Lazy-init AudioContext on first user gesture; fetch raw buffers now
    const entries = Object.entries(ASSET_MANIFEST.sfx);
    const rawBuffers = new Map<string, ArrayBuffer>();
    await Promise.all(
      entries.map(async ([k, url]) => {
        try {
          const r = await fetch(resolveAssetUrl(url));
          rawBuffers.set(k, await r.arrayBuffer());
        } catch {
          // ignore missing optional sfx
        }
      })
    );
    (this as unknown as { _pending: Map<string, ArrayBuffer> })._pending = rawBuffers;
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    const pending = (this as unknown as { _pending?: Map<string, ArrayBuffer> })._pending;
    if (pending) {
      for (const [k, buf] of pending.entries()) {
        this.ctx.decodeAudioData(buf.slice(0)).then(
          (decoded) => this.buffers.set(k, decoded),
          () => {}
        );
      }
      pending.clear();
    }
  }

  play(key: string, volume = 0.35, minIntervalMs = 45): void {
    if (this.muted || !this.ctx) return;
    const now = performance.now();
    const prev = this.lastPlayed.get(key) ?? 0;
    if (now - prev < minIntervalMs) return;
    this.lastPlayed.set(key, now);

    const buf = this.buffers.get(key);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this.ctx.destination);
    src.start();
  }
}
