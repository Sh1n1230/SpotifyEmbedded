/** カードの描画（テーマの色など）。方針は ./support.ts の冒頭を参照。 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { THEMES } from '../render/theme.js';

describe('カードの文字色は、どちらのテーマでも背景に対して WCAG AA（4.5:1）を満たす', () => {
  /** WCAG 2.2 の相対輝度とコントラスト比 */
  function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  }

  it.each(
    (['dark', 'light'] as const).flatMap((name) =>
      (['fg', 'sub', 'muted', 'accent'] as const).map((key) => [name, key] as const)
    )
  )('%s テーマの %s', (name, key) => {
    const theme = THEMES[name];
    expect(contrast(theme[key], theme.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('embed.js は theme.ts と同じ色を使う（色を二重に持っているので、変え忘れを防ぐ）', () => {
    const source = readFileSync(new URL('../../public/embed.js', import.meta.url), 'utf8');
    const literal = /var THEMES = (\{[\s\S]*?\n {2}\});/.exec(source)![1];
    const embedThemes = runInNewContext(`(${literal})`) as Record<string, Record<string, string>>;

    for (const name of ['dark', 'light'] as const) {
      for (const [key, value] of Object.entries(embedThemes[name]!)) {
        expect(value, `${name}.${key}`).toBe(THEMES[name][key as keyof (typeof THEMES)[typeof name]]);
      }
    }
  });
});
