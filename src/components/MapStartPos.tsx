import { useState, useRef, useEffect } from "react";
import AddLocationAltIcon from "@mui/icons-material/AddLocationAlt";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import CodeIcon from "@mui/icons-material/Code";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import {
  ButtonGroup,
  Tooltip,
  IconButton,
  TextField,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  Stack,
  Popover,
  Button,
  Alert,
  Tabs,
  Tab,
  Typography,
  Paper,
} from "@mui/material";

import {
  StartPos,
  Position,
  Role,
  ROLES,
  POSITION_NAME_RE,
} from "./startpos/types";
import { MapDimensions, clampToBounds } from "./startpos/geometry";
import { StartPosState } from "./startpos/state";
import { loadStartPos, saveStartPos } from "./startpos/serialization";
import { validateStartPos } from "./startpos/validation";

export interface MapStartPosProps {
  textureUrl: string;
  dimensions: MapDimensions;
  startPos: StartPos | unknown;
  updatedStartPos?: (startPos: StartPos) => void;
  editable?: boolean;
}

const CLICK_DRAG_THRESHOLD = 3;
const SIDE_COLORS = [
  "#2196f3",
  "#ef5350",
  "#66bb6a",
  "#ffa726",
  "#ab47bc",
  "#26c6da",
  "#d4e157",
  "#8d6e63",
];
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

interface SpawnUse {
  role?: Role;
  baseCenter?: string;
  sideIdx: number;
  startIdx: number;
}

function serialize(sp: StartPos): string {
  return JSON.stringify(saveStartPos(sp));
}

// 2 teams of 8 -> "8v8"; 3 teams of 2 -> "2v2v2".
function configLabel(teamCount: number, playersPerTeam: number): string {
  return Array.from({ length: teamCount }, () => playersPerTeam).join("v");
}

