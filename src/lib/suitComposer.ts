import type { AppConfig, Color, SuitState } from "../types";
import { PART_DEFINITIONS, SUIT_SOURCE_SIZE } from "./partSpec";

type ComposerContext = {
  width: number;
  height: number;
  lineImage: HTMLImageElement;
  baseMask: Uint8Array;
  regionMap: Int16Array;
  partIndexById: Map<string, number>;
};

type PartMask = {
  key: string;
  partIndex: number;
  data: Uint8Array;
};

const LINE_SRC = "/assets/suits_alpha.png";
const BASE_MASK_SRC = "/assets/default_image.png";

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
    // m19(膝パッド)は全体形状を含むため最終適用
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

function resolveColor(id: string | undefined, colors: Color[], fallback = "#111111"): [number, number, number] {
  if (!id) {
    return hexToRgb(fallback);
  }
  const color = colors.find((item) => item.id === id);
  return hexToRgb(color?.hex ?? fallback);
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f7f9fd");
  gradient.addColorStop(1, "#e6ecf6");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function buildPanelImageData(state: SuitState, colors: Color[], regionMap: Int16Array, baseMask: Uint8Array): ImageData {
  const { width, height } = SUIT_SOURCE_SIZE;
  const image = new ImageData(width, height);

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

    const part = PART_DEFINITIONS[partIndex];
    const selectedColorId = state.parts[part.id] ?? part.defaultColor;
    const [r, g, b] = resolveColor(selectedColorId, colors);
    image.data[p] = r;
    image.data[p + 1] = g;
    image.data[p + 2] = b;
    image.data[p + 3] = 236;
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
  for (let i = 0; i < regionMap.length; i += 1) {
    if (regionMap[i] !== selected) {
      continue;
    }
    const p = i * 4;
    img.data[p] = 255;
    img.data[p + 1] = 255;
    img.data[p + 2] = 255;
    img.data[p + 3] = 28;
  }
  ctx.putImageData(img, 0, 0);
  target.drawImage(overlay, 0, 0);
}

export async function initializeComposer(): Promise<void> {
  if (context) {
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

  context = { width, height, lineImage, baseMask, regionMap, partIndexById };
}

export async function renderPreview(state: SuitState, colors: Color[], stitchColors: Color[], size: number, selectedPartId: string | null): Promise<HTMLCanvasElement> {
  const current = ensureContext();

  const source = document.createElement("canvas");
  source.width = current.width;
  source.height = current.height;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) {
    throw new Error("Canvas初期化に失敗しました。");
  }

  drawBackground(sourceCtx, current.width, current.height);
  sourceCtx.putImageData(buildPanelImageData(state, colors, current.regionMap, current.baseMask), 0, 0);

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
