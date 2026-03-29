import test from "node:test";
import assert from "node:assert/strict";
import { buildChartSpecFromVizHint, parseCSV, parseMCPPayload } from "./viz-data-parser";

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
          tool: "desnz.fetchEnergy",
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
