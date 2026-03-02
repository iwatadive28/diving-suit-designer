import type { AppConfig, Color, ColorTheme, Part, Preset } from "../types";
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

function normalizeColors(colorsRaw: Color[]): Color[] {
  return colorsRaw
    .filter((color) => color.enabled)
    .map((color) => {
      const tile = color.patternTile?.trim();
      if (!tile) {
        return { ...color, patternTile: undefined };
      }
      if (!tile.startsWith("/")) {
        console.warn(`[color:${color.id}] patternTileはルートパス推奨です: ${tile}`);
      }
      return { ...color, patternTile: tile };
    })
    .sort((a, b) => a.order - b.order);
}

function normalizeAllowColors(
  partId: string,
  allowColors: string[] | undefined,
  validColorIds: Set<string>,
  fallback: string[],
): string[] {
  const input = allowColors ?? fallback;
  if (input.includes("all")) {
    return ["all"];
  }

  const filtered = input.filter((id) => {
    const valid = validColorIds.has(id);
    if (!valid) {
      console.warn(`[part:${partId}] 未定義の色IDをallowColorsから除外しました: ${id}`);
    }
    return valid;
  });

  if (filtered.length > 0) {
    return [...new Set(filtered)];
  }

  if (fallback.includes("all")) {
    return ["all"];
  }

  const fallbackFiltered = fallback.filter((id) => validColorIds.has(id));
  return fallbackFiltered.length > 0 ? fallbackFiltered : ["all"];
}

function normalizeParts(partsRaw: Part[], validColorIds: Set<string>): Part[] {
  const overrides = new Map(partsRaw.map((part) => [part.id, part]));

  partsRaw.forEach((part) => {
    if (!PART_DEFINITIONS.find((base) => base.id === part.id)) {
      console.warn(`[parts] 未定義の部位IDを無視しました: ${part.id}`);
    }
  });

  return PART_DEFINITIONS.map((basePart) => {
    const override = overrides.get(basePart.id);
    const allowColors = normalizeAllowColors(basePart.id, override?.allowColors, validColorIds, basePart.allowColors);

    const defaultColorCandidate = override?.defaultColor ?? basePart.defaultColor;
    const defaultColorValid = allowColors.includes("all")
      ? validColorIds.has(defaultColorCandidate)
      : allowColors.includes(defaultColorCandidate);

    const defaultColor = defaultColorValid ? defaultColorCandidate : basePart.defaultColor;

    if (!defaultColorValid) {
      console.warn(`[part:${basePart.id}] defaultColorが不正のためフォールバックしました: ${defaultColorCandidate}`);
    }

    return {
      ...basePart,
      name: override?.name?.trim() || basePart.name,
      allowColors,
      defaultColor,
    };
  });
}

export async function loadConfig(): Promise<AppConfig> {
  const [colorsRaw, presetsRaw, stitchRaw, themesRaw, partsRaw] = await Promise.all([
    loadJson<Color[]>("/config/colors.json"),
    loadJson<Preset[]>("/config/presets.json"),
    loadJson<Color[]>("/config/stitch-colors.json"),
    loadJson<ColorTheme[]>("/config/color-themes.json"),
    loadJson<Part[]>("/config/parts.json"),
  ]);

  const colors = normalizeColors(colorsRaw);
  const stitchColors = stitchRaw.filter((color) => color.enabled).sort((a, b) => a.order - b.order);

  const validColorIds = new Set(colors.map((color) => color.id));
  const parts = normalizeParts(partsRaw, validColorIds);

  const validPartIds = new Set(parts.map((part) => part.id));
  const validStitchIds = new Set(stitchColors.map((color) => color.id));

  const presets = normalizePresets(presetsRaw, validPartIds, validColorIds);
  const colorThemes = normalizeThemes(themesRaw, validColorIds, validStitchIds);

  return {
    colors,
    parts,
    presets,
    stitchColors,
    colorThemes,
  };
}
