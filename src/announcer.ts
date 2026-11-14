import { createLiveRegion, type LiveRegion } from './live-region.js';
import { MarkdownGuard, stripInlineMarkdown } from './markdown.js';
import { resolveMessages } from './messages.js';
import { SentenceBuffer } from './sentence-buffer.js';
import type {
  AnnounceKind,
  AnnounceSink,
  AnnounceMode,
  AnnouncerStatus,
  GuardOutput,
  StreamAnnouncer,
  StreamAnnouncerOptions,
  StreamEvent,
} from './types.js';

const MODES: readonly AnnounceMode[] = ['on-complete', 'sentence', 'off'];
const DESTROYED = 'StreamAnnouncer destroyed';

function checkNumber(name: string, value: number | undefined, min: number): void {
  if (value !== undefined && (!Number.isFinite(value) || value < min)) {
    throw new RangeError(`${name} must be a number >= ${min}, got ${String(value)}.`);
  }
}

/**
 * Decide when and what to announce for one streamed response at a time.
 * Call `start()`, `push()` for every text delta, then `done()`, `abort()` or `error()`.
 */
export function createStreamAnnouncer(options: StreamAnnouncerOptions = {}): StreamAnnouncer {
  const mode = options.mode ?? 'on-complete';
  if (!MODES.includes(mode)) {
    throw new Error(`Unknown mode "${String(mode)}". Use one of: ${MODES.join(', ')}.`);
  }
  checkNumber('heartbeatMs', options.heartbeatMs, 0);
  checkNumber('minChars', options.minChars, 0);
  checkNumber('maxChars', options.maxChars, 1);
  checkNumber('idleFlushMs', options.idleFlushMs, 0);

  const locale = options.locale ?? 'en';
  const messages = resolveMessages(locale, options.messages);
  const heartbeatMs = options.heartbeatMs ?? 5000;
  const includeBody = options.includeBodyOnComplete ?? true;

  if (options.sink && options.region) {
    throw new TypeError('Pass either `sink` or `region`, not both.');
  }

  // The region is created now (before the first text) because screen readers ignore new live regions.
  // `ownRegion` is destroyed with the announcer; a shared `options.region` is not.
  let ownRegion: LiveRegion | null = null;
  if (!options.sink && !options.region) {
    ownRegion = createLiveRegion(options.document ? { document: options.document } : {});
  }
  const region: LiveRegion | null = options.region ?? ownRegion;
  // Texts are queued under this token, so dropping them never touches another announcer's texts.
  const owner = {};
  const sink: AnnounceSink =
    options.sink ?? ((text, meta) => (region as LiveRegion).announce(text, { kind: meta.kind, owner }));

  // Waiting texts of this announcer become stale on Stop, failure or a new response.
  function dropWaiting(): void {
    region?.clear(owner);
  }

  let status: AnnouncerStatus = 'idle';
  let destroyed = false;
  let guard = newGuard();
  let buffer = newBuffer();
  let body: string[] = [];
  let heartbeat: ReturnType<typeof setTimeout> | null = null;
  let inReasoning = false;
  // While the guard holds a line that may still become a table, this timer replaces the buffer's
  // idle timer: when the stream goes quiet, the held line is released and read (sentence mode).
  let guardIdle: ReturnType<typeof setTimeout> | null = null;

  function stopGuardIdle(): void {
    if (guardIdle !== null) clearTimeout(guardIdle);
    guardIdle = null;
  }

  function armGuardIdle(): void {
    stopGuardIdle();
    const ms = options.idleFlushMs ?? 1500;
    if (mode !== 'sentence' || ms <= 0) return;
    guardIdle = setTimeout(() => {
      guardIdle = null;
      if (status !== 'generating') return;
      handle(guard.releasePending());
      buffer.flush().forEach(addSentence);
    }, ms);
  }

  function newGuard(): MarkdownGuard {
    return new MarkdownGuard({ messages, ...(options.maxChars !== undefined ? { maxChars: options.maxChars } : {}) });
  }

  function newBuffer(): SentenceBuffer {
    return new SentenceBuffer({
      locale,
      ...(options.minChars !== undefined ? { minChars: options.minChars } : {}),
      ...(options.maxChars !== undefined ? { maxChars: options.maxChars } : {}),
      // Idle flushing only matters when sentences are spoken as they appear.
      idleFlushMs: mode === 'sentence' ? (options.idleFlushMs ?? 1500) : 0,
      onIdle: (sentences) => {
        if (status === 'generating') sentences.forEach(addSentence);
      },
    });
  }

  function emit(text: string, kind: AnnounceKind): void {
    sink(text, { kind });
    if (status === 'generating') armHeartbeat();
  }

  function armHeartbeat(): void {
    stopHeartbeat();
    if (mode === 'off' || heartbeatMs <= 0) return;
    heartbeat = setTimeout(() => {
      heartbeat = null;
      if (status === 'generating') emit(messages.stillGenerating, 'heartbeat');
    }, heartbeatMs);
  }

  function stopHeartbeat(): void {
    if (heartbeat !== null) clearTimeout(heartbeat);
    heartbeat = null;
  }

  function setBusy(busy: boolean): void {
    const target = options.busyTarget;
    if (!target) return;
    if (busy) target.setAttribute('aria-busy', 'true');
    else target.removeAttribute('aria-busy');
  }

  function addSentence(raw: string): void {
    const text = stripInlineMarkdown(raw);
    if (!text) return;
    body.push(text);
    if (mode === 'sentence') emit(text, 'sentence');
  }

  function handle(outputs: GuardOutput[]): void {
    for (const output of outputs) {
      if (output.kind === 'prose') {
        buffer.push(output.text).forEach(addSentence);
      } else {
        // A code block or table ends the sentence before it, so the order stays natural.
        buffer.flush().forEach(addSentence);
        body.push(output.text);
        if (mode === 'sentence') emit(output.text, 'summary');
      }
    }
  }

  function reset(): void {
    stopHeartbeat();
    stopGuardIdle();
    buffer.cancel();
    // The previous response (finished or not) must not be read after the new one starts.
    dropWaiting();
    guard = newGuard();
    buffer = newBuffer();
    body = [];
    inReasoning = false;
  }

  function finish(next: AnnouncerStatus, text: string, kind: AnnounceKind): void {
    status = next;
    stopHeartbeat();
    stopGuardIdle();
    buffer.cancel();
    setBusy(false);
    // done() lets queued sentences finish before the completion; abort()/error() drop them,
    // so the user hears the final status right after the text that is already being read.
    if (kind !== 'complete') dropWaiting();
    sink(text, { kind });
  }

  function assertAlive(): void {
    if (destroyed) throw new Error(DESTROYED);
  }

  return {
    get status() {
      return status;
    },

    start() {
      assertAlive();
      reset();
      status = 'generating';
      setBusy(true);
      emit(messages.generating, 'start');
    },

    push(delta) {
      assertAlive();
      if (typeof delta !== 'string') {
        throw new TypeError(`push() expects a string text delta, got ${typeof delta}. Pass the new text only.`);
      }
      if (status !== 'generating') return;
      inReasoning = false;
      handle(guard.push(delta));
      if (guard.holdsPossibleTable) {
        // The held line would have reached the buffer without the table check: the line before it
        // is complete now, and the guard's idle timer takes over until the line is released.
        buffer.nextLineStarted().forEach(addSentence);
        armGuardIdle();
      } else {
        stopGuardIdle();
      }
    },

    event(event: StreamEvent) {
      assertAlive();
      if (status !== 'generating' || mode === 'off') return;
      if (event.type === 'reasoning') {
        if (options.announceReasoning && !inReasoning) emit(messages.reasoning, 'event');
        inReasoning = true;
      } else {
        inReasoning = false;
        if (options.announceTools) emit(messages.toolCall({ name: event.name }), 'event');
      }
    },

    done() {
      assertAlive();
      if (status !== 'generating') return;
      handle(guard.flush());
      buffer.flush().forEach(addSentence);
      const text =
        mode === 'on-complete' && includeBody && body.length > 0
          ? `${messages.complete} ${body.join(' ')}`
          : messages.complete;
      finish('done', text, 'complete');
    },

    abort() {
      assertAlive();
      if (status !== 'generating') return;
      finish('aborted', messages.aborted, 'abort');
    },

    error(_err?: unknown) {
      assertAlive();
      if (status !== 'generating') return;
      finish('error', messages.error, 'error');
    },

    destroy() {
      if (destroyed) return;
      stopHeartbeat();
      stopGuardIdle();
      buffer.cancel();
      setBusy(false);
      if (ownRegion) ownRegion.destroy();
      else dropWaiting();
      destroyed = true;
    },
  };
}
