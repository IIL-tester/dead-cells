export const TILE_SIZE = 24;

export const enum TileType {
  Empty = 0,
  Solid = 1,
  Platform = 2,
  Ladder = 3,
}

export type RoomKind = "Entrance" | "Combat" | "Treasure" | "Shop" | "Teleport" | "Exit" | "Boss";

export interface RoomRect {
  id: number;
  kind: RoomKind;
  tx: number;
  ty: number;
  tw: number;
  th: number;
  revealed: boolean;
}

export interface Interactable {
  id: string;
  kind: "Chest" | "Scroll" | "ShopItem" | "Teleporter" | "ExitDoor" | "WeaponDrop" | "HealingFood";
  x: number;
  y: number;
  used: boolean;
  label: string;
  cost?: number;
  itemId?: string;
  tier?: "Brutality" | "Tactic" | "Survival";
  targetX?: number;
  targetY?: number;
}

export interface EnemySpawn {
  mobId: string;
  x: number;
  y: number;
  elite: boolean;
  boss?: boolean;
}

export interface GeneratedLevel {
  biomeId: string;
  biomeName: string;
  tw: number;
  th: number;
  tiles: Uint8Array;
  rooms: RoomRect[];
  interactables: Interactable[];
  spawns: EnemySpawn[];
  spawnX: number;
  spawnY: number;
  bossRoomId: number;
}

interface RoomTemplate {
  kind: RoomKind;
  tw: number;
  th: number;
  build: (setTile: (lx: number, ly: number, t: TileType) => void, rx: number, ry: number) => {
    interactables: Interactable[];
    spawns: EnemySpawn[];
  };
}

