import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Keep App, validation and configureSymbols real. Replace SDK objects and network lifecycle only.
const sdk = vi.hoisted(() => {
  const layers = [];
  class Value {
    constructor(properties = {}) { Object.assign(this, properties); }
  }
  class Layer extends Value {
    objectIdField = "OBJECTID";
    fields = ["Tree_ID", "Cmn_Name", "Leaf_Area", "Leaf_Bmass"].map(name => ({ name }));
    fullExtent = { xmin: 0, ymin: 0, xmax: 1, ymax: 1 };
    when = vi.fn((loaded, failed) => { this.loaded = loaded; this.failed = failed; });
    constructor(properties) { super(properties); layers.push(this); }
  }
  return { Value, Layer, layers };
});

vi.mock("@arcgis/core/layers/FeatureLayer", () => ({ default: sdk.Layer }));
vi.mock("@arcgis/core/core/Collection", () => ({ default: sdk.Value }));
vi.mock("@arcgis/core/renderers/UniqueValueRenderer", () => ({ default: sdk.Value }));
vi.mock("@arcgis/core/symbols/SimpleMarkerSymbol", () => ({ default: sdk.Value }));
vi.mock("@arcgis/core/widgets/FeatureTable/support/FieldColumnTemplate", () => ({ default: sdk.Value }));
vi.mock("@arcgis/core/widgets/FeatureTable/support/TableTemplate", () => ({ default: sdk.Value }));
vi.mock("@arcgis/map-components/components/arcgis-map", () => ({}));
vi.mock("@arcgis/map-components/components/arcgis-legend", () => ({}));
vi.mock("@arcgis/map-components/components/arcgis-feature-table", () => ({}));
vi.mock("@arcgis/map-components/components/arcgis-expand", () => ({}));

import App from "../src/App";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  sdk.layers.length = 0;
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async url => response(url.endsWith("/default") ? defaultConfiguration() : [])));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete navigator.clipboard; });

function mountApp() {
  const { container } = render(<StrictMode><App /></StrictMode>);
  const map = container.querySelector("arcgis-map");
  map.view = { map: { add: vi.fn() }, goTo: vi.fn().mockResolvedValue(undefined) };
  fireEvent(map, new Event("arcgisViewReadyChange"));
  fireEvent.click(screen.getByRole("button", { name: "Map settings" }));
  return { container, map, layer: sdk.layers[0] };
}

async function loadLayer(layer) { await act(async () => layer.loaded()); }
function sizeStops(layer) { return layer.renderer.visualVariables.find(variable => variable.type === "size").stops; }

test("real edits and Apply update the renderer; later edits preserve applied settings and table state", async () => {
  const { container, map, layer } = mountApp();
  const apply = screen.getByRole("button", { name: "Apply settings" });
  expect(apply.disabled).toBe(true);
  await loadLayer(layer);
  expect(apply.disabled).toBe(false);
  const initialRenderer = layer.renderer;
  const table = container.querySelector("arcgis-feature-table");
  const tableTemplate = table.tableTemplate;
  // Stand in for native table interactions made after startup.
  table.tableTemplate.columnTemplates.reverse();
  table.hiddenFields = ["Leaf_Area"];
  const hiddenFields = table.hiddenFields;

  fireEvent.change(screen.getByLabelText("At 10"), { target: { value: "#ff0000" } });
  fireEvent.change(screen.getByLabelText("At 40,000"), { target: { value: "#800080" } });
  fireEvent.change(screen.getByLabelText("At 700 (pt)"), { target: { value: "60" } });
  expect(screen.getByRole("status").textContent).toBe("Changes not applied");
  expect(layer.renderer).toBe(initialRenderer);
  fireEvent.click(apply);
  expect(layer.renderer).not.toBe(initialRenderer);
  expect(layer.renderer.visualVariables.find(variable => variable.type === "color").stops[0].color).toBe("#ff0000");
  expect(layer.renderer.visualVariables.find(variable => variable.type === "color").stops[1].color).toBe("#800080");
  expect(sizeStops(layer)[1].size).toBe(60);
  expect(screen.getByRole("status").textContent).toBe("Applied — not saved");

  const appliedRenderer = layer.renderer;
  fireEvent.change(screen.getByLabelText("At 0 (pt)"), { target: { value: "30" } });
  expect(layer.renderer).toBe(appliedRenderer);
  expect(table.tableTemplate).toBe(tableTemplate);
  expect(table.tableTemplate.columnTemplates.map(column => column.fieldName)).toEqual(["Leaf_Bmass", "Leaf_Area", "Cmn_Name", "Tree_ID"]);
  expect(table.hiddenFields).toBe(hiddenFields);
  fireEvent.click(apply);
  expect(sizeStops(layer).map(stop => stop.size)).toEqual([30, 60]);
  expect(table.tableTemplate).toBe(tableTemplate);
  expect(table.hiddenFields).toBe(hiddenFields);
  expect(map.view.goTo).toHaveBeenCalledTimes(1);
  fireEvent(map, new Event("arcgisViewReadyChange"));
  expect(sdk.layers).toHaveLength(1);
  expect(map.view.map.add).toHaveBeenCalledTimes(1);
});

