import type { AppConfig, Color, ColorTheme, Preset } from "../types";
import { PART_DEFINITIONS } from "./partSpec";

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`設定ファイルの取得に失敗しました: ${url}`);
  }
  return (await response.json()) as T;
}

function normalizePresets(presets: Preset[], validPartIds: Set<string>, validColorIds: Set<string>): Preset[] {
  return presets.map((preset) => {
    const normalizedParts: Record<string, string> = {};

    Object.entries(preset.parts).forEach(([partId, colorId]) => {
      if (!validPartIds.has(partId)) {
        console.warn(`[preset:${preset.id}] 未定義の部位IDを除外しました: ${partId}`);
        return;
      }
      if (!validColorIds.has(colorId)) {
        console.warn(`[preset:${preset.id}] 未定義の色IDを除外しました: ${colorId}`);
        return;
      }
      normalizedParts[partId] = colorId;
    });

    return {
      ...preset,
      parts: normalizedParts,
    };
  });
}

function normalizeThemes(themes: ColorTheme[], colorIds: Set<string>, stitchIds: Set<string>): ColorTheme[] {
  return themes.map((theme) => ({
    ...theme,
    colors: theme.colors.filter((id) => colorIds.has(id)),
    stitchColors: (theme.stitchColors ?? []).filter((id) => stitchIds.has(id)),
  }));
}

export async function loadConfig(): Promise<AppConfig> {
  const [colorsRaw, presetsRaw, stitchRaw, themesRaw] = await Promise.all([
    loadJson<Color[]>("/config/colors.json"),
    loadJson<Preset[]>("/config/presets.json"),
    loadJson<Color[]>("/config/stitch-colors.json"),
    loadJson<ColorTheme[]>("/config/color-themes.json"),
  ]);

  const colors = colorsRaw.filter((color) => color.enabled).sort((a, b) => a.order - b.order);
  const stitchColors = stitchRaw.filter((color) => color.enabled).sort((a, b) => a.order - b.order);

  const validPartIds = new Set(PART_DEFINITIONS.map((part) => part.id));
  const validColorIds = new Set(colors.map((color) => color.id));
  const validStitchIds = new Set(stitchColors.map((color) => color.id));

  const presets = normalizePresets(presetsRaw, validPartIds, validColorIds);
  const colorThemes = normalizeThemes(themesRaw, validColorIds, validStitchIds);

  return {
    colors,
    parts: PART_DEFINITIONS,
    presets,
    stitchColors,
    colorThemes,
  };
}
