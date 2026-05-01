import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAmbientContext,
  detectConstituencies,
  detectDateReferences,
  detectMpNames,
  detectUkPostcodes,
  renderAmbientContextBlock,
} from "./ambient-context.js";

test("detectUkPostcodes finds standard postcodes", () => {
  assert.deepEqual(detectUkPostcodes("Show crime in SE1 1AA"), ["SE1 1AA"]);
  assert.deepEqual(detectUkPostcodes("compare SW1A 1AA and EH1 1YZ"), ["SW1A 1AA", "EH1 1YZ"]);
  assert.deepEqual(detectUkPostcodes("postcode is OL16 1AB please"), ["OL16 1AB"]);
});

test("detectUkPostcodes normalises spacing", () => {
  assert.deepEqual(detectUkPostcodes("crime near SE11AA"), ["SE1 1AA"]);
  assert.deepEqual(detectUkPostcodes("se1  1aa"), ["SE1 1AA"]);
});

test("detectUkPostcodes deduplicates and drops noise", () => {
  assert.deepEqual(detectUkPostcodes("SE1 1AA, SE1 1AA, then look at se1 1aa again"), ["SE1 1AA"]);
  assert.deepEqual(detectUkPostcodes("Hello, what's the weather?"), []);
});

test("buildAmbientContext resolves a postcode via injected fetch", async () => {
  const fakeFetch = async () =>
    new Response(
      JSON.stringify({
        result: {
          latitude: 51.502092,
          longitude: -0.091895,
          parliamentary_constituency: "Bermondsey and Old Southwark",
          admin_district: "Southwark",
          admin_ward: "Riverside",
          region: "London",
          lsoa: "Southwark 002E",
          msoa: "Southwark 002",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const context = await buildAmbientContext("Show crime in SE1 1AA", { fetchImpl: fakeFetch as typeof fetch });
  assert.equal(context.postcodes.length, 1);
  const [entry] = context.postcodes;
  assert.equal(entry.postcode, "SE1 1AA");
  assert.equal(entry.latitude, 51.502092);
  assert.equal(entry.adminDistrict, "Southwark");
});

test("buildAmbientContext returns empty when no postcodes detected", async () => {
  const fakeFetch = async () => {
    throw new Error("should not be called");
  };
  const context = await buildAmbientContext("compare flood warnings near Manchester", {
    fetchImpl: fakeFetch as typeof fetch,
  });
  assert.equal(context.postcodes.length, 0);
});

test("buildAmbientContext silently drops failed lookups", async () => {
  const fakeFetch = async () => new Response("oops", { status: 500 });
  const context = await buildAmbientContext("crime in SE1 1AA", { fetchImpl: fakeFetch as typeof fetch });
  assert.equal(context.postcodes.length, 0);
});

test("renderAmbientContextBlock is empty when no entries", () => {
  assert.equal(
    renderAmbientContextBlock({ postcodes: [], constituencies: [], mpsByName: [], dates: [] }),
    "",
  );
});

test("detectConstituencies finds a known constituency in a sentence", () => {
  const matches = detectConstituencies("What's the demographic makeup of Bristol Central?");
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].constituency, "Bristol Central");
  assert.ok(matches[0].name);
  assert.ok(matches[0].memberId > 0);
});

test("detectConstituencies prefers the longest match", () => {
  const matches = detectConstituencies("compare Cities of London and Westminster vs Bristol Central");
  const ids = matches.map((m) => m.constituency);
  assert.ok(ids.includes("Cities of London and Westminster"));
  assert.ok(ids.includes("Bristol Central"));
});

test("detectConstituencies ignores non-matches", () => {
  assert.deepEqual(detectConstituencies("nothing here").length, 0);
});

test("detectMpNames finds a current MP", () => {
  const matches = detectMpNames("What has Keir Starmer voted on recently?");
  assert.ok(matches.length >= 1);
  assert.match(matches[0].name, /Keir Starmer/);
  assert.ok(matches[0].constituency);
});

test("detectDateReferences resolves explicit YYYY-MM and quarters", () => {
  const matches = detectDateReferences("compare 2026-01 vs Q3 2025", new Date("2026-04-01T00:00:00Z"));
  const labels = matches.map((m) => m.matchedAs);
  assert.ok(labels.includes("2026-01"));
  assert.ok(labels.some((l) => l.startsWith("q3 2025")));
});

test("detectDateReferences handles relative phrases", () => {
  const now = new Date("2026-04-15T00:00:00Z");
  const past = detectDateReferences("show the past 3 months", now);
  assert.ok(past.length >= 1);
  const span = past.find((m) => m.matchedAs === "past 3 months");
  assert.ok(span);
  assert.equal(span!.months.length, 3);
});

test("renderAmbientContextBlock includes pre-resolved fields", () => {
  const block = renderAmbientContextBlock({
    postcodes: [
      {
        postcode: "SE1 1AA",
        latitude: 51.502092,
        longitude: -0.091895,
        parliamentaryConstituency: "Bermondsey and Old Southwark",
        adminDistrict: "Southwark",
        adminWard: "Riverside",
        region: "London",
        lsoa: "Southwark 002E",
        msoa: "Southwark 002",
      },
    ],
    constituencies: [],
    mpsByName: [],
    dates: [],
  });
  assert.match(block, /SE1 1AA/);
  assert.match(block, /lat=51\.502092/);
  assert.match(block, /constituency="Bermondsey and Old Southwark"/);
  assert.match(block, /do NOT call lookup tools/);
});
