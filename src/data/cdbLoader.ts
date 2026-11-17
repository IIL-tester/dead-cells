import { ASSET_MANIFEST, resolveAssetUrl } from "./assetManifest";

export type TierId = "Brutality" | "Tactic" | "Survival";

export interface TruelleEntry {
  v0: number | number[] | null;
  v1: number | number[] | null;
}

export interface StrikeStep {
  coolDown: number;
  power: number[];
  charge: number;
  breachBonus?: number;
  canCrit?: boolean;
  hitFrame?: number;
  lockCtrlAfter?: number;
  animId?: string;
  area?: {
    width: number;
    height: number;
    offsetCaseX: number;
    offsetCaseY: number;
    shape: number;
  };
}

export interface CdbWeapon {
  item: string;
  airControlAlways?: boolean;
  allowCrouch?: boolean;
  strikeChain: StrikeStep[];
}

export interface CdbItem {
  id: string;
  name: string;
  tier1?: TierId;
  tier2?: TierId;
  moneyCost: number;
  cellCost: number;
  castCD: number;
  icon?: { x: number; y: number; file: string; size: number };
  tags: string[];
  props: Record<string, unknown>;
  gameplayDesc: string;
}

export interface CdbMobSkill {
  id: string;
  coolDown: number;
  power: number[];
  charge: number;
  radius: number;
  hitFrame: number;
  breachResistance?: number;
  lockAiAfter?: number;
}

export interface CdbMob {
  id: string;
  name: string;
  life: number[];
  score: number;
  volteDelay: number;
  canBeElite: boolean;
  props: Record<string, number>;
  skill: CdbMobSkill[];
}

export interface CdbData {
  truelle: Record<string, TruelleEntry>;
  hero: Array<{ id: string; props: Record<string, number> }>;
  tier: Array<{ id: TierId; color: number }>;
  difficulty: Array<{
    id: string;
    difficultyLevel: number;
    cellDropMultiplier: number;
    extraMobDensity: number;
    eliteExtraLife: number;
    bossExtraLife: number;
    forgeCaps: number[];
  }>;
  weapon: CdbWeapon[];
  item: CdbItem[];
  mob: CdbMob[];
  level: Array<{
    id: string;
    name: string;
    worldDepth: number;
    baseLootLevel: number;
    tripleUps: number;
    doubleUps: number;
    nextLevels: string[];
  }>;
}

export class CdbStore {
  public raw!: CdbData;
  public itemsById = new Map<string, CdbItem>();
  public weaponsById = new Map<string, CdbWeapon>();
  public mobsById = new Map<string, CdbMob>();

  async load(): Promise<void> {
    const res = await fetch(resolveAssetUrl(ASSET_MANIFEST.cdb));
    this.raw = (await res.json()) as CdbData;
    for (const it of this.raw.item) this.itemsById.set(it.id, it);
    for (const w of this.raw.weapon) this.weaponsById.set(w.item, w);
    for (const m of this.raw.mob) this.mobsById.set(m.id, m);
  }

  num(key: string, fallback: number): number {
    const v = this.raw?.truelle?.[key]?.v0;
    return typeof v === "number" ? v : fallback;
  }

  num1(key: string, fallback: number): number {
    const v = this.raw?.truelle?.[key]?.v1;
    return typeof v === "number" ? v : fallback;
  }

  arr(key: string, fallback: number[]): number[] {
    const v = this.raw?.truelle?.[key]?.v0;
    return Array.isArray(v) ? v : fallback;
  }
}
