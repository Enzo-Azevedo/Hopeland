// Cache generacional para amostras do mundo estático (elevação, tile,
// fluxo). O mundo é infinito: um cache sem teto cresce com a caminhada
// (~450MB por hora, medido). Duas gerações dão memória limitada sem
// penhasco: consultas acham na geração quente ou na fria (promovendo), e
// quando a quente enche ela vira a fria e uma nova começa vazia — o
// conjunto de trabalho (anel 5x5 = 25.6k tiles) nunca é despejado na
// prática, e re-aquecer um chunk custa ~25ms espalhados pela fila.

export interface TileCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  readonly size: number;
  clear(): void;
}

/** Teto por geração; memória fica limitada a ~2x isso. */
export const CACHE_GENERATION_LIMIT = 150_000;

export function createTileCache<T>(limit = CACHE_GENERATION_LIMIT): TileCache<T> {
  let hot = new Map<string, T>();
  let cold = new Map<string, T>();

  return {
    get(key) {
      const inHot = hot.get(key);
      if (inHot !== undefined) return inHot;
      const inCold = cold.get(key);
      if (inCold !== undefined) {
        hot.set(key, inCold); // promove: continua quente enquanto for usado
        return inCold;
      }
      return undefined;
    },
    set(key, value) {
      hot.set(key, value);
      if (hot.size >= limit) {
        cold = hot;
        hot = new Map<string, T>();
      }
    },
    get size() {
      return hot.size + cold.size;
    },
    clear() {
      hot = new Map<string, T>();
      cold = new Map<string, T>();
    },
  };
}
