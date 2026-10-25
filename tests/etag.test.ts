import { describe, expect, it } from "vitest";
import { contentTag, pollResponse } from "@/lib/etag";

describe("live polling tags", () => {
  it("ignores generatedAt but follows the content", () => {
    expect(contentTag({ generatedAt: 1, tasks: [1] } as never)).toBe(contentTag({ generatedAt: 2, tasks: [1] } as never));
    expect(contentTag({ generatedAt: 1, tasks: [1] } as never)).not.toBe(contentTag({ generatedAt: 1, tasks: [2] } as never));
  });

  it("answers 304 with no body when the caller has the same content", async () => {
    const data = { generatedAt: 5, tasks: ["a"] };
    const first = pollResponse(new Request("http://x/"), data);
    expect(first.status).toBe(200);
    const tag = first.headers.get("etag")!;
    const again = pollResponse(new Request("http://x/", { headers: { "if-none-match": tag } }), { ...data, generatedAt: 9 });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    const changed = pollResponse(new Request("http://x/", { headers: { "if-none-match": tag } }), { generatedAt: 9, tasks: ["b"] });
    expect(changed.status).toBe(200);
  });
});
