import { ASSET_MANIFEST, resolveAssetUrl } from "../data/assetManifest";

export interface AtlasFrame {
  tex: string;
  idx: number;
  x: number;
  y: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
  ow: number;
  oh: number;
}

export type AtlasData = Record<string, AtlasFrame[]>;

interface BitmapFont {
  tex: string;
  size: number;
  lineH: number;
  glyphs: Record<string, { x: number; y: number; w: number; h: number; dx: number; dy: number; adv: number }>;
}

export class AssetLoader {
  public images = new Map<string, CanvasImageSource>();
  public imagesByFile = new Map<string, CanvasImageSource>();
  public imageSizes = new Map<string, { w: number; h: number }>();
  public atlases = new Map<string, AtlasData>();
  private font: BitmapFont | null = null;
  private glyphCache = new Map<string, HTMLCanvasElement>();

  async loadAll(onProgress?: (pct: number) => void): Promise<void> {
    const imgEntries = Object.entries(ASSET_MANIFEST.images);
    const atlasEntries = Object.entries(ASSET_MANIFEST.atlases);
    const total = imgEntries.length + atlasEntries.length + 1;
    let done = 0;

    const tick = () => {
      done++;
      onProgress?.(done / total);
    };

    await Promise.all([
      ...imgEntries.map(async ([key, url]) => {
        const img = await this.loadImage(resolveAssetUrl(url));
        this.images.set(key, img);
        const fileName = url.split("/").pop()!;
        this.imagesByFile.set(fileName, img);
        this.imageSizes.set(key, { w: img.width, h: img.height });
        tick();
      }),
      ...atlasEntries.map(async ([key, url]) => {
        const res = await fetch(resolveAssetUrl(url));
        const json = (await res.json()) as AtlasData;
        this.atlases.set(key, json);
        tick();
      }),
      fetch(resolveAssetUrl("assets/data/victor_pixel_8.json"))
        .then((r) => (r.ok ? r.json() : null))
        .then((f) => {
          this.font = f as BitmapFont | null;
          tick();
        })
        .catch(() => tick()),
    ]);

    // Bake palette-indexed character sheets via WebGL shader (with 2D canvas fallback)
    const behPal = this.images.get("beheadedPal") as HTMLImageElement | undefined;
    if (behPal) {
      for (const k of ["beheaded0", "beheaded1", "beheaded2"]) {
        const src = this.images.get(k) as HTMLImageElement | undefined;
        if (src) {
          const baked = this.bakePalette(src, behPal);
          this.images.set(k, baked);
          this.imagesByFile.set(`${k}.png`, baked);
        }
      }
    }
    const behmPal = this.images.get("behemothPal") as HTMLImageElement | undefined;
    const behmSrc = this.images.get("behemoth0") as HTMLImageElement | undefined;
    if (behmPal && behmSrc) {
      const baked = this.bakePalette(behmSrc, behmPal);
      this.images.set("behemoth0", baked);
      this.imagesByFile.set("behemoth0.png", baked);
    }
  }

  private bakePalette(diffuse: HTMLImageElement, palette: HTMLImageElement): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = diffuse.width;
    out.height = diffuse.height;

    const gl = out.getContext("webgl", { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (gl) {
      const vsSrc = `
        attribute vec2 a_pos;
        varying vec2 v_uv;
        void main() {
          v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }`;
      const fsSrc = `
        precision mediump float;
        uniform sampler2D u_tex;
        uniform sampler2D u_pal;
        varying vec2 v_uv;
        void main() {
          vec4 idx = texture2D(u_tex, v_uv);
          if (idx.a < 0.01) discard;
          vec4 col = texture2D(u_pal, vec2(idx.r, idx.g));
          gl_FragColor = vec4(col.rgb, col.a * idx.a);
        }`;

      const compile = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(prog);
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const makeTex = (unit: number, img: HTMLImageElement, name: string) => {
        const t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.uniform1i(gl.getUniformLocation(prog, name), unit);
      };
      makeTex(0, diffuse, "u_tex");
      makeTex(1, palette, "u_pal");

      gl.viewport(0, 0, out.width, out.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Copy WebGL buffer into a 2D canvas so drawImage never loses WebGL context
      const c2d = document.createElement("canvas");
      c2d.width = out.width;
      c2d.height = out.height;
      c2d.getContext("2d")!.drawImage(out, 0, 0);
      return c2d;
    }

    // 2D fallback
    const ctx = out.getContext("2d")!;
    ctx.drawImage(diffuse, 0, 0);
    return out;
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = url;
    });
  }

  getFrame(atlasKey: string, animName: string, frameIndex: number): AtlasFrame | null {
    const atlas = this.atlases.get(atlasKey);
    if (!atlas) return null;
    const list = atlas[animName];
    if (!list || list.length === 0) return null;
    return list[Math.abs(frameIndex) % list.length];
  }

  getAnimLength(atlasKey: string, animName: string): number {
    return this.atlases.get(atlasKey)?.[animName]?.length ?? 1;
  }

