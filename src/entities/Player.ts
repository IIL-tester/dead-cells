import { AssetLoader } from "../engine/AssetLoader";
import { AudioEngine } from "../engine/Audio";
import { InputManager } from "../engine/Input";
import { CdbStore, TierId } from "../data/cdbLoader";
import { computeMaxHeroHp, scaleDamageByScroll, tierColor } from "../combat/Combat";
import { isOnLadderTile, PhysicsBody, PhysicsConfig, stepBodyPhysics, tileAt } from "../physics/Physics";
import { GeneratedLevel, TILE_SIZE, TileType } from "../world/LevelGen";

export interface EquippedItem {
  id: string;
  name: string;
  tier: TierId;
  level: number;
  kind: "weapon" | "shield" | "skill";
  cdMax: number;
  cdLeft: number;
}

export interface AttackHitbox {
  x: number;
  y: number;
  w: number;
  h: number;
  damage: number;
  breach: number;
  crit: boolean;
  fromPlayer: boolean;
}

export class Player {
  public body: PhysicsBody = {
    x: 96,
    y: 200,
    vx: 0,
    vy: 0,
    halfW: 10,
    height: 38,
    onGround: false,
    onLadder: false,
    onWallDir: 0,
    coyoteTimer: 0,
    dropThroughTimer: 0,
  };

  public facing: 1 | -1 = 1;
  public hp = 100;
  public maxHp = 100;
  public rallyHp = 0;
  public rallyLossTimer = 0;
  public flaskCharges = 4;
  public maxFlaskCharges = 4;
  public gold = 500;
  public cells = 0;
  public kills = 0;
  public speedComboKills = 0;
  public speedComboTimer = 0;

  public brutality = 1;
  public tactics = 1;
  public survival = 1;

  public slots: [EquippedItem | null, EquippedItem | null] = [null, null];
  public skills: [EquippedItem | null, EquippedItem | null] = [null, null];
  public mutations: string[] = ["Combo", "Vengeance", "Necromancy"];

  // Action states
  public airJumpsLeft = 1;
  public rollTimer = 0;
  public rollCd = 0;
  public invulnTimer = 0;
  public diving = false;
  public parryTimer = 0;
  public blocking = false;
  public shieldLockTimer = 0;

  public comboStep = 0;
  public comboResetTimer = 0;
  public attackTimer = 0;
  public attackWindup = 0;
  public attackHitSent = false;
  public currentAnim = "idle";
  public animTimer = 0;
  public pendingHitbox: AttackHitbox | null = null;
  public onDiveImpact: ((x: number, y: number) => void) | null = null;
  public onSkillCast: ((slot: number, item: EquippedItem) => void) | null = null;

  constructor(private cdb: CdbStore) {
    this.equipDefaults();
    this.recalcStats(true);
  }

  private equipDefaults(): void {
    this.slots[0] = {
      id: "StartSword",
      name: this.cdb.itemsById.get("StartSword")?.name ?? "Rusty Sword",
      tier: "Brutality",
      level: 1,
      kind: "weapon",
      cdMax: 0,
      cdLeft: 0,
    };
    this.slots[1] = {
      id: "FrontLineShield",
      name: this.cdb.itemsById.get("FrontLineShield")?.name ?? "Front Line Shield",
      tier: "Survival",
      level: 1,
      kind: "shield",
      cdMax: 0,
      cdLeft: 0,
    };
    this.skills[0] = {
      id: "Grenade",
      name: this.cdb.itemsById.get("Grenade")?.name ?? "Infantry Grenade",
      tier: "Brutality",
      level: 1,
      kind: "skill",
      cdMax: 6,
      cdLeft: 0,
    };
    this.skills[1] = {
      id: "HorizontalTurret",
      name: this.cdb.itemsById.get("HorizontalTurret")?.name ?? "Double Crossb-o-matic",
      tier: "Tactic",
      level: 1,
      kind: "skill",
      cdMax: 10,
      cdLeft: 0,
    };
  }

  recalcStats(healFull = false): void {
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.maxHp = computeMaxHeroHp(this.cdb, this.brutality, this.tactics, this.survival);
    this.hp = healFull ? this.maxHp : Math.max(1, Math.round(this.maxHp * ratio));
  }

  getTierCount(tier: TierId): number {
    if (tier === "Brutality") return this.brutality;
    if (tier === "Tactic") return this.tactics;
    return this.survival;
  }

