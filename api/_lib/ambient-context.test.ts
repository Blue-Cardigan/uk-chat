import test from "node:test";
import assert from "node:assert/strict";
import { buildAmbientContext, detectUkPostcodes, renderAmbientContextBlock } from "./ambient-context.js";

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
  assert.equal(renderAmbientContextBlock({ postcodes: [] }), "");
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
  });
  assert.match(block, /SE1 1AA/);
  assert.match(block, /lat=51\.502092/);
  assert.match(block, /constituency="Bermondsey and Old Southwark"/);
  assert.match(block, /Skip postcodes_lookup/);
});
