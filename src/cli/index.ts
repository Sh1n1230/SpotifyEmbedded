#!/usr/bin/env node
import { setup } from './setup.js';
import { generate } from './generate.js';
import { isTopTracksRange, isTopTracksLimit } from '../core/topTracksParams.js';
import {
  DEFAULT_RANKING_COUNT,
  DEFAULT_TOP_TRACKS_LIMIT,
  DEFAULT_TOP_TRACKS_RANGE,
  MAX_RANKING_COUNT,
  TOP_TRACKS_LIMITS,
} from '../types/index.js';

const USAGE = `SpotifyEmbedded

使い方:
  npm run setup       Spotify と連携し、設定を保存する
  npm run generate    静的ファイル（SVG / JSON / HTML）を生成する

generate のオプション（npm 経由では -- を挟みます）:
  --out <dir>     出力先ディレクトリ（既定: ./out）
  --range <name>  集計期間（既定: short_term）
                    short_term  ≒ 直近4週間
                    medium_term ≒ 直近6か月
                    long_term   ≒ 直近1年
  --limit <n>     Spotify から取得する件数 10 | 30 | 50（既定: 50）
  --count <n>     ランキングの表示件数 1〜50（既定: 5）
  --theme <name>  dark | light | both（既定: both）
  --no-mood       AIムード文の生成をスキップする（LLM設定が不要になる）

  例: npm run generate -- --out ./public --range medium_term --count 10

ビルド済みなら node dist/cli/index.js <command> でも実行できます。
`;

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'setup':
      await setup();
      return;

    case 'generate':
      await generate(parseGenerateArgs(args));
      return;

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(USAGE);
      return;

    default:
      console.error(`不明なコマンド: ${command}\n`);
      console.error(USAGE);
      process.exitCode = 1;
  }
}

function parseGenerateArgs(args: string[]): Parameters<typeof generate>[0] {
  const options: Parameters<typeof generate>[0] = {
    outDir: './out',
    count: DEFAULT_RANKING_COUNT,
    range: DEFAULT_TOP_TRACKS_RANGE,
    limit: DEFAULT_TOP_TRACKS_LIMIT,
    theme: 'both',
    skipMood: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--out':
        options.outDir = requireValue(args, ++i, '--out');
        break;

      case '--range': {
        const range = requireValue(args, ++i, '--range');
        if (!isTopTracksRange(range)) {
          throw new Error('--range は short_term / medium_term / long_term のいずれかです。');
        }
        options.range = range;
        break;
      }

      case '--limit': {
        const limit = Number.parseInt(requireValue(args, ++i, '--limit'), 10);
        if (!isTopTracksLimit(limit)) {
          throw new Error(`--limit は ${TOP_TRACKS_LIMITS.join(' / ')} のいずれかです。`);
        }
        options.limit = limit;
        break;
      }

      case '--count': {
        const raw = requireValue(args, ++i, '--count');
        const count = Number.parseInt(raw, 10);
        if (Number.isNaN(count) || count < 1 || count > MAX_RANKING_COUNT) {
          throw new Error(`--count は 1〜${MAX_RANKING_COUNT} の整数で指定してください。`);
        }
        options.count = count;
        break;
      }

      case '--theme': {
        const theme = requireValue(args, ++i, '--theme');
        if (theme !== 'dark' && theme !== 'light' && theme !== 'both') {
          throw new Error('--theme は dark / light / both のいずれかです。');
        }
        options.theme = theme;
        break;
      }

      case '--no-mood':
        options.skipMood = true;
        break;

      default:
        throw new Error(`不明なオプション: ${arg}`);
    }
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} には値が必要です。`);
  }
  return value;
}

main().catch((err: unknown) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
