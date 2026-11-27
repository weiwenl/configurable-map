import { createElement } from "react";

// ArcGIS Expand registers Calcite's icon element through its existing action component.
// Future: Replace Calcite icons here with Font Awesome or an approved icon set,
// preserving accessible labels on the buttons that use them.
export default function Icon({ name }: { name: string }) {
  return createElement("calcite-icon", { icon: name, scale: "s", "aria-hidden": "true" });
}
