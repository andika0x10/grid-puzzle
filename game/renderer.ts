import { Application, Assets, Container, Graphics, Sprite, Text, type Spritesheet } from "pixi.js";
import { BOT_COLORS } from "./algorithms";
import type { MatchFrame } from "./engine";
import type { LevelDefinition } from "./schema";
import { isWalkable } from "./schema";
import { feverMultiplier, gemActive, gemPending } from "./classic";

export class BoardRenderer {
  private app = new Application();
  private world = new Container();
  private overlay = new Graphics();
  private ownership = new Graphics();
  private modeLayer = new Container();
  private modeSprites = new Map<string, Sprite>();
  private postLabels = new Map<string, Text>();
  private actors = new Map<string, { container: Container; sprite: Sprite; cargo: Sprite; x: number; y: number }>();
  private tiles: Sprite[] = [];
  private gems = new Map<string, { gem: Sprite; pickup: Sprite; label: Text; life: Graphics; bucket: number | null; until: number }>();
  private gateCells = new Set<number>();
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
  private focusedApplied = false;
  private renderedFrame: MatchFrame | null = null;
  private modeSignature = "";
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
    this.app.ticker.maxFPS = this.reduced ? 30 : 60;
    this.app.canvas.setAttribute("aria-hidden", "true");
    this.app.stage.addChild(this.world);
    this.level.board.gates.forEach((g) => this.gateCells.add(g.y * this.level.board.width + g.x));
    this.level.board.terrain.forEach((name, i) => {
      const s = new Sprite({
        texture: this.terrain.textures[this.gateCells.has(i) ? "path" : name],
        x: (i % this.level.board.width) * 32,
        y: Math.floor(i / this.level.board.width) * 32,
      });
      this.tiles.push(s);
      this.world.addChild(s);
    });
    this.world.addChild(this.ownership, this.overlay, this.modeLayer);
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
      const label = new Text({
        text: String(g.value ?? 1),
        style: { fontFamily: "Geist, sans-serif", fontSize: 10, fontWeight: "900", fill: "#ffffff", stroke: { color: "#252b32", width: 3 } },
        x: g.x * 32 + 25,
        y: g.y * 32 + 2,
        resolution: 2,
      });
      const life = new Graphics();
      this.world.addChild(gem, pickup, life, label);
      this.gems.set(g.id, { gem, pickup, label, life, bucket: null, until: 0 });
    }
    const object = (id: string, texture: string, p: { x: number; y: number }) => {
      const sprite = new Sprite({ texture: this.shared.textures[texture], x: p.x * 32, y: p.y * 32 });
      this.modeSprites.set(id, sprite);
      this.modeLayer.addChild(sprite);
      return sprite;
    };
    if (this.level.board.depot) object("depot", "depot", this.level.board.depot);
    for (const parcel of this.frame.modeState.parcels) object(parcel.id, "parcel", parcel);
    for (const key of this.level.board.keys) object(`key-${key.color}`, `key-${key.color}`, key);
    for (const [i, door] of this.level.board.doors.entries()) object(`door-${i}`, `door-${door.color}`, door);
    for (const [i, p] of this.level.board.checkpoints.entries()) {
      object(`checkpoint-${i}`, "checkpoint-idle", p);
      const label = new Text({
        text: String(i + 1),
        style: { fontFamily: "Geist, sans-serif", fontSize: 9, fontWeight: "900", fill: "#ffffff", stroke: { color: "#252b32", width: 2 } },
        x: p.x * 32 + 24,
        y: p.y * 32 + 3,
        resolution: 2,
      });
      this.modeLayer.addChild(label);
    }
    this.level.board.gates.forEach((p, i) => object(`gate-${i}`, "gate-open", p));
    for (const [i, post] of this.frame.modeState.posts.entries()) {
      object(post.id, "outpost", post);
      const label = new Text({
        text: String(i + 1),
        style: { fontFamily: "Geist, sans-serif", fontSize: 9, fontWeight: "900", fill: "#ffffff", stroke: { color: "#252b32", width: 2 } },
        x: post.x * 32 + 25,
        y: post.y * 32 + 3,
        resolution: 2,
      });
      this.postLabels.set(post.id, label);
      this.modeLayer.addChild(label);
    }
    this.frame.modeState.dangerAt.forEach((at, c) => {
      if (!at) return;
      const p = { x: c % this.level.board.width, y: Math.floor(c / this.level.board.width) };
      object(`hazard-${c}`, "hazard-warning", p);
    });
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
        view.gem.texture = this.shared.textures[this.gemTexture(g)];
        view.pickup.visible = !this.reduced && this.clock < view.until;
      }
    });
  }
  setPlayback(playing: boolean) {
    this.playing = playing;
  }
  setFocus(id: string) {
    if (this.focusedApplied && id === this.focused) return;
    this.focusedApplied = true;
    this.focused = id;
    const actor = this.actors.get(id);
    if (actor) this.world.setChildIndex(actor.container, this.world.children.length - 1);
    this.drawOverlay();
    this.drawMode();
  }
  setFrame(frame: MatchFrame) {
    const previous = this.frame;
    this.frame = frame;
    if (!this.initialized || this.disposed) return;
    if (this.renderedFrame === frame) return;
    this.renderedFrame = frame;
    frame.terrain.forEach((name, i) => {
      this.tiles[i].texture = this.terrain.textures[this.gateCells.has(i) ? "path" : name];
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
        const cargo = new Sprite({ texture: this.shared.textures.parcel, x: 21, y: 15, width: 12, height: 12, visible: false });
        const badge = new Graphics().circle(25, 7, 6).fill(0xffffff).stroke({ color: BOT_COLORS[i], width: 2 });
        const label = new Text({ text: String(i + 1), style: { fontFamily: "Geist, sans-serif", fontSize: 8, fontWeight: "900", fill: "#000000" }, x: 25, y: 7, resolution: 2 });
        label.anchor.set(0.5);
        container.addChild(ring, sprite, cargo, badge, label);
        this.world.addChild(container);
        view = { container, sprite, cargo, x, y };
        this.actors.set(bot.id, view);
      }
      view.x = x;
      view.y = y;
      view.cargo.visible = bot.inventory > 0;
      view.container.alpha = bot.eliminatedTick === null ? 1 : 0.35;
      view.sprite.tint = bot.eliminatedTick === null ? 0xffffff : 0x8d8d8d;
      if (!this.playing || this.reduced) view.container.position.set(x, y);
    });
    for (const g of frame.gems) {
      const view = this.gems.get(g.id);
      if (!view) continue;
      const active = gemActive(g, frame.tick),
        pending = gemPending(g, frame.tick);
      view.gem.visible = active || pending;
      view.gem.alpha = pending ? 0.5 : 1;
      view.gem.texture = this.shared.textures[this.gemTexture(g)];
      view.label.visible = active && (g.value ?? 1) > 1;
      const bucket = active && g.expireTick != null ? Math.ceil((g.expireTick - frame.tick) / 20) : null;
      if (bucket !== view.bucket) {
        view.bucket = bucket;
        view.life.clear();
        if (bucket !== null) {
          const fraction = (g.expireTick! - frame.tick) / (g.expireTick! - (g.spawnTick ?? 0));
          view.life.rect(g.x * 32 + 4, g.y * 32 + 29, 24, 2).fill({ color: "#252b32", alpha: 0.6 });
          view.life.rect(g.x * 32 + 4, g.y * 32 + 29, Math.max(1, Math.round(24 * fraction)), 2).fill(bucket < 3 ? "#df6650" : "#ffdc67");
        }
      }
      if (g.taken && previous.gems.find((p) => p.id === g.id)?.taken === false && this.playing) view.until = this.clock + 300;
      if (!g.taken || g.expired) {
        view.until = 0;
        view.pickup.visible = false;
      }
    }
    this.drawOverlay();
    this.drawMode();
  }
  private gemTexture(g: MatchFrame["gems"][number]) {
    if (gemPending(g, this.frame.tick)) return "gem-dormant";
    if ((g.value ?? 1) >= 5) return "gem-red";
    if ((g.value ?? 1) >= 3) return "gem-blue";
    if (feverMultiplier(this.level, this.frame.tick) === 2) return "gem-fever";
    return `gem-${!this.reduced && this.playing ? Math.floor(this.clock / 600) % 2 : 0}`;
  }
  private drawMode() {
    if (!this.initialized || this.disposed) return;
    const { modeState: state, bots, tick } = this.frame,
      width = this.level.board.width;
    const observed = bots.find((b) => b.id === this.focused) ?? bots[0];
    const nextWave = this.level.waves.find((w) => w.tick > tick)?.tick;
    // Ownership and hazards change on rule events. Rebuilding their geometry
    // for every playback frame costs much more than moving the sprites.
    const signature = `${observed.id}:${observed.keys.join(",")}:${observed.checkpoints.join(",")}:${this.level.board.gates.map((g) => this.frame.terrain[g.y * width + g.x]).join(",")}:${nextWave ?? 0}:${state.territory.join(",")}:${state.parcels.map((p) => p.state).join(",")}:${state.posts.map((p) => `${p.owner}:${p.captureTicks}:${p.contested}`).join(",")}`;
    if (signature === this.modeSignature) return;
    this.modeSignature = signature;
    this.ownership.clear();
    this.level.board.checkpoints.forEach((_, i) => {
      this.modeSprites.get(`checkpoint-${i}`)!.texture = this.shared.textures[observed.checkpoints.includes(i) ? "checkpoint-done" : "checkpoint-idle"];
    });
    this.level.board.gates.forEach((p, i) => {
      this.modeSprites.get(`gate-${i}`)!.texture = this.shared.textures[isWalkable(this.frame.terrain[p.y * width + p.x]) ? "gate-open" : "gate-closed"];
    });
    state.territory.forEach((id, c) => {
      const index = bots.findIndex((b) => b.id === id);
      if (index < 0) return;
      const x = (c % width) * 32,
        y = Math.floor(c / width) * 32;
      this.ownership
        .rect(x + 1, y + 1, 30, 30)
        .fill({ color: BOT_COLORS[index], alpha: 0.32 })
        .stroke({ color: BOT_COLORS[index], width: 2 });
      // Corner marks encode the owner number as well as the color.
      for (let n = 0; n <= index; n++) this.ownership.rect(x + 4 + n * 4, y + 25, 2, 3).fill(0xffffff);
    });
    for (const parcel of state.parcels) this.modeSprites.get(parcel.id)!.visible = parcel.state === "available";
    for (const key of this.level.board.keys) this.modeSprites.get(`key-${key.color}`)!.visible = !observed.keys.includes(key.color);
    this.level.board.doors.forEach((door, i) => {
      this.modeSprites.get(`door-${i}`)!.texture = this.shared.textures[observed.keys.includes(door.color) ? "door-open" : `door-${door.color}`];
    });
    for (const post of state.posts) {
      const sprite = this.modeSprites.get(post.id)!,
        owner = bots.findIndex((b) => b.id === post.owner);
      sprite.tint = owner < 0 ? 0xffffff : BOT_COLORS[owner];
      const x = post.x * 32,
        y = post.y * 32;
      this.ownership.rect(x + 2, y + 2, 28, 28).stroke({ color: post.contested ? "#f9b233" : owner < 0 ? "#ffffff" : BOT_COLORS[owner], width: 2 });
      if (post.captureTicks) this.ownership.rect(x + 3, y + 28, (26 * post.captureTicks) / 8, 3).fill("#ffdd67");
    }
    state.dangerAt.forEach((at, c) => {
      if (!at) return;
      const sprite = this.modeSprites.get(`hazard-${c}`)!;
      const active = at <= tick;
      sprite.visible = active || at === nextWave;
      sprite.texture = this.shared.textures[active ? "hazard-active" : "hazard-warning"];
      sprite.alpha = active ? 0.85 : 0.65;
      if (active) this.ownership.rect((c % width) * 32, Math.floor(c / width) * 32, 32, 32).fill({ color: "#b64b23", alpha: 0.35 });
    });
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
