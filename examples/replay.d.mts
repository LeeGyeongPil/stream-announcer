export const MESSAGES: Record<'en' | 'ko', Record<string, string>>;
export function resolveLang(flag?: string, env?: Record<string, string | undefined>): 'en' | 'ko';
export function parseArgs(argv: string[]): {
  lang?: 'en' | 'ko';
  mode: string;
  fixture?: string;
  interval: number;
  help: boolean;
  error?: [string, Record<string, string>];
};
export function main(
  argv: string[],
  env?: Record<string, string | undefined>,
  write?: (line: string) => void,
): Promise<number>;