function makeRoomTemplates(biomeId: string, lootPool: string[]): RoomTemplate[] {
  const isBoss = biomeId === "Bridge";
  if (isBoss) {
    return [
      {
        kind: "Boss",
        tw: 48,
        th: 20,
        build: (set, rx, ry) => {
          // Arena floor & ceiling & side walls
          for (let x = 0; x < 48; x++) {
            set(x, 0, TileType.Solid);
            set(x, 1, TileType.Solid);
            set(x, 18, TileType.Solid);
            set(x, 19, TileType.Solid);
          }
          for (let y = 0; y < 20; y++) {
            set(0, y, TileType.Solid);
            set(1, y, TileType.Solid);
            set(46, y, TileType.Solid);
            set(47, y, TileType.Solid);
          }
          // Two side platforms for dodging Concierge shockwaves
          for (let x = 7; x <= 13; x++) set(x, 13, TileType.Platform);
          for (let x = 34; x <= 40; x++) set(x, 13, TileType.Platform);
          return {
            interactables: [],
            spawns: [
              {
                mobId: "Behemoth",
                x: (rx + 36) * TILE_SIZE,
                y: (ry + 18) * TILE_SIZE,
                elite: false,
                boss: true,
              },
            ],
          };
        },
      },
    ];
  }

  return [
    {
      kind: "Entrance",
      tw: 26,
      th: 18,
      build: (set, rx, ry) => {
        for (let x = 0; x < 26; x++) {
          set(x, 0, TileType.Solid);
          set(x, 17, TileType.Solid);
        }
        for (let y = 0; y < 18; y++) {
          set(0, y, TileType.Solid);
          if (y < 11 || y > 16) set(25, y, TileType.Solid);
        }
        for (let x = 10; x < 18; x++) set(x, 12, TileType.Platform);
        for (let y = 12; y <= 16; y++) set(12, y, TileType.Ladder);
        return {
          interactables: [
            {
              id: "start_scroll",
              kind: "Scroll",
              x: (rx + 14) * TILE_SIZE,
              y: (ry + 12) * TILE_SIZE,
              used: false,
              label: "Scroll of Power",
            },
            {
              id: "start_tp",
              kind: "Teleporter",
              x: (rx + 5) * TILE_SIZE,
              y: (ry + 17) * TILE_SIZE,
              used: false,
              label: "Teleporter (Entrance)",
            },
          ],
          spawns: [],
        };
      },
    },
    {
      kind: "Combat",
      tw: 32,
      th: 18,
      build: (set, rx, ry) => {
        for (let x = 0; x < 32; x++) {
          set(x, 0, TileType.Solid);
          set(x, 17, TileType.Solid);
        }
        for (let y = 0; y < 18; y++) {
          if (y < 11 || y > 16) {
            set(0, y, TileType.Solid);
            set(31, y, TileType.Solid);
          }
        }
        // Multi-tier combat platforms + chain ladder
        for (let x = 5; x < 14; x++) set(x, 12, TileType.Platform);
        for (let x = 17; x < 27; x++) set(x, 10, TileType.Platform);
        for (let x = 10; x < 20; x++) set(x, 6, TileType.Platform);
        for (let y = 6; y <= 16; y++) set(13, y, TileType.Ladder);
        return {
          interactables: [],
          spawns: [
            { mobId: "Zombie", x: (rx + 10) * TILE_SIZE, y: (ry + 17) * TILE_SIZE, elite: false },
            { mobId: "SkeletonArcher", x: (rx + 22) * TILE_SIZE, y: (ry + 10) * TILE_SIZE, elite: false },
            { mobId: "Zombie", x: (rx + 24) * TILE_SIZE, y: (ry + 17) * TILE_SIZE, elite: Math.random() < 0.25 },
          ],
        };
      },
    },
    {
      kind: "Treasure",
      tw: 22,
      th: 18,
      build: (set, rx, ry) => {
        for (let x = 0; x < 22; x++) {
          set(x, 0, TileType.Solid);
          set(x, 17, TileType.Solid);
        }
        for (let y = 0; y < 18; y++) {
          if (y < 11 || y > 16) {
            set(0, y, TileType.Solid);
            set(21, y, TileType.Solid);
          }
        }
        for (let x = 7; x < 15; x++) set(x, 13, TileType.Solid);
        for (let x = 4; x < 7; x++) set(x, 15, TileType.Platform);
        for (let x = 15; x < 18; x++) set(x, 15, TileType.Platform);
        return {
          interactables: [
            {
              id: `chest_${rx}`,
              kind: "Chest",
              x: (rx + 11) * TILE_SIZE,
              y: (ry + 13) * TILE_SIZE,
              used: false,
              label: "Treasure Chest",
              itemId: lootPool[Math.floor(Math.random() * lootPool.length)],
            },
          ],
          spawns: [],
        };
      },
    },
    {
      kind: "Combat",
      tw: 34,
      th: 18,
      build: (set, rx, ry) => {
        for (let x = 0; x < 34; x++) {
          set(x, 0, TileType.Solid);
          set(x, 17, TileType.Solid);
        }
        for (let y = 0; y < 18; y++) {
          if (y < 11 || y > 16) {
            set(0, y, TileType.Solid);
            set(33, y, TileType.Solid);
          }
        }
        // Central stone pillar + ledges
        for (let y = 11; y < 17; y++) {
          set(15, y, TileType.Solid);
          set(16, y, TileType.Solid);
        }
        for (let x = 11; x < 21; x++) set(x, 11, TileType.Platform);
        for (let x = 5; x < 11; x++) set(x, 8, TileType.Platform);
        for (let x = 22; x < 29; x++) set(x, 8, TileType.Platform);
        for (let y = 8; y <= 16; y++) set(24, y, TileType.Ladder);
        return {
          interactables: [
            {
              id: `scroll_${rx}`,
              kind: "Scroll",
              x: (rx + 8) * TILE_SIZE,
              y: (ry + 8) * TILE_SIZE,
              used: false,
              label: "Scroll of Power",
            },
          ],
          spawns: [
            { mobId: "Zombie", x: (rx + 9) * TILE_SIZE, y: (ry + 17) * TILE_SIZE, elite: false },
            { mobId: "SkeletonArcher", x: (rx + 26) * TILE_SIZE, y: (ry + 8) * TILE_SIZE, elite: false },
            { mobId: "Zombie", x: (rx + 25) * TILE_SIZE, y: (ry + 17) * TILE_SIZE, elite: true },
          ],
        };
      },
    },
    {
      kind: "Shop",
      tw: 24,
      th: 18,
      build: (set, rx, ry) => {
        for (let x = 0; x < 24; x++) {
          set(x, 0, TileType.Solid);
          set(x, 17, TileType.Solid);
        }
        for (let y = 0; y < 18; y++) {
          if (y < 11 || y > 16) {
            set(0, y, TileType.Solid);
            set(23, y, TileType.Solid);
          }
        }
        const i1 = lootPool[0] ?? "BroadSword";
        const i2 = lootPool[1] ?? "HeavyBow";
        return {
          interactables: [
            {
              id: `shop1_${rx}`,
              kind: "ShopItem",
              x: (rx + 8) * TILE_SIZE,
              y: (ry + 17) * TILE_SIZE,
              used: false,
              label: `Buy ${i1}`,
              cost: 1200,
              itemId: i1,
            },
            {
              id: `shop2_${rx}`,
              kind: "ShopItem",
              x: (rx + 13) * TILE_SIZE,
              y: (ry + 17) * TILE_SIZE,
              used: false,
              label: `Buy ${i2}`,
              cost: 1400,
              itemId: i2,
            },
            {
              id: `shop_food_${rx}`,
              kind: "HealingFood",
              x: (rx + 18) * TILE_SIZE,
              y: (ry + 17) * TILE_SIZE,
              used: false,
              label: "Buy Kebab (Heal 50%)",
              cost: 800,
            },
          ],
          spawns: [],
        };
      },
    },
    {
      kind: "Exit",
      tw: 22,
      th: 18,
      build: (set, rx, ry) => {
        for (let x = 0; x < 22; x++) {
          set(x, 0, TileType.Solid);
          set(x, 17, TileType.Solid);
        }
        for (let y = 0; y < 18; y++) {
          if (y < 11 || y > 16) set(0, y, TileType.Solid);
          set(21, y, TileType.Solid);
        }
        return {
          interactables: [
            {
              id: `tp_exit_${rx}`,
              kind: "Teleporter",
              x: (rx + 6) * TILE_SIZE,
              y: (ry + 17) * TILE_SIZE,
              used: false,
              label: "Teleporter (Exit)",
            },
            {
              id: `exit_${rx}`,
              kind: "ExitDoor",
              x: (rx + 16) * TILE_SIZE,
              y: (ry + 17) * TILE_SIZE,
              used: false,
              label: "Enter Black Bridge (The Concierge)",
            },
          ],
          spawns: [],
        };
      },
    },
  ];
}

