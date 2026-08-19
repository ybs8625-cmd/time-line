const TILE_URL = "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";

function keyOf(id) {
  return `${id.zoom}_${id.x}_${id.y}`;
}

export class TileCache {
  constructor() {
    this.memory = new Map();
    this.inflight = new Map();
  }

  get(id) {
    return this.memory.get(keyOf(id)) ?? null;
  }

  load(id) {
    const key = keyOf(id);
    const cached = this.memory.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const request = new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.onload = () => {
        this.memory.set(key, image);
        this.inflight.delete(key);
        resolve(image);
      };
      image.onerror = () => {
        this.inflight.delete(key);
        resolve(null);
      };
      image.src = TILE_URL.replace("{z}", id.zoom).replace("{x}", id.x).replace("{y}", id.y);
    });
    this.inflight.set(key, request);
    return request;
  }

  async loadAll(tiles) {
    const unique = [];
    const seen = new Set();
    for (const tile of tiles) {
      const id = tile.id ?? tile;
      const key = keyOf(id);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(id);
    }
    await Promise.all(unique.map((id) => this.load(id)));
  }
}