  /**
   * Draw an atlas frame anchored at its Dead Cells foot pivot (ow/2, oh/2).
   */
  drawFrame(
    ctx: CanvasRenderingContext2D,
    atlasKey: string,
    animName: string,
    frameIndex: number,
    wx: number,
    wy: number,
    facing: 1 | -1 = 1,
    scale = 1,
    alpha = 1
  ): boolean {
    const f = this.getFrame(atlasKey, animName, frameIndex);
    if (!f) return false;
    const img = this.imagesByFile.get(f.tex);
    if (!img) return false;

    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.translate(Math.round(wx), Math.round(wy));
    ctx.scale(facing * scale, scale);
    const drawX = Math.round(-f.ow / 2 + f.dx);
    const drawY = Math.round(-f.oh / 2 + f.dy);
    ctx.drawImage(img, f.x, f.y, f.w, f.h, drawX, drawY, f.w, f.h);
    ctx.restore();
    return true;
  }

  drawIcon(
    ctx: CanvasRenderingContext2D,
    file: string,
    gx: number,
    gy: number,
    size: number,
    dx: number,
    dy: number,
    destSize: number
  ): void {
    const img = this.imagesByFile.get(file);
    if (!img) return;
    ctx.drawImage(img, gx * size, gy * size, size, size, Math.round(dx), Math.round(dy), destSize, destSize);
  }

  drawSprite(
    ctx: CanvasRenderingContext2D,
    atlasKey: string,
    spriteName: string,
    frameIdx: number,
    dx: number,
    dy: number,
    dw?: number,
    dh?: number
  ): boolean {
    const f = this.getFrame(atlasKey, spriteName, frameIdx);
    if (!f) return false;
    const img = this.imagesByFile.get(f.tex);
    if (!img) return false;
    ctx.drawImage(img, f.x, f.y, f.w, f.h, Math.round(dx), Math.round(dy), dw ?? f.w, dh ?? f.h);
    return true;
  }

  drawNineSlice(
    ctx: CanvasRenderingContext2D,
    atlasKey: string,
    spriteName: string,
    x: number,
    y: number,
    w: number,
    h: number
  ): boolean {
    const f = this.getFrame(atlasKey, spriteName, 0);
    if (!f) return false;
    const img = this.imagesByFile.get(f.tex);
    if (!img) return false;
    const c = Math.max(1, Math.floor(f.w / 2));
    const mw = Math.max(0, w - c * 2);
    const mh = Math.max(0, h - c * 2);
    const rx = Math.round(x);
    const ry = Math.round(y);
    ctx.drawImage(img, f.x, f.y, c, c, rx, ry, c, c);
    ctx.drawImage(img, f.x + f.w - c, f.y, c, c, rx + w - c, ry, c, c);
    ctx.drawImage(img, f.x, f.y + f.h - c, c, c, rx, ry + h - c, c, c);
    ctx.drawImage(img, f.x + f.w - c, f.y + f.h - c, c, c, rx + w - c, ry + h - c, c, c);
    ctx.drawImage(img, f.x + c, f.y, 1, c, rx + c, ry, mw, c);
    ctx.drawImage(img, f.x + c, f.y + f.h - c, 1, c, rx + c, ry + h - c, mw, c);
    ctx.drawImage(img, f.x, f.y + c, c, 1, rx, ry + c, c, mh);
    ctx.drawImage(img, f.x + f.w - c, f.y + c, c, 1, rx + w - c, ry + c, c, mh);
    ctx.drawImage(img, f.x + c, f.y + c, 1, 1, rx + c, ry + c, mw, mh);
    return true;
  }

  drawPixelText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color = "#ffffff",
    scale = 1
  ): void {
    if (!this.font) {
      ctx.fillStyle = color;
      ctx.font = `bold ${Math.round(10 * scale)}px monospace`;
      ctx.fillText(text, Math.round(x), Math.round(y + 9 * scale));
      return;
    }
    const fontImg = this.imagesByFile.get(this.font.tex);
    if (!fontImg) return;

    let tinted = this.glyphCache.get(color);
    if (!tinted) {
      const sz = this.imageSizes.get("victorPixel8") ?? { w: 256, h: 128 };
      tinted = document.createElement("canvas");
      tinted.width = sz.w;
      tinted.height = sz.h;
      const tctx = tinted.getContext("2d")!;
      tctx.drawImage(fontImg, 0, 0);
      tctx.globalCompositeOperation = "source-in";
      tctx.fillStyle = color;
      tctx.fillRect(0, 0, sz.w, sz.h);
      this.glyphCache.set(color, tinted);
    }

    let cx = Math.round(x);
    const cy = Math.round(y);
    for (const ch of text) {
      const g = this.font.glyphs[ch];
      if (!g) {
        cx += Math.round(4 * scale);
        continue;
      }
      if (g.w > 0 && g.h > 0) {
        ctx.drawImage(
          tinted,
          g.x,
          g.y,
          g.w,
          g.h,
          Math.round(cx + g.dx * scale),
          Math.round(cy + g.dy * scale),
          Math.round(g.w * scale),
          Math.round(g.h * scale)
        );
      }
      cx += Math.round(g.adv * scale);
    }
  }
}
