import { GeneratedLevel, TILE_SIZE, TileType } from "../world/LevelGen";

export interface PhysicsBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  halfW: number;
  height: number;
  onGround: boolean;
  onLadder: boolean;
  onWallDir: -1 | 0 | 1;
  coyoteTimer: number;
  dropThroughTimer: number;
}

export interface PhysicsConfig {
  gravity: number; // px/s^2 scaled from truelle.Gravity = 0.065 at 60fps
  maxFallSpeed: number;
  friction: number;
}

export function tileAt(lvl: GeneratedLevel, tx: number, ty: number): TileType {
  if (tx < 0 || ty < 0 || tx >= lvl.tw || ty >= lvl.th) return TileType.Solid;
  return lvl.tiles[ty * lvl.tw + tx] as TileType;
}

export function stepBodyPhysics(
  body: PhysicsBody,
  lvl: GeneratedLevel,
  dt: number,
  cfg: PhysicsConfig,
  dropThrough = false
): void {
  if (dropThrough && body.onGround) {
    body.dropThroughTimer = 0.16;
  }
  if (body.dropThroughTimer > 0) body.dropThroughTimer = Math.max(0, body.dropThroughTimer - dt);

  if (!body.onLadder) {
    body.vy = Math.min(cfg.maxFallSpeed, body.vy + cfg.gravity * dt);
  }

  // Horizontal move + tile collision
  body.x += body.vx * dt;
  body.onWallDir = 0;

  const topTy = Math.floor((body.y - body.height + 2) / TILE_SIZE);
  const botTy = Math.floor((body.y - 2) / TILE_SIZE);

  if (body.vx > 0) {
    const rightTx = Math.floor((body.x + body.halfW) / TILE_SIZE);
    for (let ty = topTy; ty <= botTy; ty++) {
      if (tileAt(lvl, rightTx, ty) === TileType.Solid) {
        body.x = rightTx * TILE_SIZE - body.halfW - 0.01;
        body.vx = 0;
        body.onWallDir = 1;
        break;
      }
    }
  } else if (body.vx < 0) {
    const leftTx = Math.floor((body.x - body.halfW) / TILE_SIZE);
    for (let ty = topTy; ty <= botTy; ty++) {
      if (tileAt(lvl, leftTx, ty) === TileType.Solid) {
        body.x = (leftTx + 1) * TILE_SIZE + body.halfW + 0.01;
        body.vx = 0;
        body.onWallDir = -1;
        break;
      }
    }
  }

  // Vertical move + tile collision
  const prevY = body.y;
  body.y += body.vy * dt;
  body.onGround = false;

  const leftTx = Math.floor((body.x - body.halfW + 2) / TILE_SIZE);
  const rightTx = Math.floor((body.x + body.halfW - 2) / TILE_SIZE);

  if (body.vy >= 0) {
    const footTy = Math.floor(body.y / TILE_SIZE);
    const prevFootTy = Math.floor((prevY - 1) / TILE_SIZE);
    for (let tx = leftTx; tx <= rightTx; tx++) {
      const t = tileAt(lvl, tx, footTy);
      const isPlatformHit =
        t === TileType.Platform &&
        body.dropThroughTimer <= 0 &&
        prevFootTy < footTy;
      if (t === TileType.Solid || isPlatformHit) {
        body.y = footTy * TILE_SIZE;
        body.vy = 0;
        body.onGround = true;
        break;
      }
    }
  } else {
    const headTy = Math.floor((body.y - body.height) / TILE_SIZE);
    for (let tx = leftTx; tx <= rightTx; tx++) {
      if (tileAt(lvl, tx, headTy) === TileType.Solid) {
        body.y = (headTy + 1) * TILE_SIZE + body.height;
        body.vy = 0;
        break;
      }
    }
  }

  if (body.onGround) {
    body.coyoteTimer = 0.12; // truelle.HeroInExtremisJump = 0.12s
  } else {
    body.coyoteTimer = Math.max(0, body.coyoteTimer - dt);
  }
}

export function isOnLadderTile(body: PhysicsBody, lvl: GeneratedLevel): boolean {
  const cx = Math.floor(body.x / TILE_SIZE);
  const cy = Math.floor((body.y - body.height * 0.5) / TILE_SIZE);
  return tileAt(lvl, cx, cy) === TileType.Ladder;
}
