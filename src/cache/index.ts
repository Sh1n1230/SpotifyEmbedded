import NodeCache from 'node-cache';

export const nowPlayingCache = new NodeCache({ stdTTL: 30, checkperiod: 10 });
export const topTracksCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
// Keyed by trackId. node-cache does not evict on maxKeys (set throws when
// full), so a TTL is required to free slots; callers treat a failed set as
// a cache miss.
export const moodCache = new NodeCache({ stdTTL: 86400, checkperiod: 600, maxKeys: 200 });
