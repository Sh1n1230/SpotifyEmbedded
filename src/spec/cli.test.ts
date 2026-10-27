/** CLI（spotify-embedded）の起動と引数の検証。方針は ./support.ts の冒頭を参照。 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

describe('CLI（spotify-embedded）', () => {
  /** 実際のプロセスとして起動する。.env を拾わないよう、空の作業ディレクトリと最小の環境変数で動かす。 */
  function runCli(args: string[]): { status: number | null; stdout: string; stderr: string; cwd: string } {
    const cwd = mkdtempSync(join(tmpdir(), 'spotify-embedded-cli-'));
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url).href,
        fileURLToPath(new URL('../cli/index.ts', import.meta.url)),
        ...args,
      ],
      { cwd, env: { PATH: process.env['PATH'] ?? '' }, encoding: 'utf8', timeout: 20_000 }
    );
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, cwd };
  }

  const cwds: string[] = [];
  afterEach(() => {
    for (const dir of cwds.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('設定が何も無くても、読み込みだけでは落ちない（npm run setup が動くために必要）', () => {
    const run = runCli(['help']);
    cwds.push(run.cwd);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('npm run setup');
  }, 30_000);

  describe('generate は Spotify が受け付けない指定を、取得を始める前に弾く', () => {
    it.each([
      [['--range', 'two_weeks'], '--range'],
      [['--limit', '20'], '--limit'],
      [['--count', '0'], '--count'],
      [['--count', '51'], '--count'],
      [['--theme', 'sepia'], '--theme'],
      [['--out'], '--out'],
      [['--verbose'], '--verbose'],
    ])('%j', (args, mentioned) => {
      const run = runCli(['generate', ...args]);
      cwds.push(run.cwd);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain(mentioned);
      // 出力先（既定の ./out）すら作らない
      expect(readdirSync(run.cwd)).toEqual([]);
    }, 30_000);
  });

  it('不明なコマンドは使い方を出して失敗する', () => {
    const run = runCli(['deploy']);
    cwds.push(run.cwd);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('不明なコマンド: deploy');
    expect(run.stderr).toContain('使い方');
  }, 30_000);
});
