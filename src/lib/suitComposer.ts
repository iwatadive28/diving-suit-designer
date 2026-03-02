import type { AppConfig, Color, SuitState } from "../types";
import { PART_DEFINITIONS, SUIT_SOURCE_SIZE } from "./partSpec";

type PatternTile = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

type ComposerContext = {
  width: number;
  height: number;
  lineImage: HTMLImageElement;
  baseMask: Uint8Array;
  regionMap: Int16Array;
  partIndexById: Map<string, number>;
  patternTiles: Map<string, PatternTile>;
};

type PartMask = {
  key: string;
  partIndex: number;
  data: Uint8Array;
};

const LINE_SRC = "/assets/suits_alpha.png";
const BASE_MASK_SRC = "/assets/default_image.png";
const BASE_ALPHA = 236;

let context: ComposerContext | null = null;

function ensureContext(): ComposerContext {
  if (!context) {
    throw new Error("描画コンポーザが初期化されていません。");
  }
  return context;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const full = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized;
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`画像の読み込みに失敗しました: ${src}`));
  });
  return image;
}

function alphaMapFromImage(image: HTMLImageElement, width: number, height: number): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new Uint8Array(width * height);
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const out = new Uint8Array(width * height);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    out[p] = data[i + 3] > 5 ? 1 : 0;
  }

  return out;
}

function areaOf(mask: Uint8Array): number {
  let area = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) {
      area += 1;
    }
  }
  return area;
}

function buildRegionMap(baseMask: Uint8Array, partMasks: PartMask[]): Int16Array {
  const regionMap = new Int16Array(baseMask.length);
  regionMap.fill(-1);

  const priorities = [...partMasks].sort((a, b) => {
    if (a.key === "m19") {
      return 1;
    }
    if (b.key === "m19") {
      return -1;
    }
    return areaOf(a.data) - areaOf(b.data);
  });

  const fallback = partMasks.find((mask) => mask.key === "m19")?.partIndex ?? 0;

  for (let i = 0; i < baseMask.length; i += 1) {
    if (!baseMask[i]) {
      continue;
    }

    let hit = -1;
    for (let p = 0; p < priorities.length; p += 1) {
      if (priorities[p].data[i]) {
        hit = priorities[p].partIndex;
        break;
      }
    }

    regionMap[i] = hit >= 0 ? hit : fallback;
  }

  return regionMap;
}

function resolveColor(id: string | undefined, colorsById: Map<string, Color>, fallback = "#111111"): [number, number, number] {
  if (!id) {
    return hexToRgb(fallback);
  }
  const color = colorsById.get(id);
  return hexToRgb(color?.hex ?? fallback);
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f7f9fd");
  gradient.addColorStop(1, "#e6ecf6");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function imageToPatternTile(image: HTMLImageElement): PatternTile {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0]) };
  }

  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  return { width: image.width, height: image.height, data };
}

async function loadPatternTiles(colors: Color[]): Promise<Map<string, PatternTile>> {
  const out = new Map<string, PatternTile>();

  for (const color of colors) {
    if (!color.patternTile) {
      continue;
    }

    try {
      const img = await loadImage(color.patternTile);
      out.set(color.id, imageToPatternTile(img));
    } catch (error) {
      console.warn(`[pattern] 読み込み失敗: ${color.id} ${color.patternTile}`, error);
    }
  }

  return out;
}

async function ensurePatternTiles(colors: Color[]): Promise<void> {
  const current = ensureContext();
  const toLoad = colors.filter((color) => color.patternTile && !current.patternTiles.has(color.id));
  if (toLoad.length === 0) {
    return;
  }

  const loaded = await loadPatternTiles(toLoad);
  loaded.forEach((value, key) => {
    current.patternTiles.set(key, value);
  });
}

function samplePatternRgb(tile: PatternTile, x: number, y: number): [number, number, number, number] {
  const tx = ((x % tile.width) + tile.width) % tile.width;
  const ty = ((y % tile.height) + tile.height) % tile.height;
  const p = (ty * tile.width + tx) * 4;
  return [tile.data[p], tile.data[p + 1], tile.data[p + 2], tile.data[p + 3]];
}

