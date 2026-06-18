import { useEffect, useState, useRef, useCallback } from "react";
import DeleteIcon from "@mui/icons-material/Delete";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
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
  Slider,
  Typography,
  Popover,
  Button,
} from "@mui/material";

export interface Point {
  x: number;
  y: number;
  /**
   * Optional Catmull-Rom spline strength in [0, 1].
   *   0 (default) = sharp polygon corner
   *   1           = full smooth curve
   * Per-edge tension is the average of the two endpoint anchor strengths.
   */
  strength?: number;
}

function pointEqual(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y && (a.strength ?? 0) === (b.strength ?? 0);
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

// Convert polygon back to 2-point rectangle if it's an axis-aligned rect with
// no per-anchor strengths (i.e. a plain polygon that happens to be a rectangle).
function tryPolygonToRect(poly: Point[]): Point[] {
  if (poly.length !== 4) return poly;
  if (poly.some((p) => (p.strength ?? 0) > 0)) return poly;
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

// Snap strength to step 0.025, with explicit snap-to-0 below half a step and
// snap-to-1 above 1 - half a step so map makers don't accidentally keep tiny
// non-zero strengths or near-1 strengths that aren't quite 1.
//
// We round in integer space (multiply, round, divide by the denominator) so
// the result lands on an exact float value rather than something like
// 0.30000000000000004 that would otherwise leak from `s / 0.025 * 0.025`.
const STRENGTH_STEP = 0.025;
const STRENGTH_DENOM = 40; // 1 / STRENGTH_STEP
const STRENGTH_SNAP_EPSILON = STRENGTH_STEP / 2;
function snapStrength(s: number): number {
  if (!isFinite(s)) return 0;
  if (s <= STRENGTH_SNAP_EPSILON) return 0;
  if (s >= 1 - STRENGTH_SNAP_EPSILON) return 1;
  const clamped = Math.min(Math.max(s, 0), 1);
  return Math.round(clamped * STRENGTH_DENOM) / STRENGTH_DENOM;
}

function formatStrength(s: number): string {
  // Display with up to 3 decimal places (matching the 0.025 step), dropping
  // trailing zeros so 0.5 shows as "0.5", 0.025 shows as "0.025".
  return Number(s.toFixed(3)).toString();
}

function getStartboxString(poly: Point[]): string {
  return poly
    .map((p) => {
      const s = p.strength ?? 0;
      if (s <= 0) return `${p.x} ${p.y}`;
      return `${p.x} ${p.y} ${formatStrength(s)}`;
    })
    .join(", ");
}

function parseStartboxString(startboxString: string): Point[] {
  const parts = startboxString
    .trim()
    .split(/,/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const points: Point[] = [];
  for (const part of parts) {
    const tokens = part.split(/ +/);
    if (tokens.length !== 2 && tokens.length !== 3) {
      throw new Error(`expected 'x y' or 'x y strength', got '${part}'`);
    }

    const x = parseInt(tokens[0], 10);
    const y = parseInt(tokens[1], 10);
    if (isNaN(x)) throw new Error(`'${tokens[0]}' is not a number`);
    if (isNaN(y)) throw new Error(`'${tokens[1]}' is not a number`);
    if (x < 0 || x > 200) throw new Error(`x=${x} not in range 0-200`);
    if (y < 0 || y > 200) throw new Error(`y=${y} not in range 0-200`);

    const point: Point = { x, y };
    if (tokens.length === 3) {
      const sRaw = parseFloat(tokens[2]);
      if (isNaN(sRaw)) throw new Error(`'${tokens[2]}' is not a number`);
      if (sRaw < 0 || sRaw > 1)
        throw new Error(`strength=${sRaw} not in range 0-1`);
      const s = snapStrength(sRaw);
      if (s > 0) point.strength = s;
    }
    points.push(point);
  }

  if (points.length < 3) {
    throw new Error(`need at least 3 vertices, got ${points.length}`);
  }
  return points;
}

function clampPoint(p: Point): Point {
  const out: Point = {
    x: Math.min(Math.max(Math.round(p.x), 0), 200),
    y: Math.min(Math.max(Math.round(p.y), 0), 200),
  };
  if (p.strength !== undefined && p.strength > 0) {
    out.strength = snapStrength(p.strength);
  }
  return out;
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

// On-curve midpoint of the edge from poly[i] to poly[(i+1) % N]. For a plain
// (zero-tension) edge this collapses to the linear midpoint because
// sampleSegment with tension=0 returns the linear interpolation; for a
// splined edge it samples the same Catmull-Rom curve the renderer draws,
// so the insert handle visually rides the rendered outline.
function curveMidpoint(poly: Point[], i: number): Point {
  const n = poly.length;
  if (n < 2) return { x: poly[0]?.x ?? 0, y: poly[0]?.y ?? 0 };
  const iPrev = (i - 1 + n) % n;
  const iNext = (i + 1) % n;
  const iNext2 = (iNext + 1) % n;
  const p0 = poly[iPrev];
  const p1 = poly[i];
  const p2 = poly[iNext];
  const p3 = poly[iNext2];
  const s1 = clamp01(p1.strength ?? 0);
  const s2 = clamp01(p2.strength ?? 0);
  const edgeTension = clamp01((s1 + s2) * 0.5);
  return sampleSegment(p0, p1, p2, p3, 0.5, edgeTension);
}

// Strength to give a vertex inserted on the edge from poly[i] to poly[i+1].
// Average of the two endpoint strengths so adding a point in the middle of a
// smooth edge keeps the curve smooth (rather than introducing a sharp corner
// that would visually break the rendered shape).
function insertionStrength(poly: Point[], i: number): number {
  const s1 = poly[i].strength ?? 0;
  const s2 = poly[(i + 1) % poly.length].strength ?? 0;
  return snapStrength((s1 + s2) / 2);
}

// Choose MUI Popover origins so the strength popover projects outward from
// the polygon — always toward the empty side of the vertex rather than over
// the rest of the shape. The centroid→vertex vector is the most reliable
// signal for "which way is outside" because it works for both convex and
// concave polygons (a concave vertex's chord-midpoint can sit on the wrong
// side of the boundary, but the centroid is always inside the bulk).
type PopoverOrigin = {
  vertical: "top" | "bottom";
  horizontal: "left" | "right";
};
function popoverOriginsFor(
  poly: Point[],
  i: number
): { anchorOrigin: PopoverOrigin; transformOrigin: PopoverOrigin } {
  const here = poly[i];
  const c = polygonCentroid(poly);
  // Default to the bottom-right quadrant when the vertex coincides with the
  // centroid (degenerate). dx >= 0 / dy >= 0 → right / bottom — i.e. popover
  // extends down-right from the anchor, matching the prior fixed behavior.
  const horizontal: "left" | "right" = here.x - c.x >= 0 ? "right" : "left";
  const vertical: "top" | "bottom" = here.y - c.y >= 0 ? "bottom" : "top";
  return {
    anchorOrigin: { vertical, horizontal },
    transformOrigin: {
      vertical: vertical === "bottom" ? "top" : "bottom",
      horizontal: horizontal === "right" ? "left" : "right",
    },
  };
}

// ---------------------------------------------------------------------------
// Catmull-Rom spline tessellation (1:1 port of bar-game/common/lib_spline.lua)
// ---------------------------------------------------------------------------

const TESSELLATION_SEGMENTS = 12;

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// Centripetal knot spacing: |delta|^0.5 (alpha = 0.5).
function knotDelta(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.pow(dx * dx + dy * dy, 0.25);
}

// Barry-Goldman lerp of a->b over knot span [ta, tb], evaluated at tt.
function bgLerp(
  tt: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  ta: number,
  tb: number
): { x: number; y: number } {
  const w = (tb - tt) / (tb - ta);
  return { x: w * a.x + (1 - w) * b.x, y: w * a.y + (1 - w) * b.y };
}

// Sample a centripetal Catmull-Rom curve segment between p1 and p2 (neighbours
// p0, p3), blended toward the straight chord by `tension` in [0, 1]. Centripetal
// (alpha = 0.5) avoids the curly-q overshoot/self-intersections at sharp corners.
function sampleSegment(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
  tension: number
): Point {
  const lx = p1.x + (p2.x - p1.x) * t;
  const ly = p1.y + (p2.y - p1.y) * t;
  if (tension <= 0) return { x: lx, y: ly };

  const t0 = 0;
  const t1 = t0 + knotDelta(p0, p1);
  const t2 = t1 + knotDelta(p1, p2);
  const t3 = t2 + knotDelta(p2, p3);

  let crX: number;
  let crY: number;
  if (t2 - t1 <= 1e-9) {
    crX = p1.x;
    crY = p1.y;
  } else {
    const tt = t1 + (t2 - t1) * t;
    const A1 =
      t1 - t0 > 1e-9 ? bgLerp(tt, p0, p1, t0, t1) : { x: p1.x, y: p1.y };
    const A2 = bgLerp(tt, p1, p2, t1, t2);
    const A3 =
      t3 - t2 > 1e-9 ? bgLerp(tt, p2, p3, t2, t3) : { x: p2.x, y: p2.y };
    const B1 = bgLerp(tt, A1, A2, t0, t2);
    const B2 = bgLerp(tt, A2, A3, t1, t3);
    const C = bgLerp(tt, B1, B2, t1, t2);
    crX = C.x;
    crY = C.y;
  }

  if (tension >= 1) return { x: crX, y: crY };
  return {
    x: lx + (crX - lx) * tension,
    y: ly + (crY - ly) * tension,
  };
}

// Tessellate a closed ring of anchor points into a dense polygon. Anchors
// without explicit strength are treated as sharp corners (strength 0); plain
// polygons emerge with vertex-identical output.
function tessellateRing(
  anchors: Point[],
  segments = TESSELLATION_SEGMENTS
): Point[] {
  const n = anchors.length;
  if (n < 2) return anchors.map((p) => ({ x: p.x, y: p.y }));
  const seg = Math.max(1, segments);

  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const iPrev = (i - 1 + n) % n;
    const iNext = (i + 1) % n;
    const iNext2 = (iNext + 1) % n;
    const p0 = anchors[iPrev];
    const p1 = anchors[i];
    const p2 = anchors[iNext];
    const p3 = anchors[iNext2];

    const s1 = clamp01(p1.strength ?? 0);
    const s2 = clamp01(p2.strength ?? 0);
    const edgeTension = clamp01((s1 + s2) * 0.5);

    out.push({ x: p1.x, y: p1.y });
    if (edgeTension > 0 && n >= 3) {
      for (let k = 1; k < seg; k++) {
        out.push(sampleSegment(p0, p1, p2, p3, k / seg, edgeTension));
      }
    }
  }
  return out;
}

// SVG path for the (potentially curved) polygon outline. Plain polygons emit
// a tessellation of length N (the anchors themselves) and look identical to
// the previous straight-edged rendering.
function tessellatedPathString(poly: Point[]): string {
  const tess = tessellateRing(poly);
  if (tess.length === 0) return "";
  const parts: string[] = [`M ${tess[0].x} ${tess[0].y}`];
  for (let i = 1; i < tess.length; i++) {
    parts.push(`L ${tess[i].x} ${tess[i].y}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

// Color and radius for an anchor handle based on strength: a sharp corner
// (0) is a small, dim red dot; max smoothness (1) is a brighter, larger dot.
function strengthVisuals(strength: number): { fill: string; r: number } {
  const s = clamp01(strength);
  // Hue ramps from red (0°) toward orange/yellow (~50°) as strength rises.
  const hue = 0 + 50 * s;
  const sat = 80;
  const lit = 45 + 10 * s;
  return { fill: `hsl(${hue}, ${sat}%, ${lit}%)`, r: 2.2 + 1.0 * s };
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
    // Preserve existing strength if not explicitly provided in `point`
    if (
      point.strength === undefined &&
      this.poly[index].strength !== undefined
    ) {
      clamped.strength = this.poly[index].strength;
    }
    newPoly[index] = clamped;
    return new StartboxState(newPoly);
  }

  setVertexStrength(index: number, rawStrength: number): StartboxState {
    const snapped = snapStrength(rawStrength);
    const current = this.poly[index].strength ?? 0;
    if (current === snapped) return this;
    const newPoly = [...this.poly];
    const updated: Point = { x: this.poly[index].x, y: this.poly[index].y };
    if (snapped > 0) updated.strength = snapped;
    newPoly[index] = updated;
    return new StartboxState(newPoly);
  }

  setUniformStrength(rawStrength: number): StartboxState {
    const snapped = snapStrength(rawStrength);
    const same = this.poly.every((p) => (p.strength ?? 0) === snapped);
    if (same) return this;
    const newPoly = this.poly.map((p) => {
      const out: Point = { x: p.x, y: p.y };
      if (snapped > 0) out.strength = snapped;
      return out;
    });
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
    const moved = this.poly.map((p) => {
      const moved = clampPoint({ x: p.x + dx, y: p.y + dy });
      if (p.strength !== undefined) moved.strength = p.strength;
      return moved;
    });
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
// Preserves 2-point rectangle format when possible (no strengths).
function savePoly(poly: Point[]): Startbox {
  return { poly: tryPolygonToRect(poly) };
}

interface SelectedVertex {
  startboxIndex: number;
  vertexIndex: number;
  anchorEl: SVGCircleElement;
}

// Pixel distance below which a mousedown/mouseup pair is treated as a click
// (open the strength popover) rather than the start of a drag.
const CLICK_DRAG_THRESHOLD = 3;

export default function MapStartbox(props: MapStartboxProps) {
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const initStartboxes = props.startboxes || [];
  const [startboxes, setStartboxes] = useState<StartboxesState>(
    new StartboxesState(
      initStartboxes.map((box) => new StartboxState(loadPoly(box)))
    )
  );
  const selectedElement = useRef<
    | { type: "vertex"; startboxIndex: number; vertexIndex: number }
    | { type: "move"; startboxIndex: number; origin: Point }
    | null
  >(null);

  const [deleteStartbox, setDeleteStartbox] = useState<boolean>(false);
  const [deleteVertex, setDeleteVertex] = useState<boolean>(false);
  const [selectedVertex, setSelectedVertex] = useState<SelectedVertex | null>(
    null
  );

  // While a vertex is mouse-down'd we track the press as either a pending
  // click or a confirmed drag. If the cursor moves more than CLICK_DRAG_THRESHOLD
  // pixels before mouseup, the press becomes a drag and the popover stays
  // closed; otherwise mouseup opens the strength popover anchored at the
  // vertex's <circle>.
  const pendingClick = useRef<{
    startboxIndex: number;
    vertexIndex: number;
    anchorEl: SVGCircleElement;
    clientX: number;
    clientY: number;
  } | null>(null);

  // Clear selection if it points at a vertex that no longer exists
  useEffect(() => {
    if (selectedVertex === null) return;
    const sb = startboxes.boxes[selectedVertex.startboxIndex];
    if (!sb || selectedVertex.vertexIndex >= sb.poly.length) {
      setSelectedVertex(null);
    }
  }, [startboxes, selectedVertex]);

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

  function mouseMove(event: React.MouseEvent<SVGSVGElement, MouseEvent>) {
    // If the user moves the cursor beyond the click threshold while a vertex
    // mouse-down is still pending, promote it to a drag and cancel the
    // pending popover-open.
    if (pendingClick.current !== null) {
      const dx = event.clientX - pendingClick.current.clientX;
      const dy = event.clientY - pendingClick.current.clientY;
      if (dx * dx + dy * dy >= CLICK_DRAG_THRESHOLD * CLICK_DRAG_THRESHOLD) {
        pendingClick.current = null;
      }
    }

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

  function endInteraction() {
    if (pendingClick.current !== null) {
      // The press never moved — treat it as a click, open the popover.
      const pc = pendingClick.current;
      setSelectedVertex({
        startboxIndex: pc.startboxIndex,
        vertexIndex: pc.vertexIndex,
        anchorEl: pc.anchorEl,
      });
      pendingClick.current = null;
    }
    selectedElement.current = null;
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
          onMouseLeave={endInteraction}
          onMouseUp={endInteraction}
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
            const pathStr = tessellatedPathString(poly);
            const center = polygonCentroid(poly);
            return (
              <g key={startboxIndex}>
                <path
                  d={pathStr}
                  fill="rgba(255, 0, 0, 0.15)"
                  stroke="red"
                  strokeWidth="0.5"
                  style={{
                    cursor: deleteStartbox
                      ? "pointer"
                      : props.editable
                      ? "grab"
                      : "auto",
                  }}
                  onClick={() => maybeDeleteStartbox(startboxIndex)}
                  onMouseDown={(e) => {
                    if (deleteStartbox || deleteVertex || !props.editable)
                      return;
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
                    {/* Vertex drag handles, sized/coloured by strength */}
                    {poly.map((point, vertexIndex) => {
                      const s = point.strength ?? 0;
                      const vis = deleteVertex
                        ? { fill: "#ff6666", r: 2.5 }
                        : strengthVisuals(s);
                      const isSelected =
                        selectedVertex !== null &&
                        selectedVertex.startboxIndex === startboxIndex &&
                        selectedVertex.vertexIndex === vertexIndex;
                      return (
                        <g key={`v${vertexIndex}`}>
                          {isSelected && (
                            <circle
                              cx={point.x}
                              cy={point.y}
                              fill="none"
                              stroke="white"
                              strokeWidth="0.6"
                              r={vis.r + 1.5}
                              pointerEvents="none"
                            />
                          )}
                          <circle
                            cx={point.x}
                            cy={point.y}
                            fill={vis.fill}
                            r={vis.r}
                            style={{
                              cursor: deleteVertex ? "pointer" : "move",
                            }}
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
                              pendingClick.current = {
                                startboxIndex,
                                vertexIndex,
                                anchorEl: e.currentTarget,
                                clientX: e.clientX,
                                clientY: e.clientY,
                              };
                              selectedElement.current = {
                                type: "vertex",
                                startboxIndex,
                                vertexIndex,
                              };
                            }}
                          >
                            <title>
                              {`vertex ${
                                vertexIndex + 1
                              } — strength ${formatStrength(s)}`}
                            </title>
                          </circle>
                        </g>
                      );
                    })}
                    {/* Edge insert handles, riding the rendered curve. */}
                    {poly.map((_, i) => {
                      const mid = curveMidpoint(poly, i);
                      const newStrength = insertionStrength(poly, i);
                      const newPoint: Point = {
                        x: mid.x,
                        y: mid.y,
                      };
                      if (newStrength > 0) newPoint.strength = newStrength;
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
                                sb.insertVertex(i, newPoint)
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
    const selectedSb =
      selectedVertex !== null
        ? startboxes.boxes[selectedVertex.startboxIndex]
        : null;
    const selectedStrength =
      selectedSb !== null
        ? selectedSb.poly[selectedVertex!.vertexIndex].strength ?? 0
        : 0;
    const popoverOrigins =
      selectedSb !== null
        ? popoverOriginsFor(selectedSb.poly, selectedVertex!.vertexIndex)
        : null;

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
          <Tooltip title="Remove vertex (click a vertex to remove it)">
            <span>
              <IconButton
                size="small"
                color={deleteVertex ? "error" : "default"}
                onClick={() => {
                  setDeleteVertex(!deleteVertex);
                  setDeleteStartbox(false);
                }}
              >
                <RemoveCircleOutlineIcon />
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
        <div
          style={{
            flexGrow: 1,
            position: "relative",
            minHeight: props.expandedLayout ? "450px" : "300px",
          }}
        >
          {mapView}
        </div>

        {/* Strength popover, anchored at the clicked vertex's <circle>.
            Slider snaps to step 0.05 with explicit snap-to-0 below 0.025
            and snap-to-1 above 0.975 so map makers can't accidentally store
            strength=0.03 by nudging the slider. */}
        <Popover
          open={selectedVertex !== null && selectedSb !== null}
          anchorEl={selectedVertex?.anchorEl ?? null}
          onClose={() => setSelectedVertex(null)}
          anchorOrigin={
            popoverOrigins?.anchorOrigin ?? {
              vertical: "bottom",
              horizontal: "right",
            }
          }
          transformOrigin={
            popoverOrigins?.transformOrigin ?? {
              vertical: "top",
              horizontal: "left",
            }
          }
          disableRestoreFocus
          slotProps={{ paper: { sx: { p: 1.5, minWidth: 240 } } }}
        >
          {selectedVertex !== null && selectedSb !== null && (
            <>
              <Stack direction="column" spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  {`Box ${selectedVertex.startboxIndex + 1} · vertex ${
                    selectedVertex.vertexIndex + 1
                  }`}
                </Typography>
                <Typography variant="body2">
                  {`Strength: ${formatStrength(selectedStrength)}`}
                </Typography>
                <Slider
                  value={selectedStrength}
                  min={0}
                  max={1}
                  step={STRENGTH_STEP}
                  marks={[
                    { value: 0, label: "0" },
                    { value: 0.5, label: "0.5" },
                    { value: 1, label: "1" },
                  ]}
                  onChange={(_, raw) => {
                    const v = Array.isArray(raw) ? raw[0] : raw;
                    setStartboxes(
                      startboxes.update(selectedVertex.startboxIndex, (sb) =>
                        sb.setVertexStrength(
                          selectedVertex.vertexIndex,
                          v as number
                        )
                      )
                    );
                  }}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(v) => formatStrength(snapStrength(v))}
                  // Pull the absolutely-positioned mark labels (0, 0.5, 1)
                  // closer to the track so they fit inside the popover's
                  // content flow. Default is 30px; 23px tucks them right
                  // beneath the track without overlapping the thumb area.
                  sx={{ "& .MuiSlider-markLabel": { top: "23px" } }}
                />
              </Stack>
              {/* Button is a sibling of (not a child of) the Stack so the
                  Stack's auto-injected margin-top rule (which has higher
                  CSS specificity than the sx prop on a child) doesn't
                  override the spacing we want here. */}
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  setStartboxes(
                    startboxes.update(selectedVertex.startboxIndex, (sb) =>
                      sb.setUniformStrength(selectedStrength)
                    )
                  );
                }}
                sx={{ mt: "24px" }}
              >
                Apply to whole startbox
              </Button>
            </>
          )}
        </Popover>

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
        <div
          style={{
            padding: "20px",
            minWidth: props.expandedLayout ? "500px" : "300px",
            maxWidth: props.expandedLayout ? "700px" : "400px",
          }}
        >
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
