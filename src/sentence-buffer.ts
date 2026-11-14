export interface SentenceBufferOptions {
  /** Locale for `Intl.Segmenter`. Invalid values fall back to `en`. */
  locale?: string;
  /** Fragments shorter than this ("Dr.", "1.") are merged into the next sentence. Default 4. */
  minChars?: number;
  /** Pending text longer than this is cut at the last space. Default 200. */
  maxChars?: number;
  /** Silence after which pending text is emitted through `onIdle`. 0 or no `onIdle` disables. Default 1500. */
  idleFlushMs?: number;
  /** Receives sentences released by the idle timer. */
  onIdle?: (sentences: string[]) => void;
}

// A segment is complete when it ends with sentence punctuation (plus closers/spaces) or a line break.
const TERMINATED = /(?:[.!?。！？…]["'”’)\]」』]*\s*|\n\s*)$/;

function createSegmenter(locale: string): Intl.Segmenter {
  try {
    return new Intl.Segmenter(locale, { granularity: 'sentence' });
  } catch {
    return new Intl.Segmenter('en', { granularity: 'sentence' });
  }
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Turns arbitrary text chunks into whole sentences.
 * The last segment is always held back because more text may extend it ("3." + "14").
 */
export class SentenceBuffer {
  private text = '';
  private readonly segmenter: Intl.Segmenter;
  private readonly minChars: number;
  private readonly maxChars: number;
  private readonly idleFlushMs: number;
  private readonly onIdle: ((sentences: string[]) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SentenceBufferOptions = {}) {
    this.segmenter = createSegmenter(options.locale ?? 'en');
    this.minChars = options.minChars ?? 4;
    this.maxChars = options.maxChars ?? 200;
    this.idleFlushMs = options.idleFlushMs ?? 1500;
    this.onIdle = options.onIdle;
    if (this.maxChars < 1) throw new Error('maxChars must be at least 1.');
  }

  /** Text that has been received but not released yet. */
  get pending(): string {
    return this.text;
  }

  /** Add a chunk and return the sentences that are now complete. */
  push(chunk: string): string[] {
    this.text += chunk;
    const out = this.drain(false);
    this.armIdle();
    return out;
  }

  /** Release everything that is pending, complete or not. */
  flush(): string[] {
    this.cancel();
    const out = this.drain(true);
    this.text = '';
    return out;
  }

  /** Stop the idle timer. Pending text is kept. */
  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * More text has started on the next line, but the caller holds it back for now (`MarkdownGuard`
   * waits for a possible "|"). Returns the sentences that the line break completes, the same as
   * pushing the first character of that line would. The idle timer stops: the caller flushes when
   * the stream goes quiet.
   */
  nextLineStarted(): string[] {
    this.cancel();
    // Nothing can extend a segment that ends with a line break.
    return this.drain(false, /\n\s*$/.test(this.text));
  }

  private drain(final: boolean, lastIsComplete = false): string[] {
    const segments = [...this.segmenter.segment(this.text)].map((s) => s.segment);
    const out: string[] = [];
    let held = '';
    for (let i = 0; i < segments.length; i++) {
      held += segments[i];
      if (!final && !lastIsComplete && i === segments.length - 1) break;
      // While a fragment is held, later segments join it so sentences never overtake it.
      if (TERMINATED.test(held) && held.trim().length >= this.minChars) {
        out.push(clean(held));
        held = '';
      }
    }
    // Text without sentence punctuation is cut at the last space once it gets too long.
    while (held.length > this.maxChars) {
      let at = held.lastIndexOf(' ', this.maxChars);
      if (at <= 0) at = this.maxChars;
      out.push(clean(held.slice(0, at)));
      held = held.slice(at).replace(/^\s+/, '');
    }
    if (final) {
      out.push(clean(held));
      held = '';
    }
    this.text = held;
    return out.filter((s) => s.length > 0);
  }

  private armIdle(): void {
    this.cancel();
    if (!this.onIdle || this.idleFlushMs <= 0 || !this.text.trim()) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const sentences = this.flush();
      if (sentences.length > 0) this.onIdle?.(sentences);
    }, this.idleFlushMs);
  }
}
