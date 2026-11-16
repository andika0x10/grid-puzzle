import { Application, Assets, Container, Graphics, Sprite, Text, type Spritesheet } from "pixi.js";
import { BOT_COLORS } from "./algorithms";
import type { MatchFrame } from "./engine";
import type { LevelDefinition } from "./schema";

export class BoardRenderer {
  private app = new Application();
  private world = new Container();
  private overlay = new Graphics();
  private actors = new Map<string, { container: Container; sprite: Sprite; x: number; y: number }>();
  private tiles: Sprite[] = [];
  private gems = new Map<string, { gem: Sprite; pickup: Sprite; until: number }>();
  private shared!: Spritesheet;
  private character!: Spritesheet;
  private terrain!: Spritesheet;
  private observer: ResizeObserver | null = null;
  private promise: Promise<void>;
  private disposed = false;
  private initialized = false;
  private clock = 0;
  private playing = false;
  private focused = "bot-0";
  private frame: MatchFrame;
  constructor(
    private host: HTMLElement,
    private level: LevelDefinition,
    frame: MatchFrame,
    private reduced: boolean
  ) {
    this.frame = frame;
    this.promise = this.initialize();
  }
  ready() {
    return this.promise;
  }
  private async initialize() {
    [this.terrain, this.character, this.shared] = await Promise.all([
      Assets.load<Spritesheet>({ src: `/assets/game/themes/${this.level.theme}/atlas.json`, data: { cachePrefix: `${this.level.theme}/` } }),
      Assets.load<Spritesheet>({ src: `/assets/game/characters/${this.level.theme}/atlas.json`, data: { cachePrefix: `character/${this.level.theme}/` } }),
      Assets.load<Spritesheet>({ src: "/assets/game/shared/atlas.json", data: { cachePrefix: "shared/" } }),
    ]);
    if (this.disposed) return;
    for (const sheet of [this.shared, this.character, this.terrain]) for (const texture of Object.values(sheet.textures)) texture.source.scaleMode = "nearest";
    await this.app.init({
      width: 32,
      height: 32,
      backgroundAlpha: 0,
      antialias: false,
      roundPixels: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: "webgl",
    });
    this.initialized = true;
    if (this.disposed) return;
    this.host.appendChild(this.app.canvas);
    this.app.canvas.setAttribute("aria-hidden", "true");
    this.app.stage.addChild(this.world);
    this.level.board.terrain.forEach((name, i) => {
      const s = new Sprite({ texture: this.terrain.textures[name], x: (i % this.level.board.width) * 32, y: Math.floor(i / this.level.board.width) * 32 });
      this.tiles.push(s);
      this.world.addChild(s);
    });
    this.world.addChild(this.overlay);
    const spawn = this.level.board.spawn;
    this.world.addChild(new Sprite({ texture: this.shared.textures.start, x: spawn.x * 32, y: spawn.y * 32 }));
    if (this.level.board.goal) {
      const goal = this.level.board.goal;
      this.world.addChild(new Sprite({ texture: this.shared.textures.finish, x: goal.x * 32, y: goal.y * 32 }));
    }
    for (const p of this.level.board.decorations) this.world.addChild(new Sprite({ texture: this.terrain.textures.decor, x: p.x * 32, y: p.y * 32 }));
    for (const g of this.frame.gems) {
      const gem = new Sprite({ texture: this.shared.textures["gem-0"], x: g.x * 32, y: g.y * 32 });
      const pickup = new Sprite({ texture: this.shared.textures.pickup, x: g.x * 32, y: g.y * 32, visible: false });
      this.world.addChild(gem, pickup);
      this.gems.set(g.id, { gem, pickup, until: 0 });
    }
    const resize = () => {
      if (this.disposed) return;
      const width = Math.max(1, this.host.clientWidth),
        height = Math.max(1, this.host.clientHeight),
        boardWidth = this.level.board.width * 32,
        boardHeight = this.level.board.height * 32;
      const scale = Math.min((width - 16) / boardWidth, (height - 16) / boardHeight);
      this.world.scale.set(Math.max(0.1, scale));
      this.world.position.set(Math.round((width - boardWidth * scale) / 2), Math.round((height - boardHeight * scale) / 2));
      this.app.renderer.resize(width, height);
      this.app.render();
    };
    this.observer = new ResizeObserver(resize);
    this.observer.observe(this.host);
    resize();
    this.setFrame(this.frame);
    this.app.ticker.add((ticker) => {
      if (this.disposed) return;
      if (this.playing) this.clock += ticker.deltaMS;
      this.frame.bots.forEach((bot) => {
        const actor = this.actors.get(bot.id);
        if (!actor) return;
        const smooth = this.playing && !this.reduced,
          blend = smooth ? Math.min(1, ticker.deltaMS / 45) : 1;
        actor.container.x += (actor.x - actor.container.x) * blend;
        actor.container.y += (actor.y - actor.container.y) * blend;
        const moving = this.playing && bot.status === "moving" && !this.reduced;
        const index = moving ? Math.floor(this.clock / 110) % 4 : !this.reduced && this.playing ? Math.floor(this.clock / 650) % 2 : 0;
        actor.sprite.texture = this.character.textures[`actor-${bot.facing}-${moving ? "walk" : "idle"}-${index}`];
      });
      for (const g of this.frame.gems) {
        const view = this.gems.get(g.id)!;
        view.gem.texture = this.shared.textures[`gem-${!this.reduced && this.playing ? Math.floor(this.clock / 600) % 2 : 0}`];
        view.pickup.visible = !this.reduced && this.clock < view.until;
      }
    });
  }
  setPlayback(playing: boolean) {
    this.playing = playing;
  }
  setFocus(id: string) {
    this.focused = id;
    const actor = this.actors.get(id);
    if (actor) this.world.setChildIndex(actor.container, this.world.children.length - 1);
    this.drawOverlay();
  }
  setFrame(frame: MatchFrame) {
    const previous = this.frame;
    this.frame = frame;
    if (!this.initialized || this.disposed) return;
    frame.terrain.forEach((name, i) => {
      this.tiles[i].texture = this.terrain.textures[name];
    });
    for (const [id, view] of this.actors)
      if (!frame.bots.some((b) => b.id === id)) {
        view.container.destroy({ children: true, context: true });
        this.actors.delete(id);
      }
    frame.bots.forEach((bot, i) => {
      let view = this.actors.get(bot.id);
      const offset = [
          [-4, -3],
          [4, -3],
          [-4, 4],
          [4, 4],
        ][i],
        x = bot.x * 32 + offset[0],
        y = bot.y * 32 + offset[1];
      if (!view) {
        const container = new Container({ x, y });
        const ring = new Graphics().ellipse(16, 28, 10, 4).fill({ color: BOT_COLORS[i], alpha: 0.8 });
        const sprite = new Sprite({ texture: this.character.textures["actor-down-idle-0"] });
        const badge = new Graphics().circle(25, 7, 6).fill(0xffffff).stroke({ color: BOT_COLORS[i], width: 2 });
        const label = new Text({ text: String(i + 1), style: { fontFamily: "Geist, sans-serif", fontSize: 8, fontWeight: "900", fill: "#000000" }, x: 25, y: 7, resolution: 2 });
        label.anchor.set(0.5);
        container.addChild(ring, sprite, badge, label);
        this.world.addChild(container);
        view = { container, sprite, x, y };
        this.actors.set(bot.id, view);
      }
      view.x = x;
      view.y = y;
      if (!this.playing || this.reduced) view.container.position.set(x, y);
    });
    for (const g of frame.gems) {
      const view = this.gems.get(g.id);
      if (!view) continue;
      view.gem.visible = !g.taken;
      if (g.taken && previous.gems.find((p) => p.id === g.id)?.taken === false && this.playing) view.until = this.clock + 300;
      if (!g.taken) {
        view.until = 0;
        view.pickup.visible = false;
      }
    }
    this.drawOverlay();
  }
  private drawOverlay() {
    if (!this.initialized || this.disposed) return;
    this.overlay.clear();
    const bot = this.frame.bots.find((b) => b.id === this.focused);
    if (!bot) return;
    const color = BOT_COLORS[this.frame.bots.indexOf(bot)];
    for (const c of bot.visited) this.overlay.rect((c % this.level.board.width) * 32 + 2, Math.floor(c / this.level.board.width) * 32 + 2, 28, 28).fill({ color, alpha: 0.2 });
    for (const c of bot.frontier)
      this.overlay.rect((c % this.level.board.width) * 32 + 3, Math.floor(c / this.level.board.width) * 32 + 3, 26, 26).stroke({ color: 0xffdf69, width: 2 });
    if (bot.route.length > 1)
      this.overlay
        .poly(
          bot.route.flatMap((p) => [p.x * 32 + 16, p.y * 32 + 16]),
          false
        )
        .stroke({ color: "#ffffff", width: 5, alpha: 0.8 })
        .stroke({ color, width: 3 });
  }
  destroy() {
    this.disposed = true;
    this.observer?.disconnect();
    void this.promise
      .catch(() => {})
      .then(() => {
        if (this.initialized) {
          this.initialized = false;
          this.app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true, context: true });
        }
      });
  }
}
