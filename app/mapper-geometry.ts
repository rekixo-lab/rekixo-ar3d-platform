export type MapperPoint = [number, number];

export type HomographyPair = {
  source: MapperPoint;
  target: MapperPoint;
};

export type CadLabel = {
  text: string;
  point: MapperPoint;
};

export type CadCandidate = {
  key: string;
  layer: string;
  points: MapperPoint[];
  center: MapperPoint;
  /** Area after CAD bounds normalization; useful for visual ordering only. */
  area: number;
  /** Native CAD area before normalization. Used only as a relative matching signal. */
  rawArea?: number;
};

export type CadGeometry = {
  version: 1;
  sourceName: string;
  sourceFormat: "dwg" | "dxf";
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  candidates: CadCandidate[];
  labels: CadLabel[];
  diagnostics: {
    entityCount: number;
    closedPolylineCount: number;
    textCount: number;
    lineCount: number;
    lineFaceCount?: number;
  };
};

const EPSILON = 1e-10;

export function polygonArea(points: MapperPoint[]) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return sum / 2;
}

export function polygonCenter(points: MapperPoint[]): MapperPoint {
  if (!points.length) return [0.5, 0.5];
  const signedArea = polygonArea(points);
  if (Math.abs(signedArea) < EPSILON) {
    return [
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    ];
  }
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    x += (current[0] + next[0]) * cross;
    y += (current[1] + next[1]) * cross;
  }
  const divisor = 6 * signedArea;
  return [x / divisor, y / divisor];
}

export function pointInPolygon(point: MapperPoint, polygon: MapperPoint[]) {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const a = polygon[index];
    const b = polygon[previous];
    const crosses =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] <
        ((b[0] - a[0]) * (point[1] - a[1])) / ((b[1] - a[1]) || EPSILON) +
          a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function solveLinearSystem(matrix: number[][], values: number[]) {
  const n = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][column]) < EPSILON) {
      throw new Error("Calibration points ek line par nahi hone chahiye");
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let cursor = column; cursor <= n; cursor += 1) {
      augmented[column][cursor] /= divisor;
    }
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (Math.abs(factor) < EPSILON) continue;
      for (let cursor = column; cursor <= n; cursor += 1) {
        augmented[row][cursor] -= factor * augmented[column][cursor];
      }
    }
  }
  return augmented.map((row) => row[n]);
}

function controlPointSpread(points: MapperPoint[]) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return { width, height, area: width * height };
}

/**
 * Solve a projective 3x3 homography using four or more control-point pairs.
 * Coordinates are normalized (0..1), so the matrix remains resolution independent.
 */
export function solveHomography(pairs: HomographyPair[]) {
  if (pairs.length < 4) throw new Error("Calibration ke liye kam se kam 4 pairs chahiye");
  const sourceSpread = controlPointSpread(pairs.map((pair) => pair.source));
  const targetSpread = controlPointSpread(pairs.map((pair) => pair.target));
  if (
    sourceSpread.width < 0.15 ||
    sourceSpread.height < 0.15 ||
    sourceSpread.area < 0.04 ||
    targetSpread.width < 0.15 ||
    targetSpread.height < 0.15 ||
    targetSpread.area < 0.04
  ) {
    throw new Error("Calibration points ko site ke door-door corners me spread karein");
  }

  // For >4 pairs use normal equations (least squares) so extra anchors improve stability.
  const rows: number[][] = [];
  const values: number[] = [];
  pairs.forEach(({ source: [x, y], target: [u, v] }) => {
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  });

  let matrix: number[][];
  let vector: number[];
  if (rows.length === 8) {
    matrix = rows;
    vector = values;
  } else {
    matrix = Array.from({ length: 8 }, () => Array(8).fill(0));
    vector = Array(8).fill(0);
    for (let row = 0; row < rows.length; row += 1) {
      for (let a = 0; a < 8; a += 1) {
        vector[a] += rows[row][a] * values[row];
        for (let b = 0; b < 8; b += 1) {
          matrix[a][b] += rows[row][a] * rows[row][b];
        }
      }
    }
  }

  const solution = solveLinearSystem(matrix, vector);
  return [
    solution[0], solution[1], solution[2],
    solution[3], solution[4], solution[5],
    solution[6], solution[7], 1,
  ];
}

export function applyHomography(matrix: number[], point: MapperPoint): MapperPoint {
  if (matrix.length !== 9) throw new Error("Invalid calibration matrix");
  const [x, y] = point;
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8];
  if (Math.abs(denominator) < EPSILON) throw new Error("Calibration transform invalid hai");
  return [
    (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
    (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator,
  ];
}

export function calibrationError(matrix: number[], pairs: HomographyPair[]) {
  if (!pairs.length) return 0;
  return (
    pairs.reduce((sum, pair) => {
      const mapped = applyHomography(matrix, pair.source);
      return sum + Math.hypot(mapped[0] - pair.target[0], mapped[1] - pair.target[1]);
    }, 0) / pairs.length
  );
}

function projectToSegment(
  point: MapperPoint,
  start: MapperPoint,
  end: MapperPoint,
  renderedWidth: number,
  renderedHeight: number,
) {
  const px = point[0] * renderedWidth;
  const py = point[1] * renderedHeight;
  const ax = start[0] * renderedWidth;
  const ay = start[1] * renderedHeight;
  const bx = end[0] * renderedWidth;
  const by = end[1] * renderedHeight;
  const vx = bx - ax;
  const vy = by - ay;
  const length = vx * vx + vy * vy;
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / length)) : 0;
  const x = ax + t * vx;
  const y = ay + t * vy;
  return {
    point: [x / renderedWidth, y / renderedHeight] as MapperPoint,
    distance: Math.hypot(px - x, py - y),
  };
}

