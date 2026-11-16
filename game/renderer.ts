import { Application, Assets, Container, Graphics, Sprite, type Spritesheet } from "pixi.js";
import type { LevelDefinition, BoardState } from "./schema";
import { GROUP_COLORS } from "./mechanics";
import type { ThemeId } from "./themes";
const sharedSheets = new Map<ThemeId, Promise<Spritesheet>>();
function loadSheet(theme: ThemeId) {
  if (!sharedSheets.has(theme))
    sharedSheets.set(
      theme,
      Assets.load<Spritesheet>({
        src: `/assets/game/${theme}/atlas.json`,
        data: { cachePrefix: `${theme}/`, textureOptions: { scaleMode: "nearest" } },
      }).catch((e) => {
        sharedSheets.delete(theme);
        throw e;
      })
    );
  return sharedSheets.get(theme)!;
}
export class BoardRenderer {
  private app = new Application();
  private world = new Container();
  private overlay = new Graphics();
  private labels = new Graphics();
  private actor: Sprite | null = null;
  private clock = 0;
  private tiles: Sprite[] = [];
  private sheet!: Spritesheet;
  private observer: ResizeObserver | null = null;
  private disposed = false;
  private initialized = false;
  private destroyed = false;
  private promise: Promise<void>;
  private frame: BoardState;
  constructor(
    private host: HTMLElement,
    private level: LevelDefinition,
    frame: BoardState,
    private tick: (ms: number) => void,
    private phase: () => string,
    private reduced: boolean
  ) {
    this.frame = frame;
    this.promise = this.initialize();
  }
  ready() {
    return this.promise;
  }
  private async initialize() {
    this.sheet = await loadSheet(this.level.theme);
    if (this.disposed) return;
    await this.app.init({
      width: this.level.board.width * 32,
      height: this.level.board.height * 32,
      backgroundAlpha: 0,
      antialias: false,
      roundPixels: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: "webgl",
    });
    this.initialized = true;
    if (this.disposed) {
      this.cleanup();
      return;
    }
    this.host.appendChild(this.app.canvas);
    this.app.canvas.setAttribute("aria-hidden", "true");
    this.app.stage.addChild(this.world);
    this.level.board.terrain.forEach((name, i) => {
      const s = new Sprite({
        texture: this.sheet.textures[name],
        x: (i % this.level.board.width) * 32,
        y: Math.floor(i / this.level.board.width) * 32,
        roundPixels: true,
      });
      this.tiles.push(s);
      this.world.addChild(s);
    });
    this.world.addChild(this.overlay);
    for (const o of this.level.board.objects) {
      const s = new Sprite({
        texture: this.sheet.textures[o.asset],
        x: o.x * 32,
        y: o.y * 32,
        roundPixels: true,
      });
      this.world.addChild(s);
    }
    if (this.level.board.robot) {
      this.actor = new Sprite({
        texture: this.sheet.textures["actor-down-idle-0"],
        roundPixels: true,
      });
      this.world.addChild(this.actor);
    }
    this.world.addChild(this.labels);
    const viewport = this.host.parentElement ?? this.host;
    const resize = () => {
      const style = getComputedStyle(viewport);
      const available = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const w = this.level.board.width * 32,
        scale = Math.max(1, Math.min(2, Math.floor(available / w)));
      this.world.scale.set(scale);
      this.app.renderer.resize(w * scale, this.level.board.height * 32 * scale);
    };
    this.observer = new ResizeObserver(resize);
    this.observer.observe(viewport);
    resize();
    this.setFrame(this.frame);
    this.app.ticker.add((t) => {
      this.tick(t.deltaMS);
      if (["playing", "ready", "finished"].includes(this.phase()) && !this.reduced) {
        this.clock += t.deltaMS;
        if (this.actor) {
          const animation = this.phase() === "playing" && this.level.mechanic === "navigation" ? "walk" : "idle";
          const frame = animation === "walk" ? Math.floor(this.clock / 125) % 4 : Math.floor(this.clock / 650) % 2;
          this.actor.texture = this.sheet.textures[`actor-${this.frame.entities.robot?.facing ?? "down"}-${animation}-${frame}`];
        }
      }
    });
  }
  setFrame(frame: BoardState) {
    this.frame = frame;
    if (!this.initialized || this.disposed) return;
    this.overlay.clear();
    this.labels.clear();
    this.level.board.terrain.forEach((name, i) => {
      const key = `${i % this.level.board.width},${Math.floor(i / this.level.board.width)}`;
      this.tiles[i].texture = this.sheet.textures[frame.cells[key]?.terrain ?? name];
    });
    for (const [key, cell] of Object.entries(frame.cells)) {
      const [x, y] = key.split(",").map(Number);
      if (cell.status && !cell.terrain) {
        const color = cell.status === "visited" ? 0xd0f2bd : cell.status === "active" ? 0xffd263 : 0xf5db97;
        this.overlay.rect(x * 32 + 1, y * 32 + 1, 30, 30).fill({ color, alpha: 0.65 });
      }
      if (cell.group !== undefined) {
        const color = cell.group < 0 ? "#a2a7a4" : GROUP_COLORS[cell.group % GROUP_COLORS.length];
        this.overlay
          .rect(x * 32 + 2, y * 32 + 2, 28, 28)
          .fill({ color, alpha: 0.18 })
          .stroke({ width: 2, color });
        this.groupLabel(x, y, cell.group);
      }
    }
    if (frame.path.length > 1)
      this.overlay
        .poly(
          frame.path.flatMap((p) => [p.x * 32 + 16, p.y * 32 + 16]),
          false
        )
        .stroke({ color: 0x2e8897, width: 4 });
    for (const p of frame.centroids)
      this.overlay
        .rect(p.x * 32 + 10, p.y * 32 + 10, 12, 12)
        .stroke({ color: 0xffffff, width: 2 })
        .rect(p.x * 32 + 13, p.y * 32 + 13, 6, 6)
        .fill(0x3c535b);
    if (this.actor && frame.entities.robot) {
      const p = frame.entities.robot;
      this.actor.position.set(p.x * 32, p.y * 32);
      this.actor.texture = this.sheet.textures[`actor-${p.facing}-idle-0`];
    }
  }
  private groupLabel(x: number, y: number, group: number) {
    const glyphs = [
      "111101101101111",
      "010110010010111",
      "111001111100111",
      "111001111001111",
      "101101111001001",
      "111100111001111",
      "111100111101111",
      "111001001001001",
      "111101111101111",
      "111101111001111",
    ];
    const value = group < 0 ? "x" : String(group + 1),
      left = x * 32 + 32 - value.length * 8 - 3,
      top = y * 32 + 18;
    this.labels.rect(left - 2, top - 2, value.length * 8 + 2, 14).fill(0x355047);
    [...value].forEach((char, index) => {
      const pattern = char === "x" ? "101101010101101" : glyphs[Number(char)];
      [...pattern].forEach((p, i) => {
        if (p === "1") this.labels.rect(left + index * 8 + (i % 3) * 2, top + Math.floor(i / 3) * 2, 2, 2).fill(0xffffff);
      });
    });
  }
  private cleanup() {
    if (this.initialized && !this.destroyed) {
      this.destroyed = true;
      this.app.destroy({ removeView: true }, { children: true, context: true });
    }
  }
  destroy() {
    this.disposed = true;
    this.observer?.disconnect();
    void this.promise.then(() => this.cleanup()).catch(() => {});
  }
}