  takeDamage(amount: number, audio: AudioEngine): boolean {
    if (this.invulnTimer > 0 || this.rollTimer > 0) return false;
    if (this.parryTimer > 0) {
      // Perfect Parry!
      audio.play("parry", 0.5);
      this.shieldLockTimer = 0;
      return false;
    }
    const absorbed = this.blocking ? Math.round(amount * (1 - this.cdb.num("DefaultShieldAbsorb", 0.75))) : amount;
    if (this.blocking) audio.play("absorb", 0.4);

    const prevHp = this.hp;
    this.hp = Math.max(0, this.hp - absorbed);
    const lost = prevHp - this.hp;
    const unrallyable = this.cdb.raw.hero[0]?.props?.unrallyableDamage ?? 0.2;
    this.rallyHp = Math.min(this.maxHp - this.hp, this.rallyHp + Math.round(lost * (1 - unrallyable)));
    this.rallyLossTimer = 1.2;
    this.invulnTimer = 0.45;
    return true;
  }

  healFromHit(damageDealt: number): void {
    if (this.rallyHp <= 0) return;
    const recover = Math.min(this.rallyHp, Math.max(2, Math.round(damageDealt * 0.2)));
    this.hp = Math.min(this.maxHp, this.hp + recover);
    this.rallyHp = Math.max(0, this.rallyHp - recover);
  }

