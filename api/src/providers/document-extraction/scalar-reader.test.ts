import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyzeResultOutput } from "@azure-rest/ai-document-intelligence";
import { SCALAR_FIELDS } from "./scalar-merge.js";
import {
  createScalarReader,
  normalizeScalars,
  parseAnswer,
  READER_SCHEMA,
  READER_SYSTEM,
} from "./scalar-reader.js";

const SETTINGS = {
  endpoint: "https://reader.test/",
  key: "test-key",
  deployment: "test-deployment",
  apiVersion: "2025-01-01",
};

const input = { bytes: Buffer.from("receipt"), contentType: "image/jpeg" as const };

const nulls = (): Record<string, string | null> =>
  Object.fromEntries(SCALAR_FIELDS.map((name) => [name, null]));

const ocrResult = (content: string): AnalyzeResultOutput => ({
  apiVersion: "2024-11-30",
  modelId: "prebuilt-read",
  stringIndexType: "utf16CodeUnit",
  content,
  pages: [],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the reader's schema", () => {
  it("asks for the 14 scalars and nothing else, each a string or null", () => {
    expect(Object.keys(READER_SCHEMA.properties)).toEqual([...SCALAR_FIELDS]);
    expect(READER_SCHEMA.required).toEqual([...SCALAR_FIELDS]);
    expect(READER_SCHEMA.additionalProperties).toBe(false);
    expect(READER_SCHEMA.properties).not.toHaveProperty("items");
    expect(READER_SCHEMA.properties).not.toHaveProperty("vatBreakdown");
    for (const property of Object.values(READER_SCHEMA.properties)) {
      expect(property.type).toEqual(["string", "null"]);
      expect(property.description).toEqual(expect.any(String));
    }
  });
});

describe("normalizeScalars", () => {
  const one = (name: string, value: string | null) =>
    normalizeScalars({ ...nulls(), [name]: value })[name];

  it("reads printed values with the parsers the two-model path uses", () => {
    expect(one("issueDate", "1.06.2026")).toBe("2026-06-01");
    expect(one("total", "33,10")).toBe("33.10");
    expect(one("currency", "€")).toBe("EUR");
    expect(one("currency", "kn")).toBe("HRK");
    expect(one("issueTime", "14:30")).toBe("14:30");
  });

  it("reads a month-first date only when it is a real one", () => {
    expect(one("issueDate", "02/24/17")).toBe("2017-02-24");
    expect(one("issueDate", "02/30/17")).toBeNull();
  });

  it("reads an OIB with its label, and keeps one that fails its check digit as printed", () => {
    expect(one("sellerOib", "OIB: 62226620908")).toBe("62226620908");
    expect(one("sellerOib", "OIB: 12345678902")).toBe("12345678902");
  });

  it("writes a JIR copied without hyphens as it is printed", () => {
    expect(one("jir", "b19e5e13038842849be93a0919701be5")).toBe(
      "b19e5e13-0388-4284-9be9-3a0919701be5",
    );
  });

  it("joins a wrapped address into one line", () => {
    expect(one("sellerAddress", "Vlaška 6\n  10000 Zagreb")).toBe("Vlaška 6 10000 Zagreb");
  });

  it("returns null for a blank and for a value no parser can read", () => {
    expect(one("issueDate", "jučer")).toBeNull();
    expect(one("sellerName", "   ")).toBeNull();
    expect(one("total", null)).toBeNull();
  });

  it("infers no currency from the date", () => {
    const fields = normalizeScalars({
      ...nulls(),
      issueDate: "17.08.2026.",
      sellerOib: "62226620908",
    });

    expect(fields["currency"]).toBeNull();
  });
});

