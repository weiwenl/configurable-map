import Collection from "@arcgis/core/core/Collection";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer";
import type { ColorVariableProperties } from "@arcgis/core/renderers/visualVariables/ColorVariable";
import type { SizeVariableProperties } from "@arcgis/core/renderers/visualVariables/SizeVariable";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import FieldColumnTemplate from "@arcgis/core/widgets/FeatureTable/support/FieldColumnTemplate";
import TableTemplate from "@arcgis/core/widgets/FeatureTable/support/TableTemplate";

type SizeStop = { value: number; size: number };
type ColorStop = { value: number; color: string };

export type Configuration = {
  symbolConfig: {
    size?: { field: string; stops: SizeStop[] };
    color?: { field: string; stops: ColorStop[] };
  };
  tableConfig: {
    columns: string[];
  };
};

export const configureSymbols = (
  layer: FeatureLayer,
  symbolConfig: Configuration["symbolConfig"],
) => {
  const visualVariables: Array<
    (SizeVariableProperties & { type: "size" }) | (ColorVariableProperties & { type: "color" })
  > = [];
  if (symbolConfig.size) {
    visualVariables.push({
      type: "size",
      field: symbolConfig.size.field,
      stops: symbolConfig.size.stops,
    });
  }
  if (symbolConfig.color) {
    visualVariables.push({
      type: "color",
      field: symbolConfig.color.field,
      stops: symbolConfig.color.stops,
    });
  }

  const primaryField =
    symbolConfig.color?.field ?? symbolConfig.size?.field ?? layer.objectIdField;

  const renderer = new UniqueValueRenderer({
    field: primaryField,
    defaultSymbol: new SimpleMarkerSymbol({
      color: "#2b8a3e",
      size: 6,
      outline: { color: "white", width: 0.5 },
    }),
    uniqueValueInfos: [],
    visualVariables
  });
  layer.renderer = renderer;
};

export const configureTable = (
  layer: FeatureLayer,
  table: HTMLArcgisFeatureTableElement,
  tableConfig: Configuration["tableConfig"],
) => {
  table.tableTemplate = new TableTemplate({
    columnTemplates: tableConfig.columns.map(
      (fieldName) => new FieldColumnTemplate({ fieldName, visible: true }),
    ),
  });
  table.hiddenFields = new Collection<string>(
    layer.fields.filter(field => !tableConfig.columns.includes(field.name)).map(field => field.name),
  );
};

export const configure = (
  layer: FeatureLayer,
  table: HTMLArcgisFeatureTableElement,
  config: Configuration,
) => {
  configureSymbols(layer, config.symbolConfig);
  configureTable(layer, table, config.tableConfig);
};
