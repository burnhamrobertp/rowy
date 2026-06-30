import { IDisplayCellProps } from "@src/components/fields/types";
import MapStartPos from "@src/components/MapStartPos";
import { useMapMeta } from "./mapMetaEffect";

export default function MapStartPosView({
  value,
  column,
  _rowy_ref,
}: IDisplayCellProps) {
  const { textureUrl, dimensions } = useMapMeta(_rowy_ref, column);
  if (textureUrl === null) {
    return <>No image texture URL</>;
  }
  if (dimensions === null) {
    return <>No map dimensions</>;
  }
  return (
    <MapStartPos
      textureUrl={textureUrl}
      dimensions={dimensions}
      startPos={value}
      editable={false}
    />
  );
}