describe("parseAnswer", () => {
  it("accepts 14 string-or-null values and drops any other key", () => {
    const answer = parseAnswer({ ...nulls(), sellerName: "Ana", items: [] });

    expect(answer["sellerName"]).toBe("Ana");
    expect(answer).not.toHaveProperty("items");
  });

  it("rejects an answer that is not the 14 fields, without quoting it", () => {
    const { zki: _zki, ...missing } = nulls();
    for (const bad of [null, "tekst računa", missing, { ...nulls(), total: 12.5 }]) {
      expect(() => parseAnswer(bad)).toThrow("scalar reader: malformed answer");
    }
  });
});

describe("createScalarReader", () => {
  it("is off when any setting is blank", () => {
    expect(createScalarReader({ settings: { ...SETTINGS, deployment: "" } })).toBeNull();
    expect(createScalarReader({ settings: { ...SETTINGS, key: "" } })).toBeNull();
  });

  it("returns the values as copied and in canonical form", async () => {
    const complete = vi.fn().mockResolvedValue({ ...nulls(), total: "33,10", currency: "EUR" });
    const reader = createScalarReader({
      settings: SETTINGS,
      ocr: async () => ocrResult("UKUPNO 33,10 EUR"),
      complete,
    })!;

    const reading = await reader(input, new AbortController().signal);

    expect(complete.mock.calls[0]![0]).toBe("<dokument>\nUKUPNO 33,10 EUR\n</dokument>");
    expect(reading.printed["total"]).toBe("33,10");
    expect(reading.fields["total"]).toBe("33.10");
    expect(reading.deployment).toBe("test-deployment");
    expect(reading.ocrModelId).toBe("prebuilt-read");
    expect(reading.analyzeResult.content).toBe("UKUPNO 33,10 EUR");
  });

  it("does not ask the model about a document with no text", async () => {
    const complete = vi.fn();
    const reader = createScalarReader({
      settings: SETTINGS,
      ocr: async () => ocrResult("  \n"),
      complete,
    })!;

    await expect(reader(input, new AbortController().signal)).rejects.toThrow(
      "scalar reader: no text",
    );
    expect(complete).not.toHaveBeenCalled();
  });

  describe("the request", () => {
    const reader = () =>
      createScalarReader({ settings: SETTINGS, ocr: async () => ocrResult("UKUPNO 33,10") })!;

    it("is the measured one: one POST, the frozen prompt, a strict schema", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(nulls()) } }] }),
            { status: 200 },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      const controller = new AbortController();

      await reader()(input, controller.signal);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://reader.test/openai/deployments/test-deployment/chat/completions?api-version=2025-01-01",
      );
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "api-key": "test-key", "Content-Type": "application/json" });
      expect(init.signal).toBe(controller.signal);
      expect(JSON.parse(init.body as string)).toEqual({
        messages: [
          { role: "system", content: READER_SYSTEM },
          { role: "user", content: "<dokument>\nUKUPNO 33,10\n</dokument>" },
        ],
        temperature: 0,
        max_tokens: 8000,
        response_format: {
          type: "json_schema",
          json_schema: { name: "HrReceipt", schema: READER_SCHEMA, strict: true },
        },
      });
    });

    it.each([429, 500])(
      "fails once on HTTP %i, naming the status and nothing from the body",
      async (status) => {
        const fetchMock = vi
          .fn()
          .mockResolvedValue(new Response("Kavana Wagner 517,00", { status }));
        vi.stubGlobal("fetch", fetchMock);

        const failure = await reader()(input, new AbortController().signal).catch(
          (error: unknown) => error as Error,
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect((failure as Error).message).toBe(`scalar reader: HTTP ${status}`);
        expect((failure as Error).cause).toBeUndefined();
      },
    );

    it("fails on an answer that is not JSON without quoting it", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ choices: [{ message: { content: "Kavana Wagner" } }] }), {
            status: 200,
          }),
        ),
      );

      const failure = await reader()(input, new AbortController().signal).catch(
        (error: unknown) => error as Error,
      );

      expect((failure as Error).message).toBe("scalar reader: malformed answer");
      expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure))).not.toContain("Kavana");
    });
  });
});
