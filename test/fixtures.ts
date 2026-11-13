import en from '../examples/fixtures/en-basic.json';
import ko from '../examples/fixtures/ko-basic.json';
import table from '../examples/fixtures/table.json';
import unpunctuatedKo from '../examples/fixtures/unpunctuated-ko.json';

export const EN_CHUNKS: string[] = en.chunks;
export const KO_CHUNKS: string[] = ko.chunks;
export const TABLE_CHUNKS: string[] = table.chunks;
export const UNPUNCTUATED_KO_CHUNKS: string[] = unpunctuatedKo.chunks;

/** What a screen reader should hear for EN_CHUNKS in sentence mode. */
export const EN_SENTENCE_HISTORY = [
  'Generating response.',
  'Sure!',
  'Pi is about 3.14 for most uses.',
  'Here is code:',
  'python code block, 2 lines.',
  'That prints it.',
  'Done',
  'Response complete.',
];

/** One delta with `count` complete sentences, like a fast model sending a burst ("Old 1 is here. Old 2 is here. ..."). */
export function burst(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1} is here. `).join('');
}
