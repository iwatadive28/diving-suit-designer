import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type TouchEvent,
} from "react";
import { loadConfig } from "./lib/config";
import { choosePreviewSize } from "./lib/perf";
import {
  exportPng,
  initializeComposer,
  pickPartIdByDisplayPoint,
  renderPreview,
  renderSpecSheet,
} from "./lib/suitComposer";
import { deserializeState, serializeState } from "./lib/stateCodec";
import type { AppConfig, Color, ColorTheme, Part, SuitState, Toast } from "./types";

const MAX_SHARE_URL_LENGTH = 2000;
const RECENT_STORAGE_KEY = "recent_colors_v3";
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

type PaletteState = {
  open: boolean;
  x: number;
  y: number;
  partId: string | null;
};

type Point = { x: number; y: number };

type TouchRuntime = {
  mode: "none" | "tap" | "pan" | "pinch";
  lastX: number;
  lastY: number;
  moved: boolean;
  pinchStartDistance: number;
  pinchStartZoom: number;
  lastTapAt: number;
};

function createDefaultState(config: AppConfig): SuitState {
  const parts = Object.fromEntries(config.parts.map((part) => [part.id, part.defaultColor]));
  return {
    parts,
    stitchColor: config.stitchColors[0]?.id,
  };
}

function resolveSelectableColors(part: Part, allColors: Color[]): Color[] {
  if (part.allowColors.includes("all")) {
    return allColors;
  }
  const allowedSet = new Set(part.allowColors);
  return allColors.filter((color) => allowedSet.has(color.id));
}

