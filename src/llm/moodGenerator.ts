import { config } from '../config.js';
import { chatCompletion } from './client.js';
import type { TopTrackEntry } from '../types/index.js';

const SYSTEM_INSTRUCTION = `あなたは個人のポートフォリオサイト向けの音楽ムード描写AIです。
与えられた楽曲情報から、聴者の現在の気分を表す日本語の1文を生成してください。

ルール:
- 15〜30文字の日本語1文のみを出力する
- 語尾は「〜なようです」「〜な気分になっています」「〜しているようです」などの自然な表現にする
- クォートや説明文は一切つけない
- 楽曲の雰囲気・ジャンルを反映した表現にする

例:
- 今チルな気分になっています
- 今ノリノリなようです
- センチメンタルな夜を過ごしているようです
- 集中して作業中のようです
- エモーショナルな気分に浸っているようです`;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

export async function generateMood(params: {
  trackName: string;
  artistName: string;
  albumName: string;
  /** 取得できない環境では空配列。 */
  genres: string[];
  /** 取得できない環境では null。 */
  popularity: number | null;
}): Promise<string> {
  // 各フィールドを制限してプロンプトインジェクションを軽減。
  // 取得できなかった項目は「不明」と書くのではなく行そのものを省く。
  // 存在しない手がかりをモデルに示すと、そこに引きずられた文が出る。
  const lines = [
    `曲名: ${truncate(params.trackName, 100)}`,
    `アーティスト: ${truncate(params.artistName, 100)}`,
    `アルバム: ${truncate(params.albumName, 100)}`,
  ];
  if (params.genres.length > 0) {
    lines.push(`ジャンル: ${truncate(params.genres.join(', '), 100)}`);
  }
  if (typeof params.popularity === 'number') {
    lines.push(`人気度: ${params.popularity}/100`);
  }
  const prompt = lines.join('\n');

  return requestMood(SYSTEM_INSTRUCTION, prompt);
}

const RANKING_SYSTEM_INSTRUCTION = `あなたは個人のポートフォリオサイト向けの音楽ムード描写AIです。
与えられた再生ランキング（上位曲）から、その期間の聴き方の傾向や気分を表す日本語の1文を生成してください。

ルール:
- 15〜35文字の日本語1文のみを出力する
- 1曲ではなく、ランキング全体に共通する雰囲気を捉える
- 集計期間に合った言い回しにする（4週間なら「最近」、1年なら「この1年」など）
- 語尾は「〜なようです」「〜にハマっているようです」などの自然な表現にする
- 曲名やアーティスト名をそのまま並べない
- クォートや説明文は一切つけない

例:
- 最近は夜に似合う曲ばかり聴いているようです
- この半年はずっとアップテンポな気分のようです
- この1年はエモーショナルな曲に浸っていたようです`;

/** ランキング全体のムード文。呼び出しの要否は src/core/rankingMood.ts が決める。 */
export async function generateRankingMood(params: {
  /** 例: "直近4週間" */
  periodLabel: string;
  /** 上位から順に。件数の上限は呼び出し側で絞る。 */
  tracks: Pick<TopTrackEntry, 'rank' | 'name' | 'artist' | 'genres'>[];
}): Promise<string> {
  const lines = [
    `集計期間: ${params.periodLabel}`,
    '上位曲:',
    ...params.tracks.map(
      (t) => `${t.rank}. ${truncate(t.name, 60)} / ${truncate(t.artist, 60)}`
    ),
  ];
  // 単曲と同じく、取得できないジャンルは行ごと省く。
  const genres = [...new Set(params.tracks.flatMap((t) => t.genres))];
  if (genres.length > 0) {
    lines.push(`ジャンル: ${truncate(genres.join(', '), 150)}`);
  }

  return requestMood(RANKING_SYSTEM_INSTRUCTION, lines.join('\n'));
}

async function requestMood(system: string, prompt: string): Promise<string> {
  const text = await chatCompletion({
    baseUrl: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    model: config.llm.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    maxTokens: 80,
    temperature: 0.7,
  });

  return (
    text
      .trim()
      // 1文しか出さないので句点は要らない。プロンプトの文例にも付けていないが、
      // モデルによっては付けてくる（Gemini など）ので、ここで揃える。
      .replace(/[。．]$/, '')
      .replace(/^["「]|["」]$/g, '')
      .trim()
  );
}
