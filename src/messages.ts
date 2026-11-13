/** Spoken texts. Function entries receive the details they describe. */
export interface AnnouncerMessages {
  generating: string;
  stillGenerating: string;
  complete: string;
  aborted: string;
  error: string;
  codeBlock: (info: { lang: string; lines: number }) => string;
  table: (info: { columns: number; rows: number }) => string;
  reasoning: string;
  toolCall: (info: { name: string }) => string;
}

type Fn<K extends keyof AnnouncerMessages> = Extract<AnnouncerMessages[K], (...args: never[]) => unknown>;

/** Partial override. Plain-text keys take a string; function keys take a function or a fixed string. */
export type MessageOverrides = {
  [K in keyof AnnouncerMessages]?: AnnouncerMessages[K] extends string ? string : Fn<K> | string;
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const en: AnnouncerMessages = {
  generating: 'Generating response.',
  stillGenerating: 'Still generating.',
  complete: 'Response complete.',
  aborted: 'Response stopped.',
  error: 'Response failed.',
  codeBlock: ({ lang, lines }) => `${lang ? `${lang} code block` : 'Code block'}, ${plural(lines, 'line', 'lines')}.`,
  table: ({ columns, rows }) => `Table, ${plural(columns, 'column', 'columns')}, ${plural(rows, 'row', 'rows')}.`,
  reasoning: 'Thinking.',
  toolCall: ({ name }) => `Using tool ${name}.`,
};

const ko: AnnouncerMessages = {
  generating: '응답을 생성하는 중입니다.',
  stillGenerating: '아직 생성 중입니다.',
  complete: '응답이 완료되었습니다.',
  aborted: '응답이 중단되었습니다.',
  error: '응답 생성에 실패했습니다.',
  codeBlock: ({ lang, lines }) => `${lang ? `${lang} ` : ''}코드 블록 ${lines}줄.`,
  table: ({ columns, rows }) => `${columns}열 ${rows}행 표.`,
  reasoning: '생각하는 중입니다.',
  toolCall: ({ name }) => `${name} 도구를 사용하는 중입니다.`,
};

/** Built-in texts per language. Both languages always define the same keys. */
export const messages: { en: AnnouncerMessages; ko: AnnouncerMessages } = { en, ko };

/** `ko`, `ko-KR`, ... select Korean; everything else (or no locale) selects English. */
export function pickLanguage(locale?: string): 'en' | 'ko' {
  return typeof locale === 'string' && /^ko([-_]|$)/i.test(locale.trim()) ? 'ko' : 'en';
}

/** Built-in texts for `locale` with `overrides` applied on top. */
export function resolveMessages(locale?: string, overrides: MessageOverrides = {}): AnnouncerMessages {
  const base = messages[pickLanguage(locale)];
  const result: Record<string, unknown> = { ...base };
  const known = Object.keys(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (!known.includes(key)) {
      throw new Error(`Unknown message key "${key}". Valid keys: ${known.join(', ')}.`);
    }
    if (value === undefined) continue;
    const isFnKey = typeof (base as unknown as Record<string, unknown>)[key] === 'function';
    if (typeof value === 'string') {
      result[key] = isFnKey ? () => value : value;
    } else if (typeof value === 'function' && isFnKey) {
      result[key] = value;
    } else {
      throw new Error(`Message "${key}" must be ${isFnKey ? 'a string or a function' : 'a string'}.`);
    }
  }
  return result as unknown as AnnouncerMessages;
}