function readRecentColors(): string[] {
  try {
    const raw = sessionStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function writeRecentColors(ids: string[]): void {
  sessionStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(ids.slice(0, 8)));
}

function todayLabel(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function blobToUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = blobToUrl(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function sortColorIdsByRecent(allIds: string[], recents: string[]): string[] {
  return [...allIds].sort((a, b) => {
    const ai = recents.includes(a) ? recents.indexOf(a) : Number.POSITIVE_INFINITY;
    const bi = recents.includes(b) ? recents.indexOf(b) : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return allIds.indexOf(a) - allIds.indexOf(b);
  });
}

function sanitizeState(raw: SuitState, config: AppConfig): SuitState {
  const colorSet = new Set(config.colors.map((color) => color.id));
  const stitchSet = new Set(config.stitchColors.map((color) => color.id));

  const parts = Object.fromEntries(
    config.parts.map((part) => {
      const selected = raw.parts[part.id];
      const selectable = resolveSelectableColors(part, config.colors).map((color) => color.id);
      const fallback = selectable.includes(part.defaultColor)
        ? part.defaultColor
        : selectable[0] ?? config.colors[0]?.id ?? "black";
      return [part.id, selected && selectable.includes(selected) && colorSet.has(selected) ? selected : fallback];
    }),
  );

  const stitchColor = raw.stitchColor && stitchSet.has(raw.stitchColor)
    ? raw.stitchColor
    : config.stitchColors[0]?.id;

  return {
    parts,
    preset: config.presets.find((preset) => preset.id === raw.preset)?.id,
    stitchColor,
  };
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function applyRandomRecommendation(theme: ColorTheme, config: AppConfig, state: SuitState): SuitState {
  const nextParts: Record<string, string> = {};

  config.parts.forEach((part) => {
    const selectable = resolveSelectableColors(part, config.colors).map((color) => color.id);
    const themed = theme.colors.filter((id) => selectable.includes(id));
    const pool = themed.length > 0 ? themed : selectable;
    nextParts[part.id] = pickRandom(pool);
  });

  const stitchCandidates = (theme.stitchColors && theme.stitchColors.length > 0)
    ? theme.stitchColors
    : config.stitchColors.map((color) => color.id);

  return {
    ...state,
    preset: undefined,
    parts: nextParts,
    stitchColor: pickRandom(stitchCandidates),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampPalettePosition(anchor: Point, paletteSize: { width: number; height: number }, viewportSize: { width: number; height: number }): Point {
  const margin = 8;
  return {
    x: clamp(anchor.x, margin + paletteSize.width / 2, viewportSize.width - margin - paletteSize.width / 2),
    y: clamp(anchor.y, margin + paletteSize.height / 2, viewportSize.height - margin - paletteSize.height / 2),
  };
}

function toImageSpacePoint(screenPoint: Point, zoom: number, panX: number, panY: number, viewportSize: { width: number; height: number }): Point {
  const cx = viewportSize.width / 2;
  const cy = viewportSize.height / 2;

  return {
    x: ((screenPoint.x - cx - panX) / zoom) + cx,
    y: ((screenPoint.y - cy - panY) / zoom) + cy,
  };
}

function clampPan(panX: number, panY: number, zoom: number, viewportSize: { width: number; height: number }): Point {
  if (zoom <= 1) {
    return { x: 0, y: 0 };
  }

  const maxX = ((zoom - 1) * viewportSize.width) / 2;
  const maxY = ((zoom - 1) * viewportSize.height) / 2;

  return {
    x: clamp(panX, -maxX, maxX),
    y: clamp(panY, -maxY, maxY),
  };
}

function estimatePaletteSize(colorCount: number, isMobile: boolean): { width: number; height: number } {
  const columns = isMobile ? 6 : 5;
  const rows = Math.max(1, Math.ceil(colorCount / columns));
  return {
    width: isMobile ? 250 : 220,
    height: 42 + rows * 38,
  };
}

function buildBlackState(config: AppConfig, current: SuitState): SuitState {
  const nextParts: Record<string, string> = {};
  config.parts.forEach((part) => {
    const selectable = resolveSelectableColors(part, config.colors).map((color) => color.id);
    nextParts[part.id] = selectable.includes("black") ? "black" : (selectable[0] ?? part.defaultColor);
  });

  const stitchBlack = config.stitchColors.find((color) => color.id === "st_black")?.id ?? config.stitchColors[0]?.id;

  return {
    ...current,
    parts: nextParts,
    preset: undefined,
    stitchColor: stitchBlack,
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function App(): JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [state, setState] = useState<SuitState | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string>("1");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [fileNameInput, setFileNameInput] = useState("");
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedThemeId, setSelectedThemeId] = useState<string>("");
  const [partPanelCollapsed, setPartPanelCollapsed] = useState(false);
  const [palette, setPalette] = useState<PaletteState>({ open: false, x: 50, y: 50, partId: null });
  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const paletteRef = useRef<HTMLDivElement | null>(null);
  const touchRuntimeRef = useRef<TouchRuntime>({
    mode: "none",
    lastX: 0,
    lastY: 0,
    moved: false,
    pinchStartDistance: 0,
    pinchStartZoom: 1,
    lastTapAt: 0,
  });

  const previewSize = useMemo(() => choosePreviewSize(), []);

  const addToast = (message: string): void => {
    const toast: Toast = { id: crypto.randomUUID(), message };
    setToasts((prev) => [...prev, toast]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== toast.id));
    }, 3000);
  };

  useEffect(() => {
    setRecentColors(readRecentColors());

    const media = window.matchMedia("(max-width: 960px)");
    const applyMobile = (): void => setIsMobile(media.matches);
    applyMobile();
    media.addEventListener("change", applyMobile);

    return () => media.removeEventListener("change", applyMobile);
  }, []);

  useEffect(() => {
    let alive = true;

    async function boot(): Promise<void> {
      try {
        setLoading(true);
        const loaded = await loadConfig();
        await initializeComposer(loaded.colors);
        if (!alive) return;

        const parsed = deserializeState(window.location.search);
        const initial = parsed ? sanitizeState(parsed, loaded) : createDefaultState(loaded);

        setConfig(loaded);
        setState(initial);
        setSelectedPartId(loaded.parts[0]?.id ?? "1");
        setSelectedThemeId(loaded.colorThemes[0]?.id ?? "");
        setPartPanelCollapsed(window.matchMedia("(max-width: 960px)").matches);
      } catch (error) {
        setFatalError(error instanceof Error ? error.message : "初期化に失敗しました。");
      } finally {
        if (alive) setLoading(false);
      }
    }

    boot();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!config || !state) return;
    const safe = sanitizeState(state, config);
    const query = serializeState(safe);
    window.history.replaceState({}, "", `${window.location.pathname}?${query}`);
  }, [state, config]);

  useEffect(() => {
    if (!config || !state) return;
    let alive = true;
    const stateForPreview = state;
    const panelColors = config.colors;
    const stitchColors = config.stitchColors;

    async function refreshPreview(): Promise<void> {
      try {
        const canvas = await renderPreview(
          stateForPreview,
          panelColors,
          stitchColors,
          previewSize,
          selectedPartId,
        );
        if (!alive) return;
        setPreviewUrl(canvas.toDataURL("image/png"));
      } catch (error) {
        addToast(error instanceof Error ? error.message : "プレビュー更新に失敗しました。");
      }
    }

    refreshPreview();
    return () => {
      alive = false;
    };
  }, [config, state, previewSize, selectedPartId]);

  useEffect(() => {
    if (!palette.open || !paletteRef.current || !previewBoxRef.current) return;

    const paletteEl = paletteRef.current;
    const rect = previewBoxRef.current.getBoundingClientRect();
    const clamped = clampPalettePosition(
      { x: palette.x, y: palette.y },
      { width: paletteEl.offsetWidth, height: paletteEl.offsetHeight },
      { width: rect.width, height: rect.height },
    );

    if (Math.abs(clamped.x - palette.x) > 0.5 || Math.abs(clamped.y - palette.y) > 0.5) {
      setPalette((prev) => ({ ...prev, x: clamped.x, y: clamped.y }));
    }
  }, [palette.open, palette.x, palette.y, selectedPartId]);

  if (loading) {
    return <div className="loading">読み込み中...</div>;
  }

  if (!config || !state || fatalError) {
    return (
      <div className="fatal">
        <h1>初期化エラー</h1>
        <p>{fatalError ?? "設定読み込みに失敗しました。"}</p>
        <button type="button" onClick={() => window.location.reload()}>再読み込み</button>
      </div>
    );
  }

  const selectedPart = config.parts.find((part) => part.id === selectedPartId) ?? config.parts[0];
  const selectableForSelected = resolveSelectableColors(selectedPart, config.colors);
  const colorIds = sortColorIdsByRecent(selectableForSelected.map((color) => color.id), recentColors);

  const openPaletteAt = (anchor: Point, partId: string): void => {
    const part = config.parts.find((item) => item.id === partId) ?? selectedPart;
    const colors = resolveSelectableColors(part, config.colors);
    const box = previewBoxRef.current;
    if (!box) return;

    const rect = box.getBoundingClientRect();
    const size = estimatePaletteSize(colors.length, isMobile);
    const clamped = clampPalettePosition(anchor, size, { width: rect.width, height: rect.height });

    setPalette({
      open: true,
      x: clamped.x,
      y: clamped.y,
      partId,
    });
  };

  const onSelectColor = (colorId: string, partId = selectedPart.id): void => {
    const targetPart = config.parts.find((part) => part.id === partId) ?? selectedPart;
    const selectable = resolveSelectableColors(targetPart, config.colors);
    if (!selectable.find((color) => color.id === colorId)) {
      addToast("この部位では選択できない色です。");
      return;
    }

    setState((prev) => {
      if (!prev) return prev;
      const beforeStitch = prev.stitchColor;
      const next: SuitState = {
        ...prev,
        parts: {
          ...prev.parts,
          [targetPart.id]: colorId,
        },
        stitchColor: prev.stitchColor,
      };

      if (window.location.hostname === "localhost" && next.stitchColor !== beforeStitch) {
        console.warn("パネル色変更でステッチ色が変化しました。処理を確認してください。");
      }

      return next;
    });

    setSelectedPartId(targetPart.id);
    setPalette((prev) => ({ ...prev, open: false }));

    const nextRecents = [colorId, ...recentColors.filter((id) => id !== colorId)].slice(0, 8);
    setRecentColors(nextRecents);
    writeRecentColors(nextRecents);
  };

  const onApplyPreset = (presetId: string): void => {
    const preset = config.presets.find((item) => item.id === presetId);
    if (!preset) {
      addToast("プリセットが見つかりません。");
      return;
    }

    setState((prev) => {
      if (!prev) return prev;
      return sanitizeState(
        {
          ...prev,
          preset: preset.id,
          parts: {
            ...prev.parts,
            ...preset.parts,
          },
        },
        config,
      );
    });

    setPalette((prev) => ({ ...prev, open: false }));
    setMenuOpen(false);
  };

  const onRecommendRandom = (): void => {
    const theme = config.colorThemes.find((item) => item.id === selectedThemeId);
    if (!theme) {
      addToast("テーマを選択してください。");
      return;
    }

    setState((prev) => {
      if (!prev) return prev;
      return sanitizeState(applyRandomRecommendation(theme, config, prev), config);
    });
    addToast(`おすすめを生成しました: ${theme.name}`);
    setPalette((prev) => ({ ...prev, open: false }));
    setMenuOpen(false);
  };

  const onResetBlack = (): void => {
    setState((prev) => {
      if (!prev) return prev;
      return sanitizeState(buildBlackState(config, prev), config);
    });
    setPalette((prev) => ({ ...prev, open: false }));
    addToast("全身をブラックにリセットしました。");
    setMenuOpen(false);
  };

  const handlePreviewTapPoint = (screenPoint: Point): void => {
    const box = previewBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();

    const srcPoint = toImageSpacePoint(screenPoint, zoom, panX, panY, { width: rect.width, height: rect.height });
    const picked = pickPartIdByDisplayPoint(srcPoint.x, srcPoint.y, rect.width, rect.height);

    if (!picked) {
      setPalette((prev) => ({ ...prev, open: false }));
      return;
    }

    setSelectedPartId(picked);
    openPaletteAt(screenPoint, picked);
  };

  const onPreviewClick = (event: MouseEvent<HTMLDivElement>): void => {
    const box = previewBoxRef.current;
    if (!box) return;

    const rect = box.getBoundingClientRect();
    const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    handlePreviewTapPoint(screenPoint);
  };

  const onPreviewTouchStart = (event: TouchEvent<HTMLDivElement>): void => {
    const rt = touchRuntimeRef.current;

    if (event.touches.length === 2) {
      const a = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      const b = { x: event.touches[1].clientX, y: event.touches[1].clientY };
      rt.mode = "pinch";
      rt.pinchStartDistance = distance(a, b);
      rt.pinchStartZoom = zoom;
      rt.moved = false;
      return;
    }

    if (event.touches.length === 1) {
      const t = event.touches[0];
      rt.mode = zoom > 1 ? "pan" : "tap";
      rt.lastX = t.clientX;
      rt.lastY = t.clientY;
      rt.moved = false;
    }
  };

  const onPreviewTouchMove = (event: TouchEvent<HTMLDivElement>): void => {
    const box = previewBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const rt = touchRuntimeRef.current;

    if (rt.mode === "pinch" && event.touches.length === 2) {
      event.preventDefault();
      const a = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      const b = { x: event.touches[1].clientX, y: event.touches[1].clientY };
      const d = Math.max(1, distance(a, b));
      const ratio = d / Math.max(1, rt.pinchStartDistance);
      const nextZoom = clamp(rt.pinchStartZoom * ratio, MIN_ZOOM, MAX_ZOOM);
      setZoom(nextZoom);
      const clampedPan = clampPan(panX, panY, nextZoom, { width: rect.width, height: rect.height });
      setPanX(clampedPan.x);
      setPanY(clampedPan.y);
      rt.moved = true;
      return;
    }

    if (rt.mode === "pan" && event.touches.length === 1) {
      event.preventDefault();
      const t = event.touches[0];
      const dx = t.clientX - rt.lastX;
      const dy = t.clientY - rt.lastY;
      rt.lastX = t.clientX;
      rt.lastY = t.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        rt.moved = true;
      }
      const nextPan = clampPan(panX + dx, panY + dy, zoom, { width: rect.width, height: rect.height });
      setPanX(nextPan.x);
      setPanY(nextPan.y);
      return;
    }

    if (rt.mode === "tap" && event.touches.length === 1) {
      const t = event.touches[0];
      if (Math.hypot(t.clientX - rt.lastX, t.clientY - rt.lastY) > 8) {
        rt.moved = true;
      }
    }
  };

  const onPreviewTouchEnd = (event: TouchEvent<HTMLDivElement>): void => {
    const box = previewBoxRef.current;
    if (!box) return;

    const rt = touchRuntimeRef.current;

    if (event.touches.length > 0) {
      return;
    }

    const now = Date.now();

    if (!rt.moved && rt.mode === "tap") {
      const rect = box.getBoundingClientRect();
      const changed = event.changedTouches[0];
      if (changed) {
        const point = { x: changed.clientX - rect.left, y: changed.clientY - rect.top };
        if (now - rt.lastTapAt < 280) {
          setZoom(1);
          setPanX(0);
          setPanY(0);
        } else {
          handlePreviewTapPoint(point);
        }
      }
      rt.lastTapAt = now;
    }

    rt.mode = "none";
    rt.moved = false;
  };

  const palettePart = palette.partId
    ? config.parts.find((part) => part.id === palette.partId) ?? selectedPart
    : selectedPart;
  const paletteColors = resolveSelectableColors(palettePart, config.colors);

  const shareUrl = `${window.location.origin}${window.location.pathname}?${serializeState(state)}`;

  const onCopyUrl = async (): Promise<void> => {
    if (shareUrl.length > MAX_SHARE_URL_LENGTH) {
      addToast("URLが長すぎるためコピーできません。設定数を減らしてください。");
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      addToast("共有URLをコピーしました。");
      setMenuOpen(false);
    } catch {
      addToast("URLコピーに失敗しました。");
    }
  };

  const onSaveSuitPng = async (): Promise<void> => {
    try {
      setIsSaving(true);
      const blob = await exportPng(state, config.colors, config.stitchColors);
      const filename = fileNameInput.trim() ? `${fileNameInput.trim()}_suit.png` : `suit_${todayLabel()}.png`;
      triggerDownload(blob, filename);
      addToast("スーツ画像を保存しました。");
      setMenuOpen(false);
    } catch (error) {
      addToast(error instanceof Error ? error.message : "画像保存に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  };

  const onSaveSpecPng = async (): Promise<void> => {
    try {
      setIsSaving(true);
      const blob = await renderSpecSheet(state, config, shareUrl);
      const filename = fileNameInput.trim() ? `${fileNameInput.trim()}_spec.png` : `spec_${todayLabel()}.png`;
      triggerDownload(blob, filename);
      addToast("仕様書PNGを保存しました。");
      setMenuOpen(false);
    } catch (error) {
      addToast(error instanceof Error ? error.message : "仕様書生成に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  };

  const onPrintSpec = async (): Promise<void> => {
    try {
      const blob = await renderSpecSheet(state, config, shareUrl);
      const url = blobToUrl(blob);
      const win = window.open("", "_blank");
      if (!win) {
        addToast("ポップアップを許可してください。");
        return;
      }
      win.document.write(`<html><body style=\"margin:0\"><img src=\"${url}\" style=\"width:100%\" /></body></html>`);
      win.document.close();
      win.focus();
      win.print();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMenuOpen(false);
    } catch (error) {
      addToast(error instanceof Error ? error.message : "印刷用生成に失敗しました。");
    }
  };

  const titleText = isMobile ? "セミドライスーツシミュレーター" : "セミドライスーツデザインシミュレーター";

  const menuSection = (
    <>
      <div className="menu-section">
        <h3>プリセット / ランダムおすすめ</h3>
        <div className="preset-grid">
          {config.presets.map((preset) => (
            <button key={preset.id} type="button" className="preset-btn" onClick={() => onApplyPreset(preset.id)}>
              {preset.name}
            </button>
          ))}
        </div>
        <div className="recommend-row">
          <select value={selectedThemeId} onChange={(event) => setSelectedThemeId(event.target.value)}>
            {config.colorThemes.map((theme) => (
              <option key={theme.id} value={theme.id}>{theme.name}</option>
            ))}
          </select>
          <button type="button" className="preset-btn" onClick={onRecommendRandom}>おすすめ生成</button>
        </div>
      </div>

      <div className="menu-section">
        <h3>出力 / 共有</h3>
        <div className="save-row">
          <input
            value={fileNameInput}
            onChange={(event) => setFileNameInput(event.target.value)}
            type="text"
            placeholder="案件名（任意）"
          />
          <button type="button" onClick={onSaveSuitPng} disabled={isSaving}>スーツ画像保存</button>
        </div>
        <div className="action-row">
          <button type="button" className="share-btn" onClick={onSaveSpecPng} disabled={isSaving}>仕様書PNG</button>
          <button type="button" className="share-btn" onClick={onPrintSpec}>印刷</button>
          <button type="button" className="share-btn" onClick={onCopyUrl}>URLコピー</button>
        </div>
      </div>

      <div className="menu-section">
        <button type="button" className="danger-btn" onClick={onResetBlack}>全身ブラックにリセット</button>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-head-row">
          <p className="hero-tag">ORDER SHEET READY</p>
          {isMobile ? (
            <button type="button" className="menu-toggle" onClick={() => setMenuOpen((prev) => !prev)} aria-label="メニュー">
              ☰
            </button>
          ) : null}
        </div>
        <h1>{titleText}</h1>
      </header>

      <main className="layout-v2">
        <section className="top-grid">
          <div className="section-block preview-panel">
            <h2>デザインプレビュー（画像タップで部位と色を選択）</h2>
            <div
              className="preview-canvas-wrap"
              ref={previewBoxRef}
              onClick={onPreviewClick}
              onTouchStart={onPreviewTouchStart}
              onTouchMove={onPreviewTouchMove}
              onTouchEnd={onPreviewTouchEnd}
              role="button"
              tabIndex={0}
            >
              <div className="preview-transform" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}>
                {previewUrl ? <img src={previewUrl} className="preview-image" alt="スーツプレビュー" /> : null}
              </div>
              {palette.open ? (
                <div
                  ref={paletteRef}
                  className="tap-palette"
                  style={{ left: `${palette.x}px`, top: `${palette.y}px` }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="tap-palette-title">{palettePart.name}</div>
                  <div className="tap-palette-grid">
                    {paletteColors.map((color) => (
                      <button
                        key={`tap-${palettePart.id}-${color.id}`}
                        type="button"
                        className={state.parts[palettePart.id] === color.id ? "tap-color-btn active" : "tap-color-btn"}
                        onClick={() => onSelectColor(color.id, palettePart.id)}
                        title={color.name}
                        aria-label={color.name}
                      >
                        <span className="swatch" style={{ backgroundColor: color.hex }} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <p className="hint">選択中: {selectedPart ? `${selectedPart.id}. ${selectedPart.name}` : "未選択"}</p>
            <p className="hint zoom">ズーム: {zoom.toFixed(2)}x（2本指ピンチ / 1本指ドラッグ / ダブルタップで戻す）</p>
          </div>

          <div className="section-block part-panel">
            <div className="section-head-row">
              <h2>選択部位（19部位）</h2>
              <button
                type="button"
                className="compact-toggle"
                onClick={() => setPartPanelCollapsed((prev) => !prev)}
              >
                {partPanelCollapsed ? "開く" : "閉じる"}
              </button>
            </div>
            {!partPanelCollapsed ? (
              <div className="part-grid long">
                {config.parts.map((part) => (
                  <button
                    key={part.id}
                    type="button"
                    className={part.id === selectedPart.id ? "part-btn active" : "part-btn"}
                    onClick={() => {
                      setSelectedPartId(part.id);
                      setPalette((prev) => ({ ...prev, open: false }));
                    }}
                  >
                    {part.id}. {part.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="collapsed-note">プレビューをタップして部位選択できます。</p>
            )}
          </div>
        </section>

        <section className="section-block">
          <h2>パネルカラー一覧（{selectedPart.name}）</h2>
          <div className="color-grid">
            {colorIds.map((colorId) => {
              const color = config.colors.find((item) => item.id === colorId);
              if (!color) return null;
              return (
                <button
                  key={color.id}
                  type="button"
                  className={state.parts[selectedPart.id] === color.id ? "color-btn active" : "color-btn"}
                  onClick={() => onSelectColor(color.id)}
                >
                  <span className="swatch" style={{ backgroundColor: color.hex }} />
                  <span>{color.name}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="section-block">
          <h2>ステッチカラー</h2>
          <div className="color-grid stitch">
            {config.stitchColors.map((stitch) => (
              <button
                key={stitch.id}
                type="button"
                className={state.stitchColor === stitch.id ? "color-btn active" : "color-btn"}
                onClick={() => setState((prev) => (prev ? { ...prev, stitchColor: stitch.id } : prev))}
              >
                <span className="swatch" style={{ backgroundColor: stitch.hex }} />
                <span>{stitch.name}</span>
              </button>
            ))}
          </div>
        </section>

        {!isMobile ? (
          <section className="section-block">
            {menuSection}
          </section>
        ) : null}
      </main>

      {isMobile && menuOpen ? (
        <div className="mobile-menu-backdrop" onClick={() => setMenuOpen(false)}>
          <aside className="mobile-menu" onClick={(event) => event.stopPropagation()}>
            {menuSection}
          </aside>
        </div>
      ) : null}

      <div className="toast-area" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">{toast.message}</div>
        ))}
      </div>
    </div>
  );
}

export default App;


