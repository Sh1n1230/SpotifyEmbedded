#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
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
  spotify-embedded setup                Spotify と連携し、設定を保存する
  spotify-embedded generate [オプション]  静的ファイル（SVG / JSON / HTML）を生成する
  spotify-embedded --version            版を表示する

このリポジトリを clone して使うときは、npm run setup / npm run generate -- [オプション] でも実行できます。

generate のオプション:
  --out <dir>     出力先ディレクトリ（既定: ./out）
  --range <name>  集計期間（既定: short_term）
                    short_term  ≒ 直近4週間
                    medium_term ≒ 直近6か月
                    long_term   ≒ 直近1年
  --limit <n>     Spotify から取得する件数 10 | 30 | 50（既定: 50）
  --count <n>     ランキングの表示件数 1〜50（既定: 5。--limit 以下）
  --page-count <n>  iframe 用ページ（index.html）のランキングの表示件数 1〜50（既定: --count と同じ）
  --theme <name>  dark | light | both（既定: both）
  --no-mood       AIムード文の生成をスキップする（LLM設定が不要になる）
  --refresh-ranking-mood
                  ランキングのムード文を、顔ぶれの変化に関係なく作り直す
  --index         検索エンジンに載せてよい（既定では index.html に noindex を入れ、robots.txt を書く）

  値は --out ./public と --out=./public のどちらの形でも渡せます。

  例: npm run generate -- --out ./public --range medium_term --count 10

ビルド済みなら node dist/cli/index.js <command> でも実行できます。
`;

/** package.json の version。src/cli と dist/cli のどちらからも ../../package.json にある（npm パッケージの files にも含まれる） */
function packageVersion(): string {
  const path = new URL('../../package.json', import.meta.url);
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case '--version':
    case '-v':
    case 'version':
      console.log(packageVersion());
      return;
    case 'setup':
      if (args.includes('--help') || args.includes('-h')) {
        console.log(USAGE);
        return;
      }
      if (args.length > 0) {
        console.error(`✗ 不明なオプション: ${args[0]}\n`);
        console.error(USAGE);
        process.exitCode = 1;
        return;
      }
      await setup();
      return;

    case 'generate':
      if (args.includes('--help') || args.includes('-h')) {
        console.log(USAGE);
        return;
      }
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

/** generate のオプション。値の検証（範囲・選択肢）は下の parseGenerateArgs が行う。 */
const GENERATE_OPTIONS = {
  out: { type: 'string' },
  range: { type: 'string' },
  limit: { type: 'string' },
  count: { type: 'string' },
  'page-count': { type: 'string' },
  theme: { type: 'string' },
  'no-mood': { type: 'boolean' },
  'refresh-ranking-mood': { type: 'boolean' },
  index: { type: 'boolean' },
} as const;

/**
 * node:util の parseArgs で読む。`--out dir` と `--out=dir` のどちらも受け付け、知らないオプション・
 * 位置引数・値の無いオプションは拒む（strict）。`--` で始まる値は `--out=--dir` の形で渡せる。
 */
function parseGenerateArgs(args: string[]): Parameters<typeof generate>[0] {
  let values: ReturnType<typeof parseArgs<{ options: typeof GENERATE_OPTIONS }>>['values'];
  try {
    ({ values } = parseArgs({ args, options: GENERATE_OPTIONS, strict: true, allowPositionals: false }));
  } catch (err) {
    throw new Error(describeParseError(err), { cause: err });
  }

  const options: Parameters<typeof generate>[0] = {
    outDir: './out',
    count: DEFAULT_RANKING_COUNT,
    range: DEFAULT_TOP_TRACKS_RANGE,
    limit: DEFAULT_TOP_TRACKS_LIMIT,
    theme: 'both',
    skipMood: values['no-mood'] === true,
    refreshRankingMood: values['refresh-ranking-mood'] === true,
    allowIndexing: values.index === true,
  };

  if (values.out !== undefined) {
    if (values.out === '') throw new Error('--out には値が必要です。');
    options.outDir = values.out;
  }

  if (values.range !== undefined) {
    if (!isTopTracksRange(values.range)) {
      throw new Error('--range は short_term / medium_term / long_term のいずれかです。');
    }
    options.range = values.range;
  }

  if (values.limit !== undefined) {
    const limit = parseIntStrict(values.limit);
    if (!isTopTracksLimit(limit)) {
      throw new Error(`--limit は ${TOP_TRACKS_LIMITS.join(' / ')} のいずれかです。`);
    }
    options.limit = limit;
  }

  if (values.count !== undefined) options.count = parseCount(values.count, '--count');
  if (values['page-count'] !== undefined) options.pageCount = parseCount(values['page-count'], '--page-count');

  if (values.theme !== undefined) {
    if (values.theme !== 'dark' && values.theme !== 'light' && values.theme !== 'both') {
      throw new Error('--theme は dark / light / both のいずれかです。');
    }
    options.theme = values.theme;
  }

  return options;
}

function parseCount(raw: string, flag: string): number {
  const count = parseIntStrict(raw);
  if (Number.isNaN(count) || count < 1 || count > MAX_RANKING_COUNT) {
    throw new Error(`${flag} は 1〜${MAX_RANKING_COUNT} の整数で指定してください。`);
  }
  return count;
}

/** parseArgs の例外（英語）を、今までと同じ日本語の案内にする。 */
function describeParseError(err: unknown): string {
  const code = err instanceof Error && 'code' in err ? String(err.code) : '';
  const message = err instanceof Error ? err.message : String(err);
  // メッセージは `Unknown option '--foo'`・`Option '--out <value>' argument missing` のように、名前を '…' で囲んで始まる
  const name = /'(-{1,2}[^'\s=]+)/.exec(message)?.[1] ?? '';
  if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return `不明なオプション: ${name || message}`;
  if (code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL') {
    return `不明なオプション: ${/'([^']*)'/.exec(message)?.[1] ?? message}`;
  }
  if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    return /does not take an argument/.test(message) ? `${name} は値を取りません。` : `${name} には値が必要です。`;
  }
  return message;
}

/**
 * 整数として妥当な文字列だけを数にする。Number.parseInt は先頭の数字だけを読むので、
 * 10abc・7.5・1e2 のような打ち間違いが黙って 10・7・1 になる。それ以外は NaN。
 */
function parseIntStrict(raw: string): number {
  return /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
}

main().catch((err: unknown) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  // 想定外の例外の原因の行を調べるときだけ、スタックトレース（と cause）を出す
  if ((process.env['DEBUG'] ?? '').split(',').includes('spotify-embedded')) console.error(err);
  process.exitCode = 1;
});
