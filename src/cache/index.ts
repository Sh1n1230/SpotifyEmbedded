import NodeCache from 'node-cache';

export const nowPlayingCache = new NodeCache({ stdTTL: 30, checkperiod: 10 });
export const topTracksCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
// Keyed by trackId. node-cache does not evict on maxKeys (set throws when
// full), so a TTL is required to free slots; callers treat a failed set as
// a cache miss.
export const moodCache = new NodeCache({ stdTTL: 86400, checkperiod: 600, maxKeys: 200 });
// Keyed by image URL. ライブSVGはリクエストのたびにジャケ写を data URI 化
// するため、画像バイト列を使い回す。maxKeys は moodCache と同じ理由で必要。
export const artCache = new NodeCache({ stdTTL: 86400, checkperiod: 600, maxKeys: 100 });
// Keyed by range（最大3キー）。期限は設けない。ランキングのムード文は
// 時間ではなく上位曲の顔ぶれで失効する（src/core/rankingMood.ts）。
export const rankingMoodCache = new NodeCache({ stdTTL: 0, checkperiod: 0 });