export function generateBiomeLevel(biomeId: string, biomeName: string): GeneratedLevel {
  const lootPool = ["StartSword", "BroadSword", "AssassinDagger", "TwinDaggers", "FrontLineShield", "ParryShield", "Grenade", "FireGrenade", "HorizontalTurret"];
  const templates = makeRoomTemplates(biomeId, lootPool);
  const totalW = templates.reduce((acc, t) => acc + t.tw, 0);
  const totalH = Math.max(...templates.map((t) => t.th));
  const tiles = new Uint8Array(totalW * totalH);

  const rooms: RoomRect[] = [];
  const interactables: Interactable[] = [];
  const spawns: EnemySpawn[] = [];

  let cursorX = 0;
  templates.forEach((tpl, idx) => {
    const ry = totalH - tpl.th;
    const setTile = (lx: number, ly: number, t: TileType) => {
      const gx = cursorX + lx;
      const gy = ry + ly;
      if (gx >= 0 && gx < totalW && gy >= 0 && gy < totalH) {
        tiles[gy * totalW + gx] = t;
      }
    };
    const res = tpl.build(setTile, cursorX, ry);
    rooms.push({
      id: idx,
      kind: tpl.kind,
      tx: cursorX,
      ty: ry,
      tw: tpl.tw,
      th: tpl.th,
      revealed: idx === 0,
    });
    interactables.push(...res.interactables);
    spawns.push(...res.spawns);
    cursorX += tpl.tw;
  });

  // Link teleporters in a ring
  const tps = interactables.filter((i) => i.kind === "Teleporter");
  for (let i = 0; i < tps.length; i++) {
    const next = tps[(i + 1) % tps.length];
    tps[i].targetX = next.x;
    tps[i].targetY = next.y;
  }

  return {
    biomeId,
    biomeName,
    tw: totalW,
    th: totalH,
    tiles,
    rooms,
    interactables,
    spawns,
    spawnX: 4 * TILE_SIZE,
    spawnY: (totalH - 1) * TILE_SIZE,
    bossRoomId: biomeId === "Bridge" ? 0 : -1,
  };
}
