import { describe, expect, it } from "vitest";
import { dispatch } from "../src/dispatch.js";
import type { NotificationChannel } from "../src/types.js";

function fakeChannel(name: string, behavior: "ok" | "fail"): NotificationChannel {
  return {
    name,
    async send() {
      if (behavior === "fail") {
        throw new Error(`${name} failed`);
      }
    },
  };
}

describe("dispatch", () => {
  it("runs all channels and reports each channel's success", async () => {
    const channels = [fakeChannel("a", "ok"), fakeChannel("b", "ok")];
    const results = await dispatch(channels, { to: {}, title: "t", body: "b" });

    expect(results).toEqual([
      { channel: "a", ok: true },
      { channel: "b", ok: true },
    ]);
  });

  it("does not let one channel's failure stop the others, and reports the failure", async () => {
    const channels = [fakeChannel("a", "fail"), fakeChannel("b", "ok")];
    const results = await dispatch(channels, { to: {}, title: "t", body: "b" });

    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.channel).toBe("a");
    expect(results[0]?.error).toBeInstanceOf(Error);
    expect(results[1]).toEqual({ channel: "b", ok: true });
  });

  it("returns an empty array for an empty channel list", async () => {
    const results = await dispatch([], { to: {}, title: "t", body: "b" });
    expect(results).toEqual([]);
  });
});
