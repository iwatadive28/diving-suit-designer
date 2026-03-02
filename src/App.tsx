import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { loadConfig } from "./lib/config";
import { choosePreviewSize } from "./lib/perf";
import {
  exportPng,
  initializeComposer,
  pickPartIdByDisplayPoint,
  renderPreview,
  renderSpecSheet,
} from "./lib/suitComposer";
import { PART_DEFINITIONS } from "./lib/partSpec";
import { deserializeState, serializeState } from "./lib/stateCodec";
import type { AppConfig, ColorTheme, SuitState, Toast } from "./types";

const MAX_SHARE_URL_LENGTH = 2000;
const RECENT_STORAGE_KEY = "recent_colors_v3";

function createDefaultState(config: AppConfig): SuitState {
  const parts = Object.fromEntries(config.parts.map((part) => [part.id, part.defaultColor]));
  return {
    parts,
    stitchColor: config.stitchColors[0]?.id,
  };
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
      return [part.id, selected && colorSet.has(selected) ? selected : part.defaultColor];
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
  const partColors = theme.colors.length > 0
    ? theme.colors
    : config.colors.map((color) => color.id);

  const stitchCandidates = (theme.stitchColors && theme.stitchColors.length > 0)
    ? theme.stitchColors
    : config.stitchColors.map((color) => color.id);

  const nextParts: Record<string, string> = {};
  config.parts.forEach((part) => {
    nextParts[part.id] = pickRandom(partColors);
  });

  return {
    ...state,
    preset: undefined,
    parts: nextParts,
    stitchColor: pickRandom(stitchCandidates),
  };
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

  const previewBoxRef = useRef<HTMLDivElement | null>(null);
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
  }, []);

  useEffect(() => {
    let alive = true;

    async function boot(): Promise<void> {
      try {
        setLoading(true);
        await initializeComposer();
        const loaded = await loadConfig();
        if (!alive) return;

        const parsed = deserializeState(window.location.search);
        const initial = parsed ? sanitizeState(parsed, loaded) : createDefaultState(loaded);

        setConfig(loaded);
        setState(initial);
        setSelectedPartId(loaded.parts[0]?.id ?? "1");
        setSelectedThemeId(loaded.colorThemes[0]?.id ?? "");
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
  const colorIds = sortColorIdsByRecent(config.colors.map((color) => color.id), recentColors);

  const onSelectColor = (colorId: string): void => {
    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        parts: {
          ...prev.parts,
          [selectedPart.id]: colorId,
        },
      };
    });

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
  };

  const onPreviewClick = (event: MouseEvent<HTMLDivElement>): void => {
    const box = previewBoxRef.current;
    if (!box) return;

    const rect = box.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const picked = pickPartIdByDisplayPoint(x, y, rect.width, rect.height);
    if (picked) setSelectedPartId(picked);
  };

  const shareUrl = `${window.location.origin}${window.location.pathname}?${serializeState(state)}`;

  const onCopyUrl = async (): Promise<void> => {
    if (shareUrl.length > MAX_SHARE_URL_LENGTH) {
      addToast("URLが長すぎるためコピーできません。設定数を減らしてください。");
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      addToast("共有URLをコピーしました。");
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
    } catch (error) {
      addToast(error instanceof Error ? error.message : "印刷用生成に失敗しました。");
    }
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="hero-tag">ORDER SHEET READY</p>
        <h1>セミドライスーツデザインシミュレーター</h1>
        <p>19部位マスク優先 / スマホ対応 / 仕様書PNG・URL共有対応</p>
      </header>

      <main className="layout-v2">
        <section className="top-grid">
          <div className="section-block preview-panel">
            <h2>デザインプレビュー（クリックで部位選択）</h2>
            <div className="preview-canvas-wrap" ref={previewBoxRef} onClick={onPreviewClick} role="button" tabIndex={0}>
              {previewUrl ? <img src={previewUrl} className="preview-image" alt="スーツプレビュー" /> : null}
            </div>
            <p className="hint">選択中: {selectedPart.id}. {selectedPart.name}</p>
          </div>

          <div className="section-block part-panel">
            <h2>選択部位（19部位）</h2>
            <div className="part-grid long">
              {PART_DEFINITIONS.map((part) => (
                <button
                  key={part.id}
                  type="button"
                  className={part.id === selectedPart.id ? "part-btn active" : "part-btn"}
                  onClick={() => setSelectedPartId(part.id)}
                >
                  {part.id}. {part.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="section-block">
          <h2>パネルカラー一覧</h2>
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

        <section className="section-block">
          <h2>プリセット / ランダムおすすめ</h2>
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
        </section>

        <section className="section-block">
          <h2>出力 / 共有</h2>
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
        </section>
      </main>

      <div className="toast-area" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">{toast.message}</div>
        ))}
      </div>
    </div>
  );
}

export default App;
