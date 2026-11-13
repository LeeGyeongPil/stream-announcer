/** Practice mock: replays recorded chunks with a pause between them. It is not a real LLM stream. */
export async function playChunks(
  chunks: readonly string[],
  intervalMs: number,
  onChunk: (chunk: string) => void,
  isCancelled: () => boolean,
): Promise<boolean> {
  for (const chunk of chunks) {
    if (isCancelled()) return false;
    onChunk(chunk);
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  return !isCancelled();
}
