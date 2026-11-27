import { useCallback, useEffect, useRef, useState } from "react";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-legend";
import "@arcgis/map-components/components/arcgis-feature-table";
import "@arcgis/map-components/components/arcgis-expand";
import type { ArcgisMapCustomEvent } from "@arcgis/map-components";
import type { ArcgisFeatureTable } from "@arcgis/map-components/components/arcgis-feature-table";
import { Configuration, configure, configureSymbols, configureTable } from "./configuration";
import { validateSymbology, type SymbologyDraft } from "./symbology";
import { getConfiguration, getDefaultConfiguration, getSharedConfiguration, listConfigurations, saveConfiguration, type ConfigurationSummary, type SavedConfiguration } from "./configurationApi";
import LeftRail from "./components/LeftRail";
import AttributeSettingsDrawer from "./components/AttributeSettingsDrawer";
import SaveConfigurationDialog from "./components/SaveConfigurationDialog";
import ShareConfigurationDialog from "./components/ShareConfigurationDialog";
import Icon from "./components/Icon";

// This is a REST API - you can open this url on the browser to see the available fields in the layer
const FEATURE_LAYER_URL =
  "https://services.arcgis.com/V6ZHFr6zdgNZuVG0/arcgis/rest/services/Landscape_Trees/FeatureServer/0";

const EMPTY_DRAFT: SymbologyDraft = { lowColor: "", highColor: "", lowSize: "", highSize: "" };

type SettingsDraft = { symbology: SymbologyDraft; columns: string[] };

function clearShareQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete("share");
  window.history.replaceState(null, "", url);
}

function draftFromConfiguration(configuration: Configuration): SettingsDraft {
  const { color, size } = configuration.symbolConfig;
  if (color?.field !== "Leaf_Area" || size?.field !== "Leaf_Bmass" || color.stops.length !== 2 || size.stops.length !== 2 ||
    color.stops[0].value !== 10 || color.stops[1].value !== 40000 || size.stops[0].value !== 0 || size.stops[1].value !== 700) {
    throw new Error("This configuration uses fields or ranges this editor does not support.");
  }
  return { symbology: { lowColor: color.stops[0].color, highColor: color.stops[1].color, lowSize: String(size.stops[0].size), highSize: String(size.stops[1].size) }, columns: [...configuration.tableConfig.columns] };
}

