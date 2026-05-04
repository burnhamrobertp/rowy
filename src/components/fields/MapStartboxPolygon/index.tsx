import { lazy } from "react";
import { IFieldConfig, FieldType } from "@src/components/fields/types";
import withRenderTableCell from "@src/components/Table/TableCell/withRenderTableCell";

import HexagonOutlinedIcon from "@mui/icons-material/HexagonOutlined";
import DisplayCell from "/src/components/fields/MapStartbox/DisplayCell";

const SideDrawerField = lazy(
  () =>
    import(
      "./SideDrawerField" /* webpackChunkName: "SideDrawerField-MapStartboxPolygon" */
    )
);

const Settings = lazy(
  () =>
    import(
      "../MapStartbox/Settings" /* webpackChunkName: "Settings-MapStartbox" */
    )
);

export const config: IFieldConfig = {
  type: FieldType.mapStartboxPolygon,
  name: "Map Startbox (Polygon)",
  group: "BAR Custom",
  dataType: "{ poly: { x: number; y: number; strength?: number }[] }[]",
  initialValue: [],
  icon: <HexagonOutlinedIcon />,
  description:
    "Polygon startbox editor — supports arbitrary vertex polygons, Catmull-Rom spline polygons (per-anchor strength in [0, 1]), and legacy rectangles",
  TableCell: withRenderTableCell(DisplayCell, SideDrawerField, "popover", {
    usesRowData: true,
    disablePadding: true,
  }),
  SideDrawerField,
  settings: Settings,
};
export default config;