  update(dt: number, input: InputManager, lvl: GeneratedLevel, audio: AudioEngine): void {
    this.animTimer += dt;
    this.pendingHitbox = null;

    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (this.rollCd > 0) this.rollCd = Math.max(0, this.rollCd - dt);
    if (this.parryTimer > 0) this.parryTimer = Math.max(0, this.parryTimer - dt);
    if (this.shieldLockTimer > 0) this.shieldLockTimer = Math.max(0, this.shieldLockTimer - dt);
    if (this.comboResetTimer > 0) {
      this.comboResetTimer = Math.max(0, this.comboResetTimer - dt);
      if (this.comboResetTimer === 0) this.comboStep = 0;
    }
    if (this.speedComboTimer > 0) {
      this.speedComboTimer = Math.max(0, this.speedComboTimer - dt);
      if (this.speedComboTimer === 0) this.speedComboKills = 0;
    }

    // Rally decay
    if (this.rallyHp > 0) {
      if (this.rallyLossTimer > 0) this.rallyLossTimer -= dt;
      else {
        this.rallyHp = Math.max(0, this.rallyHp - Math.max(1, this.maxHp * 0.08 * dt));
      }
    }

    for (const sk of this.skills) {
      if (sk && sk.cdLeft > 0) sk.cdLeft = Math.max(0, sk.cdLeft - dt);
    }

    // Heal Flask
    if (input.consume("heal") && this.flaskCharges > 0 && this.hp < this.maxHp) {
      this.flaskCharges--;
      const pct = this.cdb.num("FlaskLife", 0.6);
      this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * pct));
      this.rallyHp = 0;
      audio.play("heal", 0.45);
    }

    // Active skills
    if (input.consume("skill1") && this.skills[0] && this.skills[0].cdLeft <= 0) {
      this.skills[0].cdLeft = this.skills[0].cdMax;
      this.onSkillCast?.(0, this.skills[0]);
    }
    if (input.consume("skill2") && this.skills[1] && this.skills[1].cdLeft <= 0) {
      this.skills[1].cdLeft = this.skills[1].cdMax;
      this.onSkillCast?.(1, this.skills[1]);
    }

    const moveDir = (input.isDown("right") ? 1 : 0) - (input.isDown("left") ? 1 : 0);
    if (moveDir !== 0 && this.rollTimer <= 0 && this.attackTimer <= 0) {
      this.facing = moveDir > 0 ? 1 : -1;
    }

    // Dodge Roll (GAME_SPEC §2.3: DodgeDuration=0.4, DodgeCD=0.37)
    if (input.consume("roll") && this.rollCd <= 0 && this.rollTimer <= 0) {
      this.rollTimer = this.cdb.num("DodgeDuration", 0.4) * 0.75;
      this.rollCd = this.cdb.num("DodgeCD", 0.37);
      this.diving = false;
      this.body.onLadder = false;
      this.attackTimer = 0;
      audio.play("roll", 0.35);
    }

    const speedBoost = this.speedComboKills >= 4 ? 1.28 : 1;
    const baseRunPx = 220 * speedBoost;

    if (this.rollTimer > 0) {
      this.rollTimer = Math.max(0, this.rollTimer - dt);
      this.body.vx = this.facing * 355 * speedBoost;
      this.body.vy = Math.min(this.body.vy, 120);
      this.currentAnim = "rolling";
    } else if (this.diving) {
      this.body.vx = 0;
      this.body.vy = 760;
      this.currentAnim = "lethalSlam";
    } else {
      // Ladder/chain handling
      const onLadTile = isOnLadderTile(this.body, lvl);
      if (onLadTile && (input.isDown("up") || input.isDown("down"))) {
        this.body.onLadder = true;
        this.airJumpsLeft = 1;
      } else if (!onLadTile) {
        this.body.onLadder = false;
      }

      if (this.body.onLadder) {
        this.body.vx = moveDir * 110;
        const vDir = (input.isDown("down") ? 1 : 0) - (input.isDown("up") ? 1 : 0);
        this.body.vy = vDir * 175;
        if (vDir !== 0) audio.play("climb1", 0.25, 220);
        this.currentAnim = vDir !== 0 ? "climbA" : "climbIdleA";
      } else {
        const accel = this.body.onGround ? 1900 : 1250;
        const targetVx = this.blocking ? moveDir * 70 : moveDir * baseRunPx;
        if (this.body.vx < targetVx) this.body.vx = Math.min(targetVx, this.body.vx + accel * dt);
        else if (this.body.vx > targetVx) this.body.vx = Math.max(targetVx, this.body.vx - accel * dt);
      }

      // Jump / Double Jump / Downward Slam
      if (input.consume("jump")) {
        if (input.isDown("down") && this.body.onGround) {
          // Drop through one-way platform
          stepBodyPhysics(this.body, lvl, 0, { gravity: 0, maxFallSpeed: 0, friction: 0 }, true);
        } else if (this.body.onGround || this.body.coyoteTimer > 0 || this.body.onLadder) {
          this.body.onLadder = false;
          this.body.vy = -390;
          this.body.coyoteTimer = 0;
          this.airJumpsLeft = 1;
          audio.play("jump", 0.35);
        } else if (this.airJumpsLeft > 0) {
          this.airJumpsLeft--;
          this.body.vy = -355;
          audio.play("jump", 0.3);
        }
      }

      // Downward Slam (DiveAttack)
      if (!this.body.onGround && !this.body.onLadder && input.isDown("down") && input.consume("jump")) {
        this.diving = true;
      }
      if (!this.body.onGround && !this.body.onLadder && input.isDown("down") && input.consume("primary")) {
        this.diving = true;
      }

      // Primary / Secondary Combat
      const sec = this.slots[1];
      this.blocking = Boolean(sec?.kind === "shield" && input.isDown("secondary") && this.shieldLockTimer <= 0);
      if (sec?.kind === "shield" && input.consume("secondary") && this.shieldLockTimer <= 0) {
        this.parryTimer = this.cdb.num("ShieldPreShortPressParryDuration", 0.2);
        this.shieldLockTimer = 0.25;
      } else if (sec && sec.kind === "weapon" && input.consume("secondary") && this.attackTimer <= 0) {
        this.startWeaponAttack(sec, audio);
      }

      if (input.consume("primary") && this.slots[0] && this.attackTimer <= 0) {
        this.startWeaponAttack(this.slots[0], audio);
      }
    }

    // Physics integration (Gravity = 0.065 * 60^2 ≈ 1080 px/s^2 tuned for 24px tiles)
    const physCfg: PhysicsConfig = {
      gravity: 1120,
      maxFallSpeed: 760,
      friction: 0.3,
    };
    const wasInAir = !this.body.onGround;
    stepBodyPhysics(this.body, lvl, dt, physCfg);

    // Ledge grab assist: if airborne falling near top corner of a solid block
    if (!this.body.onGround && this.body.vy > 0 && this.body.onWallDir !== 0 && moveDir === this.body.onWallDir) {
      const checkTx = Math.floor((this.body.x + this.body.onWallDir * (this.body.halfW + 4)) / TILE_SIZE);
      const headTy = Math.floor((this.body.y - this.body.height) / TILE_SIZE);
      if (tileAt(lvl, checkTx, headTy) === TileType.Empty && tileAt(lvl, checkTx, headTy + 1) === TileType.Solid) {
        this.body.vy = 0;
        this.body.y = (headTy + 1) * TILE_SIZE;
        this.body.x += this.body.onWallDir * 8;
        this.airJumpsLeft = 1;
      }
    }

    if (wasInAir && this.body.onGround) {
      this.airJumpsLeft = 1;
      if (this.diving) {
        this.diving = false;
        audio.play("stomp", 0.45);
        this.onDiveImpact?.(this.body.x, this.body.y);
      } else {
        audio.play("land", 0.22);
      }
    }

    // Active attack timer
    if (this.attackTimer > 0) {
      this.attackTimer = Math.max(0, this.attackTimer - dt);
      if (!this.attackHitSent && this.attackTimer <= this.attackWindup) {
        this.attackHitSent = true;
        this.emitStrikeHitbox(audio);
      }
    } else if (this.rollTimer <= 0 && !this.diving && !this.body.onLadder) {
      if (this.blocking) this.currentAnim = "block";
      else if (!this.body.onGround) this.currentAnim = this.body.vy < 0 ? "jumpUp" : "jumpDown";
      else if (Math.abs(this.body.vx) > 20) {
        this.currentAnim = "idleRun";
        audio.play("step1", 0.14, 240);
      } else {
        this.currentAnim = "idle";
      }
    }
  }

  private startWeaponAttack(wep: EquippedItem, audio: AudioEngine): void {
    const cdbWep = this.cdb.weaponsById.get(wep.id);
    const chain = cdbWep?.strikeChain ?? [];
    const step = chain[this.comboStep % Math.max(1, chain.length)];
    const charge = step?.charge ?? 0.12;
    const total = Math.max(0.2, charge + 0.14);

    this.attackTimer = total;
    this.attackWindup = total - charge;
    this.attackHitSent = false;
    this.currentAnim = step?.animId || (this.comboStep === 0 ? "atkSwordA" : this.comboStep === 1 ? "atkSwordB" : "atkSwordC");
    this.animTimer = 0;
    this.comboResetTimer = this.cdb.num("WeaponChainLoss", 1.0);
    audio.play("swingShort", 0.32);
  }

  private emitStrikeHitbox(audio: AudioEngine): void {
    const wep = this.slots[0];
    if (!wep) return;
    const cdbWep = this.cdb.weaponsById.get(wep.id);
    const chain = cdbWep?.strikeChain ?? [];
    const step = chain[this.comboStep % Math.max(1, chain.length)];
    const basePow = step?.power?.[0] ?? 28;
    const dmg = scaleDamageByScroll(basePow, this.getTierCount(wep.tier), wep.level);
    const crit = Boolean(step?.canCrit || this.comboStep === 2);
    const finalDmg = crit ? Math.round(dmg * 1.5) : dmg;

    const w = ((step?.area?.width ?? 2.6) * TILE_SIZE) | 0;
    const h = Math.max(32, ((step?.area?.height ?? 1.8) * TILE_SIZE) | 0);
    this.pendingHitbox = {
      x: this.facing === 1 ? this.body.x : this.body.x - w,
      y: this.body.y - h - 4,
      w,
      h,
      damage: finalDmg,
      breach: 35 + (step?.breachBonus ?? 0) * 35,
      crit,
      fromPlayer: true,
    };

    if (chain.length > 0) {
      this.comboStep = (this.comboStep + 1) % chain.length;
    }
    if (wep.id.includes("Bow")) audio.play("bowShot", 0.35);
  }

  render(ctx: CanvasRenderingContext2D, assets: AssetLoader): void {
    const fps = this.currentAnim === "idleRun" ? 18 : this.currentAnim.startsWith("atk") ? 20 : 12;
    const fIdx = Math.floor(this.animTimer * fps);
    const alpha = this.invulnTimer > 0 && Math.floor(this.invulnTimer * 20) % 2 === 0 ? 0.55 : 1;

    const ok = assets.drawFrame(ctx, "beheaded", this.currentAnim, fIdx, this.body.x, this.body.y, this.facing, 1, alpha);
    if (!ok) {
      assets.drawFrame(ctx, "beheaded", "idle", fIdx, this.body.x, this.body.y, this.facing, 1, alpha);
    }

    // Beheaded's signature glowing flame head & wisps
    if (this.rollTimer <= 0) {
      const t = this.animTimer;
      const hx = this.body.x + this.facing * 2;
      const hy = this.body.y - 34;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) {
        const phase = (t * 4 + i * 0.33) % 1;
        const wx = hx - this.facing * (phase * 8) + Math.sin(t * 11 + i) * 2;
        const wy = hy - phase * 11;
        const r = (1 - phase) * 4.5;
        ctx.fillStyle = i === 0 ? "rgba(255, 190, 60, 0.55)" : "rgba(255, 95, 30, 0.38)";
        ctx.beginPath();
        ctx.arc(wx, wy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Visual parry/block aura
    if (this.parryTimer > 0 || this.blocking) {
      ctx.save();
      ctx.strokeStyle = this.parryTimer > 0 ? "#ffe066" : tierColor("Survival");
      ctx.lineWidth = this.parryTimer > 0 ? 3 : 2;
      ctx.beginPath();
      ctx.arc(this.body.x + this.facing * 14, this.body.y - 20, 18, -Math.PI * 0.45, Math.PI * 0.45, this.facing === -1);
      ctx.stroke();
      ctx.restore();
    }
  }
}
