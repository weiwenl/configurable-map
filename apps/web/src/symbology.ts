import type { Configuration } from "./configuration.ts";

export type SymbologyDraft = {
  lowColor: string;
  highColor: string;
  lowSize: string;
  highSize: string;
};

// Application limits for readable markers, not ArcGIS SDK limits. Units: points.
export const MIN_MARKER_SIZE = 1;
export const MAX_MARKER_SIZE = 100;

export function validateSymbology(draft: SymbologyDraft):
  | { symbolConfig: Configuration["symbolConfig"]; error?: never }
  | { error: string; symbolConfig?: never } {
  if (![draft.lowColor, draft.highColor].every(color => /^#[0-9a-f]{6}$/i.test(color))) {
    return { error: "Choose two valid colours in #RRGGBB format." };
  }

  const sizes = [draft.lowSize, draft.highSize];
  if (sizes.some(size => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(size.trim()) ||
      !Number.isFinite(Number(size)))) {
    return { error: "Enter a finite number for both marker sizes." };
  }
  const [lowSize, highSize] = sizes.map(Number);
  if ([lowSize, highSize].some(size => size < MIN_MARKER_SIZE || size > MAX_MARKER_SIZE)) {
    return { error: `Marker sizes must be between ${MIN_MARKER_SIZE} and ${MAX_MARKER_SIZE} points.` };
  }

  // Future: Support field selection or editable data ranges by validating them against
  // layer metadata here and replace these fixed stops while preserving Configuration's shape.
  return {
    symbolConfig: {
      color: { field: "Leaf_Area", stops: [
        { value: 10, color: draft.lowColor }, { value: 40000, color: draft.highColor },
      ] },
      size: { field: "Leaf_Bmass", stops: [
        { value: 0, size: lowSize }, { value: 700, size: highSize },
      ] },
    },
  };
}

// Keep applied state unchanged until validation and the renderer update succeed.
export function applySymbologyDraft(
  draft: SymbologyDraft,
  appliedDraft: SymbologyDraft,
  render: (symbolConfig: Configuration["symbolConfig"]) => void,
): { appliedDraft: SymbologyDraft; error: string | null } {
  const result = validateSymbology(draft);
  if (result.error !== undefined) return { appliedDraft, error: result.error };
  try {
    render(result.symbolConfig);
    return { appliedDraft: { ...draft }, error: null };
  } catch {
    return { appliedDraft, error: "Could not apply symbology. Your settings are kept; try again." };
  }
}
