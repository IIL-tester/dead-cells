import { AssetLoader } from "./AssetLoader";
import { AudioEngine } from "./Audio";
import { Camera } from "./Camera";
import { InputManager } from "./Input";
import { CdbStore, TierId } from "../data/cdbLoader";
import { FloatingNumber, Projectile, scaleDamageByScroll } from "../combat/Combat";
import { Player } from "../entities/Player";
import { Enemy } from "../entities/Enemy";
import { updateEnemyAI } from "../ai/EnemyAI";
import { generateBiomeLevel, GeneratedLevel, Interactable, TILE_SIZE, TileType } from "../world/LevelGen";
import { HUD } from "../ui/HUD";

type ScreenMode = "loading" | "title" | "playing" | "scroll_pick" | "victory" | "gameover";

export class Game {
  private ctx: CanvasRenderingContext2D;
  private assets = new AssetLoader();
  private audio = new AudioEngine();
  private cdb = new CdbStore();
  private input: InputManager;
  private camera = new Camera();
  private hud = new HUD();

  private mode: ScreenMode = "loading";
  private loadPct = 0;
  private viewW = 960;
  private viewH = 540;
  private dpr = 1;

  private level!: GeneratedLevel;
  private player!: Player;
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private floatingNums: FloatingNumber[] = [];
  private hitStopTimer = 0;
  private pendingScroll: Interactable | null = null;
  private showFullMap = false;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.input = new InputManager(canvas, () => this.audio.unlock());
    this.handleResize();
    window.addEventListener("resize", () => this.handleResize());
  }

  private handleResize(): void {
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    this.canvas.width = Math.floor(cssW * this.dpr);
    this.canvas.height = Math.floor(cssH * this.dpr);
    // Authentic zoomed-in Dead Cells pixel-art framing (~2.5x-3x)
    const zoom = Math.max(2, Math.min(3, Math.round(cssH / 280)));
    this.viewW = Math.floor(cssW / zoom);
    this.viewH = Math.floor(cssH / zoom);
    this.ctx.imageSmoothingEnabled = false;
  }

  async start(): Promise<void> {
    this.loop(performance.now());
    await Promise.all([
      this.cdb.load(),
      this.assets.loadAll((p) => {
        this.loadPct = p;
      }),
      this.audio.preload(),
    ]);
    this.mode = "title";
  }

  private startNewRun(biomeId = "PrisonStart", biomeName = "Prisoners' Quarters"): void {
    this.player = new Player(this.cdb);
    this.bindPlayerCallbacks();
    this.loadBiome(biomeId, biomeName);
    this.mode = "playing";
  }

  private loadBiome(biomeId: string, biomeName: string): void {
    this.level = generateBiomeLevel(biomeId, biomeName);
    this.player.body.x = this.level.spawnX;
    this.player.body.y = this.level.spawnY;
    this.player.body.vx = 0;
    this.player.body.vy = 0;
    this.projectiles = [];
    this.floatingNums = [];
    this.enemies = [];

    for (const sp of this.level.spawns) {
      const mobCdb = this.cdb.mobsById.get(sp.mobId) ?? this.cdb.raw.mob[0];
      if (!mobCdb) continue;
      this.enemies.push(new Enemy(sp.mobId, mobCdb, sp.x, sp.y, sp.elite, Boolean(sp.boss)));
    }
  }

  private bindPlayerCallbacks(): void {
    this.player.onDiveImpact = (x, y) => {
      this.camera.shake(6, 0.18);
      for (const e of this.enemies) {
        if (Math.hypot(e.body.x - x, e.body.y - y) < 76) {
          const dmg = scaleDamageByScroll(42, this.player.brutality);
          this.damageEnemy(e, dmg, 65, true);
        }
      }
    };
    this.player.onSkillCast = (_slot, item) => {
      const dmg = scaleDamageByScroll(55, this.player.getTierCount(item.tier), item.level);
      this.projectiles.push({
        x: this.player.body.x + this.player.facing * 12,
        y: this.player.body.y - 24,
        vx: this.player.facing * 290,
        vy: item.id.includes("Grenade") ? -170 : 0,
        fromPlayer: true,
        damage: dmg,
        breach: 45,
        color: item.id.includes("Fire") ? "#fb923c" : "#facc15",
        life: 1.6,
        status: item.id.includes("Fire") ? "burn" : "bleed",
        radius: 6,
      });
      this.audio.play("swingShort", 0.35);
    };
  }

  private damageEnemy(e: Enemy, dmg: number, breach: number, crit: boolean): void {
    const res = e.takeDamage(dmg, breach);
    this.player.healFromHit(dmg);
    this.floatingNums.push({
      x: e.body.x,
      y: e.body.y - e.body.height - 6,
      vy: -55,
      text: crit ? `${dmg}!` : `${dmg}`,
      color: res.breached ? "#ffe066" : crit ? "#ff9f1c" : "#ffffff",
      life: 0.75,
      crit,
    });
    this.audio.play("hitBlade", 0.35);
    this.hitStopTimer = crit ? 0.045 : 0.025;
    this.camera.shake(crit ? 4.5 : 2.2, 0.1);

    if (e.hp <= 0) {
      this.player.kills++;
      this.player.speedComboKills++;
      this.player.speedComboTimer = 10;
      const cells = e.isBoss ? 25 : e.elite ? 5 : Math.random() < 0.45 ? 1 : 0;
      const gold = e.isBoss ? 500 : e.elite ? 120 : 25;
      this.player.cells += cells;
      this.player.gold += gold;
      this.audio.play("dropGold", 0.3);
      if (e.isBoss) {
        this.mode = "victory";
      }
    }
  }

  private loop = (now: number): void => {
    const prev = (this as unknown as { _last?: number })._last ?? now;
    (this as unknown as { _last?: number })._last = now;
    const frameDt = Math.min(0.05, (now - prev) / 1000);

    let acc = ((this as unknown as { _acc?: number })._acc ?? 0) + frameDt;
    const STEP = 1 / 60;
    while (acc >= STEP) {
      this.fixedUpdate(STEP);
      this.input.tick(STEP);
      acc -= STEP;
    }
    (this as unknown as { _acc?: number })._acc = acc;

    this.render();
    requestAnimationFrame(this.loop);
  };

  private fixedUpdate(dt: number): void {
    if (this.mode === "title") {
      if (this.input.consume("jump") || this.input.consume("primary") || this.input.consume("interact")) {
        this.startNewRun();
      }
      return;
    }
    if (this.mode === "victory" || this.mode === "gameover") {
      if (this.input.consume("interact") || this.input.consume("jump")) {
        this.startNewRun();
      }
      return;
    }
    if (this.mode === "scroll_pick") {
      if (this.input.consume("skill1")) this.applyScroll("Brutality");
      else if (this.input.consume("skill2")) this.applyScroll("Tactic");
      else if (this.input.consume("heal")) this.applyScroll("Survival");
      return;
    }
    if (this.mode !== "playing") return;

    if (this.input.consume("map")) this.showFullMap = !this.showFullMap;

    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
      return;
    }

    this.player.update(dt, this.input, this.level, this.audio);

    // Reveal room player is standing in
    const ptx = Math.floor(this.player.body.x / TILE_SIZE);
    for (const r of this.level.rooms) {
      if (ptx >= r.tx && ptx < r.tx + r.tw) r.revealed = true;
    }

    // Player melee hitbox collision
    if (this.player.pendingHitbox) {
      const hb = this.player.pendingHitbox;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        if (
          hb.x < e.body.x + e.body.halfW &&
          hb.x + hb.w > e.body.x - e.body.halfW &&
          hb.y < e.body.y &&
          hb.y + hb.h > e.body.y - e.body.height
        ) {
          this.damageEnemy(e, hb.damage, hb.breach, hb.crit);
        }
      }
    }

    // Update enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.hp <= 0) {
        this.enemies.splice(i, 1);
        continue;
      }
      updateEnemyAI(e, this.player, this.level, dt, this.audio, (mob, dmg, col) => {
        this.floatingNums.push({ x: mob.body.x, y: mob.body.y - 36, vy: -35, text: `${dmg}`, color: col, life: 0.5, crit: false });
      });

      if (e.pendingAttack) {
        const atk = e.pendingAttack;
        if (atk.kind === "ranged") {
          const dir = this.player.body.x >= e.body.x ? 1 : -1;
          this.projectiles.push({
            x: atk.x,
            y: atk.y,
            vx: dir * 240,
            vy: 0,
            fromPlayer: false,
            damage: atk.dmg,
            breach: 0,
            color: "#ff595e",
            life: 2.0,
            radius: 4,
          });
        } else if (
          atk.x < this.player.body.x + this.player.body.halfW &&
          atk.x + atk.w > this.player.body.x - this.player.body.halfW &&
          atk.y < this.player.body.y &&
          atk.y + atk.h > this.player.body.y - this.player.body.height
        ) {
          if (this.player.parryTimer > 0 && atk.kind === "melee") {
            this.audio.play("parry", 0.5);
            this.damageEnemy(e, scaleDamageByScroll(35, this.player.survival), 100, true);
          } else if (this.player.takeDamage(atk.dmg, this.audio)) {
            this.camera.shake(4, 0.14);
            this.floatingNums.push({ x: this.player.body.x, y: this.player.body.y - 42, vy: -45, text: `-${atk.dmg}`, color: "#ff4d6d", life: 0.7, crit: false });
            if (this.player.hp <= 0) this.mode = "gameover";
          }
        }
      }
    }

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.vy !== 0) p.vy += 450 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const tx = Math.floor(p.x / TILE_SIZE);
      const ty = Math.floor(p.y / TILE_SIZE);
      const hitWall =
        tx < 0 || ty < 0 || tx >= this.level.tw || ty >= this.level.th || this.level.tiles[ty * this.level.tw + tx] === TileType.Solid;

      let remove = p.life <= 0 || hitWall;
      if (!remove && p.fromPlayer) {
        for (const e of this.enemies) {
          if (
            p.x > e.body.x - e.body.halfW &&
            p.x < e.body.x + e.body.halfW &&
            p.y > e.body.y - e.body.height &&
            p.y < e.body.y
          ) {
            if (p.status) e.applyStatus(p.status);
            this.damageEnemy(e, p.damage, p.breach, false);
            remove = true;
            break;
          }
        }
      } else if (!remove && !p.fromPlayer) {
        if (
          p.x > this.player.body.x - this.player.body.halfW &&
          p.x < this.player.body.x + this.player.body.halfW &&
          p.y > this.player.body.y - this.player.body.height &&
          p.y < this.player.body.y
        ) {
          if (this.player.parryTimer > 0) {
            p.fromPlayer = true;
            p.vx = -p.vx * 1.4;
            p.damage *= 2;
            p.color = "#ffe066";
            this.audio.play("parry", 0.5);
          } else {
            if (this.player.takeDamage(p.damage, this.audio)) {
              this.camera.shake(3.5, 0.12);
              if (this.player.hp <= 0) this.mode = "gameover";
            }
            remove = true;
          }
        }
      }
      if (remove) this.projectiles.splice(i, 1);
    }

    // Interactables
    const nearby = this.findNearbyInteractable();
    if (nearby && this.input.consume("interact")) {
      this.handleInteract(nearby);
    }

    // Floating damage numbers
    for (let i = this.floatingNums.length - 1; i >= 0; i--) {
      const fn = this.floatingNums[i];
      fn.y += fn.vy * dt;
      fn.life -= dt;
      if (fn.life <= 0) this.floatingNums.splice(i, 1);
    }

    this.camera.update(
      dt,
      this.player.body.x,
      this.player.body.y - 20,
      this.player.facing,
      this.input.isDown("up"),
      this.input.isDown("down"),
      this.viewW,
      this.viewH,
      this.level.tw * TILE_SIZE,
      this.level.th * TILE_SIZE
    );
  }

  private findNearbyInteractable(): Interactable | null {
    for (const it of this.level.interactables) {
      if (it.used && it.kind !== "Teleporter") continue;
      if (Math.hypot(it.x - this.player.body.x, it.y - this.player.body.y) < 38) {
        return it;
      }
    }
    return null;
  }

  private handleInteract(it: Interactable): void {
    if (it.kind === "Scroll") {
      this.pendingScroll = it;
      this.mode = "scroll_pick";
      return;
    }
    if (it.kind === "Chest") {
      it.used = true;
      this.audio.play("chest", 0.45);
      this.player.gold += 250;
      if (it.itemId) this.equipWeaponFromId(it.itemId);
      return;
    }
    if (it.kind === "ShopItem" && it.cost && this.player.gold >= it.cost) {
      this.player.gold -= it.cost;
      it.used = true;
      this.audio.play("dropGold", 0.4);
      if (it.itemId) this.equipWeaponFromId(it.itemId);
      return;
    }
    if (it.kind === "HealingFood" && it.cost && this.player.gold >= it.cost) {
      this.player.gold -= it.cost;
      it.used = true;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + Math.round(this.player.maxHp * 0.5));
      this.audio.play("heal", 0.45);
      return;
    }
    if (it.kind === "Teleporter" && it.targetX !== undefined && it.targetY !== undefined) {
      this.player.body.x = it.targetX;
      this.player.body.y = it.targetY;
      this.audio.play("teleport", 0.4);
      return;
    }
    if (it.kind === "ExitDoor") {
      this.audio.play("door", 0.45);
      this.loadBiome("Bridge", "Black Bridge");
    }
  }

  private equipWeaponFromId(itemId: string): void {
    const item = this.cdb.itemsById.get(itemId);
    if (!item) return;
    const isShield = item.tags.includes("Shield");
    const slotIdx = isShield ? 1 : 0;
    this.player.slots[slotIdx] = {
      id: item.id,
      name: item.name,
      tier: item.tier1 ?? "Brutality",
      level: this.level.biomeId === "Bridge" ? 4 : 2,
      kind: isShield ? "shield" : "weapon",
      cdMax: item.castCD || 0,
      cdLeft: 0,
    };
  }

  private applyScroll(tier: TierId): void {
    if (tier === "Brutality") this.player.brutality++;
    else if (tier === "Tactic") this.player.tactics++;
    else this.player.survival++;
    this.player.recalcStats(false);
    if (this.pendingScroll) this.pendingScroll.used = true;
    this.pendingScroll = null;
    this.mode = "playing";
    this.audio.play("absorb", 0.45);
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.canvas.width / this.viewW, this.canvas.height / this.viewH);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = "#0e0c16";
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    if (this.mode === "loading") {
      ctx.fillStyle = "#e2dcf0";
      ctx.font = "bold 16px monospace";
      ctx.fillText(`Loading Dead Cells Assets... ${Math.round(this.loadPct * 100)}%`, this.viewW / 2 - 170, this.viewH / 2);
      ctx.restore();
      return;
    }

    if (this.mode === "title") {
      this.renderTitle(ctx);
      ctx.restore();
      return;
    }

    // World Space
    const { ox, oy } = this.camera.getOffset();
    ctx.save();
    ctx.translate(-ox, -oy);

    this.renderWorld(ctx, ox, oy);
    for (const it of this.level.interactables) this.renderInteractable(ctx, it);
    for (const e of this.enemies) e.render(ctx, this.assets);
    this.player.render(ctx, this.assets);

    for (const p of this.projectiles) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const fn of this.floatingNums) {
      this.assets.drawPixelText(ctx, fn.text, Math.round(fn.x - 8), Math.round(fn.y), fn.color, fn.crit ? 1.25 : 1);
    }

    this.renderLighting(ctx, ox, oy);
    ctx.restore();

    // Subtle atmospheric vignette
    const vig = ctx.createRadialGradient(
      this.viewW * 0.5,
      this.viewH * 0.5,
      this.viewH * 0.35,
      this.viewW * 0.5,
      this.viewH * 0.5,
      this.viewW * 0.72
    );
    vig.addColorStop(0, "rgba(0, 0, 0, 0)");
    vig.addColorStop(1, "rgba(4, 4, 10, 0.45)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // Screen-space HUD
    this.hud.render(ctx, this.viewW, this.viewH, this.player, this.level, this.enemies, this.assets, this.cdb, this.findNearbyInteractable(), this.showFullMap);

    if (this.mode === "scroll_pick") this.renderScrollModal(ctx);
    if (this.mode === "victory" || this.mode === "gameover") this.renderEndModal(ctx);

    ctx.restore();
  }

  private tileHash(tx: number, ty: number): number {
    return Math.abs((tx * 73856093) ^ (ty * 19349663)) >>> 0;
  }

  private renderWorld(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    const startTx = Math.max(0, Math.floor(ox / TILE_SIZE));
    const endTx = Math.min(this.level.tw - 1, Math.ceil((ox + this.viewW) / TILE_SIZE));
    const startTy = Math.max(0, Math.floor(oy / TILE_SIZE));
    const endTy = Math.min(this.level.th - 1, Math.ceil((oy + this.viewH) / TILE_SIZE));

    const isBridge = this.level.biomeId === "Bridge";

    if (isBridge) {
      this.assets.drawSprite(ctx, "bridge", "skyGradient", 0, ox, oy, this.viewW, this.viewH);
      this.assets.drawSprite(ctx, "bridge", "moon", 0, ox + this.viewW * 0.65 - ox * 0.05, oy + 14);
      for (let bx = Math.floor((ox * 0.4) / 624) * 624; bx < ox + this.viewW + 624; bx += 624) {
        this.assets.drawSprite(ctx, "bridge", "bridgeArchs", 0, bx - ox * 0.4 + ox, oy + this.viewH - 340);
      }
    } else {
      // Deep atmospheric prison stone/fog gradient behind multi-layer parallax
      const bgGrad = ctx.createLinearGradient(0, oy, 0, oy + this.viewH);
      bgGrad.addColorStop(0, "#121728");
      bgGrad.addColorStop(0.55, "#191b2e");
      bgGrad.addColorStop(1, "#0b0c14");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(ox, oy, this.viewW, this.viewH);

      const drawParallax = (key: string, factor: number, yOff: number, alpha: number) => {
        const img = this.assets.images.get(key);
        const sz = this.assets.imageSizes.get(key);
        if (!img || !sz) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        const scrollX = -((ox * factor) % sz.w);
        for (let x = ox + scrollX - sz.w; x < ox + this.viewW; x += sz.w) {
          ctx.drawImage(img, Math.round(x), Math.round(oy + yOff));
        }
        ctx.restore();
      };
      drawParallax("prisonStartScrollerA", 0.14, -10, 0.55);
      drawParallax("prisonScrollerA", 0.28, 12, 0.72);
      drawParallax("prisonScrollerB", 0.45, 36, 0.85);

      // Room architectural details: arches, pillars, flasks tube, doorway frames, torches
      for (const r of this.level.rooms) {
        if (r.tx + r.tw < startTx - 2 || r.tx > endTx + 2) continue;
        const rx = r.tx * TILE_SIZE;
        const floorY = (r.ty + r.th - 1) * TILE_SIZE;
        this.assets.drawSprite(ctx, "prison", "archeSmall", 0, rx + 56, floorY - 120);
        this.assets.drawSprite(ctx, "prison", "alcovePillar", 0, rx + r.tw * TILE_SIZE * 0.5 - 90, floorY - 134);
        if (r.kind === "Entrance") {
          this.assets.drawSprite(ctx, "prison", "upgrades/groundCells", 0, rx + 24, floorY - 98);
        }
        if (r.id > 0) {
          this.assets.drawSprite(ctx, "prison", "smallDoor", 0, rx - 16, floorY - 67);
        }
        this.assets.drawSprite(ctx, "common", "fireCauldron", Math.floor(performance.now() / 110), rx + 36, floorY - 64);
        this.assets.drawSprite(ctx, "common", "fireCauldron", Math.floor(performance.now() / 110) + 2, rx + r.tw * TILE_SIZE - 72, floorY - 64);
        this.assets.drawSprite(ctx, "prison", "wallJunk/wallJunk", r.id, rx + 132, floorY - 72);
        this.assets.drawSprite(ctx, "prison", "floorJunk/floorjunk", r.id, rx + 180, floorY - 33);
      }
    }

    const atlas = isBridge ? "bridge" : "prison";
    const tileAtSafe = (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= this.level.tw || y >= this.level.th) return TileType.Solid;
      return this.level.tiles[y * this.level.tw + x];
    };

    for (let ty = startTy; ty <= endTy; ty++) {
      for (let tx = startTx; tx <= endTx; tx++) {
        const t = this.level.tiles[ty * this.level.tw + tx];
        const px = tx * TILE_SIZE;
        const py = ty * TILE_SIZE;
        const h = this.tileHash(tx, ty);

        if (t === TileType.Solid) {
          this.assets.drawSprite(ctx, atlas, "backWall", h % 10, px, py, TILE_SIZE, TILE_SIZE);
          const aboveEmpty = tileAtSafe(tx, ty - 1) !== TileType.Solid;
          const belowEmpty = tileAtSafe(tx, ty + 1) !== TileType.Solid;
          const leftEmpty = tileAtSafe(tx - 1, ty) !== TileType.Solid;
          const rightEmpty = tileAtSafe(tx + 1, ty) !== TileType.Solid;
          if (aboveEmpty) {
            const gName = leftEmpty ? "ground_left" : rightEmpty ? "ground_right" : "ground";
            this.assets.drawSprite(ctx, atlas, gName, h % 4, px, py, TILE_SIZE, 6);
          }
          if (belowEmpty) {
            this.assets.drawSprite(ctx, atlas, "ceiling", h % 4, px, py + TILE_SIZE - 4, TILE_SIZE, 4);
          }
          if (!isBridge && leftEmpty) {
            this.assets.drawSprite(ctx, "prison", "stoneWall", h % 4, px - 6, py, 14, TILE_SIZE);
          }
          if (!isBridge && rightEmpty) {
            this.assets.drawSprite(ctx, "prison", "stoneWall", (h + 1) % 4, px + TILE_SIZE - 8, py, 14, TILE_SIZE);
          }
        } else if (t === TileType.Platform) {
          if (isBridge) {
            this.assets.drawSprite(ctx, "bridge", "ground", 0, px, py, TILE_SIZE, 6);
          } else {
            const leftPlat = tileAtSafe(tx - 1, ty) === TileType.Platform;
            const rightPlat = tileAtSafe(tx + 1, ty) === TileType.Platform;
            const pName = !leftPlat ? "woodenPlatform_left" : !rightPlat ? "woodenPlatform_right" : "woodenPlatform";
            this.assets.drawSprite(ctx, "prison", pName, h % 5, px, py - 4, TILE_SIZE, 20);
          }
        } else if (t === TileType.Ladder) {
          const aboveLad = tileAtSafe(tx, ty - 1) === TileType.Ladder;
          if (!aboveLad) {
            this.assets.drawSprite(ctx, "prison", "chainAnchor", 0, px - 7, py - 8, 38, 28);
          }
          this.assets.drawSprite(ctx, "prison", "chainTile", 0, px + 7, py, 10, TILE_SIZE);
        }
      }
    }
  }

  private renderLighting(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    const t = performance.now() / 1000;
    const flicker = 0.92 + Math.sin(t * 14) * 0.05 + Math.cos(t * 23) * 0.03;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const drawGlow = (wx: number, wy: number, radius: number, r: number, g: number, b: number, a: number) => {
      if (wx + radius < ox || wx - radius > ox + this.viewW) return;
      const grad = ctx.createRadialGradient(wx, wy, 2, wx, wy, radius);
      grad.addColorStop(0, `rgba(${r},${g},${b},${a})`);
      grad.addColorStop(0.5, `rgba(${r},${g},${b},${a * 0.35})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(wx, wy, radius, 0, Math.PI * 2);
      ctx.fill();
    };

    // Beheaded flame head warm glow
    drawGlow(this.player.body.x, this.player.body.y - 32, 72 * flicker, 255, 145, 55, 0.24);

    // Room torches
    if (this.level.biomeId !== "Bridge") {
      for (const r of this.level.rooms) {
        const rx = r.tx * TILE_SIZE;
        const floorY = (r.ty + r.th - 1) * TILE_SIZE;
        drawGlow(rx + 52, floorY - 52, 95 * flicker, 255, 130, 40, 0.26);
        drawGlow(rx + r.tw * TILE_SIZE - 56, floorY - 52, 95 * flicker, 255, 130, 40, 0.26);
      }
    }

    // Teleporters & Scrolls runes
    for (const it of this.level.interactables) {
      if (it.used && it.kind !== "Teleporter") continue;
      if (it.kind === "Teleporter") {
        drawGlow(it.x, it.y - 26, 68 * flicker, 56, 189, 248, 0.28);
      } else if (it.kind === "Scroll") {
        drawGlow(it.x, it.y - 18, 56 * flicker, 168, 85, 247, 0.28);
      } else if (it.kind === "Chest") {
        drawGlow(it.x, it.y - 18, 52 * flicker, 250, 204, 21, 0.2);
      }
    }

    ctx.restore();
  }

  private renderInteractable(ctx: CanvasRenderingContext2D, it: Interactable): void {
    if (it.used && it.kind !== "Teleporter") return;
    if (it.kind === "Chest") {
      this.assets.drawSprite(ctx, "common", it.used ? "chestBasicOpen" : "chestBasicClosed", 0, it.x - 32, it.y - 46, 64, 46);
    } else if (it.kind === "Scroll") {
      const bob = Math.sin(performance.now() / 220) * 3;
      this.assets.drawSprite(ctx, "ui", "ui/iconTacticBig", 0, it.x - 14, it.y - 34 + bob, 28, 28);
    } else if (it.kind === "Teleporter") {
      this.assets.drawSprite(ctx, "prison", "upgrades/tpStoneUp", 0, it.x - 16, it.y - 54, 32, 54);
    } else if (it.kind === "ExitDoor") {
      this.assets.drawSprite(ctx, "prison", "exitDoorBridge", 0, it.x - 56, it.y - 84, 112, 84);
    } else {
      const cdbItem = it.itemId ? this.cdb.itemsById.get(it.itemId) : null;
      if (cdbItem?.icon) {
        this.assets.drawIcon(ctx, cdbItem.icon.file, cdbItem.icon.x, cdbItem.icon.y, cdbItem.icon.size, it.x - 14, it.y - 32, 28);
      } else {
        this.assets.drawSprite(ctx, "ui", "ui/flask", 0, it.x - 12, it.y - 26, 24, 24);
      }
    }
  }

  private renderTitle(ctx: CanvasRenderingContext2D): void {
    const bg = this.assets.images.get("prisonStartScrollerA");
    if (bg) ctx.drawImage(bg, 0, 0, this.viewW, this.viewH);
    ctx.fillStyle = "rgba(10, 8, 18, 0.55)";
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    this.assets.drawSprite(ctx, "ui", "ui/logoDeadCells", 0, this.viewW / 2 - 58, 18, 116, 180);

    ctx.fillStyle = "#e2dcf0";
    ctx.font = "11px monospace";
    ctx.fillText("WASD/Arrows: Move | Space: Jump/Double-Jump | Shift: Roll | J/Click: Attack | U: Shield/Parry", 36, this.viewH - 68);
    ctx.fillText("Q/E: Skills | R: Heal Flask | F: Interact | Down+Space/Attack: Dive Slam | Tab: Full Map", 56, this.viewH - 50);
    ctx.fillStyle = "#ffd166";
    ctx.font = "bold 14px monospace";
    ctx.fillText("Press SPACE or CLICK to Start Run", this.viewW / 2 - 140, this.viewH - 22);
  }

  private renderScrollModal(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "rgba(8, 6, 14, 0.82)";
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    ctx.fillStyle = "#f8f9fa";
    ctx.font = "bold 16px monospace";
    ctx.fillText("SCROLL OF POWER — Choose Stat (+15% Damage + HP)", this.viewW / 2 - 220, this.viewH / 2 - 55);
    const opts = [
      { key: "[Q]", name: "Brutality", color: "#ec4242", val: this.player.brutality },
      { key: "[E]", name: "Tactics", color: "#a05cff", val: this.player.tactics },
      { key: "[R]", name: "Survival", color: "#2dd66b", val: this.player.survival },
    ];
    opts.forEach((o, i) => {
      const bx = this.viewW / 2 - 195 + i * 135;
      const by = this.viewH / 2 - 25;
      ctx.fillStyle = "#181424";
      ctx.fillRect(bx, by, 120, 75);
      ctx.strokeStyle = o.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, 120, 75);
      ctx.fillStyle = o.color;
      ctx.font = "bold 13px monospace";
      ctx.fillText(`${o.key} ${o.name}`, bx + 10, by + 26);
      ctx.fillStyle = "#fff";
      ctx.font = "12px monospace";
      ctx.fillText(`Current: ${o.val}`, bx + 18, by + 52);
    });
  }

  private renderEndModal(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "rgba(8, 6, 14, 0.85)";
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    const win = this.mode === "victory";
    ctx.fillStyle = win ? "#06d6a0" : "#e63946";
    ctx.font = "bold 26px monospace";
    ctx.fillText(win ? "CONCIERGE DEFEATED!" : "YOU DIED", this.viewW / 2 - (win ? 150 : 65), this.viewH / 2 - 25);
    ctx.fillStyle = "#e2dcf0";
    ctx.font = "13px monospace";
    ctx.fillText(`Kills: ${this.player.kills} | Cells: ${this.player.cells} | Gold: ${this.player.gold}`, this.viewW / 2 - 140, this.viewH / 2 + 12);
    ctx.fillStyle = "#ffd166";
    ctx.fillText("Press SPACE or F to Start New Run", this.viewW / 2 - 135, this.viewH / 2 + 46);
  }
}
