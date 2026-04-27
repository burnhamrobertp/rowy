import { useEffect, useState, useRef, useCallback } from "react";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import {
  ButtonGroup,
  Tooltip,
  IconButton,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  Stack,
} from "@mui/material";

export interface Point {
  x: number;
  y: number;
}

function pointEqual(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export interface Startbox {
  poly: Point[];
}

function startboxEqual(a: Startbox, b: Startbox): boolean {
  if (a.poly.length !== b.poly.length) return false;
  return a.poly.every((p, i) => pointEqual(p, b.poly[i]));
}

// Legacy 2-point rectangle to 4-point polygon (for editor state only).
function rectToPolygon(poly: [Point, Point]): Point[] {
  const [tl, br] = poly;
  return [
    { x: tl.x, y: tl.y },
    { x: br.x, y: tl.y },
    { x: br.x, y: br.y },
    { x: tl.x, y: br.y },
  ];
}

function isLegacyRect(poly: Point[]): boolean {
  return poly.length === 2;
}

// Convert polygon back to 2-point rectangle if it's an axis-aligned rect.
function tryPolygonToRect(poly: Point[]): Point[] {
  if (poly.length !== 4) return poly;
  const xs = poly.map((p) => p.x).sort((a, b) => a - b);
  const ys = poly.map((p) => p.y).sort((a, b) => a - b);
  const isRect =
    xs[0] === xs[1] && xs[2] === xs[3] && ys[0] === ys[1] && ys[2] === ys[3];
  if (!isRect) return poly;
  return [
    { x: xs[0], y: ys[0] },
    { x: xs[3], y: ys[3] },
  ];
}

function getStartboxString(poly: Point[]): string {
  return poly.map((p) => `${p.x} ${p.y}`).join(", ");
}

function parseStartboxString(startboxString: string): Point[] {
  const parts = startboxString
    .trim()
    .split(/,/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const points: Point[] = [];
  for (const part of parts) {
    const nums = part
      .split(/ +/)
      .map((field) => {
        const val = parseInt(field, 10);
        if (isNaN(val)) throw new Error(`'${field}' is not a number`);
        if (val < 0 || val > 200) throw new Error(`${val} not in range 0-200`);
        return val;
      });
    if (nums.length !== 2) throw new Error(`expected 'x y' pair, got '${part}'`);
    points.push({ x: nums[0], y: nums[1] });
  }

  if (points.length < 3) {
    throw new Error(`need at least 3 vertices, got ${points.length}`);
  }
  return points;
}

function clampPoint({ x, y }: Point): Point {
  return {
    x: Math.min(Math.max(Math.round(x), 0), 200),
    y: Math.min(Math.max(Math.round(y), 0), 200),
  };
}

function polygonCentroid(poly: Point[]): Point {
  const n = poly.length;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = poly[i].x * poly[j].y - poly[j].x * poly[i].y;
    area += cross;
    cx += (poly[i].x + poly[j].x) * cross;
    cy += (poly[i].y + poly[j].y) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-6) {
    // Degenerate — fall back to bounding box center.
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  }
  cx /= 6 * area;
  cy /= 6 * area;
  return { x: cx, y: cy };
}

// Midpoint of an edge between two vertices.
function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Immutable state object for single startbox
class StartboxState {
  public readonly str: string;

  constructor(
    public readonly poly: Point[],
    str?: string,
    public readonly strErr?: string
  ) {
    if (str !== undefined) {
      this.str = str;
    } else {
      this.str = getStartboxString(poly);
    }
  }

  setStr(str: string): StartboxState {
    if (str === this.str) {
      return this;
    }
    try {
      return new StartboxState(parseStartboxString(str), str);
    } catch (e) {
      return new StartboxState(this.poly, str, (e as Error).message);
    }
  }

  setVertex(index: number, point: Point): StartboxState {
    const clamped = clampPoint(point);
    if (pointEqual(this.poly[index], clamped)) return this;
    const newPoly = [...this.poly];
    newPoly[index] = clamped;
    return new StartboxState(newPoly);
  }

  insertVertex(afterIndex: number, point: Point): StartboxState {
    const newPoly = [...this.poly];
    newPoly.splice(afterIndex + 1, 0, clampPoint(point));
    return new StartboxState(newPoly);
  }

  removeVertex(index: number): StartboxState {
    if (this.poly.length <= 3) return this;
    const newPoly = [...this.poly];
    newPoly.splice(index, 1);
    return new StartboxState(newPoly);
  }

  moveBy(dx: number, dy: number): StartboxState {
    const moved = this.poly.map((p) => clampPoint({ x: p.x + dx, y: p.y + dy }));
    if (this.poly.every((p, i) => pointEqual(p, moved[i]))) return this;
    return new StartboxState(moved);
  }
}

// Immutable state object for all startboxes
class StartboxesState {
  constructor(public readonly boxes: StartboxState[]) {}

  update(
    idx: number,
    update: (box: StartboxState) => StartboxState
  ): StartboxesState {
    const newBox = update(this.boxes[idx]);
    if (newBox === this.boxes[idx]) {
      return this;
    }
    const newStartboxes = [...this.boxes];
    newStartboxes[idx] = newBox;
    return new StartboxesState(newStartboxes);
  }

  add(poly: Point[]): StartboxesState {
    return new StartboxesState([...this.boxes, new StartboxState(poly)]);
  }

  remove(idx: number): StartboxesState {
    const newStartboxes = [...this.boxes];
    newStartboxes.splice(idx, 1);
    return new StartboxesState(newStartboxes);
  }
}

export interface MapStartboxProps {
  textureUrl: string;
  startboxes: Startbox[];
  updatedStartboxes?: (startboxes: Startbox[]) => void;
  editable?: boolean;
  expandedLayout?: boolean;
}

const NEW_POLYGON: Point[] = [
  { x: 50, y: 50 },
  { x: 150, y: 50 },
  { x: 150, y: 150 },
  { x: 50, y: 150 },
];

// Convert stored startbox data to editor polygon state.
function loadPoly(box: Startbox): Point[] {
  if (isLegacyRect(box.poly)) {
    return rectToPolygon(box.poly as [Point, Point]);
  }
  return box.poly;
}

// Convert editor polygon state back to stored startbox data.
// Preserves 2-point rectangle format when possible.
function savePoly(poly: Point[]): Startbox {
  return { poly: tryPolygonToRect(poly) };
}

export default function MapStartbox(props: MapStartboxProps) {
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const initStartboxes = props.startboxes || [];
  const [startboxes, setStartboxes] = useState<StartboxesState>(
    new StartboxesState(initStartboxes.map((box) => new StartboxState(loadPoly(box))))
  );
  const selectedElement = useRef<
    | { type: "vertex"; startboxIndex: number; vertexIndex: number }
    | { type: "move"; startboxIndex: number; origin: Point }
    | null
  >(null);

  const [deleteStartbox, setDeleteStartbox] = useState<boolean>(false);
  const [deleteVertex, setDeleteVertex] = useState<boolean>(false);

  const changedStartbox =
    initStartboxes.length !== startboxes.boxes.length ||
    initStartboxes.some(
      (box, idx) => !startboxEqual(savePoly(startboxes.boxes[idx].poly), box)
    );

  function saveStartboxes() {
    if (props.updatedStartboxes) {
      props.updatedStartboxes(startboxes.boxes.map((sb) => savePoly(sb.poly)));
    }
  }

  function maybeDeleteStartbox(startboxIndex: number) {
    if (deleteStartbox) {
      setStartboxes(startboxes.remove(startboxIndex));
      setDeleteStartbox(false);
    }
  }

  function svgPoint(event: React.MouseEvent<SVGElement, MouseEvent>): Point {
    const svg = event.currentTarget instanceof SVGSVGElement
      ? event.currentTarget
      : event.currentTarget.ownerSVGElement!;
    const ctm = svg.getScreenCTM()!;
    return {
      x: (event.clientX - ctm.e) / ctm.a,
      y: (event.clientY - ctm.f) / ctm.d,
    };
  }

  function mouseMove(event: React.MouseEvent<SVGSVGElement, MouseEvent>) {
    if (selectedElement.current === null) return;
    event.preventDefault();
    const point = svgPoint(event);
    if (selectedElement.current.type === "vertex") {
      setStartboxes(
        startboxes.update(selectedElement.current.startboxIndex, (sb) =>
          sb.setVertex((selectedElement.current as any).vertexIndex, point)
        )
      );
    } else if (selectedElement.current.type === "move") {
      const dx = point.x - selectedElement.current.origin.x;
      const dy = point.y - selectedElement.current.origin.y;
      setStartboxes(
        startboxes.update(selectedElement.current.startboxIndex, (sb) =>
          sb.moveBy(dx, dy)
        )
      );
      selectedElement.current = { ...selectedElement.current, origin: point };
    }
  }

  const [textureAspectRatio, setTextureAspectRatio] = useState<number>(0);
  const [imageElementAspectRatio, setImageElementAspectRatio] =
    useState<number>(0);

  const resizeObserver = useRef<ResizeObserver>(
    new ResizeObserver((entries) => {
      setImageElementAspectRatio(
        entries[0].borderBoxSize[0].inlineSize /
          entries[0].borderBoxSize[0].blockSize
      );
    })
  );

  const registerResizeObserver = useCallback((el: HTMLImageElement) => {
    if (el) return resizeObserver.current.observe(el);
    resizeObserver.current.disconnect();
  }, []);

  const mapView = (
    <>
      <div style={{ position: "absolute", width: "100%", height: "100%" }}>
        <img
          src={props.textureUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            opacity: "0",
            display: "block",
          }}
          alt="map texture"
          onLoad={(e) =>
            setTextureAspectRatio(
              e.currentTarget.naturalWidth / e.currentTarget.naturalHeight
            )
          }
          ref={registerResizeObserver}
        />
        <svg
          viewBox="-5 -5 210 210"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            aspectRatio: textureAspectRatio,
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            ...(textureAspectRatio > imageElementAspectRatio
              ? { width: "100%", maxHeight: "100%" }
              : { height: "100%", maxWidth: "100%" }),
          }}
          onMouseLeave={() => {
            selectedElement.current = null;
          }}
          onMouseUp={() => {
            selectedElement.current = null;
          }}
          onMouseMove={mouseMove}
          onClick={() => {
            setDeleteStartbox(false);
            setDeleteVertex(false);
          }}
        >
          <image
            width={200}
            height={200}
            x={0}
            y={0}
            href={props.textureUrl}
            preserveAspectRatio="none"
          ></image>
          {startboxes.boxes.map((startbox, startboxIndex) => {
            const poly = startbox.poly;
            const pointsStr = poly.map((p) => `${p.x},${p.y}`).join(" ");
            const center = polygonCentroid(poly);
            return (
              <g key={startboxIndex}>
                <polygon
                  points={pointsStr}
                  fill="rgba(255, 0, 0, 0.15)"
                  stroke="red"
                  strokeWidth="0.5"
                  style={{ cursor: deleteStartbox ? "pointer" : (props.editable ? "grab" : "auto") }}
                  onClick={() => maybeDeleteStartbox(startboxIndex)}
                  onMouseDown={(e) => {
                    if (deleteStartbox || deleteVertex || !props.editable) return;
                    const origin = svgPoint(e);
                    selectedElement.current = {
                      type: "move",
                      startboxIndex,
                      origin,
                    };
                  }}
                />
                <text
                  x={center.x}
                  y={center.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fontSize="12px"
                >
                  {startboxIndex + 1}
                </text>
                {props.editable && (
                  <>
                    {/* Vertex drag handles */}
                    {poly.map((point, vertexIndex) => (
                      <circle
                        key={`v${vertexIndex}`}
                        cx={point.x}
                        cy={point.y}
                        fill={deleteVertex ? "#ff6666" : "red"}
                        r="2.5"
                        style={{ cursor: deleteVertex ? "pointer" : "move" }}
                        onMouseDown={(e) => {
                          if (deleteVertex) {
                            e.stopPropagation();
                            if (poly.length > 3) {
                              setStartboxes(
                                startboxes.update(startboxIndex, (sb) =>
                                  sb.removeVertex(vertexIndex)
                                )
                              );
                            }
                            setDeleteVertex(false);
                            return;
                          }
                          e.stopPropagation();
                          selectedElement.current = {
                            type: "vertex",
                            startboxIndex,
                            vertexIndex,
                          };
                        }}
                      />
                    ))}
                    {/* Edge midpoint handles to insert vertices */}
                    {poly.map((point, i) => {
                      const next = poly[(i + 1) % poly.length];
                      const mid = midpoint(point, next);
                      return (
                        <circle
                          key={`m${i}`}
                          cx={mid.x}
                          cy={mid.y}
                          fill="rgba(255, 255, 255, 0.6)"
                          stroke="red"
                          strokeWidth="0.3"
                          r="1.5"
                          style={{ cursor: "crosshair" }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setStartboxes(
                              startboxes.update(startboxIndex, (sb) =>
                                sb.insertVertex(i, clampPoint(mid))
                              )
                            );
                          }}
                        />
                      );
                    })}
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );

  if (props.editable) {
    const editorView = (
      <>
        <ButtonGroup
          variant="outlined"
          size="small"
          aria-label="outlined button group"
        >
          <Tooltip title="Add startbox">
            <span>
              <IconButton
                size="small"
                onClick={() => setStartboxes(startboxes.add(NEW_POLYGON))}
              >
                <AddIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Delete startbox">
            <span>
              <IconButton
                size="small"
                disabled={startboxes.boxes.length <= 1}
                onClick={() => {
                  setDeleteStartbox(!deleteStartbox);
                  setDeleteVertex(false);
                }}
              >
                <DeleteIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Delete vertex (click a vertex to remove it)">
            <span>
              <IconButton
                size="small"
                color={deleteVertex ? "error" : "default"}
                onClick={() => {
                  setDeleteVertex(!deleteVertex);
                  setDeleteStartbox(false);
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          {props.updatedStartboxes && (
            <Tooltip title="Save startboxes">
              <span>
                <IconButton
                  disabled={!changedStartbox}
                  size="small"
                  onClick={saveStartboxes}
                >
                  <SaveAltIcon />
                </IconButton>
              </span>
            </Tooltip>
          )}
          <Tooltip title="Fullscreen">
            <span>
              <IconButton
                size="small"
                onClick={() => setDialogOpen(!dialogOpen)}
              >
                {dialogOpen ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </IconButton>
            </span>
          </Tooltip>
        </ButtonGroup>
        <div style={{ flexGrow: 1, position: "relative", minHeight: props.expandedLayout ? "450px" : "300px" }}>
          {mapView}
        </div>
        <Stack direction="row" flexWrap="wrap" style={{ columnGap: "10px" }}>
          {startboxes.boxes.map((startbox, startboxIndex) => (
            <TextField
              key={startboxIndex}
              value={startbox.str}
              size="small"
              label={`${startboxIndex + 1} (${startbox.poly.length} pts)`}
              style={{ width: "280px" }}
              onChange={(e) =>
                setStartboxes(
                  startboxes.update(startboxIndex, (sb) =>
                    sb.setStr(e.target.value)
                  )
                )
              }
              helperText={startbox.strErr || " "}
              error={startbox.strErr !== undefined}
            ></TextField>
          ))}
        </Stack>
      </>
    );

    if (dialogOpen) {
      return (
        <Dialog
          open={dialogOpen}
          fullWidth={true}
          maxWidth="xl"
          onClose={() => setDialogOpen(false)}
        >
          <DialogTitle>Startbox editor</DialogTitle>
          <DialogContent>
            <Stack
              spacing={2}
              flexWrap="nowrap"
              flexDirection="column"
              style={{ height: "80vh", width: "100%" }}
            >
              {editorView}
            </Stack>
          </DialogContent>
        </Dialog>
      );
    } else {
      return (
        <div style={{
          padding: "20px",
          minWidth: props.expandedLayout ? "500px" : "300px",
          maxWidth: props.expandedLayout ? "700px" : "400px",
        }}>
          {editorView}
        </div>
      );
    }
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        margin: "10px",
        position: "relative",
      }}
    >
      {mapView}
    </div>
  );
}
