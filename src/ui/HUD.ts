import { AssetLoader } from "../engine/AssetLoader";
import { CdbStore } from "../data/cdbLoader";
import { tierColor } from "../combat/Combat";
import { Enemy } from "../entities/Enemy";
import { Player } from "../entities/Player";
import { GeneratedLevel, Interactable } from "../world/LevelGen";

export class HUD {
  render(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    player: Player,
    lvl: GeneratedLevel,
    enemies: Enemy[],
    assets: AssetLoader,
    cdb: CdbStore,
    nearby: Interactable | null,
    showMap: boolean
  ): void {
    // 1. Top-left HP + Rally + Flask + Gold/Cells using ui.png frames & victor_pixel_8
    const barX = 10;
    const barY = 10;
    const barW = 148;
    const barH = 10;

    assets.drawNineSlice(ctx, "ui", "ui/boxLife", barX - 3, barY - 3, barW + 6, barH + 6);
    assets.drawSprite(ctx, "ui", "ui/lifeBg", 0, barX, barY, barW, barH);

    const hpRatio = Math.max(0, player.hp / player.maxHp);
    const rallyRatio = Math.min(1 - hpRatio, player.rallyHp / player.maxHp);
    if (rallyRatio > 0) {
      assets.drawSprite(ctx, "ui", "ui/lifeReco", 0, barX + Math.round(barW * hpRatio), barY, Math.round(barW * rallyRatio), barH);
    }
    if (hpRatio > 0) {
      assets.drawSprite(ctx, "ui", "ui/lifeFull", 0, barX, barY, Math.round(barW * hpRatio), barH);
    }
    assets.drawSprite(ctx, "ui", "ui/lifeDeco", 0, barX, barY + barH - 2, 79, 6);
    assets.drawPixelText(ctx, `${player.hp}/${player.maxHp}`, barX + 4, barY + 1, "#ffffff", 1);

    // Flask icons
    for (let i = 0; i < player.maxFlaskCharges; i++) {
      const fx = barX + i * 16;
      const fy = barY + 14;
      assets.drawSprite(ctx, "ui", "ui/flask", 0, fx, fy, 16, 16);
      if (i < player.flaskCharges) {
        assets.drawSprite(ctx, "ui", "ui/flaskA", 0, fx + 5, fy + 3, 5, 11);
      }
    }

    // Gold & Cells with official icons
    const resY = barY + 33;
    assets.drawSprite(ctx, "ui", "ui/iconGold", 0, barX, resY, 10, 10);
    assets.drawPixelText(ctx, String(player.gold), barX + 13, resY + 1, "#ffd166", 1);

    assets.drawSprite(ctx, "ui", "ui/iconCell", 0, barX + 58, resY, 10, 10);
    assets.drawPixelText(ctx, String(player.cells), barX + 71, resY + 1, "#48cae4", 1);

    // Scroll Counters (Brutality / Tactics / Survival)
    const sx = barX + barW + 10;
    const stats = [
      { icon: "ui/iconBrutalityBig", color: tierColor("Brutality"), val: player.brutality },
      { icon: "ui/iconTacticBig", color: tierColor("Tactic"), val: player.tactics },
      { icon: "ui/iconSurviveBig", color: tierColor("Survival"), val: player.survival },
    ];
    stats.forEach((st, idx) => {
      const bx = sx + idx * 28;
      assets.drawNineSlice(ctx, "ui", "ui/boxHud", bx, barY - 2, 25, 28);
      assets.drawSprite(ctx, "ui", st.icon, 0, bx + 4, barY + 1, 17, 17);
      assets.drawPixelText(ctx, String(st.val), bx + 9, barY + 18, "#ffffff", 1);
    });

    // 2. Bottom-left Weapon & Skill Slots
    const slotSize = 28;
    const slotY = viewH - slotSize - 10;
    const allSlots = [
      { key: "J", item: player.slots[0] },
      { key: "U", item: player.slots[1] },
      { key: "Q", item: player.skills[0] },
      { key: "E", item: player.skills[1] },
    ];
    allSlots.forEach((entry, idx) => {
      const x = 10 + idx * (slotSize + 5);
      assets.drawNineSlice(ctx, "ui", "ui/boxHud", x - 1, slotY - 1, slotSize + 2, slotSize + 2);
      assets.drawSprite(ctx, "ui", "ui/skillSlotBg", 0, x, slotY, slotSize, slotSize);

      if (entry.item) {
        const cdbItem = cdb.itemsById.get(entry.item.id);
        if (cdbItem?.icon) {
          assets.drawIcon(ctx, cdbItem.icon.file, cdbItem.icon.x, cdbItem.icon.y, cdbItem.icon.size, x + 2, slotY + 2, 24);
        }
        if (entry.item.cdLeft > 0) {
          ctx.fillStyle = "rgba(0,0,0,0.72)";
          ctx.fillRect(x, slotY, slotSize, slotSize);
          assets.drawPixelText(ctx, entry.item.cdLeft.toFixed(0), x + 9, slotY + 10, "#ffffff", 1);
        }
      }
      assets.drawPixelText(ctx, entry.key, x + 2, slotY + 1, entry.item ? tierColor(entry.item.tier) : "#a8a2b8", 1);
    });

    // 3. Top-right Biome Name & Minimap
    const mapW = 128;
    const mapH = 34;
    const mapX = viewW - mapW - 10;
    const mapY = 10;
    assets.drawNineSlice(ctx, "ui", "ui/boxHud", mapX, mapY, mapW, mapH + 14);
    assets.drawPixelText(ctx, lvl.biomeName, mapX + 5, mapY + 3, "#e2dcf0", 1);
    this.drawMapRooms(ctx, lvl, player, mapX + 5, mapY + 14, mapW - 10, mapH - 4, showMap);

    // Full-screen Map Overlay when Tab is toggled
    if (showMap) {
      const mw = Math.min(440, viewW - 40);
      const mh = 140;
      const mx = Math.round((viewW - mw) / 2);
      const my = Math.round((viewH - mh) / 2);
      assets.drawNineSlice(ctx, "ui", "ui/boxMain", mx, my, mw, mh);
      assets.drawPixelText(ctx, `${lvl.biomeName.toUpperCase()} - MAP [TAB]`, mx + 10, my + 8, "#ffd166", 1);
      this.drawMapRooms(ctx, lvl, player, mx + 10, my + 22, mw - 20, mh - 34, true);
    }

    // 4. Boss HP Bar (The Concierge)
    const boss = enemies.find((e) => e.isBoss && e.hp > 0);
    if (boss) {
      const bw = Math.min(300, viewW - 80);
      const bx = Math.round((viewW - bw) / 2);
      const by = viewH - 54;
      assets.drawNineSlice(ctx, "ui", "ui/boxLifeBoss", bx - 3, by - 3, bw + 6, 14);
      assets.drawPixelText(ctx, "THE CONCIERGE", bx, by - 13, "#ffccd5", 1);
      assets.drawSprite(ctx, "ui", "ui/lifeFullBoss", 0, bx, by, Math.round(bw * (boss.hp / boss.maxHp)), 8);
    }

    // 5. Proximity Tooltip / Weapon Comparison
    if (nearby) {
      const tw = 210;
      const th = nearby.itemId ? 48 : 24;
      const tx = Math.round(viewW / 2 - tw / 2);
      const ty = viewH - 92;
      assets.drawNineSlice(ctx, "ui", "ui/boxMain", tx, ty, tw, th);

      const costText = nearby.cost ? ` (${nearby.cost}G)` : "";
      assets.drawPixelText(ctx, `[F] ${nearby.label}${costText}`, tx + 8, ty + 6, "#ffd166", 1);

      if (nearby.itemId) {
        const it = cdb.itemsById.get(nearby.itemId);
        const cur = player.slots[0];
        assets.drawPixelText(ctx, `New: ${it?.name ?? nearby.itemId}`, tx + 8, ty + 19, tierColor(it?.tier1), 1);
        assets.drawPixelText(ctx, `Cur: ${cur?.name ?? "None"}`, tx + 8, ty + 31, "#a8a2b8", 1);
      }
    }
  }

  private drawMapRooms(
    ctx: CanvasRenderingContext2D,
    lvl: GeneratedLevel,
    player: Player,
    x: number,
    y: number,
    w: number,
    h: number,
    revealAll: boolean
  ): void {
    const scaleX = w / lvl.tw;
    const scaleY = h / lvl.th;
    for (const r of lvl.rooms) {
      if (!r.revealed && !revealAll) continue;
      ctx.fillStyle =
        r.kind === "Shop"
          ? "#ffd166"
          : r.kind === "Treasure"
            ? "#06d6a0"
            : r.kind === "Boss"
              ? "#ef476f"
              : "#4a4063";
      ctx.fillRect(x + r.tx * scaleX, y + r.ty * scaleY, Math.max(3, r.tw * scaleX - 1), Math.max(6, r.th * scaleY));
      ctx.strokeStyle = "#8d82a8";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + r.tx * scaleX, y + r.ty * scaleY, Math.max(3, r.tw * scaleX - 1), Math.max(6, r.th * scaleY));
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + (player.body.x / 24) * scaleX - 1.5, y + (player.body.y / 24) * scaleY - 1.5, 3, 3);
  }
}
