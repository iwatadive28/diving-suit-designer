import { describe, expect, it } from "vitest";
import { deserializeState, serializeState } from "../lib/stateCodec";
import type { SuitState } from "../types";

describe("stateCodec", () => {
  it("serialize/deserializeで状態を往復できる", () => {
    const input: SuitState = {
      preset: "marine",
      parts: {
        parts1: "blue",
        parts2: "black",
      },
    };

    const query = serializeState(input);
    const output = deserializeState(query);
    expect(output).toEqual(input);
  });

  it("不正な形式はnullを返す", () => {
    expect(deserializeState("?v=1&s=invalid")).toBeNull();
    expect(deserializeState("?v=999&s=abc")).toBeNull();
    expect(deserializeState("?v=1")).toBeNull();
  });
});