/** Opt in to shared-boundary snapping within a small CSS screen-pixel radius. */
export function snapPoint(
  point: MapperPoint,
  polygons: MapperPoint[][],
  renderedWidth: number,
  renderedHeight: number,
  { enabled = false, thresholdPx = 6 }: { enabled?: boolean; thresholdPx?: number } = {},
) {
  let best = { point, distance: Infinity, kind: "none" as "none" | "vertex" | "edge" };
  // Nearby plots can have deliberately separate boundaries. Free placement
  // must preserve the exact source coordinates for both taps and handle drags.
  if (!enabled) return best;
  for (const polygon of polygons) {
    for (const vertex of polygon) {
      const distance = Math.hypot(
        (point[0] - vertex[0]) * renderedWidth,
        (point[1] - vertex[1]) * renderedHeight,
      );
      if (distance < best.distance) best = { point: vertex, distance, kind: "vertex" };
    }
  }
  if (best.distance <= thresholdPx) return best;

  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const projected = projectToSegment(
        point,
        polygon[index],
        polygon[(index + 1) % polygon.length],
        renderedWidth,
        renderedHeight,
      );
      if (projected.distance < best.distance) {
        best = { ...projected, kind: "edge" };
      }
    }
  }
  return best.distance <= thresholdPx ? best : { point, distance: best.distance, kind: "none" as const };
}

export function cleanPlotId(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "").slice(0, 80);
}

export function nextPlotId(value: string) {
  const source = cleanPlotId(value);
  const match = source.match(/^(.*?)(\d+)$/);
  if (!match) return source ? `${source}-2` : "1";
  return `${match[1]}${String(Number(match[2]) + 1).padStart(match[2].length, "0")}`;
}

export function bestCadLabel(
  candidate: CadCandidate,
  labels: CadLabel[],
  inventoryIds: Set<string>,
) {
  // Civil CAD drawings often repeat dimension text such as 9, 12 or 15. A
  // repeated number must never be treated as a plot ID automatically. Only a
  // label that maps to an inventory ID and occurs exactly once in the CAD text
  // set is eligible for auto matching; duplicates stay in Review.
  const normalized = labels
    .map((label) => ({ ...label, id: cleanPlotId(label.text) }))
    .filter((label) => inventoryIds.has(label.id));
  const frequency = new Map<string, number>();
  normalized.forEach((label) => frequency.set(label.id, (frequency.get(label.id) || 0) + 1));
  const eligible = normalized
    .filter((label) => frequency.get(label.id) === 1)
    .filter((label) => pointInPolygon(label.point, candidate.points))
    .sort(
      (a, b) =>
        Math.hypot(a.point[0] - candidate.center[0], a.point[1] - candidate.center[1]) -
        Math.hypot(b.point[0] - candidate.center[0], b.point[1] - candidate.center[1]),
    );
  return eligible[0]?.id || "";
}

function median(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

/**
 * Infer the square-unit conversion between native CAD polygon area and the
 * authoritative inventory sqm values. This makes matching work whether a CAD
 * file uses metres, millimetres, feet or another consistent drawing unit.
 */
export function estimateCadAreaScale(
  candidates: Array<{ candidate: CadCandidate; sqm: number }>,
) {
  const ratios = candidates
    .filter(({ candidate, sqm }) => Number(candidate.rawArea) > 0 && Number(sqm) > 0)
    .map(({ candidate, sqm }) => sqm / Number(candidate.rawArea));
  return ratios.length >= 4 ? median(ratios) : 0;
}

export function cadAreaErrorRatio(candidate: CadCandidate, sqm: number, areaScale: number) {
  const rawArea = Number(candidate.rawArea);
  if (!(rawArea > 0) || !(sqm > 0) || !(areaScale > 0)) return null;
  return Math.abs(rawArea * areaScale - sqm) / sqm;
}

export function transformedCandidate(
  candidate: CadCandidate,
  matrix: number[],
): MapperPoint[] {
  return candidate.points.map((point) => applyHomography(matrix, point));
}

export function validNormalizedPolygon(points: MapperPoint[]) {
  return (
    Array.isArray(points) &&
    points.length >= 3 &&
    points.length <= 80 &&
    points.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]) &&
        point[0] >= -0.02 &&
        point[0] <= 1.02 &&
        point[1] >= -0.02 &&
        point[1] <= 1.02,
    )
  );
}
