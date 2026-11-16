import type { MoodResult } from '../types/index.js';

/**
 * 保存されていた値（Workers KV・snapshot.json）をムード文として読む。形が違えば null。
 * 古い版が書いた値には model が無いので、null を補って今の形（キーは必ず存在する）に揃える。
 */
export function toMoodResult(value: unknown): MoodResult | null {
  if (!value || typeof value !== 'object') return null;
  const mood = value as Record<string, unknown>;
  if (typeof mood['text'] !== 'string' || typeof mood['generated_at'] !== 'string') return null;
  return {
    text: mood['text'],
    generated_at: mood['generated_at'],
    model: typeof mood['model'] === 'string' ? mood['model'] : null,
  };
}
