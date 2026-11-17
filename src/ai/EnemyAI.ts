import { AudioEngine } from "../engine/Audio";
import { stepBodyPhysics } from "../physics/Physics";
import { GeneratedLevel } from "../world/LevelGen";
import { Enemy } from "../entities/Enemy";
import { Player } from "../entities/Player";

export function updateEnemyAI(
  enemy: Enemy,
  player: Player,
  lvl: GeneratedLevel,
  dt: number,
  audio: AudioEngine,
  onStatusDamage: (enemy: Enemy, dmg: number, color: string) => void
): void {
  enemy.animTimer += dt;
  enemy.pendingAttack = null;
  if (enemy.hitFlash > 0) enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
  if (enemy.attackCooldown > 0) enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
  if (enemy.auraTimer > 0) enemy.auraTimer = Math.max(0, enemy.auraTimer - dt);

  // Breach decay (truelle.BreachDecay = 20/s)
  if (enemy.breachAccum > 0) {
    enemy.breachAccum = Math.max(0, enemy.breachAccum - 20 * dt);
  }

  // Status effects tick
  for (let i = enemy.statuses.length - 1; i >= 0; i--) {
    const st = enemy.statuses[i];
    st.remaining -= dt;
    st.tickTimer -= dt;
    if (st.tickTimer <= 0) {
      st.tickTimer = 0.5;
      enemy.hp = Math.max(0, enemy.hp - st.dps * 0.5);
      onStatusDamage(enemy, Math.round(st.dps * 0.5), st.kind === "poison" ? "#4ade80" : st.kind === "burn" ? "#fb923c" : "#ef4444");
    }
    if (st.remaining <= 0) enemy.statuses.splice(i, 1);
  }

  if (enemy.state === "stun") {
    enemy.body.vx = 0;
    enemy.stunTimer -= dt;
    if (enemy.stunTimer <= 0) enemy.state = "alert";
    stepBodyPhysics(enemy.body, lvl, dt, { gravity: 1120, maxFallSpeed: 760, friction: 0.3 });
    return;
  }

  const dx = player.body.x - enemy.body.x;
  const dy = player.body.y - enemy.body.y;
  const dist = Math.hypot(dx, dy);
  const desiredFacing: 1 | -1 = dx >= 0 ? 1 : -1;

  // volteDelay turn-around behavior (GAME_SPEC §5.1)
  if (desiredFacing !== enemy.facing) {
    enemy.volteTimer += dt;
    if (enemy.volteTimer >= (enemy.cdb.volteDelay || 0.4)) {
      enemy.facing = desiredFacing;
      enemy.volteTimer = 0;
    }
  } else {
    enemy.volteTimer = 0;
  }

  const aggroRange = enemy.isBoss ? 900 : 280;
  const attackRange = enemy.id === "SkeletonArcher" ? 230 : enemy.isBoss ? 90 : 48;

  if (enemy.state === "patrol") {
    enemy.body.vx = enemy.facing * 45;
    if (enemy.body.onWallDir !== 0) enemy.facing = (enemy.facing * -1) as 1 | -1;
    if (dist < aggroRange && Math.abs(dy) < 120) {
      enemy.state = "alert";
    }
  } else if (enemy.state === "alert") {
    if (dist > attackRange) {
      const spd = enemy.isBoss ? (enemy.bossPhase === 2 ? 155 : 115) : enemy.elite ? 130 : 95;
      enemy.body.vx = enemy.facing * spd;
    } else {
      enemy.body.vx = 0;
      if (enemy.attackCooldown <= 0) {
        enemy.state = "windup";
        enemy.stateTimer = enemy.isBoss ? 0.55 : enemy.id === "SkeletonArcher" ? 0.6 : 0.48;
        if (enemy.id === "Zombie") audio.play("zombieCharge", 0.3);
        if (enemy.isBoss) audio.play("bossRoar", 0.35);
      }
    }
    if (enemy.isBoss && enemy.bossPhase === 2 && enemy.auraTimer <= 0 && Math.random() < 0.015) {
      enemy.auraTimer = 3.0;
    }
  } else if (enemy.state === "windup") {
    enemy.body.vx = 0;
    enemy.stateTimer -= dt;
    if (enemy.stateTimer <= 0) {
      enemy.state = "attack";
      enemy.stateTimer = 0.22;
      if (enemy.id === "SkeletonArcher") {
        enemy.pendingAttack = {
          kind: "ranged",
          x: enemy.body.x + enemy.facing * 14,
          y: enemy.body.y - 24,
          w: 10,
          h: 10,
          dmg: 16,
        };
      } else if (enemy.isBoss && Math.random() < 0.45) {
        // Concierge shockwave / leap
        enemy.body.vy = -260;
        enemy.body.vx = enemy.facing * 240;
        enemy.pendingAttack = {
          kind: "shockwave",
          x: enemy.body.x - 90,
          y: enemy.body.y - 28,
          w: 180,
          h: 28,
          dmg: 26,
        };
      } else {
        enemy.pendingAttack = {
          kind: "melee",
          x: enemy.facing === 1 ? enemy.body.x : enemy.body.x - 46,
          y: enemy.body.y - 42,
          w: 46,
          h: 42,
          dmg: enemy.isBoss ? 24 : enemy.elite ? 20 : 14,
        };
        if (enemy.id === "Zombie") audio.play("zombieHit", 0.3);
      }
    }
  } else if (enemy.state === "attack") {
    enemy.stateTimer -= dt;
    if (enemy.stateTimer <= 0) {
      enemy.state = "alert";
      enemy.attackCooldown = enemy.isBoss ? 0.9 : 1.1;
    }
  }

  // Concierge fire aura damage check
  if (enemy.auraTimer > 0 && dist < 74) {
    enemy.pendingAttack = {
      kind: "aura",
      x: enemy.body.x - 74,
      y: enemy.body.y - 74,
      w: 148,
      h: 74,
      dmg: 10,
    };
  }

  stepBodyPhysics(enemy.body, lvl, dt, { gravity: 1120, maxFallSpeed: 760, friction: 0.3 });
}
