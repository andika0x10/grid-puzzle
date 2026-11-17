import { Application, Assets, Container, Graphics, GraphicsContext, Sprite, type Spritesheet } from "pixi.js";
import { BOT_COLORS } from "./algorithms";
import type { MatchFrame } from "./engine";
import type { LevelDefinition } from "./schema";
import { cellOf } from "./modes";
import { extraTokens, guardCells } from "./extra-modes";
type Glyph = "target" | "switch" | "terminal" | "charger" | "beacon" | "supply" | "bridge" | "dock" | "box" | "bomb" | "fruit" | "portal" | "guard" | "bush" | "intel";
const ink = 0x26343b,
  cream = 0xfff2ca;
export class BoardRenderer {
  private app = new Application();
  private world = new Container();
  private objects = new Container();
  private actorsLayer = new Container();
  private overlay = new Graphics();
  private effects = new Graphics();
  private fog = new Graphics();
  private routes = new Graphics();
  private contexts = new Map<Glyph, GraphicsContext>();
  private objectViews = new Map<string, Graphics>();
  private actors = new Map<string, { container: Container; sprite: Sprite; ring: Graphics; x: number; y: number }>();
  private tiles: Sprite[] = [];
  private terrain!: Spritesheet;
  private character!: Spritesheet;
  private shared!: Spritesheet;
  private goalView: Sprite | null = null;
  private observer: ResizeObserver | null = null;
  private promise: Promise<void>;
  private disposed = false;
  private initialized = false;
  private playing = false;
  private focused = "bot-0";
  private clock = 0;
  private signature = "";
  constructor(
    private host: HTMLElement,
    private level: LevelDefinition,
    private frame: MatchFrame,
    private reduced: boolean
  ) {
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
    for (const sheet of [this.terrain, this.character, this.shared]) for (const t of Object.values(sheet.textures)) t.source.scaleMode = "nearest";
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
    this.app.ticker.maxFPS = this.reduced ? 30 : 60;
    this.app.stage.addChild(this.world);
    this.level.board.terrain.forEach((name, c) => {
      const tile = new Sprite({ texture: this.terrain.textures[name], x: (c % this.level.board.width) * 32, y: Math.floor(c / this.level.board.width) * 32 });
      this.tiles.push(tile);
      this.world.addChild(tile);
    });
    this.world.addChild(this.routes, this.overlay, this.objects, this.effects, this.actorsLayer, this.fog);
    for (const p of this.level.board.decorations) this.world.addChild(new Sprite({ texture: this.terrain.textures.decor, x: p.x * 32, y: p.y * 32 }));
    for (const spawn of this.level.board.spawns ?? [this.level.board.spawn])
      this.objects.addChild(new Sprite({ texture: this.shared.textures.start, x: spawn.x * 32, y: spawn.y * 32 }));
    if (this.level.board.goal) {
      const p = this.level.board.goal;
      this.goalView = new Sprite({ texture: this.shared.textures.finish, x: p.x * 32, y: p.y * 32 });
      this.world.addChild(this.goalView);
    }
    for (const [i, bot] of this.frame.bots.entries()) {
      const container = new Container(),
        sprite = new Sprite({ texture: this.character.textures["actor-up-idle-0"] }),
        ring = new Graphics().rect(3, 27, 26, 4).fill(BOT_COLORS[i]);
      container.addChild(ring, sprite);
      const number = new Graphics().rect(23, 0, 9, 10).fill(ink);
      this.number(number, i + 1, 25, 2, 0xffffff);
      container.addChild(number);
      container.position.set(bot.x * 32, bot.y * 32);
      this.actorsLayer.addChild(container);
      this.actors.set(bot.id, { container, sprite, ring, x: bot.x * 32, y: bot.y * 32 });
    }
    this.staticRoutes();
    const resize = () => {
      if (this.disposed) return;
      const width = Math.max(1, this.host.clientWidth),
        height = Math.max(1, this.host.clientHeight),
        bw = this.level.board.width * 32,
        bh = this.level.board.height * 32,
        scale = Math.max(0.1, Math.min((width - 16) / bw, (height - 16) / bh));
      this.app.renderer.resize(width, height);
      this.world.scale.set(scale);
      this.world.position.set(Math.round((width - bw * scale) / 2), Math.round((height - bh * scale) / 2));
      this.app.render();
    };
    this.observer = new ResizeObserver(resize);
    this.observer.observe(this.host);
    this.setFrame(this.frame);
    resize();
    this.app.ticker.add((ticker) => {
      if (this.disposed) return;
      if (this.playing) this.clock += ticker.deltaMS;
      for (const bot of this.frame.bots) {
        const actor = this.actors.get(bot.id)!;
        const blend = this.playing && !this.reduced ? Math.min(1, ticker.deltaMS / 45) : 1;
        actor.container.x += (actor.x - actor.container.x) * blend;
        actor.container.y += (actor.y - actor.container.y) * blend;
        const moving = this.playing && bot.status === "moving" && bot.action !== "wait" && !this.reduced,
          index = moving ? Math.floor(this.clock / 110) % 4 : 0;
        actor.sprite.texture = this.character.textures[`actor-${bot.facing}-${moving ? "walk" : "idle"}-${index}`];
      }
    });
  }
  private number(g: Graphics, n: number, x: number, y: number, color: number) {
    const patterns = [
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
    [...patterns[n % 10]].forEach((v, i) => {
      if (v === "1") g.rect(x + (i % 3), y + Math.floor(i / 3), 1, 1).fill(color);
    });
  }
  private context(kind: Glyph) {
    let g = this.contexts.get(kind);
    if (g) return g;
    g = new GraphicsContext();
    const border = (x: number, y: number, w: number, h: number, color: number) => g!.rect(x, y, w, h).fill(color).stroke({ color: ink, width: 2 });
    if (kind === "target") {
      border(8, 8, 16, 16, 0xffc340);
      g.rect(13, 3, 6, 26).fill(cream).rect(3, 13, 26, 6).fill(cream).rect(11, 11, 10, 10).fill(0xe95d43).rect(14, 14, 4, 4).fill(cream);
    }
    if (kind === "switch") {
      border(5, 7, 22, 20, 0x668c9a);
      g.rect(10, 12, 12, 10).fill(ink).rect(13, 7, 6, 12).fill(cream).rect(7, 24, 18, 2).fill(0xbee4df);
    }
    if (kind === "terminal") {
      border(5, 4, 22, 24, 0x668c9a);
      g.rect(8, 7, 16, 12).fill(0xc6f26d).rect(12, 22, 8, 3).fill(cream);
    }
    if (kind === "charger") {
      border(5, 5, 22, 24, 0x288b9e);
      g.rect(11, 2, 10, 4).fill(ink).poly([17, 8, 10, 18, 15, 18, 13, 25, 23, 14, 17, 14]).fill(0xffe88c);
    }
    if (kind === "beacon") {
      border(10, 7, 12, 19, 0xd1dfef);
      g.rect(8, 25, 16, 4).fill(ink).rect(13, 4, 6, 8).fill(0xffcf5b).rect(4, 6, 4, 2).fill(cream).rect(24, 6, 4, 2).fill(cream);
    }
    if (kind === "supply") {
      border(4, 10, 24, 17, 0xc99859);
      g.rect(6, 12, 20, 3).fill(0xf7d994).rect(9, 6, 4, 20).fill(0x825d39).rect(19, 6, 4, 20).fill(0x825d39);
    }
    if (kind === "bridge") {
      for (let y = 5; y < 29; y += 6) g.rect(3, y, 26, 4).fill({ color: 0xffd788, alpha: 0.7 });
      g.rect(4, 3, 2, 26).fill(ink).rect(26, 3, 2, 26).fill(ink);
    }
    if (kind === "dock") {
      g.rect(3, 3, 26, 26).fill(0x2d7f6d);
      for (let y = 5; y < 27; y += 6) for (let x = 5; x < 27; x += 6) if ((x + y) % 12 === 10) g.rect(x, y, 5, 5).fill(0xd8f5cf);
    }
    if (kind === "box") {
      border(3, 3, 26, 26, 0xd69a50);
      g.rect(7, 6, 18, 3).fill(0xffd08a).rect(7, 23, 18, 3).fill(0x966332).poly([7, 10, 10, 7, 25, 22, 22, 25]).fill(0x996635).poly([7, 22, 22, 7, 25, 10, 10, 25]).fill(0xffce80);
    }
    if (kind === "bomb") g.circle(16, 19, 10).fill(ink).rect(13, 5, 6, 7).fill(0x9d7347).poly([17, 6, 23, 2, 25, 7, 20, 10]).fill(0xffb52d).circle(12, 15, 2).fill(cream);
    if (kind === "fruit") g.circle(12, 19, 8).fill(0xf26a45).circle(20, 19, 8).fill(0xee7842).rect(15, 5, 3, 9).fill(ink).ellipse(22, 7, 7, 3).fill(0x67b84c);
    if (kind === "portal") g.ellipse(16, 16, 12, 14).fill(ink).ellipse(16, 16, 9, 11).fill(0x9e82e7).ellipse(16, 16, 5, 8).fill(0x383a78).rect(4, 28, 24, 3).fill(0xc9b8f1);
    if (kind === "guard")
      g.circle(16, 9, 7).fill(0xe1ad7d).rect(6, 4, 20, 5).fill(0x5c65a1).rect(8, 15, 16, 13).fill(0x5668a2).rect(10, 27, 5, 4).fill(ink).rect(19, 27, 5, 4).fill(ink);
    if (kind === "bush") g.circle(9, 21, 8).fill(0x347d4b).circle(21, 20, 9).fill(0x40864c).circle(15, 12, 9).fill(0x5caa58).rect(4, 26, 24, 4).fill(0x347d4b);
    if (kind === "intel")
      g.rect(6, 4, 20, 24).fill(cream).stroke({ color: ink, width: 2 }).rect(10, 9, 12, 3).fill(0xd36a52).rect(10, 16, 12, 2).fill(ink).rect(10, 21, 8, 2).fill(ink);
    this.contexts.set(kind, g);
    return g;
  }
  private view(id: string, kind: Glyph, cell: number, tint: string | number = 0xffffff, alpha = 1) {
    let g = this.objectViews.get(id);
    if (!g) {
      g = new Graphics(this.context(kind));
      this.objects.addChild(g);
      this.objectViews.set(id, g);
    }
    g.position.set((cell % this.level.board.width) * 32, Math.floor(cell / this.level.board.width) * 32);
    g.visible = true;
    g.tint = tint;
    g.alpha = alpha;
    return g;
  }
  private staticRoutes() {
    const l = this.level;
    this.routes.clear();
    if (l.mode === "hunt")
      l.hunt.targets.forEach((target, i) =>
        target.route.forEach((p, j) => {
          if (j % 2 === 0) this.routes.rect(p.x * 32 + 13, p.y * 32 + 13, 6, 6).fill({ color: [0xffd15f, 0x7be1eb, 0xdba3ee][i], alpha: 0.7 });
        })
      );
  }
  setPlayback(playing: boolean) {
    this.playing = playing;
  }
  setFocus(id: string) {
    if (id === this.focused) return;
    this.focused = id;
    this.signature = "";
    this.setFrame(this.frame);
  }
  setFrame(frame: MatchFrame) {
    this.frame = frame;
    if (!this.initialized || this.disposed) return;
    const focused = frame.bots.find((b) => b.id === this.focused) ?? frame.bots[0],
      l = this.level,
      width = l.board.width;
    frame.terrain.forEach((terrain, c) => {
      const known = l.mode === "fog" ? focused.known[c] : terrain;
      this.tiles[c].texture = this.terrain.textures[known ?? "ground"];
      this.tiles[c].alpha = l.mode === "fog" && !focused.visible.includes(c) ? 0.55 : 1;
    });
    for (const bot of frame.bots) {
      const actor = this.actors.get(bot.id)!;
      actor.x = bot.x * 32;
      actor.y = bot.y * 32;
      actor.container.alpha = bot.eliminatedTick !== null ? 0.35 : 1;
      actor.container.visible = l.mode !== "fog" || bot.id === focused.id || focused.visible.includes(cellOf(bot, width));
      actor.ring.alpha = bot.id === focused.id ? 1 : 0.5;
    }
    this.overlay.clear();
    const known = (c: number) => l.mode !== "fog" || !!focused.known[c],
      color = BOT_COLORS[frame.bots.findIndex((b) => b.id === focused.id)];
    for (const c of focused.visited) if (known(c)) this.overlay.rect((c % width) * 32 + 2, Math.floor(c / width) * 32 + 2, 28, 28).fill({ color, alpha: 0.18 });
    for (const c of focused.frontier) if (known(c)) this.overlay.rect((c % width) * 32 + 4, Math.floor(c / width) * 32 + 4, 24, 24).stroke({ color: 0xffdf69, width: 2 });
    for (let i = 1; i < focused.route.length; i++) {
      const a = focused.route[i - 1],
        b = focused.route[i];
      if (known(cellOf(a, width)) && known(cellOf(b, width)))
        this.overlay
          .moveTo(a.x * 32 + 16, a.y * 32 + 16)
          .lineTo(b.x * 32 + 16, b.y * 32 + 16)
          .stroke({ color, width: 3, alpha: 0.8 });
    }
    this.fog.clear();
    if (l.mode === "fog")
      focused.known.forEach((t, c) => {
        if (t === null) {
          this.fog.rect((c % width) * 32, Math.floor(c / width) * 32, 32, 32).fill(0x23343e);
          if (c % 3 === 0) this.fog.rect((c % width) * 32 + 14, Math.floor(c / width) * 32 + 14, 3, 3).fill(0x41545d);
        }
      });
    const signature = `${frame.tick}:${focused.id}`;
    if (signature !== this.signature) {
      this.signature = signature;
      this.drawMode();
    }
  }
  private drawMode() {
    for (const g of this.objectViews.values()) g.visible = false;
    this.effects.clear();
    const l = this.level,
      s = this.frame.modeState,
      w = l.board.width,
      owner = (id: string | null) => {
        const i = this.frame.bots.findIndex((b) => b.id === id);
        return i < 0 ? 0xffffff : BOT_COLORS[i];
      };
    if (this.goalView) this.goalView.tint = s.mode === "bridge" && !s.owners.every(Boolean) ? 0x87949c : 0xffffff;
    if (l.mode === "collapse" && s.mode === "collapse")
      s.dangerAt.forEach((at, c) => {
        const remaining = at - this.frame.tick;
        if (remaining > 0 && remaining <= 80) {
          const x = (c % w) * 32,
            y = Math.floor(c / w) * 32;
          this.effects
            .moveTo(x + 8, y + 4)
            .lineTo(x + 18, y + 13)
            .lineTo(x + 12, y + 23)
            .lineTo(x + 23, y + 28)
            .stroke({ color: remaining <= 24 ? 0xea6946 : 0xffd45f, width: 3 });
          this.effects.rect(x + 3, y + 29, Math.max(1, (26 * remaining) / 80), 2).fill(0xffd45f);
        }
      });
    if (l.mode === "hunt" && s.mode === "hunt")
      s.targets.forEach((t, i) => {
        this.view(`target:${i}`, "target", t.cell, [0xffffff, 0x80d7e5, 0xd6a2ee][i], t.active ? 1 : 0.25);
      });
    if (l.mode === "circuit" && s.mode === "circuit") {
      l.circuit.switches.forEach((p, i) => {
        const c = cellOf(p, w);
        this.view(`switch:${i}`, "switch", c, s.mask & (1 << i) ? 0x9ce4a0 : 0xffffff);
        this.number(this.effects, i + 1, p.x * 32 + 25, p.y * 32 + 3, 0xffffff);
        for (const gate of l.circuit.switches[i].gates) {
          const x = gate.x * 32,
            y = gate.y * 32;
          this.effects.rect(x + 4, y + 4, 24, 24).stroke({ color: s.mask & (1 << i) ? 0x9fe176 : 0xed9f50, width: 3 });
        }
      });
      const contract = l.circuit.contracts[s.contract];
      if (contract) {
        const cell = cellOf(contract, w),
          powered = s.mask === contract.mask;
        this.view("terminal", "terminal", cell, powered ? 0x9fef80 : 0x93a0a6);
        l.circuit.switches.forEach((p, i) => {
          const need = !!(contract.mask & (1 << i)),
            on = !!(s.mask & (1 << i));
          this.effects.rect(p.x * 32 + 7, p.y * 32 + 29, 18, 2).fill(need === on ? 0x9fe176 : 0xe77550);
        });
      }
    }
    if (l.mode === "energy" && s.mode === "energy") {
      s.chargers.forEach((c, i) => {
        this.view(`charger:${i}`, "charger", c.cell);
        this.effects.rect((c.cell % w) * 32 + 5, Math.floor(c.cell / w) * 32 + 29, (22 * c.stock) / 40, 2).fill(0x8ce5ed);
      });
      l.energy.beacons.forEach((p, i) => this.view(`beacon:${i}`, "beacon", cellOf(p, w), owner(s.owners[i]), s.owners[i] ? 0.55 : 1));
    }
    if (l.mode === "bridge" && s.mode === "bridge") {
      l.bridge.supplies.forEach((p, i) => this.view(`supply:${i}`, "supply", cellOf(p, w), 0xffffff, s.suppliesReady[i] > this.frame.tick ? 0.25 : 1));
      l.bridge.spans.forEach((span, i) => {
        if (!(s.builtMask & (1 << i)))
          for (const p of span.cells) {
            this.view(`span:${cellOf(p, w)}`, "bridge", cellOf(p, w), 0xffffff, 0.7);
            this.number(this.effects, i + 1, p.x * 32 + 14, p.y * 32 + 13, ink);
          }
      });
      l.bridge.markers.forEach((p, i) => this.view(`marker:${i}`, "beacon", cellOf(p, w), owner(s.owners[i]), s.owners[i] ? 0.5 : 1));
    }
    if (l.mode === "crates" && s.mode === "crates") {
      l.crates.docks.forEach((p, i) => this.view(`dock:${i}`, "dock", cellOf(p, w)));
      s.boxes.forEach((b) => this.view(`box:${b.id}`, "box", b.cell, owner(b.owner)));
    }
    extraTokens(l).forEach((p, i) => {
      const id = "owners" in s ? s.owners[i] : null;
      const ready = s.mode !== "snake" || s.ready[i] <= this.frame.tick;
      this.view(`token:${i}`, l.mode === "snake" ? "fruit" : l.mode === "stealth" ? "intel" : "target", cellOf(p, w), owner(id), id || !ready ? 0.28 : 1);
    });
    if (s.mode === "bomb") {
      for (const c of s.wood) this.view(`wood:${c}`, "box", c);
      for (const bomb of s.bombs) {
        this.view(`bomb:${bomb.cell}`, "bomb", bomb.cell, owner(bomb.owner));
        const x = (bomb.cell % w) * 32,
          y = Math.floor(bomb.cell / w) * 32;
        this.effects.rect(x + 3, y + 29, Math.max(1, (26 * (bomb.at - this.frame.tick)) / 36), 2).fill(0xffcf58);
      }
      for (const f of s.flames) this.effects.rect((f.cell % w) * 32 + 2, Math.floor(f.cell / w) * 32 + 2, 28, 28).fill({ color: 0xff9c35, alpha: 0.9 });
    }
    if (s.mode === "snake")
      for (const [id, tail] of Object.entries(s.tails))
        for (const [i, c] of tail.entries())
          this.effects.roundRect((c % w) * 32 + 5, Math.floor(c / w) * 32 + 5, 22, 22, 5).fill({ color: owner(id), alpha: Math.max(0.35, 0.9 - i * 0.05) });
    if (l.mode === "flow") {
      for (const p of l.flow.ice)
        this.effects
          .rect(p.x * 32 + 2, p.y * 32 + 2, 28, 28)
          .fill({ color: 0xa5edf4, alpha: 0.65 })
          .moveTo(p.x * 32 + 6, p.y * 32 + 24)
          .lineTo(p.x * 32 + 23, p.y * 32 + 7)
          .stroke({ color: 0xffffff, width: 2 });
      for (const p of l.flow.currents) {
        const x = p.x * 32 + 16,
          y = p.y * 32 + 16,
          dx = p.dx * 9,
          dy = p.dy * 9;
        this.effects
          .moveTo(x - dx, y - dy)
          .lineTo(x + dx, y + dy)
          .stroke({ color: 0x16839b, width: 4 })
          .poly([x + dx, y + dy, x + dy * 0.7, y - dx * 0.7, x - dy * 0.7, y + dx * 0.7])
          .fill(0x16839b);
        this.number(this.effects, p.distance, p.x * 32 + 25, p.y * 32 + 2, ink);
      }
    }
    if (l.mode === "portal" && s.mode === "portal")
      l.portal.pads.forEach((p, i) => {
        this.view(`portal:${i}`, "portal", cellOf(p, w));
        this.number(this.effects, i + 1, p.x * 32 + 3, p.y * 32 + 2, cream);
        this.number(this.effects, ((i + 1 + (s.phase % (l.portal.pads.length - 1))) % l.portal.pads.length) + 1, p.x * 32 + 14, p.y * 32 + 13, 0xffffff);
      });
    if (s.mode === "tactical")
      for (const wall of s.walls)
        this.effects
          .rect((wall.cell % w) * 32 + 3, Math.floor(wall.cell / w) * 32 + 3, 26, 26)
          .fill(owner(wall.owner))
          .stroke({ color: ink, width: 2 });
    if (l.mode === "stealth" && s.mode === "stealth") {
      for (const c of guardCells(l, this.frame)) this.effects.rect((c % w) * 32 + 1, Math.floor(c / w) * 32 + 1, 30, 30).fill({ color: 0xf2aa4c, alpha: 0.35 });
      l.stealth.bushes.forEach((p, i) => this.view(`bush:${i}`, "bush", cellOf(p, w)));
      l.stealth.guards.forEach((g, i) => this.view(`guard:${i}`, "guard", cellOf(g.route[s.guards[i].index], w), 0xffffff, s.guards[i].stunnedUntil > this.frame.tick ? 0.4 : 1));
      for (const b of this.frame.bots) if (s.alert[b.id]) this.effects.rect(b.x * 32 + 3, b.y * 32, 26 * Math.min(1, s.alert[b.id] / 20), 3).fill(0xef7651);
    }
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer?.disconnect();
    void this.promise
      .catch(() => {})
      .then(() => {
        if (this.initialized) {
          for (const graphic of [this.overlay, this.effects, this.fog, this.routes]) graphic.destroy();
          for (const actor of this.actors.values()) for (const child of [...actor.container.children]) if (child instanceof Graphics) child.destroy();
          this.app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
          this.initialized = false;
        }
        for (const context of this.contexts.values()) context.destroy();
        this.contexts.clear();
      });
  }
}