export default function MapStartPos(props: MapStartPosProps) {
  const { dimensions } = props;
  const W = dimensions.widthElmos;
  const H = dimensions.heightElmos;
  const portrait = H >= W;
  // Match the in-game render (map_start_position_suggestions.lua): a fixed
  // 300-elmo circle. Name and role share one label size (in elmo units).
  const R = 300;
  const LABEL_SIZE = 110;

  const [dialogOpen, setDialogOpen] = useState(false);
  const initial = useRef(loadStartPos(props.startPos));
  const [state, setState] = useState<StartPosState>(() =>
    StartPosState.fromStartPos(initial.current)
  );

  const [configIdx, setConfigIdx] = useState(0);
  const [addMode, setAddMode] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  // Raw-JSON view/edit; null = closed.
  const [jsonDraft, setJsonDraft] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
    name: string;
    anchorEl: Element;
  } | null>(null);

  const dragging = useRef<string | null>(null);
  const pendingClick = useRef<{
    name: string;
    anchorEl: Element;
    clientX: number;
    clientY: number;
  } | null>(null);

  const positionNames = Object.keys(state.positions);
  const errors = validateStartPos(state.toStartPos());
  const outOfBounds = positionNames.filter((n) => {
    const p = state.positions[n];
    return p.x < 0 || p.x > W || p.y < 0 || p.y > H;
  });

  const team = state.team;
  const activeConfig = configIdx < team.length ? configIdx : 0;
  const config = team[activeConfig];

  // For the active config, map each used spawn -> its role/team/slot.
  const spawnUse = new Map<string, SpawnUse>();
  config?.sides.forEach((side, sideIdx) =>
    side.starts.forEach((start, startIdx) => {
      if (start.spawnPoint) {
        spawnUse.set(start.spawnPoint, {
          role: start.role,
          baseCenter: start.baseCenter,
          sideIdx,
          startIdx,
        });
      }
    })
  );

  useEffect(() => {
    if (selected && !(selected.name in state.positions)) setSelected(null);
  }, [state, selected]);

  useEffect(() => {
    if (configIdx >= team.length && team.length > 0)
      setConfigIdx(team.length - 1);
  }, [team.length, configIdx]);

  // Auto-persist: debounce writes while editing and flush on unmount (when the
  // popover / side drawer closes), so changes are never lost for want of a
  // save click.
  const lastSavedRef = useRef(serialize(initial.current));
  const stateRef = useRef(state);
  stateRef.current = state;
  const updatedRef = useRef(props.updatedStartPos);
  updatedRef.current = props.updatedStartPos;

  useEffect(() => {
    if (!props.editable || !props.updatedStartPos) return;
    const serialized = serialize(state.toStartPos());
    if (serialized === lastSavedRef.current) return;
    const id = setTimeout(() => {
      props.updatedStartPos!(saveStartPos(state.toStartPos()));
      lastSavedRef.current = serialized;
    }, 500);

    return () => clearTimeout(id);
  }, [state, props.editable, props.updatedStartPos]);

  useEffect(
    () => () => {
      const fn = updatedRef.current;
      if (!fn) return;
      const serialized = serialize(stateRef.current.toStartPos());
      if (serialized !== lastSavedRef.current)
        fn(saveStartPos(stateRef.current.toStartPos()));
    },
    []
  );

  function openJson() {
    setJsonDraft(JSON.stringify(saveStartPos(state.toStartPos()), null, 2));
    setJsonError(null);
  }

  function applyJson() {
    try {
      const parsed = JSON.parse(jsonDraft ?? "");
      setState(StartPosState.fromStartPos(loadStartPos(parsed)));
      setJsonDraft(null);
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  }

  function svgPoint(event: React.MouseEvent<SVGElement, MouseEvent>): Position {
    const svg =
      event.currentTarget instanceof SVGSVGElement
        ? event.currentTarget
        : event.currentTarget.ownerSVGElement!;
    const ctm = svg.getScreenCTM()!;
    return {
      x: (event.clientX - ctm.e) / ctm.a,
      y: (event.clientY - ctm.f) / ctm.d,
    };
  }

  function onBackgroundClick(
    event: React.MouseEvent<SVGSVGElement, MouseEvent>
  ) {
    if (!addMode) return;
    const elmo = clampToBounds(svgPoint(event), dimensions);
    const name = state.nextPositionName();
    setState(state.addPosition(name, elmo));
    setAddMode(false);
  }

  function onMouseMove(event: React.MouseEvent<SVGSVGElement, MouseEvent>) {
    if (pendingClick.current) {
      const dx = event.clientX - pendingClick.current.clientX;
      const dy = event.clientY - pendingClick.current.clientY;
      if (dx * dx + dy * dy >= CLICK_DRAG_THRESHOLD * CLICK_DRAG_THRESHOLD) {
        dragging.current = pendingClick.current.name;
        pendingClick.current = null;
      }
    }
    if (!dragging.current) return;
    event.preventDefault();
    const elmo = clampToBounds(svgPoint(event), dimensions);
    setState((s) => s.movePosition(dragging.current!, elmo));
  }

  function endInteraction() {
    if (pendingClick.current) {
      const pc = pendingClick.current;
      setSelected({ name: pc.name, anchorEl: pc.anchorEl });
      pendingClick.current = null;
    }
    dragging.current = null;
  }

  const mapView = (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        ...(addMode ? { cursor: "crosshair" } : {}),
      }}
      onMouseLeave={endInteraction}
      onMouseUp={endInteraction}
      onMouseMove={onMouseMove}
      onClick={onBackgroundClick}
    >
      <image
        width={W}
        height={H}
        x={0}
        y={0}
        href={props.textureUrl}
        preserveAspectRatio="none"
      />
      {positionNames.map((name) => {
        const p = state.positions[name];
        const use = spawnUse.get(name);
        const isSelected = selected?.name === name;

        // A position outside the map bounds would render off-canvas and be
        // unreachable, so pin it to the nearest edge (flagged) while the modal
        // and stored value keep the true coords for correction.
        const oob = p.x < 0 || p.x > W || p.y < 0 || p.y > H;
        const d = oob ? clampToBounds(p, dimensions) : p;
        const color = deleteMode
          ? "#e53935"
          : oob
          ? "#ff5252"
          : use
          ? SIDE_COLORS[use.sideIdx % SIDE_COLORS.length]
          : "#8a93a3";

        // Shrink the name to fit across the circle if it's long.
        const nameSize = Math.min(LABEL_SIZE, (1.7 * R) / (name.length * 0.62));

        return (
          <g key={name}>
            <circle
              cx={d.x}
              cy={d.y}
              r={R}
              fill={rgba(color, 0.28)}
              stroke={isSelected ? "#ffffff" : color}
              strokeWidth={isSelected ? R * 0.11 : R * 0.07}
              strokeDasharray={oob ? `${R * 0.22} ${R * 0.16}` : undefined}
              style={{
                cursor: deleteMode
                  ? "pointer"
                  : props.editable
                  ? "move"
                  : "default",
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => {
                if (!props.editable) return;
                e.stopPropagation();
                if (deleteMode) {
                  setState(state.removePosition(name));
                  setDeleteMode(false);
                  return;
                }
                pendingClick.current = {
                  name,
                  anchorEl: e.currentTarget,
                  clientX: e.clientX,
                  clientY: e.clientY,
                };
              }}
            >
              <title>
                {oob ? `${name} - off map at (${p.x}, ${p.y})` : name}
              </title>
            </circle>
            <text
              x={d.x}
              y={use?.role ? d.y - LABEL_SIZE * 0.6 : d.y}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#ffffff"
              stroke="rgba(0,0,0,0.5)"
              strokeWidth={nameSize * 0.05}
              paintOrder="stroke"
              fontSize={nameSize}
              fontWeight={700}
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {name}
            </text>
            {use?.role && (
              <text
                x={d.x}
                y={d.y + LABEL_SIZE * 0.6}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#ffd54f"
                stroke="rgba(0,0,0,0.5)"
                strokeWidth={LABEL_SIZE * 0.05}
                paintOrder="stroke"
                fontSize={LABEL_SIZE}
                fontWeight={600}
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {use.role}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );

  // Fullscreen lets a portrait map use the full viewport height; in the side
  // drawer the map fills the available width (capped so very tall maps scroll).
  const mapWrapStyle: React.CSSProperties = dialogOpen
    ? portrait
      ? { height: "84vh", aspectRatio: `${W} / ${H}`, maxWidth: "100%" }
      : { width: "100%", aspectRatio: `${W} / ${H}`, maxHeight: "84vh" }
    : { width: "100%", aspectRatio: `${W} / ${H}`, maxHeight: "74vh" };
  const mapBox = (
    <div style={{ position: "relative", margin: "0 auto", ...mapWrapStyle }}>
      {mapView}
    </div>
  );

  if (!props.editable) {
    return (
      <div style={{ width: "100%", height: "100%", padding: 10 }}>{mapBox}</div>
    );
  }

  const selectedPos = selected ? state.positions[selected.name] : null;
  const selectedUse = selected ? spawnUse.get(selected.name) : undefined;

  const editorView = (
    <>
      <ButtonGroup variant="outlined" size="small">
        <Tooltip title="Add position (then click the map)">
          <span>
            <IconButton
              size="small"
              color={addMode ? "primary" : "default"}
              onClick={() => {
                setAddMode(!addMode);
                setDeleteMode(false);
              }}
            >
              <AddLocationAltIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Delete position (then click a marker)">
          <span>
            <IconButton
              size="small"
              color={deleteMode ? "error" : "default"}
              disabled={positionNames.length === 0}
              onClick={() => {
                setDeleteMode(!deleteMode);
                setAddMode(false);
              }}
            >
              <DeleteIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="View / edit raw JSON">
          <span>
            <IconButton size="small" onClick={openJson}>
              <CodeIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Fullscreen">
          <span>
            <IconButton size="small" onClick={() => setDialogOpen(!dialogOpen)}>
              {dialogOpen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </ButtonGroup>

      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="caption" color="text.secondary">
          Configuration
        </Typography>
        {team.length > 0 ? (
          <Tabs
            value={activeConfig}
            onChange={(_, v) => setConfigIdx(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ minHeight: 36, flexGrow: 1 }}
          >
            {team.map((t, i) => (
              <Tab
                key={i}
                sx={{ minHeight: 36, py: 0 }}
                label={configLabel(t.teamCount, t.playersPerTeam)}
              />
            ))}
          </Tabs>
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ flexGrow: 1 }}
          >
            none yet
          </Typography>
        )}
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={() => {
            setState(state.addTeam());
            setConfigIdx(team.length);
          }}
        >
          Add
        </Button>
      </Stack>

      {mapBox}

      {config && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TextField
              type="number"
              size="small"
              label="Teams"
              value={config.teamCount}
              onChange={(e) =>
                setState(
                  state.setTeamCount(activeConfig, Number(e.target.value))
                )
              }
              sx={{ width: 90 }}
              inputProps={{ min: 1 }}
            />
            <TextField
              type="number"
              size="small"
              label="Players / team"
              value={config.playersPerTeam}
              onChange={(e) =>
                setState(
                  state.setPlayersPerTeam(activeConfig, Number(e.target.value))
                )
              }
              sx={{ width: 120 }}
              inputProps={{ min: 1 }}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ flexGrow: 1 }}
            >
              Click a marker to set its team & role
            </Typography>
            <Tooltip title="Remove this configuration">
              <IconButton
                size="small"
                onClick={() => {
                  setState(state.removeTeam(activeConfig));
                  setConfigIdx(Math.max(0, activeConfig - 1));
                }}
              >
                <DeleteIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Paper>
      )}

      <Popover
        open={selected !== null && selectedPos !== null}
        anchorEl={selected?.anchorEl ?? null}
        onClose={() => setSelected(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
        disableRestoreFocus
        PaperProps={{ sx: { p: 1.5, minWidth: 240 } }}
      >
        {selected !== null && selectedPos !== null && (
          <PositionEditor
            name={selected.name}
            pos={selectedPos}
            use={selectedUse}
            teamCount={config?.teamCount ?? 0}
            positionNames={positionNames}
            onRename={(newName) => {
              setState(state.renamePosition(selected.name, newName));
              setSelected({ ...selected, name: newName });
            }}
            onMove={(p) =>
              setState(
                state.movePosition(selected.name, clampToBounds(p, dimensions))
              )
            }
            onSetTeam={(sideIdx) =>
              setState(state.setSpawnTeam(activeConfig, selected.name, sideIdx))
            }
            onSetStart={(patch) => {
              if (selectedUse)
                setState(
                  state.setStart(
                    activeConfig,
                    selectedUse.sideIdx,
                    selectedUse.startIdx,
                    patch
                  )
                );
            }}
            onDelete={() => {
              setState(state.removePosition(selected.name));
              setSelected(null);
            }}
          />
        )}
      </Popover>

      {outOfBounds.length > 0 && (
        <Alert severity="warning">
          {outOfBounds.length} position(s) lie outside the map and are pinned to
          the edge (red, dashed): {outOfBounds.join(", ")}. Click one to correct
          its coordinates.
        </Alert>
      )}

      {errors.length > 0 && (
        <Alert severity="warning" sx={{ "& ul": { m: 0, pl: 2 } }}>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Dialog
        open={jsonDraft !== null}
        onClose={() => setJsonDraft(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>StartPos JSON</DialogTitle>
        <DialogContent>
          <TextField
            multiline
            minRows={14}
            fullWidth
            value={jsonDraft ?? ""}
            onChange={(e) => setJsonDraft(e.target.value)}
            error={jsonError !== null}
            helperText={jsonError ?? " "}
            InputProps={{ sx: { fontFamily: "monospace", fontSize: 12 } }}
          />
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button
              startIcon={<ContentCopyIcon />}
              onClick={() =>
                jsonDraft && navigator.clipboard?.writeText(jsonDraft)
              }
            >
              Copy
            </Button>
            <Button variant="contained" onClick={applyJson}>
              Apply
            </Button>
            <div style={{ flexGrow: 1 }} />
            <Button onClick={() => setJsonDraft(null)}>Close</Button>
          </Stack>
        </DialogContent>
      </Dialog>
    </>
  );

  if (dialogOpen) {
    return (
      <Dialog open fullWidth maxWidth="xl" onClose={() => setDialogOpen(false)}>
        <DialogTitle>StartPos editor</DialogTitle>
        <DialogContent>
          <Stack spacing={2} style={{ minHeight: "80vh", width: "100%" }}>
            {editorView}
          </Stack>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Stack spacing={2} style={{ padding: 20, minWidth: 520, maxWidth: 760 }}>
      {editorView}
    </Stack>
  );
}

interface PositionEditorProps {
  name: string;
  pos: Position;
  use?: SpawnUse;
  teamCount: number;
  positionNames: string[];
  onRename: (newName: string) => void;
  onMove: (pos: Position) => void;
  onSetTeam: (sideIdx: number | null) => void;
  onSetStart: (patch: { role?: Role; baseCenter?: string }) => void;
  onDelete: () => void;
}

function PositionEditor(props: PositionEditorProps) {
  const [name, setName] = useState(props.name);
  const nameError =
    name !== props.name &&
    (name.trim() === "" ||
      !POSITION_NAME_RE.test(name) ||
      props.positionNames.includes(name));

  function commitName() {
    if (!nameError && name !== props.name) props.onRename(name);
    else setName(props.name);
  }

  return (
    <Stack spacing={1.5}>
      <TextField
        size="small"
        label="Name"
        value={name}
        error={nameError}
        helperText={nameError ? "Invalid or duplicate name" : " "}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => e.key === "Enter" && commitName()}
      />
      {props.use && (
        <Stack direction="row" spacing={1}>
          <TextField
            select
            size="small"
            label="Role"
            value={props.use.role ?? ""}
            fullWidth
            onChange={(e) =>
              props.onSetStart({
                role: (e.target.value || undefined) as Role | undefined,
              })
            }
          >
            <MenuItem value="">
              <em>none</em>
            </MenuItem>
            {ROLES.map((r) => (
              <MenuItem key={r} value={r}>
                {r}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Base"
            value={
              props.use.baseCenter &&
              props.positionNames.includes(props.use.baseCenter)
                ? props.use.baseCenter
                : ""
            }
            fullWidth
            onChange={(e) =>
              props.onSetStart({ baseCenter: e.target.value || undefined })
            }
          >
            <MenuItem value="">
              <em>none</em>
            </MenuItem>
            {props.positionNames.map((n) => (
              <MenuItem key={n} value={n}>
                {n}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      )}

      {props.teamCount > 0 && (
        <TextField
          select
          size="small"
          label="Team"
          value={props.use ? String(props.use.sideIdx) : ""}
          onChange={(e) =>
            props.onSetTeam(
              e.target.value === "" ? null : Number(e.target.value)
            )
          }
        >
          <MenuItem value="">
            <em>not in this config</em>
          </MenuItem>
          {Array.from({ length: props.teamCount }, (_, i) => (
            <MenuItem key={i} value={String(i)}>
              Team {i + 1}
            </MenuItem>
          ))}
        </TextField>
      )}

      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          type="number"
          label="x"
          value={props.pos.x}
          onChange={(e) =>
            props.onMove({ x: Number(e.target.value), y: props.pos.y })
          }
        />
        <TextField
          size="small"
          type="number"
          label="y"
          value={props.pos.y}
          onChange={(e) =>
            props.onMove({ x: props.pos.x, y: Number(e.target.value) })
          }
        />
      </Stack>

      <Button
        size="small"
        color="error"
        startIcon={<DeleteIcon />}
        onClick={props.onDelete}
      >
        Delete position
      </Button>
    </Stack>
  );
}