export default function App() {
  const [isAttributeDrawerOpen, setIsAttributeDrawerOpen] = useState(false);
  const [draftColumnNames, setDraftColumnNames] = useState<string[]>([]);
  const [layer, setLayer] = useState<FeatureLayer | null>(null);
  const layerRef = useRef<FeatureLayer | null>(null);
  const initializedTable = useRef<ArcgisFeatureTable | null>(null);
  const [isTableInitialized, setIsTableInitialized] = useState(false);
  const [symbologyDraft, setSymbologyDraft] = useState(EMPTY_DRAFT);
  const [appliedSymbologyDraft, setAppliedSymbologyDraft] = useState(EMPTY_DRAFT);
  const [appliedColumnNames, setAppliedColumnNames] = useState<string[]>([]);
  const [savedBaseline, setSavedBaseline] = useState<SettingsDraft>({ symbology: EMPTY_DRAFT, columns: [] });
  const [defaultConfiguration, setDefaultConfiguration] = useState<SavedConfiguration | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [isLoadingDefault, setIsLoadingDefault] = useState(true);
  const [sharedToken, setSharedToken] = useState(() => new URLSearchParams(window.location.search).get("share"));
  const [sharedConfiguration, setSharedConfiguration] = useState<SavedConfiguration | null>(null);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [isLoadingShared, setIsLoadingShared] = useState(false);
  const sharedRequest = useRef<AbortController | null>(null);
  const [sharingConfiguration, setSharingConfiguration] = useState<ConfigurationSummary | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [layerLoadError, setLayerLoadError] = useState<string | null>(null);
  const [configurations, setConfigurations] = useState<ConfigurationSummary[]>([]);
  const [selectedConfigurationId, setSelectedConfigurationId] = useState("");
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [isLoadingConfigurations, setIsLoadingConfigurations] = useState(true);
  const [isOpeningConfiguration, setIsOpeningConfiguration] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string } | null>(null);
  const settingsButton = useRef<HTMLButtonElement | null>(null);
  const currentDraft = { symbology: symbologyDraft, columns: draftColumnNames };
  const hasUnappliedChanges = JSON.stringify(currentDraft) !== JSON.stringify({ symbology: appliedSymbologyDraft, columns: appliedColumnNames });
  const hasUnsavedChanges = JSON.stringify(currentDraft) !== JSON.stringify(savedBaseline);
  const startupConfiguration = sharedToken !== null ? sharedConfiguration : defaultConfiguration;
  const selectedOwnedConfiguration = sharedToken === null && selectedConfigurationId !== defaultConfiguration?.id
    ? configurations.find(configuration => configuration.id === selectedConfigurationId) : undefined;

  const refreshConfigurations = useCallback(async (signal?: AbortSignal) => {
    setIsLoadingConfigurations(true);
    setConfigurationError(null);
    try { setConfigurations(await listConfigurations(signal)); }
    catch (error) { if (!signal?.aborted) setConfigurationError((error as Error).message); }
    finally { if (!signal?.aborted) setIsLoadingConfigurations(false); }
  }, []);

  const loadDefaultConfiguration = useCallback(async (signal?: AbortSignal) => {
    setIsLoadingDefault(true);
    setDefaultError(null);
    try {
      const saved = await getDefaultConfiguration(signal);
      if (!signal?.aborted) setDefaultConfiguration(saved);
    } catch (error) { if (!signal?.aborted) setDefaultError((error as Error).message); }
    finally { if (!signal?.aborted) setIsLoadingDefault(false); }
  }, []);

  const loadSharedConfiguration = useCallback(async () => {
    if (sharedToken === null) return;
    sharedRequest.current?.abort();
    const controller = new AbortController();
    sharedRequest.current = controller;
    const signal = controller.signal;
    setIsLoadingShared(true);
    setSharedError(null);
    try {
      const saved = await getSharedConfiguration(sharedToken, signal);
      if (!signal?.aborted) setSharedConfiguration(saved);
    } catch (error) { if (!signal?.aborted) setSharedError((error as Error).message); }
    finally { if (!signal?.aborted) setIsLoadingShared(false); }
  }, [sharedToken]);

  useEffect(() => {
    void loadSharedConfiguration();
    return () => sharedRequest.current?.abort();
  }, [loadSharedConfiguration]);

  useEffect(() => {
    const controller = new AbortController();
    void refreshConfigurations(controller.signal);
    void loadDefaultConfiguration(controller.signal);
    return () => controller.abort();
  }, [refreshConfigurations, loadDefaultConfiguration]);

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notification]);

  const handleTableRef = useCallback((table: ArcgisFeatureTable | null) => {
    if (!table || !layer || !startupConfiguration) return;
    if (initializedTable.current !== table) {
      const previous = { renderer: layer.renderer, tableTemplate: table.tableTemplate, hiddenFields: table.hiddenFields };
      try {
        const draft = draftFromConfiguration(startupConfiguration.configuration);
        validateDraft(draft);
        configure(layer, table, startupConfiguration.configuration);
        setSymbologyDraft(draft.symbology);
        setAppliedSymbologyDraft(draft.symbology);
        setDraftColumnNames(draft.columns);
        setAppliedColumnNames(draft.columns);
        setSavedBaseline(draft);
        setSelectedConfigurationId(sharedToken !== null ? `shared:${sharedToken}` : startupConfiguration.id);
        initializedTable.current = table;
      } catch (error) {
        layer.renderer = previous.renderer;
        table.tableTemplate = previous.tableTemplate;
        table.hiddenFields = previous.hiddenFields;
        if (sharedToken !== null) setSharedError((error as Error).message);
        else setDefaultError((error as Error).message);
        return;
      }
    }
    setIsTableInitialized(true);
  }, [layer, startupConfiguration, sharedToken]);

  const validateDraft = (draft: SettingsDraft): Configuration => {
    const result = validateSymbology(draft.symbology);
    if (result.error) throw new Error(result.error);
    if (draft.columns.length === 0) throw new Error("Select at least one column.");
    if (!layer || draft.columns.some(name => !layer.fields.some(field => field.name === name))) throw new Error("This configuration contains unavailable columns.");
    return { symbolConfig: result.symbolConfig!, tableConfig: { columns: [...draft.columns] } };
  };

  const updateSymbologyDraft = (field: keyof SymbologyDraft, value: string) => {
    setSymbologyDraft(current => ({ ...current, [field]: value }));
  };

  const applySettingsSnapshot = (configuration: Configuration, draft: SettingsDraft, changesOnly = false) => {
    if (!isTableInitialized || !layer || !initializedTable.current) throw new Error("The table is still loading. Try again when it is ready.");
    const table = initializedTable.current;
    const previous = { renderer: layer.renderer, tableTemplate: table.tableTemplate, hiddenFields: table.hiddenFields };
    try {
      if (!changesOnly || JSON.stringify(draft.symbology) !== JSON.stringify(appliedSymbologyDraft)) configureSymbols(layer, configuration.symbolConfig);
      if (!changesOnly || JSON.stringify(draft.columns) !== JSON.stringify(appliedColumnNames)) configureTable(layer, table, configuration.tableConfig);
    }
    catch {
      layer.renderer = previous.renderer;
      table.tableTemplate = previous.tableTemplate;
      table.hiddenFields = previous.hiddenFields;
      throw new Error("Could not apply settings. Your previous map and table settings are kept; try again.");
    }
    setAppliedSymbologyDraft({ ...draft.symbology });
    setAppliedColumnNames([...draft.columns]);
  };

  const applySettings = () => {
    try {
      applySettingsSnapshot(validateDraft(currentDraft), currentDraft, true);
      setSettingsError(null);
    } catch (error) { setSettingsError((error as Error).message); }
  };

  const openSaveDialog = () => {
    if (sharedToken !== null) return;
    try {
      validateDraft(currentDraft);
      setSettingsError(null);
      setSaveError(null);
      setIsSaveDialogOpen(true);
    } catch (error) { setSettingsError((error as Error).message); }
  };

  const saveCurrentDraft = async (name: string) => {
    // Future: Allow saving shared settings as a new owned copy.
    setIsSaving(true);
    setSaveError(null);
    let saved: SavedConfiguration;
    const snapshot = { symbology: { ...symbologyDraft }, columns: [...draftColumnNames] };
    try { saved = await saveConfiguration(name, validateDraft(snapshot)); }
    catch (error) { setSaveError((error as Error).message); setIsSaving(false); return; }
    setConfigurations(current => [...current, saved]);
    setSelectedConfigurationId(saved.id);
    setSavedBaseline(snapshot);
    setIsSaving(false);
    setIsSaveDialogOpen(false);
    setNotification({ message: `Configuration “${saved.name}” created successfully.` });
    try {
      applySettingsSnapshot(saved.configuration, snapshot);
      setSettingsError(null);
      setIsAttributeDrawerOpen(false);
      window.requestAnimationFrame(() => settingsButton.current?.focus());
    } catch {
      setSettingsError("Configuration saved, but could not apply it. Your draft is kept; try Apply settings again.");
    }
  };

  const openSavedConfiguration = async (id: string) => {
    if (!isTableInitialized && sharedToken !== null && id === defaultConfiguration?.id) {
      setSharedToken(null);
      setSharedError(null);
      clearShareQuery();
      return;
    }
    if (!id || (hasUnsavedChanges && !window.confirm("Discard your unsaved settings and open this configuration?"))) return;
    setIsOpeningConfiguration(true);
    setConfigurationError(null);
    try {
      // Future: Resolve the owner's personal default on the backend when preferences are introduced.
      const saved = id === defaultConfiguration?.id ? await getDefaultConfiguration() : await getConfiguration(id);
      const nextDraft = draftFromConfiguration(saved.configuration);
      validateDraft(nextDraft);
      applySettingsSnapshot(saved.configuration, nextDraft);
      setSymbologyDraft(nextDraft.symbology);
      setDraftColumnNames(nextDraft.columns);
      setSavedBaseline(nextDraft);
      setSelectedConfigurationId(saved.id);
      setSettingsError(null);
      setSharedToken(null);
      setSharedError(null);
      clearShareQuery();
    } catch (error) { setConfigurationError((error as Error).message); }
    finally { setIsOpeningConfiguration(false); }
  };

  const handleMapReady = useCallback((event: ArcgisMapCustomEvent<void>) => {
    const view = event.target.view;
    if (!view?.map || layerRef.current) return;

    const layer = new FeatureLayer({
      url: FEATURE_LAYER_URL,
      outFields: ["*"],
      popupTemplate: {
        title: "{Cmn_Name} (Tree {Tree_ID})",
        content: [
          {
            type: "fields",
            fieldInfos: [
              { fieldName: "Sci_Name", label: "Scientific name" },
              { fieldName: "Status", label: "Status" },
              { fieldName: "Condition", label: "Condition" },
              { fieldName: "Height", label: "Height (ft)" },
              { fieldName: "Native", label: "Native" },
              { fieldName: "Land_Use", label: "Land use" },
            ],
          },
        ],
      },
    });

    layerRef.current = layer;
    view.map.add(layer);
    layer.when(
      () => {
        if (layer.fullExtent) view.goTo(layer.fullExtent).catch(() => { });
        setLayer(layer);
      },
      () => setLayerLoadError("Could not load tree data. Check your connection and reload the page."),
    );
  }, []);

  return (
    <div className="app-shell">
      <LeftRail
        isAttributeDrawerOpen={isAttributeDrawerOpen}
        onToggleAttributeDrawer={() => setIsAttributeDrawerOpen(selected => !selected)}
        buttonRef={settingsButton}
      />
      <AttributeSettingsDrawer
        isAttributeDrawerOpen={isAttributeDrawerOpen}
        fields={layer?.fields ?? []}
        columns={draftColumnNames}
        isTableInitialized={isTableInitialized}
        layerLoadError={layerLoadError}
        onChange={setDraftColumnNames}
        symbologyDraft={symbologyDraft}
        onSymbologyChange={updateSymbologyDraft}
        error={settingsError}
        status={hasUnappliedChanges ? "Changes not applied" : hasUnsavedChanges ? "Applied — not saved" : sharedToken !== null ? "Shared configuration applied" : selectedConfigurationId === defaultConfiguration?.id ? "Default applied" : "Saved configuration applied"}
        onApply={applySettings}
        onSave={openSaveDialog}
        isBusy={isOpeningConfiguration || isSaving}
        canSave={!isLoadingConfigurations && sharedToken === null}
        saveDisabledReason={sharedToken !== null ? "Saving a copy of shared settings is not available yet." : undefined}
      />
      {isSaveDialogOpen && <SaveConfigurationDialog isSaving={isSaving} error={saveError} onSave={name => void saveCurrentDraft(name)} onCancel={() => setIsSaveDialogOpen(false)} />}
      {sharingConfiguration && <ShareConfigurationDialog configurationId={sharingConfiguration.id} name={sharingConfiguration.name} onClose={() => setSharingConfiguration(null)} />}
      {notification && <div className="configuration-toast">
        <span className="configuration-toast-icon"><Icon name="check-circle-f" /></span>
        <div role="status"><strong>Success</strong><p>{notification.message}</p></div>
        <button type="button" aria-label="Dismiss notification" onClick={() => setNotification(null)}><Icon name="x" /></button>
      </div>}
      <div className="map-workspace">
        <div className="configuration-toolbar">
          {/* Future: Style the native select chevron with an approved icon while preserving native keyboard behaviour. */}
          <label>My configuration<select value={selectedConfigurationId} disabled={(!isTableInitialized && !(sharedToken !== null && defaultConfiguration)) || isLoadingConfigurations || isOpeningConfiguration || isSaving} onChange={event => void openSavedConfiguration(event.target.value)}>
            <option value="">{isLoadingConfigurations ? "Loading configurations…" : "Choose a configuration"}</option>
            {defaultConfiguration && <option value={defaultConfiguration.id}>{defaultConfiguration.name}</option>}
            {sharedToken !== null && sharedConfiguration && <option value={`shared:${sharedToken}`}>{sharedConfiguration.name} (shared)</option>}
            {configurations.filter(configuration => configuration.id !== defaultConfiguration?.id).map(configuration => <option key={configuration.id} value={configuration.id} disabled={!isTableInitialized}>{configuration.name}</option>)}
          </select></label>
          <button type="button" disabled={!selectedOwnedConfiguration || !isTableInitialized || isOpeningConfiguration || isSaving} onClick={() => selectedOwnedConfiguration && setSharingConfiguration(selectedOwnedConfiguration)}>Share</button>
          {isOpeningConfiguration && <span>Opening…</span>}
          {configurationError && <><span role="alert">{configurationError}</span><button type="button" disabled={isLoadingConfigurations} onClick={() => void refreshConfigurations()}>Retry list</button></>}
          {defaultError && <><span role="alert">Could not load default settings: {defaultError}</span><button type="button" disabled={isLoadingDefault} onClick={() => void loadDefaultConfiguration()}>Retry default</button></>}
          {sharedError && <><span role="alert">Could not load shared settings: {sharedError}</span><button type="button" disabled={isLoadingShared} onClick={() => void loadSharedConfiguration()}>Retry shared configuration</button></>}
          {layerLoadError && <span role="alert">{layerLoadError}</span>}
        </div>
        <arcgis-map
          id="map"
          basemap="topo-vector"
          onarcgisViewReadyChange={handleMapReady}
          style={{ flex: 1, minHeight: 0 }}
        >
          {/* Keep the legend in workspace stacking rather than the browser's top layer. */}
          <arcgis-expand slot="bottom-left" expanded topLayerDisabled>
            <arcgis-legend />
          </arcgis-expand>
        </arcgis-map>
        {layer && (
          <arcgis-feature-table
            ref={handleTableRef}
            referenceElement="map"
            layer={layer}
            style={{ height: "40vh" }}
          />
        )}
      </div>
    </div>
  );
}
