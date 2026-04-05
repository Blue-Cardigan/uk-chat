import test from "node:test";
import assert from "node:assert/strict";
import { buildChartSpecFromVizHint, extractMapData, parseCSV, parseMCPPayload } from "./viz-data-parser";

test("parseCSV handles BOM and quoted commas", () => {
  const rows = parseCSV('\uFEFFyear,value,label\n2022,"1,234","North, UK"\n2023,1200,South');
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.year, "2022");
  assert.equal(rows[0]?.value, "1,234");
  assert.equal(rows[0]?.label, "North, UK");
});

test("parseMCPPayload accepts records/data arrays", () => {
  const rowsFromRecords = parseMCPPayload({
    records: [{ year: 2022, value: 10 }],
  });
  assert.equal(rowsFromRecords.length, 1);
  assert.equal(rowsFromRecords[0]?.year, "2022");
  assert.equal(rowsFromRecords[0]?.value, "10");

  const rowsFromData = parseMCPPayload({
    data: [{ month: "Jan", amount: 14.2 }],
  });
  assert.equal(rowsFromData.length, 1);
  assert.equal(rowsFromData[0]?.month, "Jan");
  assert.equal(rowsFromData[0]?.amount, "14.2");
});

test("buildChartSpecFromVizHint parses wrapped MCP content payload", () => {
  const toolOutput = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          tool: "desnz_fetchEnergy",
          source: "desnz-energy",
          payload: {
            format: "csv",
            csv: "year,value\n2022,1234\n2023,1200",
          },
          vizHint: {
            suggested: "timeseries",
            xField: "year",
            yFields: ["value"],
            note: "Sample note",
          },
        }),
      },
    ],
  };

  const spec = buildChartSpecFromVizHint(toolOutput);
  assert.ok(spec);
  assert.equal(spec.type, "line");
  assert.equal(spec.xField, "year");
  assert.deepEqual(spec.yFields, ["value"]);
  assert.equal(spec.data.length, 2);
  assert.equal(spec.data[0]?.value, 1234);
  assert.equal(spec.note, "Sample note");
});

test("buildChartSpecFromVizHint returns null when suggested is none", () => {
  const spec = buildChartSpecFromVizHint({
    payload: {
      format: "csv",
      csv: "year,value\n2022,1234",
    },
    vizHint: {
      suggested: "none",
      xField: "year",
      yFields: ["value"],
    },
  });
  assert.equal(spec, null);
});

test("buildChartSpecFromVizHint returns null when suggested is map", () => {
  const spec = buildChartSpecFromVizHint({
    payload: {
      records: [{ geography_code: "E14001423", value: 42 }],
    },
    vizHint: {
      suggested: "map",
      codeField: "geography_code",
      valueField: "value",
    },
  });
  assert.equal(spec, null);
});

test("extractMapData detects points from coordinate rows", () => {
  const mapData = extractMapData(
    {
      payload: {
        data: [
          { latitude: 51.501, longitude: -0.141, category: "crime" },
          { latitude: 51.503, longitude: -0.127, category: "crime" },
        ],
      },
      vizHint: {
        suggested: "map",
        latField: "latitude",
        lngField: "longitude",
      },
    },
    "points",
  );
  assert.ok(mapData);
  assert.equal(mapData.kind, "points");
  assert.equal(mapData.items.length, 2);
  assert.equal(mapData.items[0]?.lat, 51.501);
});

test("extractMapData detects choropleth entries from geography codes", () => {
  const mapData = extractMapData(
    {
      payload: {
        records: [
          { pcon24cd: "E14001423", value: "12.5", name: "Sample Constituency" },
          { pcon24cd: "E14001424", value: "7.2", name: "Another Constituency" },
        ],
      },
      vizHint: {
        suggested: "map",
        codeField: "pcon24cd",
        valueField: "value",
      },
    },
    "choropleth",
  );
  assert.ok(mapData);
  assert.equal(mapData.kind, "choropleth");
  assert.equal(mapData.entries.length, 2);
  assert.equal(mapData.entries[0]?.code, "E14001423");
});
