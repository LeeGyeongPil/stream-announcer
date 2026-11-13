/** How much of the response is announced while it streams. */
export type AnnounceMode = 'on-complete' | 'sentence' | 'off';

/** Lifecycle state of one streamed response. */
export type AnnouncerStatus = 'idle' | 'generating' | 'done' | 'aborted' | 'error';

/** Why a text is being announced. */
export type AnnounceKind =
  | 'start'
  | 'heartbeat'
  | 'sentence'
  | 'summary'
  | 'complete'
  | 'abort'
  | 'error'
  | 'event';

export interface AnnounceMeta {
  kind: AnnounceKind;
}

/** Receives every text that should be spoken. The default sink writes to a live region. */
export type AnnounceSink = (text: string, meta: AnnounceMeta) => void;

/** Intermediate events that are silent by default. */
export type StreamEvent = { type: 'reasoning' } | { type: 'tool-call'; name: string };

/** Spoken text of a code fence or a table (never the raw code). */
export interface GuardOutput {
  kind: 'prose' | 'summary';
  text: string;
}

export interface StreamAnnouncerOptions {
  /** `on-complete` (default), `sentence` or `off`. */
  mode?: AnnounceMode;
  /** BCP 47 tag. `ko*` selects Korean texts, anything else English. Default `en`. */
  locale?: string;
  /** Partial override of the built-in texts (strings or functions). */
  messages?: import('./messages.js').MessageOverrides;
  /** Silence period before "still generating" is announced. 0 disables. Default 5000. */
  heartbeatMs?: number;
  /** In `on-complete` mode, append the response body to the completion text. Default true. */
  includeBodyOnComplete?: boolean;
  /** Fragments shorter than this are merged into the next sentence. Default 4. */
  minChars?: number;
  /** Force-emit pending text longer than this. Default 200. */
  maxChars?: number;
  /** Force-emit pending text after this much silence in `sentence` mode. Default 1500. */
  idleFlushMs?: number;
  /** Announce "Thinking." once per reasoning phase. Default false. */
  announceReasoning?: boolean;
  /** Announce tool calls. Default false. */
  announceTools?: boolean;
  /**
   * Custom output. Without it (and without `region`) a single live region is created.
   * The announcer cannot reach into a custom sink's own queue: if the sink queues or delays texts,
   * drop what is still waiting when `meta.kind` is `start`, `abort` or `error` (a new response,
   * Stop or a failure makes the old sentences stale). A sink that forwards to a `LiveRegion` can
   * call `region.clear()` there.
   */
  sink?: AnnounceSink;
  /**
   * Use an existing live region (for example one region shared by several announcers) instead of
   * creating one. The announcer queues its texts under its own owner, so its `start()`, `abort()`,
   * `error()` and `destroy()` drop only its own waiting texts. The region is not destroyed with the
   * announcer. Cannot be combined with `sink`.
   */
  region?: import('./live-region.js').LiveRegion;
  /** Element that gets `aria-busy="true"` while a response is generating. */
  busyTarget?: Element | null;
  /** Document used for the default live region. Default `globalThis.document`. */
  document?: Document;
}

export interface StreamAnnouncer {
  /**
   * Begin a response. Starting while generating silently discards the previous one.
   * Texts of an earlier response that are still waiting in the live region are dropped too.
   */
  start(): void;
  /** Feed the next text delta. Ignored unless generating. */
  push(delta: string): void;
  /** Report an intermediate event (reasoning, tool call). */
  event(event: StreamEvent): void;
  /** The response finished normally. Sentences still waiting in the live region are read first. */
  done(): void;
  /** The user stopped the response. Waiting sentences are dropped; only "Response stopped." follows. */
  abort(): void;
  /** The response failed. Waiting sentences are dropped; only "Response failed." follows. */
  error(err?: unknown): void;
  /**
   * Release timers and the live region it created (a shared `region` only loses this
   * announcer's waiting texts). Further calls (except destroy) throw.
   */
  destroy(): void;
  readonly status: AnnouncerStatus;
}
