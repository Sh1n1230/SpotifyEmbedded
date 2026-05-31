import NodeCache from 'node-cache';

export const nowPlayingCache = new NodeCache({ stdTTL: 30, checkperiod: 10 });
export const topTracksCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
// No TTL; keyed by trackId. maxKeys acts as a soft LRU cap.
export const moodCache = new NodeCache({ stdTTL: 0, maxKeys: 200 });
