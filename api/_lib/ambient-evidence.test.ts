import test from "node:test";
import assert from "node:assert/strict";
import type { AmbientContext } from "./ambient-context.js";
import { renderAmbientEvidenceBlock, runAmbientEvidence, type EvidenceItem } from "./ambient-evidence.js";

function emptyAmbient(): AmbientContext {
  return { postcodes: [], constituencies: [], mpsByName: [], lads: [], dates: [] };
}

const SE1_1AA = {
  postcode: "SE1 1AA",
  latitude: 51.502092,
  longitude: -0.091895,
  parliamentaryConstituency: "Bermondsey and Old Southwark",
  adminDistrict: "Southwark",
  adminWard: "Riverside",
  region: "London",
  lsoa: "Southwark 002E",
  msoa: "Southwark 002",
};

test("crime + postcode rule fires and aggregates by category", async () => {
  const tools = {
    police_fetchCrimes: {
      execute: async (_input: unknown) =>
        ({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                payload: [
                  { category: "anti-social-behaviour" },
                  { category: "anti-social-behaviour" },
                  { category: "theft-from-the-person" },
                ],
              }),
            },
          ],
        }),
    },
  };
  const ambient: AmbientContext = { ...emptyAmbient(), postcodes: [SE1_1AA] };
  const items = await runAmbientEvidence(
    "Show recent crime in SE1 1AA broken down by category",
    ambient,
    tools as Record<string, unknown>,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].toolName, "police_fetchCrimes");
  assert.match(items[0].resultPreview, /anti-social-behaviour/);
  assert.match(items[0].resultPreview, /total_crimes":3/);
});

test("crime rule does not fire without a postcode", async () => {
  const tools = {
    police_fetchCrimes: {
      execute: async () => {
        throw new Error("should not be called");
      },
    },
  };
  const items = await runAmbientEvidence("show crime trends nationally", emptyAmbient(), tools as Record<string, unknown>);
  assert.equal(items.length, 0);
});

test("MP voting rule fires when an MP is detected", async () => {
  const tools = {
    parliament_votes: {
      execute: async (input: unknown) => {
        const i = input as { memberId?: number; kind?: string };
        return { ok: true, kind: i.kind, memberId: i.memberId, votes: [{ title: "x", value: "Aye" }] };
      },
    },
  };
  const ambient: AmbientContext = {
    ...emptyAmbient(),
    mpsByName: [
      { matchedAs: "Keir Starmer", name: "Keir Starmer", constituency: "Holborn and St Pancras", memberId: 4514, party: "Labour" },
    ],
  };
  const items = await runAmbientEvidence("what has Keir Starmer voted on recently", ambient, tools as Record<string, unknown>);
  assert.equal(items.length, 1);
  assert.equal(items[0].toolName, "parliament_votes");
  assert.match(items[0].resultPreview, /4514/);
});

test("rule silently skips when the named tool isn't loaded", async () => {
  const items = await runAmbientEvidence(
    "show crime in SE1 1AA",
    { ...emptyAmbient(), postcodes: [SE1_1AA] },
    {},
  );
  assert.equal(items.length, 0);
});

test("rule silently swallows tool execution errors", async () => {
  const tools = {
    police_fetchCrimes: {
      execute: async () => {
        throw new Error("boom");
      },
    },
  };
  const items = await runAmbientEvidence(
    "show crime in SE1 1AA",
    { ...emptyAmbient(), postcodes: [SE1_1AA] },
    tools as Record<string, unknown>,
  );
  assert.equal(items.length, 0);
});

test("renderAmbientEvidenceBlock formats items as labeled JSON sections", () => {
  const items: EvidenceItem[] = [
    {
      rule: "crime + postcode → police_fetchCrimes",
      toolName: "police_fetchCrimes",
      input: { postcode: "SE1 1AA", kind: "crimes_at_location" },
      resultPreview: '{"total_crimes":3}',
    },
  ];
  const block = renderAmbientEvidenceBlock(items);
  assert.match(block, /AMBIENT EVIDENCE/);
  assert.match(block, /police_fetchCrimes/);
  assert.match(block, /total_crimes":3/);
  assert.equal(renderAmbientEvidenceBlock([]), "");
});
