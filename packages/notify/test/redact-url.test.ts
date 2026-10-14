import { describe, expect, it } from "vitest";
import { redactUrl } from "../src/redact-url.js";

describe("redactUrl", () => {
  it("keeps only the origin", () => {
    expect(redactUrl("https://hooks.slack.com/services/T/B/secret?x=1#y")).toBe("https://hooks.slack.com/...");
    expect(redactUrl("https://fcm.googleapis.com:443/fcm/send/abc")).toBe("https://fcm.googleapis.com/...");
    expect(redactUrl("http://user:pass@example.com:8080/p")).toBe("http://example.com:8080/...");
  });

  it("does not echo an unparsable value", () => {
    expect(redactUrl("not a url /secret")).toBe("<invalid url>");
  });
});
