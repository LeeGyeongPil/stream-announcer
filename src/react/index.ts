import { useEffect, useMemo, useRef } from 'react';
import { createStreamAnnouncer } from '../announcer.js';
import type { StreamAnnouncer, StreamAnnouncerOptions } from '../types.js';

/** Internal: a stable handle plus access to the current instance. */
function useAnnouncerHandle(options: StreamAnnouncerOptions): {
  api: StreamAnnouncer;
  current: () => StreamAnnouncer | null;
} {
  const instance = useRef<StreamAnnouncer | null>(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    // Create and destroy as a pair so StrictMode's double mount leaves exactly one region.
    const created = createStreamAnnouncer(latest.current);
    instance.current = created;
    return () => {
      created.destroy();
      if (instance.current === created) instance.current = null;
    };
  }, []);

  return useMemo(() => {
    const api: StreamAnnouncer = {
      start: () => instance.current?.start(),
      push: (delta) => instance.current?.push(delta),
      event: (event) => instance.current?.event(event),
      done: () => instance.current?.done(),
      abort: () => instance.current?.abort(),
      error: (err) => instance.current?.error(err),
      destroy: () => instance.current?.destroy(),
      get status() {
        return instance.current?.status ?? 'idle';
      },
    };
    return { api, current: () => instance.current };
  }, []);
}

/**
 * Create a stream announcer for the lifetime of the component.
 * Options are read once at mount; remount (change `key`) to apply new ones.
 * Calls made before the component has mounted are ignored.
 */
export function useStreamAnnouncer(options: StreamAnnouncerOptions = {}): StreamAnnouncer {
  return useAnnouncerHandle(options).api;
}

export type AnnounceTextStatus = 'idle' | 'submitted' | 'streaming' | 'ready' | 'error';

export interface UseAnnounceTextOptions extends StreamAnnouncerOptions {
  /** The whole assistant text so far (it only grows while streaming). */
  text: string;
  /** Chat status, as reported by libraries such as the AI SDK's `useChat`. */
  status: AnnounceTextStatus;
  /** With `ready`: the user stopped the response, so announce "stopped" instead of "complete". */
  stopped?: boolean;
}

/** Announce a response from accumulating `text` and a `status`, without calling start/push/done yourself. */
export function useAnnounceText(options: UseAnnounceTextOptions): void {
  const { text, status, stopped = false, ...announcerOptions } = options;
  const { current } = useAnnouncerHandle(announcerOptions);
  const session = useRef<{ instance: StreamAnnouncer | null; active: boolean; consumed: number }>({
    instance: null,
    active: false,
    consumed: 0,
  });

  useEffect(() => {
    const announcer = current();
    if (!announcer) return;
    const s = session.current;
    // A new instance (first mount or StrictMode remount) starts a fresh session.
    if (s.instance !== announcer) {
      s.instance = announcer;
      s.active = false;
      s.consumed = 0;
    }
    const pushNew = (): void => {
      if (text.length > s.consumed) announcer.push(text.slice(s.consumed));
      s.consumed = text.length;
    };
    const begin = (): void => {
      if (!s.active) {
        s.active = true;
        s.consumed = 0;
        announcer.start();
      }
    };
    if (status === 'submitted') {
      begin();
    } else if (status === 'streaming') {
      begin();
      pushNew();
    } else if (s.active) {
      pushNew();
      s.active = false;
      if (status === 'error') announcer.error();
      else if (status === 'ready' && !stopped) announcer.done();
      else announcer.abort();
    }
  }, [text, status, stopped, current]);
}
