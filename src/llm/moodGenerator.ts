import { config } from '../config.js';
import { chatCompletion } from './client.js';

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
  genres: string[];
  popularity: number;
}): Promise<string> {
  // 各フィールドを制限してプロンプトインジェクションを軽減
  const genreText = params.genres.length > 0
    ? truncate(params.genres.join(', '), 100)
    : '不明';
  const prompt = `曲名: ${truncate(params.trackName, 100)}
アーティスト: ${truncate(params.artistName, 100)}
アルバム: ${truncate(params.albumName, 100)}
ジャンル: ${genreText}
人気度: ${params.popularity}/100`;

  const text = await chatCompletion({
    baseUrl: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    model: config.llm.model,
    messages: [
      { role: 'system', content: SYSTEM_INSTRUCTION },
      { role: 'user', content: prompt },
    ],
    maxTokens: 80,
    temperature: 0.7,
  });

  return text.trim().replace(/^["「]|["」]$/g, '');
}