function buildPanelImageData(
  state: SuitState,
  colors: Color[],
  regionMap: Int16Array,
  baseMask: Uint8Array,
  patternTiles: Map<string, PatternTile>,
): ImageData {
  const { width, height } = SUIT_SOURCE_SIZE;
  const image = new ImageData(width, height);
  const colorsById = new Map(colors.map((color) => [color.id, color]));

  const selectedByPart = PART_DEFINITIONS.map((part) => {
    const colorId = state.parts[part.id] ?? part.defaultColor;
    return colorsById.get(colorId);
  });

  for (let i = 0; i < regionMap.length; i += 1) {
    if (!baseMask[i]) {
      continue;
    }

    const p = i * 4;
    const partIndex = regionMap[i];
    if (partIndex < 0) {
      image.data[p] = 232;
      image.data[p + 1] = 234;
      image.data[p + 2] = 238;
      image.data[p + 3] = 230;
      continue;
    }

    const selectedColor = selectedByPart[partIndex];
    const y = Math.floor(i / width);
    const x = i - y * width;

    if (selectedColor?.patternTile && patternTiles.has(selectedColor.id)) {
      const tile = patternTiles.get(selectedColor.id);
      if (tile) {
        const [pr, pg, pb, pa] = samplePatternRgb(tile, x, y);
        image.data[p] = pr;
        image.data[p + 1] = pg;
        image.data[p + 2] = pb;
        image.data[p + 3] = Math.max(20, Math.round((pa / 255) * BASE_ALPHA));
        continue;
      }
    }

    const [r, g, b] = resolveColor(selectedColor?.id, colorsById);
    image.data[p] = r;
    image.data[p + 1] = g;
    image.data[p + 2] = b;
    image.data[p + 3] = BASE_ALPHA;
  }

  return image;
}

function drawStitchLines(target: CanvasRenderingContext2D, lineImage: HTMLImageElement, stitchHex: string, width: number, height: number): void {
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const ctx = layer.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.drawImage(lineImage, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  const [r, g, b] = hexToRgb(stitchHex);

  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    if (a === 0) {
      continue;
    }
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = Math.min(255, a * 14);
  }

  ctx.putImageData(img, 0, 0);
  target.drawImage(layer, 0, 0);
}

function drawHighlight(target: CanvasRenderingContext2D, regionMap: Int16Array, selectedPartId: string | null, partIndexById: Map<string, number>, width: number, height: number): void {
  if (!selectedPartId) {
    return;
  }
  const selected = partIndexById.get(selectedPartId);
  if (selected === undefined) {
    return;
  }

  const overlay = document.createElement("canvas");
  overlay.width = width;
  overlay.height = height;
  const ctx = overlay.getContext("2d");
  if (!ctx) {
    return;
  }

  const img = ctx.createImageData(width, height);
  const strokeR = 98;
  const strokeG = 206;
  const strokeB = 255;

  for (let i = 0; i < regionMap.length; i += 1) {
    if (regionMap[i] !== selected) {
      continue;
    }

    const p = i * 4;
    img.data[p] = 255;
    img.data[p + 1] = 255;
    img.data[p + 2] = 255;
    img.data[p + 3] = 56;

    const x = i % width;
    const y = Math.floor(i / width);
    const left = x > 0 ? regionMap[i - 1] : -1;
    const right = x < width - 1 ? regionMap[i + 1] : -1;
    const top = y > 0 ? regionMap[i - width] : -1;
    const bottom = y < height - 1 ? regionMap[i + width] : -1;

    if (left !== selected || right !== selected || top !== selected || bottom !== selected) {
      img.data[p] = strokeR;
      img.data[p + 1] = strokeG;
      img.data[p + 2] = strokeB;
      img.data[p + 3] = 195;
    }
  }

  ctx.putImageData(img, 0, 0);
  target.drawImage(overlay, 0, 0);
}

export async function initializeComposer(colors: Color[] = []): Promise<void> {
  if (context) {
    await ensurePatternTiles(colors);
    return;
  }

  const { width, height } = SUIT_SOURCE_SIZE;

  const lineImagePromise = loadImage(LINE_SRC);
  const baseImagePromise = loadImage(BASE_MASK_SRC);
  const partImagePromises = PART_DEFINITIONS.map((part) => {
    const key = part.originalRef ?? "";
    return loadImage(`/assets/masks/${key}.png`);
  });

  const [lineImage, baseImage, ...partImages] = await Promise.all([
    lineImagePromise,
    baseImagePromise,
    ...partImagePromises,
  ]);

  const baseMask = alphaMapFromImage(baseImage, width, height);
  const partMasks: PartMask[] = partImages.map((image, index) => ({
    key: PART_DEFINITIONS[index].originalRef ?? "",
    partIndex: index,
    data: alphaMapFromImage(image, width, height),
  }));

  const regionMap = buildRegionMap(baseMask, partMasks);

  const partIndexById = new Map<string, number>();
  PART_DEFINITIONS.forEach((part, index) => partIndexById.set(part.id, index));

  const patternTiles = await loadPatternTiles(colors);

  context = { width, height, lineImage, baseMask, regionMap, partIndexById, patternTiles };
}

