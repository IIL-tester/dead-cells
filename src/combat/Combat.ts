import { CdbStore, TierId } from "../data/cdbLoader";

export type StatusKind = "bleed" | "poison" | "burn" | "freeze" | "root" | "oil";

export interface StatusEffect {
  kind: StatusKind;
  remaining: number;
  dps: number;
  tickTimer: number;
}

export interface FloatingNumber {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  crit: boolean;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fromPlayer: boolean;
  damage: number;
  breach: number;
  color: string;
  life: number;
  status?: StatusKind;
  radius: number;
  parried?: boolean;
}

export function scaleDamageByScroll(basePower: number, tierCount: number, gearLevel = 1): number {
  // GAME_SPEC §3.1: HeroScaleFactor = 1.15^(tier - 1), ItemDamageBonus = 0.25 per itemLevel
  const scrollMul = Math.pow(1.15, Math.max(0, tierCount - 1));
  const gearMul = 1 + 0.25 * Math.max(0, gearLevel - 1);
  return Math.round(basePower * scrollMul * gearMul);
}

export function computeMaxHeroHp(
  cdb: CdbStore,
  brutality: number,
  tactics: number,
  survival: number
): number {
  const baseLife = cdb.num("HeroLife", 100);
  const startScales = cdb.arr("HeroLifeStartScale", [0.65, 0.5, 0.7]);
  const caps = cdb.arr("HeroLifeTierCap", [35, 25, 60]);

  const calcFactor = (count: number, start: number, cap: number): number => {
    let mul = 1;
    for (let i = 2; i <= count; i++) {
      const t = Math.min(1, (i - 1) / Math.max(1, cap));
      const bonus = start * (1 - 0.85 * t);
      mul *= 1 + Math.max(0.03, bonus);
    }
    return mul;
  };

  return Math.round(
    baseLife *
      calcFactor(brutality, startScales[0], caps[0]) *
      calcFactor(tactics, startScales[1], caps[1]) *
      calcFactor(survival, startScales[2], caps[2])
  );
}

export function tierColor(tier?: TierId): string {
  if (tier === "Brutality") return "#ec4242";
  if (tier === "Tactic") return "#a05cff";
  if (tier === "Survival") return "#2dd66b";
  return "#d4d4d4";
}
