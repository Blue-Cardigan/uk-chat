import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAmbientContext,
  detectConstituencies,
  detectDateReferences,
  detectLads,
  detectMpNames,
  detectPlacePhrases,
  detectUkPostcodes,
  mergeAmbientContext,
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
    renderAmbientContextBlock({ postcodes: [], constituencies: [], mpsByName: [], lads: [], places: [], dates: [] }),
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

test("detectLads resolves a council name to its GSS code", () => {
  const matches = detectLads("How is Manchester performing on housing targets?");
  assert.ok(matches.length >= 1);
  const m = matches.find((x) => x.name === "Manchester");
  assert.ok(m, "expected Manchester LAD match");
  assert.match(m!.code, /^E0[789]/);
});

test("detectLads ignores noisy generic words", () => {
  // "City" alone is in the blocklist; bare "North" / "South" too.
  assert.equal(detectLads("the city is busy").length, 0);
  assert.equal(detectLads("travelling north").length, 0);
});

test("detectMpNames finds a current MP", () => {
  const matches = detectMpNames("What has Keir Starmer voted on recently?");
  assert.ok(matches.length >= 1);
  assert.match(matches[0].name, /Keir Starmer/);
  assert.ok(matches[0].constituency);
});

test("detectPlacePhrases catches title-cased prepositional phrases", () => {
  assert.deepEqual(detectPlacePhrases("Show crime in Finsbury Park please"), ["Finsbury Park"]);
  assert.deepEqual(detectPlacePhrases("flood warnings near Borough Market"), ["Borough Market"]);
  assert.deepEqual(detectPlacePhrases("data for Mayfair and Soho"), ["Mayfair"]);
});

test("detectPlacePhrases skips blocklisted nation/city tokens", () => {
  assert.deepEqual(detectPlacePhrases("compare data in England and Scotland"), []);
  assert.deepEqual(detectPlacePhrases("trends across the UK"), []);
});

test("detectPlacePhrases ignores lowercase / non-place phrases", () => {
  assert.deepEqual(detectPlacePhrases("show me crime data near my postcode"), []);
});

test("buildAmbientContext geocodes free-text places via injected fetch when no postcode is present", async () => {
  let calls = 0;
  const fakeFetch = async (input: string | URL) => {
    calls += 1;
    const url = typeof input === "string" ? input : input.toString();
    assert.match(url, /nominatim\.openstreetmap\.org\/search/);
    assert.match(url, /countrycodes=gb/);
    return new Response(
      JSON.stringify([
        {
          lat: "51.5648345",
          lon: "-0.1064144",
          display_name: "Finsbury Park, Islington, London",
          address: { city: "London", county: "Greater London", state: "England" },
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const ctx = await buildAmbientContext("How safe is my area? Show crime data for Finsbury Park", {
    fetchImpl: fakeFetch as typeof fetch,
  });
  assert.equal(calls, 1);
  assert.equal(ctx.places.length, 1);
  assert.equal(ctx.places[0].matchedAs, "Finsbury Park");
  assert.equal(ctx.places[0].latitude, 51.5648345);
});

test("buildAmbientContext skips Nominatim when a postcode is already present", async () => {
  let nominatimCalls = 0;
  const fakeFetch = async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("nominatim")) {
      nominatimCalls += 1;
      return new Response("[]", { status: 200 });
    }
    // Postcodes.io path
    return new Response(
      JSON.stringify({
        result: {
          latitude: 51.502092,
          longitude: -0.091895,
          parliamentary_constituency: "Bermondsey and Old Southwark",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const ctx = await buildAmbientContext("crime in SE1 1AA", { fetchImpl: fakeFetch as typeof fetch });
  assert.equal(nominatimCalls, 0);
  assert.equal(ctx.postcodes.length, 1);
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

test("mergeAmbientContext keeps fresh detections and inherits non-overlapping prior entries", () => {
  const inherited = {
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
    lads: [],
    places: [],
    dates: [],
  };
  const fresh = {
    postcodes: [
      {
        postcode: "M1 1AB",
        latitude: 53.4794,
        longitude: -2.2453,
        parliamentaryConstituency: null,
        adminDistrict: null,
        adminWard: null,
        region: null,
        lsoa: null,
        msoa: null,
      },
    ],
    constituencies: [],
    mpsByName: [],
    lads: [],
    places: [],
    dates: [],
  };
  const merged = mergeAmbientContext(inherited, fresh);
  assert.equal(merged.postcodes.length, 2);
  // Fresh first, inherited second
  assert.equal(merged.postcodes[0].postcode, "M1 1AB");
  assert.equal(merged.postcodes[1].postcode, "SE1 1AA");
});

test("mergeAmbientContext caps each list at 10 entries", () => {
  const make = (n: number) => Array.from({ length: n }, (_, i) => ({
    postcode: `XX${i} ${i}AA`,
    latitude: 0, longitude: 0,
    parliamentaryConstituency: null, adminDistrict: null, adminWard: null,
    region: null, lsoa: null, msoa: null,
  }));
  const merged = mergeAmbientContext(
    { postcodes: make(20), constituencies: [], mpsByName: [], lads: [], places: [], dates: [] },
    { postcodes: make(5), constituencies: [], mpsByName: [], lads: [], places: [], dates: [] },
  );
  assert.equal(merged.postcodes.length, 10);
});

test("mergeAmbientContext: fresh wins on key collision", () => {
  const inherited = {
    postcodes: [{
      postcode: "SE1 1AA", latitude: 0, longitude: 0,
      parliamentaryConstituency: "OLD", adminDistrict: null, adminWard: null,
      region: null, lsoa: null, msoa: null,
    }],
    constituencies: [], mpsByName: [], lads: [], places: [], dates: [],
  };
  const fresh = {
    postcodes: [{
      postcode: "SE1 1AA", latitude: 0, longitude: 0,
      parliamentaryConstituency: "NEW", adminDistrict: null, adminWard: null,
      region: null, lsoa: null, msoa: null,
    }],
    constituencies: [], mpsByName: [], lads: [], places: [], dates: [],
  };
  const merged = mergeAmbientContext(inherited, fresh);
  assert.equal(merged.postcodes.length, 1);
  assert.equal(merged.postcodes[0].parliamentaryConstituency, "NEW");
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
    lads: [],
    places: [],
    dates: [],
  });
  assert.match(block, /SE1 1AA/);
  assert.match(block, /lat=51\.502092/);
  assert.match(block, /constituency="Bermondsey and Old Southwark"/);
  assert.match(block, /do NOT call lookup tools/);
});
