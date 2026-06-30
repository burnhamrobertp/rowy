import { ISideDrawerFieldProps } from "@src/components/fields/types";
import MapStartPos from "@src/components/MapStartPos";
import { StartPos } from "@src/components/startpos/types";
import { Alert } from "@mui/material";
import { useMapMeta } from "./mapMetaEffect";

export default function MapStartPosPanel({
  value,
  disabled,
  onChange,
  onSubmit,
  _rowy_ref,
  column,
}: ISideDrawerFieldProps) {
  const { textureUrl, dimensions } = useMapMeta(_rowy_ref, column);

  const updated = (startPos: StartPos) => {
    onChange(startPos);
    onSubmit();
  };

  if (textureUrl === null) {
    return <Alert severity="error">No image texture URL</Alert>;
  }
  if (dimensions === null) {
    return (
      <Alert severity="error">
        Map dimensions missing or unparseable (expected "W x H").
      </Alert>
    );
  }

  return (
    <MapStartPos
      textureUrl={textureUrl}
      dimensions={dimensions}
      startPos={value}
      updatedStartPos={updated}
      editable={!disabled}
    />
  );
}
