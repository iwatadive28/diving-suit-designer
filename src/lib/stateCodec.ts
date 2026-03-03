import type { SuitState } from "../types";

const VERSION = "1";

function encodeBase64Url(input: string): string {
  return btoa(unescape(encodeURIComponent(input)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

export function serializeState(state: SuitState): string {
  const payload = JSON.stringify(state);
  const encoded = encodeBase64Url(payload);
  const params = new URLSearchParams({ v: VERSION, s: encoded });
  return params.toString();
}

export function deserializeState(raw: string): SuitState | null {
  try {
    const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
    if (params.get("v") !== VERSION) {
      return null;
    }

    const encoded = params.get("s");
    if (!encoded) {
      return null;
    }

    const decoded = decodeBase64Url(encoded);
    const parsed = JSON.parse(decoded) as SuitState;

    if (!parsed || typeof parsed !== "object" || !parsed.parts || typeof parsed.parts !== "object") {
      return null;
    }

    if (parsed.logos !== undefined) {
      if (!Array.isArray(parsed.logos)) {
        return null;
      }
      const validLogos = parsed.logos.every((logo) => (
        logo
        && typeof logo === "object"
        && typeof logo.id === "string"
        && typeof logo.x === "number"
        && typeof logo.y === "number"
      ));
      if (!validLogos) {
        return null;
      }
    }

    return parsed;
  } catch {
    return null;
  }
}