test("invalid input keeps the last renderer and can be corrected through the actual form", async () => {
  const { layer } = mountApp();
  await loadLayer(layer);
  const input = screen.getByLabelText("At 700 (pt)");
  const apply = screen.getByRole("button", { name: "Apply settings" });
  fireEvent.change(input, { target: { value: "70" } });
  fireEvent.click(apply);
  expect(sizeStops(layer)[1].size).toBe(70);
  const appliedRenderer = layer.renderer;
  for (const invalid of ["", "101"]) {
    fireEvent.change(input, { target: { value: invalid } });
    fireEvent.click(apply);
    expect(screen.getByRole("alert").textContent).not.toBe("");
    expect(layer.renderer).toBe(appliedRenderer);
    expect(input.value).toBe(invalid);
  }
  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.click(apply);
  expect(sizeStops(layer).map(stop => stop.size)).toEqual([5, 3]);
  expect(screen.queryByRole("alert")).toBeNull();
});

// Future: Test native drag reordering, dialog focus and timed notification dismissal in a browser.
// Future: Test that docking preserves map/table state and pending edits.

function columnNames(table) { return table.tableTemplate.columnTemplates.map(column => column.fieldName); }
function response(body, status = 200) { return { ok: status < 400, status, json: async () => body }; }
function savedConfiguration(name = "My trees") {
  return {
    id: "saved-1", name, visibility: "private", created_at: "2026-11-24T00:00:00Z",
    configuration: {
      symbolConfig: {
        color: { field: "Leaf_Area", stops: [{ value: 10, color: "#ffffff" }, { value: 40000, color: "#00fd00" }] },
        size: { field: "Leaf_Bmass", stops: [{ value: 0, size: 5 }, { value: 700, size: 40 }] },
      },
      tableConfig: { columns: ["Tree_ID", "Cmn_Name", "Leaf_Area", "Leaf_Bmass"] },
    },
  };
}
function defaultConfiguration() { return { ...savedConfiguration("System default"), id: "system-default" }; }
async function openSave(name = "My trees") {
  await waitFor(() => expect(screen.getByRole("button", { name: "Save as configuration" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Save as configuration" }));
  fireEvent.change(screen.getByLabelText("Configuration name"), { target: { value: name } });
}

test("table drafts survive rail closing, reorder only on Apply, and preserve the renderer", async () => {
  const { container, layer } = mountApp();
  await loadLayer(layer);
  const table = container.querySelector("arcgis-feature-table");
  const renderer = layer.renderer;
  const template = table.tableTemplate;
  fireEvent.click(screen.getByRole("button", { name: "Hide Tree_ID" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Leaf_Area, position 2 of 3" }), { altKey: true, key: "ArrowLeft" });
  expect(table.tableTemplate).toBe(template);
  fireEvent.click(screen.getByRole("button", { name: "Map settings" }));
  expect(screen.queryByRole("heading", { name: "Visible columns (3)" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Map settings" }));
  const apply = screen.getByRole("button", { name: "Apply settings" });
  apply.focus();
  fireEvent.click(apply);
  expect(columnNames(table)).toEqual(["Leaf_Area", "Cmn_Name", "Leaf_Bmass"]);
  expect(layer.renderer).toBe(renderer);
  expect(document.activeElement).toBe(apply);
  expect(screen.getByRole("heading", { name: "Map settings" })).toBeTruthy();
  const appliedTemplate = table.tableTemplate;
  fireEvent.click(apply);
  expect(table.tableTemplate).toBe(appliedTemplate);
  expect(layer.renderer).toBe(renderer);
});

test("an empty column draft blocks Apply until a hidden column is selected", async () => {
  const { container, layer } = mountApp();
  await loadLayer(layer);
  const table = container.querySelector("arcgis-feature-table");
  const template = table.tableTemplate;
  for (const name of ["Tree_ID", "Cmn_Name", "Leaf_Area", "Leaf_Bmass"]) fireEvent.click(screen.getByRole("button", { name: `Hide ${name}` }));
  const apply = screen.getByRole("button", { name: "Apply settings" });
  expect(apply.disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toBe("Select at least one column.");
  expect(table.tableTemplate).toBe(template);
  fireEvent.click(screen.getByRole("button", { name: "Tree_ID", exact: true }));
  fireEvent.click(apply);
  expect(columnNames(table)).toEqual(["Tree_ID"]);
});

test("Save without Apply persists the draft and fully applies the successful snapshot", async () => {
  const { container, layer } = mountApp();
  await loadLayer(layer);
  const table = container.querySelector("arcgis-feature-table");
  const renderer = layer.renderer;
  fireEvent.change(screen.getByLabelText("At 700 (pt)"), { target: { value: "60" } });
  fireEvent.click(screen.getByRole("button", { name: "Hide Tree_ID" }));
  expect(sizeStops(layer)[1].size).toBe(40);
  await openSave();
  fetch.mockImplementationOnce(async (_url, options) => {
    const payload = JSON.parse(options.body);
    expect(payload.name).toBe("My trees");
    expect(payload.configuration.symbolConfig.size.stops[1].size).toBe(60);
    expect(payload.configuration.tableConfig.columns).not.toContain("Tree_ID");
    return response({ ...savedConfiguration(), configuration: payload.configuration });
  });
  fireEvent.click(screen.getByRole("button", { name: "Save configuration", exact: true }));
  await screen.findByText("Configuration “My trees” created successfully.");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText("My configuration").value).toBe("saved-1");
  expect(layer.renderer).not.toBe(renderer);
  expect(sizeStops(layer)[1].size).toBe(60);
  expect(columnNames(table)).toEqual(["Cmn_Name", "Leaf_Area", "Leaf_Bmass"]);
  fireEvent.click(screen.getByRole("button", { name: "Map settings" }));
  expect(screen.getAllByRole("status")[0].textContent).toBe("Saved configuration applied");
});

test.each([
  ["duplicate", () => Promise.resolve(response({ detail: "Choose a different name and try again." }, 409)), "Choose a different name"],
  ["network", () => Promise.reject(new TypeError("offline")), "Configuration service unavailable"],
])("a %s Save error retains the name, draft and applied settings", async (_kind, failure, message) => {
  const { container, layer } = mountApp();
  await loadLayer(layer);
  const renderer = layer.renderer;
  const table = container.querySelector("arcgis-feature-table");
  const template = table.tableTemplate;
  fireEvent.change(screen.getByLabelText("At 700 (pt)"), { target: { value: "65" } });
  await openSave("Retry name");
  fetch.mockImplementationOnce(failure);
  fireEvent.click(screen.getByRole("button", { name: "Save configuration", exact: true }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(message));
  expect(screen.getByLabelText("Configuration name").value).toBe("Retry name");
  expect(layer.renderer).toBe(renderer);
  expect(table.tableTemplate).toBe(template);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText("At 700 (pt)").value).toBe("65");
  expect(screen.getByRole("status").textContent).toBe("Changes not applied");
});

test("loading a saved snapshot fully reapplies it; cancelling discard preserves the draft", async () => {
  const saved = savedConfiguration();
  fetch.mockImplementation(async url => response(url.endsWith("/default") ? defaultConfiguration() : [saved]));
  const { container, layer } = mountApp();
  await loadLayer(layer);
  const select = screen.getByLabelText("My configuration");
  await waitFor(() => expect(select.disabled).toBe(false));
  const table = container.querySelector("arcgis-feature-table");
  table.tableTemplate.columnTemplates.reverse();
  const renderer = layer.renderer;
  fireEvent.change(screen.getByLabelText("At 700 (pt)"), { target: { value: "65" } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const requests = fetch.mock.calls.length;
  fireEvent.change(select, { target: { value: saved.id } });
  expect(confirm).toHaveBeenCalledOnce();
  expect(fetch.mock.calls.length).toBe(requests);
  expect(select.value).toBe("system-default");
  expect(screen.getByLabelText("At 700 (pt)").value).toBe("65");
  confirm.mockReturnValue(true);
  fetch.mockResolvedValueOnce(response(saved));
  fireEvent.change(select, { target: { value: saved.id } });
  await waitFor(() => expect(select.value).toBe(saved.id));
  expect(screen.queryByRole("button", { name: "Dismiss notification" })).toBeNull();
  expect(sizeStops(layer)[1].size).toBe(40);
  expect(layer.renderer).not.toBe(renderer);
  expect(columnNames(table)).toEqual(saved.configuration.tableConfig.columns);
  expect(screen.getByLabelText("At 700 (pt)").value).toBe("40");
  expect(select.value).toBe(saved.id);
  expect(screen.getAllByRole("status")[0].textContent).toBe("Saved configuration applied");
  fetch.mockResolvedValueOnce(response(defaultConfiguration()));
  fireEvent.change(select, { target: { value: "system-default" } });
  await waitFor(() => expect(select.value).toBe("system-default"));
  expect(screen.queryByRole("button", { name: "Dismiss notification" })).toBeNull();
  expect(fetch.mock.calls.at(-1)[0]).toBe("/api/configurations/default");
  expect(select.value).toBe("system-default");
  expect(columnNames(table)).toEqual(defaultConfiguration().configuration.tableConfig.columns);
});

// Run twice: the shared settings arrive before the map layer, then the map layer arrives first.
// Both must be ready before applying settings; viewing a link does not transfer ownership.
test.each(["API first", "layer first"])("startup waits for remote settings and the layer: %s", async order => {
  const remote = defaultConfiguration();
  remote.configuration.symbolConfig.size.stops = [{ value: 0, size: 12 }, { value: 700, size: 72 }];
  remote.configuration.symbolConfig.color.stops[0].color = "#123456";
  remote.configuration.tableConfig.columns = ["Leaf_Area", "Leaf_Bmass"];
  let resolveDefault;
  const pendingDefault = new Promise(resolve => { resolveDefault = resolve; });
  fetch.mockImplementation(async url => url.endsWith("/default") ? pendingDefault : response([]));
  const { container, layer } = mountApp();
  const apply = screen.getByRole("button", { name: "Apply settings" });
  if (order === "API first") {
    await act(async () => resolveDefault(response(remote)));
  } else {
    await loadLayer(layer);
  }
  expect(apply.disabled).toBe(true);
  expect(layer.renderer).toBeUndefined();
  expect(screen.queryByLabelText("At 700 (pt)")).toBeNull();
  if (order === "API first") {
    await loadLayer(layer);
  } else {
    await act(async () => resolveDefault(response(remote)));
  }
  expect(apply.disabled).toBe(false);
  expect(sizeStops(layer).map(stop => stop.size)).toEqual([12, 72]);
  expect(screen.getByLabelText("At 10").value).toBe("#123456");
  expect(screen.getByLabelText("At 700 (pt)").value).toBe("72");
  expect(columnNames(container.querySelector("arcgis-feature-table"))).toEqual(["Leaf_Area", "Leaf_Bmass"]);
  expect(screen.getByLabelText("My configuration").value).toBe("system-default");
  expect(screen.getByRole("status").textContent).toBe("Default applied");
  expect(sdk.layers).toHaveLength(1);
});

test.each(["network", "invalid settings"])("default %s failure keeps editing disabled and can be retried", async failure => {
  const invalid = defaultConfiguration();
  invalid.configuration.tableConfig.columns = ["missing_field"];
  fetch.mockImplementation(async url => {
    if (!url.endsWith("/default")) return response([]);
    if (failure === "network") throw new TypeError("offline");
    return response(invalid);
  });
  const { layer } = mountApp();
  await loadLayer(layer);
  expect(screen.getByRole("alert").textContent).toContain("Could not load default settings");
  expect(screen.getByRole("button", { name: "Apply settings" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Save as configuration" }).disabled).toBe(true);
  expect(layer.renderer).toBeUndefined();
  fetch.mockImplementation(async url => response(url.endsWith("/default") ? defaultConfiguration() : []));
  fireEvent.click(screen.getByRole("button", { name: "Retry default" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply settings" }).disabled).toBe(false));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByLabelText("My configuration").value).toBe("system-default");
});

test("a list failure still allows startup with the system default", async () => {
  fetch.mockImplementation(async url => {
    if (url.endsWith("/default")) return response(defaultConfiguration());
    throw new TypeError("list offline");
  });
  const { layer } = mountApp();
  await loadLayer(layer);
  expect(screen.getByRole("alert").textContent).toContain("Configuration service unavailable");
  expect(screen.getByRole("button", { name: "Apply settings" }).disabled).toBe(false);
  expect(screen.getByLabelText("My configuration").disabled).toBe(false);
});

function failNextTableConfiguration(table) {
  let hiddenFields = table.hiddenFields;
  let fail = true;
  Object.defineProperty(table, "hiddenFields", {
    configurable: true,
    get: () => hiddenFields,
    set(value) { if (fail) { fail = false; throw new Error("SDK failed"); } hiddenFields = value; },
  });
}

test("a table apply failure rolls back both parts and leaves the draft retryable", async () => {
  const { container, layer } = mountApp();
  await loadLayer(layer);
  const table = container.querySelector("arcgis-feature-table");
  const previous = { renderer: layer.renderer, template: table.tableTemplate, hidden: table.hiddenFields };
  fireEvent.change(screen.getByLabelText("At 700 (pt)"), { target: { value: "75" } });
  fireEvent.click(screen.getByRole("button", { name: "Hide Tree_ID" }));
  failNextTableConfiguration(table);
  fireEvent.click(screen.getByRole("button", { name: "Apply settings" }));
  expect(screen.getByRole("alert").textContent).toContain("Could not apply settings");
  expect(layer.renderer).toBe(previous.renderer);
  expect(table.tableTemplate).toBe(previous.template);
  expect(table.hiddenFields).toBe(previous.hidden);
  expect(screen.getByRole("status").textContent).toBe("Changes not applied");
  fireEvent.click(screen.getByRole("button", { name: "Apply settings" }));
  expect(sizeStops(layer)[1].size).toBe(75);
  expect(columnNames(table)).not.toContain("Tree_ID");
});

test("a rendering failure after Save reports persistence success and keeps the draft for Apply", async () => {
  const { container, layer } = mountApp();
  await loadLayer(layer);
  const table = container.querySelector("arcgis-feature-table");
  const renderer = layer.renderer;
  fireEvent.change(screen.getByLabelText("At 700 (pt)"), { target: { value: "80" } });
  await openSave();
  fetch.mockImplementationOnce(async (_url, options) => response({ ...savedConfiguration(), configuration: JSON.parse(options.body).configuration }));
  failNextTableConfiguration(table);
  fireEvent.click(screen.getByRole("button", { name: "Save configuration", exact: true }));
  await screen.findByText("Configuration “My trees” created successfully.");
  expect(screen.getByRole("alert").textContent).toContain("Configuration saved, but could not apply it");
  expect(layer.renderer).toBe(renderer);
  expect(screen.getByLabelText("My configuration").value).toBe("saved-1");
  expect(screen.getByLabelText("At 700 (pt)").value).toBe("80");
  fireEvent.click(screen.getByRole("button", { name: "Apply settings" }));
  expect(sizeStops(layer)[1].size).toBe(80);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("failed tree loading shows an error and leaves Apply disabled", async () => {
  const { layer } = mountApp();
  act(() => layer.failed(new Error("offline")));
  expect(screen.getAllByRole("alert")[0].textContent).toContain("Could not load tree data");
  expect(screen.getByRole("button", { name: "Apply settings" }).disabled).toBe(true);
});

// Change a draft without saving, then publish the selected saved record by ID.
// Opening the dialog sends nothing; a blocked clipboard still leaves a manually copyable URL.
test("Publishes saved settings only after clicking Publish link and allows manual copying if clipboard access fails", async () => {
  const own = savedConfiguration();
  fetch.mockImplementation(async url => response(url.endsWith("/default") ? defaultConfiguration() : [own]));
  const { layer } = mountApp();
  await loadLayer(layer);
  expect(screen.getByRole("button", { name: "Share", exact: true }).disabled).toBe(true);
  fetch.mockResolvedValueOnce(response(own));
  fireEvent.change(screen.getByLabelText("My configuration"), { target: { value: own.id } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Share", exact: true }).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("At 700 (pt)"), { target: { value: "95" } });
  const requests = fetch.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  expect(screen.getByRole("dialog").textContent).toContain("Anyone with this link can view these saved settings. Unsaved edits are not included.");
  expect(fetch.mock.calls.length).toBe(requests);
  fetch.mockResolvedValueOnce(response({ token: "example/token" }));
  fireEvent.click(screen.getByRole("button", { name: "Publish link" }));
  const input = await screen.findByLabelText("Share link");
  expect(fetch.mock.calls.at(-1)).toEqual([`/api/configurations/${own.id}/share`, { credentials: "same-origin", method: "POST" }]);
  expect(input.value).toBe(`${window.location.origin}/?share=example%2Ftoken`);
  expect(input.readOnly).toBe(true);
  expect(sizeStops(layer)[1].size).toBe(40);
  const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await screen.findByText("Could not copy automatically. Select the link and copy it manually.");
  expect(input.value).toContain("?share=");
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await screen.findByText("Copied");
  expect(writeText).toHaveBeenLastCalledWith(input.value);
  expect(screen.queryByRole("button", { name: "Dismiss notification" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByLabelText("At 700 (pt)").value).toBe("95");
});

test("shows a publishing error and lets the user click Publish link again", async () => {
  const own = savedConfiguration();
  fetch.mockImplementation(async url => response(url.endsWith("/default") ? defaultConfiguration() : [own]));
  const { layer } = mountApp();
  await loadLayer(layer);
  fetch.mockResolvedValueOnce(response(own));
  fireEvent.change(screen.getByLabelText("My configuration"), { target: { value: own.id } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Share", exact: true }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  fetch.mockRejectedValueOnce(new TypeError("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Publish link" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Configuration service unavailable"));
  fetch.mockResolvedValueOnce(response({ token: "retry-token" }));
  fireEvent.click(screen.getByRole("button", { name: "Publish link" }));
  await screen.findByLabelText("Share link");
  expect(screen.queryByRole("alert")).toBeNull();
});

// Run twice: the shared settings arrive before the map layer, then the map layer arrives first.
// Both must be ready before applying settings; viewing a link does not transfer ownership.
test.each(["API first", "layer first"])("opens shared settings instead of System default without adding them to my saved configurations (%s)", async order => {
  window.history.replaceState(null, "", "/?share=foreign-token");
  const shared = { ...savedConfiguration("Other person's trees"), id: "foreign-1", visibility: "unlisted" };
  shared.configuration.symbolConfig.size.stops[1].size = 87;
  let resolveShared;
  const pendingShared = new Promise(resolve => { resolveShared = resolve; });
  fetch.mockImplementation(async url => {
    if (url.includes("/shared/")) return pendingShared;
    return response(url.endsWith("/default") ? defaultConfiguration() : []);
  });
  const { layer } = mountApp();
  if (order === "API first") await act(async () => resolveShared(response(shared)));
  else await loadLayer(layer);
  expect(layer.renderer).toBeUndefined();
  expect(screen.getByRole("button", { name: "Apply settings" }).disabled).toBe(true);
  if (order === "API first") await loadLayer(layer);
  else await act(async () => resolveShared(response(shared)));
  expect(sizeStops(layer)[1].size).toBe(87);
  expect(screen.getByLabelText("My configuration").value).toBe("shared:foreign-token");
  expect(screen.getByRole("option", { name: "Other person's trees (shared)" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Other person's trees", exact: true })).toBeNull();
  expect(screen.getByRole("button", { name: "Share", exact: true }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Save as configuration" }).disabled).toBe(true);
  expect(screen.getByText("Saving a copy of shared settings is not available yet.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("At 700 (pt)"), { target: { value: "88" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply settings" }));
  expect(sizeStops(layer)[1].size).toBe(88);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  expect(screen.getByLabelText("My configuration").disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("My configuration"), { target: { value: "system-default" } });
  await waitFor(() => expect(screen.getByLabelText("My configuration").value).toBe("system-default"));
  expect(window.location.search).toBe("");
  expect(sizeStops(layer)[1].size).toBe(40);
  expect(screen.queryByRole("option", { name: "Other person's trees (shared)" })).toBeNull();
  expect(screen.getByRole("button", { name: "Save as configuration" }).disabled).toBe(false);
  expect(screen.queryByRole("button", { name: "Dismiss notification" })).toBeNull();
});

// A missing link returns 404; invalid settings contain a column the dataset does not have.
// Show the error instead of silently displaying System default. Test retry and dropdown recovery.
test.each(["missing", "using an unknown column"])("shows an error for shared settings that are %s and lets the user recover", async failure => {
  window.history.replaceState(null, "", "/?share=bad-token");
  const invalid = savedConfiguration("Invalid shared");
  invalid.configuration.tableConfig.columns = ["not-a-field"];
  fetch.mockImplementation(async url => {
    if (url.includes("/shared/")) return failure === "missing" ? response({ detail: "Shared configuration not found." }, 404) : response(invalid);
    return response(url.endsWith("/default") ? defaultConfiguration() : []);
  });
  const { layer } = mountApp();
  await loadLayer(layer);
  expect(screen.getByRole("alert").textContent).toContain("Could not load shared settings");
  expect(layer.renderer).toBeUndefined();
  expect(screen.getByRole("button", { name: "Apply settings" }).disabled).toBe(true);
  fetch.mockImplementation(async url => response(url.includes("/shared/") ? { ...savedConfiguration("Recovered shared"), id: "foreign-1", visibility: "unlisted" } : url.endsWith("/default") ? defaultConfiguration() : []));
  if (failure === "missing") {
    fireEvent.click(screen.getByRole("button", { name: "Retry shared configuration" }));
    await waitFor(() => expect(screen.getByLabelText("My configuration").value).toBe("shared:bad-token"));
    expect(window.location.search).toBe("?share=bad-token");
  }
  expect(screen.getByLabelText("My configuration").disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("My configuration"), { target: { value: "system-default" } });
  await waitFor(() => expect(screen.getByLabelText("My configuration").value).toBe("system-default"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(window.location.search).toBe("");
});

test("switching to my saved configuration removes the share link from the address and enables Save and Share", async () => {
  window.history.replaceState(null, "", "/?share=foreign-token&other=kept");
  const own = savedConfiguration();
  const shared = { ...savedConfiguration("Shared trees"), id: "foreign-1", visibility: "unlisted" };
  fetch.mockImplementation(async url => response(url.includes("/shared/") ? shared : url.endsWith("/default") ? defaultConfiguration() : [own]));
  const { layer } = mountApp();
  await loadLayer(layer);
  fetch.mockResolvedValueOnce(response(own));
  fireEvent.change(screen.getByLabelText("My configuration"), { target: { value: own.id } });
  await waitFor(() => expect(screen.getByLabelText("My configuration").value).toBe(own.id));
  expect(window.location.search).toBe("?other=kept");
  expect(screen.getByRole("button", { name: "Share", exact: true }).disabled).toBe(false);
  expect(screen.getByRole("button", { name: "Save as configuration" }).disabled).toBe(false);
});

// Retry a failed link, switch to System default while waiting, then let the old request fail.
// The old failure must not overwrite the recovered screen with an error.
test("does not show an old retry error after the user switches to System default", async () => {
  window.history.replaceState(null, "", "/?share=bad-token");
  fetch.mockImplementation(async url => response(url.includes("/shared/") ? { detail: "Shared configuration not found." } : url.endsWith("/default") ? defaultConfiguration() : [], url.includes("/shared/") ? 404 : 200));
  const { layer } = mountApp();
  await loadLayer(layer);
  let rejectRetry;
  let retrySignal;
  fetch.mockImplementationOnce((_url, options) => {
    retrySignal = options.signal;
    return new Promise((_resolve, reject) => { rejectRetry = reject; });
  });
  fireEvent.click(screen.getByRole("button", { name: "Retry shared configuration" }));
  expect(screen.getByLabelText("My configuration").disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("My configuration"), { target: { value: "system-default" } });
  await waitFor(() => expect(screen.getByLabelText("My configuration").value).toBe("system-default"));
  expect(retrySignal.aborted).toBe(true);
  await act(async () => rejectRetry(new TypeError("late failure")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry shared configuration" })).toBeNull();
  expect(window.location.search).toBe("");
});
