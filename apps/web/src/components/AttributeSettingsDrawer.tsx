import { useRef, useState } from "react";
import './styles.css';
import Icon from './Icon';
import { MAX_MARKER_SIZE, MIN_MARKER_SIZE, type SymbologyDraft } from '../symbology';

type AttributeSettingsDrawerProps = {
  isAttributeDrawerOpen: boolean;
  fields: { name: string }[];
  columns: string[];
  isTableInitialized: boolean;
  layerLoadError: string | null;
  onChange: (columns: string[]) => void;
  onApply: () => void;
  onSave: () => void;
  symbologyDraft: SymbologyDraft;
  onSymbologyChange: (field: keyof SymbologyDraft, value: string) => void;
  error: string | null;
  status: string;
  isBusy: boolean;
  canSave: boolean;
  saveDisabledReason?: string;
};

export default function AttributeSettingsDrawer({
  isAttributeDrawerOpen,
  fields,
  columns,
  isTableInitialized,
  layerLoadError,
  onChange,
  onApply,
  onSave,
  symbologyDraft,
  onSymbologyChange,
  error,
  status,
  isBusy,
  canSave,
  saveDisabledReason
}: AttributeSettingsDrawerProps) {
  const [search, setSearch] = useState("");
  const draggedField = useRef<string | null>(null);
  if (!isAttributeDrawerOpen) return null;

  const hiddenFields = fields.filter(field => !columns.includes(field.name));
  const matchingFields = hiddenFields.filter(field => field.name.toLowerCase().includes(search.trim().toLowerCase()));
  const move = (fieldName: string, to: number) => {
    const from = columns.indexOf(fieldName);
    if (from < 0 || to < 0 || to >= columns.length || from === to) return;
    const reordered = [...columns];
    reordered.splice(from, 1);
    reordered.splice(to, 0, fieldName);
    onChange(reordered);
  };

  // Future: Dock this drawer by shrinking the map/table workspace so the table stays uncovered and horizontally scrollable.
  // Future: Adapt the drawer and its controls for mobile screens.
  return (
    <aside className="attribute-drawer" aria-labelledby="attribute-settings-heading">
      <header>
        <h2 id="attribute-settings-heading">Map settings</h2>
        <p>Apply updates the map and table. Closing keeps your draft.</p>
      </header>
      <div className="attribute-drawer-body">
        <fieldset className="attribute-drawer-content" disabled={isBusy}>
          {layerLoadError ? <p role="alert">{layerLoadError}</p> : !isTableInitialized ? <p>Loading table fields…</p> : <>
            <section className="drawer-symbology" aria-label="Point symbology">
              <h3>Symbology</h3>
              <fieldset aria-describedby="colour-dataset">
                <legend>Point colour</legend>
                <p id="colour-dataset">Leaf area</p>
                <div className="symbology-endpoints">
                  <label>At 10 <input type="color" value={symbologyDraft.lowColor} onChange={event => onSymbologyChange("lowColor", event.target.value)} /></label>
                  <label>At 40,000 <input type="color" value={symbologyDraft.highColor} onChange={event => onSymbologyChange("highColor", event.target.value)} /></label>
                </div>
              </fieldset>
              <fieldset aria-describedby="size-dataset">
                <legend>Point size</legend>
                <p id="size-dataset">Leaf biomass</p>
                <div className="symbology-endpoints">
                  <label>At 0 (pt) <input type="number" min={MIN_MARKER_SIZE} max={MAX_MARKER_SIZE} step="any" value={symbologyDraft.lowSize} onChange={event => onSymbologyChange("lowSize", event.target.value)} /></label>
                  <label>At 700 (pt) <input type="number" min={MIN_MARKER_SIZE} max={MAX_MARKER_SIZE} step="any" value={symbologyDraft.highSize} onChange={event => onSymbologyChange("highSize", event.target.value)} /></label>
                </div>
              </fieldset>
              <small>1–100 points; either direction allowed.</small>
            </section>
            <h3>Visible columns ({columns.length})</h3>
            {/* Future: If shortcut arrows use the approved icon set, retain readable Alt + Left/Right instructions. */}
            <p id="attribute-order-hint">Order runs left to right, then the next row. Click a name to hide. Drag a grip to reorder, or focus it and use Alt + ← / →.</p>
            <ol className="attribute-columns" aria-label="Visible columns in display order">
              {columns.map((fieldName, index) => (
                <li key={fieldName} onDragOver={event => event.preventDefault()} onDrop={event => {
                  event.preventDefault();
                  if (draggedField.current) move(draggedField.current, index);
                  draggedField.current = null;
                }}>
                  <button
                    type="button"
                    className="attribute-grip"
                    draggable
                    aria-label={`Reorder ${fieldName}, position ${index + 1} of ${columns.length}`}
                    aria-describedby="attribute-order-hint"
                    aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                    onKeyDown={event => {
                      if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                      event.preventDefault();
                      move(fieldName, index + (event.key === "ArrowLeft" ? -1 : 1));
                    }}
                    onDragStart={event => {
                      draggedField.current = fieldName;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", fieldName);
                    }}
                    onDragEnd={() => { draggedField.current = null; }}
                  ><Icon name="drag" /></button>
                  <button type="button" className="attribute-field-name" aria-label={`Hide ${fieldName}`} onClick={() => onChange(columns.filter(name => name !== fieldName))}>{fieldName} <Icon name="x" /></button>
                </li>
              ))}
            </ol>
            {columns.length === 0 && <p role="alert">Select at least one column.</p>}
            <h3 className="attribute-hidden-heading">Hidden columns ({hiddenFields.length})</h3>
            <label className="attribute-search">Search hidden columns<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
            <ul className="attribute-hidden-columns">
              {matchingFields.map(field => <li key={field.name}><button type="button" onClick={() => onChange([...columns, field.name])}><Icon name="plus" /> {field.name}</button></li>)}
            </ul>
            {matchingFields.length === 0 && <p>{hiddenFields.length === 0 ? "All columns are selected." : "No matching hidden columns."}</p>}
          </>}
        </fieldset>
        <footer>
          {error && <p role="alert">{error}</p>}
          <p role="status">{!isTableInitialized ? "Loading map…" : status}</p>
          <button type="button" disabled={!isTableInitialized || columns.length === 0 || isBusy} onClick={onApply}>Apply settings</button>
          <button type="button" className="secondary-action" disabled={!isTableInitialized || isBusy || !canSave} onClick={onSave}>Save as configuration</button>
          {saveDisabledReason && <small>{saveDisabledReason}</small>}
        </footer>
      </div>
    </aside>
  );
}
