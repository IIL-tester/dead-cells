import { AssetLoader } from "../engine/AssetLoader";
import { CdbMob } from "../data/cdbLoader";
import { StatusEffect, StatusKind } from "../combat/Combat";
import { PhysicsBody } from "../physics/Physics";

export type EnemyState = "patrol" | "alert" | "windup" | "attack" | "cooldown" | "stun";

export class Enemy {
  public body: PhysicsBody;
  public facing: 1 | -1 = -1;
  public hp: number;
  public maxHp: number;
  public breachAccum = 0;
  public stunTimer = 0;
  public state: EnemyState = "patrol";
  public stateTimer = 0;
  public attackCooldown = 0;
  public volteTimer = 0;
  public hitFlash = 0;
  public animTimer = 0;
  public statuses: StatusEffect[] = [];
  public bossPhase = 1;
  public auraTimer = 0;
  public pendingAttack: { kind: "melee" | "ranged" | "shockwave" | "aura"; x: number; y: number; w: number; h: number; dmg: number } | null = null;

  constructor(
    public id: string,
    public cdb: CdbMob,
    x: number,
    y: number,
    public elite: boolean,
    public isBoss: boolean
  ) {
    const baseHp = cdb.life?.[0] ?? 120;
    const mul = isBoss ? 14 : elite ? 2.4 : 1;
    this.maxHp = Math.round(baseHp * mul);
    this.hp = this.maxHp;
    this.body = {
      x,
      y,
      vx: 0,
      vy: 0,
      halfW: isBoss ? 22 : 12,
      height: isBoss ? 64 : 40,
      onGround: false,
      onLadder: false,
      onWallDir: 0,
      coyoteTimer: 0,
      dropThroughTimer: 0,
    };
  }

  applyStatus(kind: StatusKind, duration = 4, dps = 8): void {
    const existing = this.statuses.find((s) => s.kind === kind);
    if (existing) {
      existing.remaining = Math.max(existing.remaining, duration);
      existing.dps = Math.max(existing.dps, dps);
    } else {
      this.statuses.push({ kind, remaining: duration, dps, tickTimer: 0.4 });
    }
  }

  takeDamage(amount: number, breach: number): { breached: boolean } {
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlash = 0.12;
    this.breachAccum += breach;
    if (!this.isBoss && this.breachAccum >= 100) {
      this.breachAccum -= 100;
      this.state = "stun";
      this.stunTimer = 1.4; // truelle.BreachStun = 1.4s
      return { breached: true };
    }
    if (this.isBoss && this.hp / this.maxHp < 0.5 && this.bossPhase === 1) {
      this.bossPhase = 2;
    }
    return { breached: false };
  }

  render(ctx: CanvasRenderingContext2D, assets: AssetLoader): void {
    const atlasKey =
      this.id === "Behemoth" ? "behemoth" : this.id === "SkeletonArcher" ? "skeletonArcher" : "zombie";
    let anim = "idle";
    if (atlasKey === "zombie") {
      if (this.state === "stun") anim = "stunIdle";
      else if (this.state === "windup") anim = "atkLoadA";
      else if (this.state === "attack") anim = "atkA";
      else if (Math.abs(this.body.vx) > 10) anim = "walk";
    } else if (atlasKey === "skeletonArcher") {
      if (this.state === "stun") anim = "skeletonArcher/stunIdle";
      else if (this.state === "windup" || this.state === "attack") anim = "skeletonArcher/shoot";
      else if (Math.abs(this.body.vx) > 10) anim = "skeletonArcher/walk";
      else anim = "skeletonArcher/idle";
    } else if (atlasKey === "behemoth") {
      if (this.state === "stun") anim = "stunIdle";
      else if (this.state === "windup") anim = "behemothAtkLoadA";
      else if (this.state === "attack") anim = "behemothAtkA";
      else if (Math.abs(this.body.vx) > 10) anim = "behemothWalkA";
      else anim = "behemothWalkIdleA";
    }

    const fIdx = Math.floor(this.animTimer * 12);
    const sprScale = atlasKey === "zombie" ? 0.52 : 1;
    assets.drawFrame(ctx, atlasKey, anim, fIdx, this.body.x, this.body.y, this.facing, sprScale, this.hitFlash > 0 ? 0.65 : 1);

    // Elite / Windup / Concierge Fire Aura indicators
    if (this.elite) {
      ctx.save();
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(this.body.x - this.body.halfW, this.body.y - this.body.height, this.body.halfW * 2, this.body.height);
      ctx.restore();
    }
    if (this.auraTimer > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 80, 30, 0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.body.x, this.body.y - 26, 74, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (this.state === "windup") {
      ctx.fillStyle = "#ffe066";
      ctx.font = "bold 14px monospace";
      ctx.fillText("!", this.body.x - 4, this.body.y - this.body.height - 12);
    }

    // Overhead HP bar
    if (!this.isBoss && this.hp < this.maxHp) {
      const bw = 28;
      const bx = Math.round(this.body.x - bw / 2);
      const by = Math.round(this.body.y - this.body.height - 8);
      ctx.fillStyle = "#18141c";
      ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = "#e63946";
      ctx.fillRect(bx, by, Math.round(bw * (this.hp / this.maxHp)), 3);
    }
  }
}
