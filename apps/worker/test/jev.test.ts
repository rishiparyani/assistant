// Jev, the decision model, on the wire (decision 2026-10-24 "Jev decides"): one choice
// question, the pick and how sure it is read back; a bad answer throws so the caller falls
// back to the everyday model. No network: the fetch is a stub.
import { describe, expect, it } from "vitest";
import { askJev, JEV_BASE } from "../src/core/assistant/decide.ts";

const stub = (status: number, body: unknown, seen: { url?: string; init?: RequestInit }) =>
  (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

describe("Jev", () => {
  it("asks one choice question and reads the pick back", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const got = await askJev(
      "test-key",
      "jev-latest",
      {
        state: "Pay the electricity bill by Friday",
        question: "Which action?",
        labels: ["Remind me", "Add to Bills", "Nothing"],
      },
      stub(
        200,
        {
          model: "jev-1.13",
          answers: { pick: { type: "choice", choice: "Add to Bills", confidence: 0.91, probabilities: {} } },
          usage: { input_tokens: 40, output_tokens: 0 },
        },
        seen,
      ),
    );
    expect(got).toEqual({ label: "Add to Bills", confidence: 0.91, usage: { input: 40, output: 0 } });
    expect(seen.url).toBe(`${JEV_BASE}/v1/systemone`);
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");
    expect(JSON.parse(String(seen.init?.body))).toEqual({
      state: "Pay the electricity bill by Friday",
      questions: {
        pick: {
          type: "choice",
          instructions: "Which action?",
          criteria: { "Remind me": null, "Add to Bills": null, Nothing: null },
        },
      },
      model: "jev-latest",
    });
  });

  it("names no option for a choice it doesn't know, and throws on a bad status", async () => {
    const seen = {};
    const odd = await askJev(
      "k",
      "jev-latest",
      { state: "x", question: "q", labels: ["A", "B"] },
      stub(200, { answers: { pick: { choice: "C", confidence: 0.8 } } }, seen),
    );
    expect(odd.label).toBeNull();
    await expect(
      askJev(
        "k",
        "jev-latest",
        { state: "x", question: "q", labels: ["A"] },
        stub(401, { error: "no" }, seen),
      ),
    ).rejects.toThrow("Jev answered 401");
  });
});
