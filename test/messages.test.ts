import { describe, expect, it } from 'vitest';
import { messages, pickLanguage, resolveMessages } from '../src/index.js';

describe('messages', () => {
  it('defines identical keys in en and ko', () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.ko).sort());
  });

  it('selects the language from the locale', () => {
    expect(resolveMessages('ko-KR').generating).toBe('응답을 생성하는 중입니다.');
    expect(resolveMessages('ko').generating).toBe('응답을 생성하는 중입니다.');
    expect(resolveMessages('fr').generating).toBe('Generating response.');
    expect(resolveMessages(undefined).generating).toBe('Generating response.');
    expect(pickLanguage('kok')).toBe('en');
  });

  it('renders every built-in text in both languages', () => {
    expect(messages.en.codeBlock({ lang: 'python', lines: 2 })).toBe('python code block, 2 lines.');
    expect(messages.en.codeBlock({ lang: '', lines: 1 })).toBe('Code block, 1 line.');
    expect(messages.ko.codeBlock({ lang: '', lines: 3 })).toBe('코드 블록 3줄.');
    expect(messages.en.table({ columns: 1, rows: 1 })).toBe('Table, 1 column, 1 row.');
    expect(messages.en.toolCall({ name: 'web_search' })).toBe('Using tool web_search.');
    expect(messages.ko.toolCall({ name: 'web_search' })).toBe('web_search 도구를 사용하는 중입니다.');
    expect(messages.ko.reasoning).toBe('생각하는 중입니다.');
  });

  it('overrides only the given keys', () => {
    const resolved = resolveMessages('en', { complete: 'All done.' });
    expect(resolved.complete).toBe('All done.');
    expect(resolved.aborted).toBe(messages.en.aborted);
    expect(resolved.error).toBe(messages.en.error);
  });

  it('accepts functions and fixed strings for function keys', () => {
    const fn = resolveMessages('en', { codeBlock: ({ lines }) => `code (${lines})` });
    expect(fn.codeBlock({ lang: 'js', lines: 4 })).toBe('code (4)');
    const fixed = resolveMessages('ko', { table: 'A table.' });
    expect(fixed.table({ columns: 2, rows: 2 })).toBe('A table.');
  });

  it('rejects unknown keys and wrong value types with a helpful message', () => {
    expect(() => resolveMessages('en', { nope: 'x' } as never)).toThrow(/Unknown message key "nope"/);
    expect(() => resolveMessages('en', { complete: (() => 'x') as never })).toThrow(/must be a string/);
  });
});
