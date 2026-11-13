import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { recordLiveRegion } from '../../src/testing/index.js';
import { LANG_KEY, UI } from './i18n.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setNavigatorLanguage(value: string): void {
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(value);
}

describe('demo page', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.useFakeTimers();
    setNavigatorLanguage('en-US');
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('has an English / 한국어 menu that switches the page and stores the choice', () => {
    render(<App />);
    const menu = screen.getByTestId('lang-select') as HTMLSelectElement;
    expect([...menu.options].map((o) => o.text)).toEqual(['English', '한국어']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(UI.en.title);
    expect(screen.getByTestId('replay').textContent).toBe(UI.en.replay);

    fireEvent.change(menu, { target: { value: 'ko' } });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(UI.ko.title);
    expect(screen.getByTestId('replay').textContent).toBe(UI.ko.replay);
    expect(localStorage.getItem(LANG_KEY)).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');

    cleanup();
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(UI.ko.title);
  });

  it('detects navigator.language on the first run only', () => {
    setNavigatorLanguage('ko-KR');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(UI.ko.title);
    cleanup();

    setNavigatorLanguage('de-DE');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(UI.en.title);
    cleanup();

    // A saved choice wins over the browser language.
    localStorage.setItem(LANG_KEY, 'ko');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(UI.ko.title);
  });

  it('accepts ?lang=ko for screenshots', () => {
    window.history.replaceState(null, '', '/?lang=ko');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(UI.ko.title);
  });

  it('defines the same UI keys in both languages', () => {
    expect(Object.keys(UI.en).sort()).toEqual(Object.keys(UI.ko).sort());
  });

  it('shows the practice-mock notice in both languages', () => {
    render(<App />);
    expect(screen.getByText(UI.en.mockNotice)).toBeTruthy();
    fireEvent.change(screen.getByTestId('lang-select'), { target: { value: 'ko' } });
    expect(screen.getByText(UI.ko.mockNotice)).toBeTruthy();
  });

  it('replay fills both log panels, with fragments on the left and sentences on the right', async () => {
    render(<App />);
    fireEvent.change(screen.getByTestId('mode-select'), { target: { value: 'sentence' } });
    fireEvent.click(screen.getByTestId('replay'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    const naive = screen.getByTestId('naive-log').querySelectorAll('li');
    const lib = screen.getByTestId('lib-log').querySelectorAll('li');
    expect(naive.length).toBe(9);
    expect(lib.length).toBeGreaterThan(0);
    expect(screen.getByTestId('naive-log').textContent).toContain('out 3.');
    expect(screen.getByTestId('lib-log').textContent).toContain('Pi is about 3.14 for most uses.');
    expect(screen.getByTestId('lib-log').textContent).not.toContain('import math');
    expect(screen.getByTestId('lib-log').textContent).toContain('Response complete.');
  });

  it('announces in the chosen screen language', async () => {
    render(<App />);
    fireEvent.change(screen.getByTestId('lang-select'), { target: { value: 'ko' } });
    fireEvent.change(screen.getByTestId('fixture-select'), { target: { value: 'ko-basic' } });
    fireEvent.click(screen.getByTestId('replay'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('lib-log').textContent).toContain('응답이 완료되었습니다.');
  });

  it('stop aborts the replay and leaves no timers behind', async () => {
    const view = render(<App />);
    fireEvent.click(screen.getByTestId('replay'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    fireEvent.click(screen.getByTestId('stop'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('lib-log').textContent).toContain('Response stopped.');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelectorAll('[aria-live]').length).toBe(0);
  });

  it('stop: after the click the live region only gets "Response stopped."', async () => {
    window.history.replaceState(null, '', '/?mode=sentence');
    render(<App />);
    const recorder = recordLiveRegion(document.querySelector('[data-stream-announcer]')!);
    fireEvent.click(screen.getByTestId('replay'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    const before = recorder.texts();
    expect(before.length).toBeGreaterThan(1);
    fireEvent.click(screen.getByTestId('stop'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(recorder.texts()).toEqual([...before, 'Response stopped.']);
    recorder.stop();
  });

  it('takes mode, fixture, speed, lang and autoplay from the address and ends on a finished screen', async () => {
    window.history.replaceState(null, '', '/?mode=sentence&fixture=ko-basic&speed=fast&lang=ko&autoplay=1');
    render(<App />);
    expect((screen.getByTestId('mode-select') as HTMLSelectElement).value).toBe('sentence');
    expect((screen.getByTestId('fixture-select') as HTMLSelectElement).value).toBe('ko-basic');
    expect((screen.getByTestId('speed-select') as HTMLSelectElement).value).toBe('fast');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(UI.ko.title);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('lib-log').textContent).toContain('응답이 완료되었습니다.');
    expect((screen.getByTestId('replay') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ignores unknown query values and does not autoplay by default', async () => {
    window.history.replaceState(null, '', '/?mode=bogus&fixture=nope&speed=warp');
    render(<App />);
    expect((screen.getByTestId('mode-select') as HTMLSelectElement).value).toBe('on-complete');
    expect((screen.getByTestId('fixture-select') as HTMLSelectElement).value).toBe('en-basic');
    expect((screen.getByTestId('speed-select') as HTMLSelectElement).value).toBe('fast');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId('lib-log').querySelectorAll('li').length).toBe(0);
  });
});