export async function renderPreview(state: SuitState, colors: Color[], stitchColors: Color[], size: number, selectedPartId: string | null): Promise<HTMLCanvasElement> {
  await initializeComposer(colors);
  const current = ensureContext();

  const source = document.createElement("canvas");
  source.width = current.width;
  source.height = current.height;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) {
    throw new Error("Canvas初期化に失敗しました。");
  }

  drawBackground(sourceCtx, current.width, current.height);
  sourceCtx.putImageData(buildPanelImageData(state, colors, current.regionMap, current.baseMask, current.patternTiles), 0, 0);

  const stitchId = state.stitchColor ?? "st_black";
  const stitchHex = stitchColors.find((item) => item.id === stitchId)?.hex ?? "#111111";
  drawStitchLines(sourceCtx, current.lineImage, stitchHex, current.width, current.height);
  drawHighlight(sourceCtx, current.regionMap, selectedPartId, current.partIndexById, current.width, current.height);

  const out = document.createElement("canvas");
  out.width = size;
  out.height = Math.round((size * current.height) / current.width);
  const outCtx = out.getContext("2d");
  if (!outCtx) {
    throw new Error("Canvas初期化に失敗しました。");
  }
  outCtx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

export function pickPartIdByDisplayPoint(x: number, y: number, displayWidth: number, displayHeight: number): string | null {
  const current = ensureContext();
  if (displayWidth <= 0 || displayHeight <= 0) {
    return null;
  }

  const srcX = Math.max(0, Math.min(current.width - 1, Math.floor((x / displayWidth) * current.width)));
  const srcY = Math.max(0, Math.min(current.height - 1, Math.floor((y / displayHeight) * current.height)));
  const partIndex = current.regionMap[srcY * current.width + srcX];
  if (partIndex < 0) {
    return null;
  }
  return PART_DEFINITIONS[partIndex]?.id ?? null;
}

export async function exportPng(state: SuitState, colors: Color[], stitchColors: Color[]): Promise<Blob> {
  const canvas = await renderPreview(state, colors, stitchColors, 2208, null);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("PNG書き出しに失敗しました。"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

export async function renderSpecSheet(state: SuitState, config: AppConfig, shareUrl: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 3508;
  canvas.height = 2480;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("仕様書生成に失敗しました。");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#111111";
  ctx.font = "bold 58px 'Noto Sans JP', sans-serif";
  ctx.fillText("セミドライスーツ 配色仕様書", 120, 120);

  ctx.font = "32px 'Noto Sans JP', sans-serif";
  const today = new Date();
  const dateLabel = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  ctx.fillText(`作成日: ${dateLabel}`, 120, 182);
  ctx.fillText(`ステッチ: ${config.stitchColors.find((c) => c.id === state.stitchColor)?.name ?? "ブラック"}`, 120, 236);

  const preview = await renderPreview(state, config.colors, config.stitchColors, 1400, null);
  const previewHeight = Math.round((1400 * preview.height) / preview.width);
  ctx.drawImage(preview, 120, 300, 1400, previewHeight);
  ctx.strokeStyle = "#202020";
  ctx.lineWidth = 2;
  ctx.strokeRect(120, 300, 1400, previewHeight);

  ctx.font = "24px 'Noto Sans JP', sans-serif";
  ctx.fillStyle = "#222222";
  ctx.fillText("共有URL", 120, 2120);

  ctx.font = "18px 'Noto Sans JP', sans-serif";
  const wrapped = shareUrl.match(/.{1,92}/g) ?? [shareUrl];
  wrapped.slice(0, 4).forEach((line, index) => {
    ctx.fillText(line, 120, 2160 + index * 30);
  });

  const tableX = 1620;
  const tableY = 300;
  const rowHeight = 66;
  ctx.fillStyle = "#111111";
  ctx.font = "bold 28px 'Noto Sans JP', sans-serif";
  ctx.fillText("部位別カラー一覧", tableX, tableY - 20);

  ctx.font = "24px 'Noto Sans JP', sans-serif";
  for (let i = 0; i < PART_DEFINITIONS.length; i += 1) {
    const part = PART_DEFINITIONS[i];
    const y = tableY + i * rowHeight;
    const colorId = state.parts[part.id] ?? part.defaultColor;
    const color = config.colors.find((item) => item.id === colorId);

    ctx.strokeStyle = "#d0d0d0";
    ctx.strokeRect(tableX, y, 1720, rowHeight);
    ctx.fillStyle = "#111111";
    ctx.fillText(part.id.padStart(2, "0"), tableX + 16, y + 42);
    ctx.fillText(part.name, tableX + 90, y + 42);
    ctx.fillText(color?.name ?? colorId, tableX + 980, y + 42);

    ctx.fillStyle = color?.hex ?? "#999999";
    ctx.fillRect(tableX + 1420, y + 14, 240, 38);
    ctx.strokeStyle = "#444444";
    ctx.strokeRect(tableX + 1420, y + 14, 240, 38);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("仕様書PNGの生成に失敗しました。"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}
