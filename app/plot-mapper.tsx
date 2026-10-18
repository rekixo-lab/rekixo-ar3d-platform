"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Hand,
  ImagePlus,
  Maximize2,
  MousePointer2,
  Pencil,
  RotateCcw,
  Save,
  Target,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  applyHomography,
  bestCadLabel,
  cadAreaErrorRatio,
  calibrationError,
  cleanPlotId,
  estimateCadAreaScale,
  nextPlotId,
  polygonCenter,
  snapPoint,
  solveHomography,
  transformedCandidate,
  validNormalizedPolygon,
  type CadGeometry,
  type HomographyPair,
  type MapperPoint,
} from "./mapper-geometry";
import ProjectPricingSource from "./project-pricing-source";
import { syncManualDimensionLabel } from "./manual-measurement-labels";
import ProjectStartView from "./project-start-view";
import {
  edgeIndexForDisplayDirection,
  type EdgeDirection,
} from "./plot-edge-semantics";
import {
  normalizeSqmToSqftFactor,
  sqftToSqm,
  sqmToSqyd,
} from "./area-policy";
import {
  frontFirstFourSideEdges,
  resolveFourSideEdges,
} from "./plot-side-resolver";
import {
  forwardCornerEdgeChain,
  parsePlotSideSemantics,
  serializePlotSideSemantics,
  setPlotSideEdge,
  type PlotFacingCardinalDirection,
  type PlotSideLayout,
  type PlotSideRole,
} from "./plot-side-semantics";
import {
  cardinalDirectionDistance,
  displayNorthAngleFromSource,
  normalizeMasterplanNorthAngle,
  plotFacingResults,
  plotFacingResultsForNorthAngle,
  plotNorthDirectionToAngle,
  plotSideDirectionResults,
  plotSideDirectionResultsForNorthAngle,
  sourceNorthAngleFromDisplay,
} from "./plot-facing";

function FourCornerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="5" cy="5" r="1.5" fill="currentColor" />
      <circle cx="19" cy="5" r="1.5" fill="currentColor" />
      <circle cx="19" cy="19" r="1.5" fill="currentColor" />
      <circle cx="5" cy="19" r="1.5" fill="currentColor" />
    </svg>
  );
}

function IrregularCornerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 7.5 10 4l8.5 3 1 7-5.5 5.5-8-1.5-2-6.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="4.5" cy="7.5" r="1.35" fill="currentColor" />
      <circle cx="10" cy="4" r="1.35" fill="currentColor" />
      <circle cx="18.5" cy="7" r="1.35" fill="currentColor" />
      <circle cx="19.5" cy="14" r="1.35" fill="currentColor" />
      <circle cx="14" cy="19.5" r="1.35" fill="currentColor" />
      <circle cx="6" cy="18" r="1.35" fill="currentColor" />
      <circle cx="4" cy="11.5" r="1.35" fill="currentColor" />
    </svg>
  );
}


type Plot = {
  id: string;
  sqft: number;
  sqm: number;
  sqyd: number;
  dimensions: string;
  road: string;
  front?: number | null;
  depth?: number | null;
  back?: number | null;
  depth2?: number | null;
  dimensionUnit?: "ft" | "m" | null;
  frontEdgeIndex?: number | null;
  depthEdgeIndex?: number | null;
  backEdgeIndex?: number | null;
  depth2EdgeIndex?: number | null;
  frontLabel?: string | null;
  depthLabel?: string | null;
  backLabel?: string | null;
  depth2Label?: string | null;
  sideDimensions?: string | null;
  edgeSemantics?: string | null;
  status: string;
  notes?: string;
  featured?: boolean;
  polygon?: string;
};

type MapperSettings = {
  masterplanName?: string;
  sourcePdfName?: string;
  sourceCadName?: string;
  plotSheetName?: string;
  roadAccessSheetName?: string;
  roadAccessSheetCount?: string;
  sideMappingSheetName?: string;
  sideMappingSheetCount?: string;
  measurementSheetName?: string;
  measurementSheetCount?: string;
  measurementSheetFullSidesCount?: string;
  measurementSheetVerifiedCount?: string;
  measurementSheetReviewCount?: string;
  sqmToSqftFactor?: string;
  mapWidth?: string;
  mapHeight?: string;
  masterplanOriginalWidth?: string;
  masterplanOriginalHeight?: string;
  masterplanOriginalName?: string;
  masterplanVersion?: string;
  masterplanOriginalObjectToken?: string;
  cadCandidateCount?: string;
  cadParseError?: string;
  homography?: string;
  calibrationPairs?: string;
  calibrationError?: string;
  cadMatchedCount?: string;
  cadReviewCount?: string;
  publicRotation?: string;
  masterplanNorthAngle?: string;
  logoName?: string;
  logoVersion?: string;
  address?: string;
  plotFrontDirections?: string;
  plotFacingEnabled?: string;
  plotNorthDirection?: "top" | "right" | "bottom" | "left" | string;
};

type AutoMatch = {
  plot: Plot;
  candidateKey: string;
  points: MapperPoint[];
  candidate: CadGeometry["candidates"][number];
  areaErrorRatio: number | null;
};

type PlotSheetQualitySummary = {
  total: number;
  fullDetailCount: number;
  missingDimensions: string[];
  missingRoad: string[];
  missingSideMeasurements: string[];
  partialSideMeasurements: string[];
  genericAreaOnlyDimensions: string[];
  missingFrontDirection: string[];
  richDetailReady: boolean;
};

type PlotInventorySummary = {
  existingActiveCount: number;
  incomingCount: number;
  retainedCount: number;
  addedIds: string[];
  restoredIds: string[];
  missingIds: string[];
  missingMappedIds: string[];
  missingNonAvailableIds: string[];
  missingPricedIds: string[];
  confirmationRequired: boolean;
  confirmationToken: string;
};

type CurrentPlotQuality = {
  total: number;
  dimensionsComplete: number;
  roadComplete: number;
  fourSidesComplete: number;
  mappedSemanticsComplete: number;
  frontDirectionsComplete: number;
  genericAreaOnly: number;
  richDetailReady: boolean;
};

type GesturePoint = { x: number; y: number };

type PanGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
};

type PinchGesture = {
  startDistance: number;
  startZoom: number;
  lastCenterX: number;
  lastCenterY: number;
};

type ZoomAnchor = {
  clientX: number;
  clientY: number;
  visualX: number;
  visualY: number;
};

type PendingPinchFrame = {
  zoom: number;
  centerX: number;
  centerY: number;
  panX: number;
  panY: number;
};

type PendingHandleFrame = {
  index: number;
  clientX: number;
  clientY: number;
  element: HTMLButtonElement;
};

const COMPLETED_PROJECT_ID = "tiyansh-prime-square";
const MAX_MAPPER_ZOOM = 18;
const MAPPER_LABEL_SCREEN_FONT_PX = 14;
const MAPPER_LABEL_SCREEN_STROKE_PX = 2.4;
const MAX_MAPPING_DIMENSION = 4096;
const MAX_MAPPING_PIXELS = 10_000_000;
const TARGET_MAPPING_BYTES = 8 * 1024 * 1024;
const MAX_PUBLIC_DIMENSION = 2048;
const MAX_PUBLIC_PIXELS = 3_000_000;
const TARGET_PUBLIC_BYTES = 2 * 1024 * 1024;
const MAX_ORIGINAL_MASTERPLAN_BYTES = 100 * 1024 * 1024;
// Large source files are uploaded to R2 in multipart chunks. The mapper itself
// never needs the 30–100 MB original after derivatives have been prepared.
const MASTERPLAN_ORIGINAL_CHUNK_BYTES = 8 * 1024 * 1024;
// On constrained/mobile devices keep the working decode materially smaller.
// Persistent polygons are normalized 0..1 so this never changes saved geometry.
const MOBILE_MAPPING_DIMENSION = 3072;
const MOBILE_MAPPING_PIXELS = 6_000_000;
const MOBILE_PUBLIC_DIMENSION = 1600;
const MOBILE_PUBLIC_PIXELS = 2_000_000;
const MASTERPLAN_FINALIZE_TIMEOUT_MS = 180_000;

function resolvedPlotSideLayout(plot: Plot, polygon = parsePolygon(plot)): PlotSideLayout {
  const parsed = parsePlotSideSemantics(
    plot.edgeSemantics,
    polygon.length >= 3 ? polygon.length : undefined,
  );
  if (parsed?.layout === "three" || parsed?.layout === "four") return parsed.layout;
  return polygon.length === 3 ? "three" : "four";
}

function plotHasRequiredSideMeasurements(plot: Plot) {
  const polygon = parsePolygon(plot);
  const layout = resolvedPlotSideLayout(plot, polygon);
  const roles = [
    plot.front != null || Boolean(String(plot.frontLabel || "").trim()),
    plot.back != null || Boolean(String(plot.backLabel || "").trim()),
    plot.depth != null || Boolean(String(plot.depthLabel || "").trim()),
    ...(layout === "four"
      ? [plot.depth2 != null || Boolean(String(plot.depth2Label || "").trim())]
      : []),
  ];
  if (roles.every(Boolean)) return true;

  const sides = String(plot.sideDimensions || "").toLowerCase();
  if (!sides.includes("front") || !sides.includes("back") || !sides.includes("depth"))
    return false;
  const measurements =
    sides.match(/\d+(?:\.\d+)?\s*(?:m\b|ft\b|'|feet\b|meter\b|metre\b)/gi) || [];
  return measurements.length >= (layout === "three" ? 3 : 4);
}

function plotHasRequiredSideSemantics(plot: Plot) {
  const polygon = parsePolygon(plot);
  if (polygon.length < 3) return false;
  const parsed = parsePlotSideSemantics(plot.edgeSemantics, polygon.length);
  const layout =
    parsed?.layout === "three" || parsed?.layout === "four"
      ? parsed.layout
      : polygon.length === 3
        ? "three"
        : "four";
  if (
    parsed?.roles.front?.length &&
    parsed.roles.back?.length &&
    parsed.roles.depthA?.length &&
    (layout === "three" || parsed.roles.depthB?.length)
  ) {
    return true;
  }
  const indexes = [
    plot.frontEdgeIndex,
    plot.backEdgeIndex,
    plot.depthEdgeIndex,
    ...(layout === "four" ? [plot.depth2EdgeIndex] : []),
  ].map((value) =>
    value == null || String(value).trim() === "" ? null : Number(value),
  );
  return (
    indexes.every(
      (value) =>
        value != null &&
        Number.isInteger(value) &&
        value >= 0 &&
        value < polygon.length,
    ) && new Set(indexes).size === indexes.length
  );
}

type PlotSideRoleEdges = Record<PlotSideRole, number[]>;

function emptyPlotSideRoleEdges(): PlotSideRoleEdges {
  return { front: [], back: [], depthA: [], depthB: [] };
}

function savedPlotSemanticRoles(
  plot: Plot | null | undefined,
  polygon: MapperPoint[],
): PlotSideRoleEdges {
  const output = emptyPlotSideRoleEdges();
  if (!plot || polygon.length < 3) return output;
  const parsed = parsePlotSideSemantics(plot.edgeSemantics, polygon.length);
  const layout = resolvedPlotSideLayout(plot, polygon);
  const fallback: Record<PlotSideRole, number | null | undefined> = {
    front: plot.frontEdgeIndex,
    back: plot.backEdgeIndex,
    depthA: plot.depthEdgeIndex,
    depthB: plot.depth2EdgeIndex,
  };
  (["front", "back", "depthA", "depthB"] as PlotSideRole[]).forEach((role) => {
    if (layout === "three" && role === "depthB") return;
    const canonical = parsed?.roles[role] || [];
    if (canonical.length) {
      output[role] = [...canonical];
      return;
    }
    const legacy = fallback[role];
    if (
      legacy != null &&
      Number.isInteger(Number(legacy)) &&
      Number(legacy) >= 0 &&
      Number(legacy) < polygon.length
    ) {
      output[role] = [Number(legacy)];
    }
  });
  return output;
}

function savedPlotRoleMeasurementText(
  plot: Plot | null | undefined,
  role: PlotSideRole,
  layout: PlotSideLayout,
) {
  if (!plot || (layout === "three" && role === "depthB")) return "";
  const value =
    role === "front" ? plot.front :
    role === "back" ? plot.back :
    role === "depthA" ? plot.depth : plot.depth2;
  const label =
    role === "front" ? plot.frontLabel :
    role === "back" ? plot.backLabel :
    role === "depthA" ? plot.depthLabel : plot.depth2Label;
  const roleName =
    role === "front" ? "Front" :
    role === "back" ? "Back" :
    role === "depthA" ? (layout === "three" ? "Depth" : "Depth A") :
    "Depth B";
  const precise = String(label || "").trim();
  if (precise) return `${roleName} · ${precise}`;
  if (value == null || !Number.isFinite(Number(value))) return "";
  return `${roleName} · ${value} ${plot.dimensionUnit === "m" ? "m" : "ft"}`;
}

function semanticRoleMidpoint(points: MapperPoint[], edges: number[]) {
  if (!points.length || !edges.length) return null;
  const segments = edges
    .filter((edge) => Number.isInteger(edge) && edge >= 0 && edge < points.length)
    .map((edge) => {
      const a = points[edge];
      const b = points[(edge + 1) % points.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return { a, b, length };
    })
    .filter((segment) => segment.length > 0);
  if (!segments.length) return null;

  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  let target = total / 2;
  for (const segment of segments) {
    if (target <= segment.length) {
      const ratio = segment.length ? target / segment.length : 0.5;
      return [
        segment.a[0] + (segment.b[0] - segment.a[0]) * ratio,
        segment.a[1] + (segment.b[1] - segment.a[1]) * ratio,
      ] as MapperPoint;
    }
    target -= segment.length;
  }
  const last = segments[segments.length - 1];
  return [
    (last.a[0] + last.b[0]) / 2,
    (last.a[1] + last.b[1]) / 2,
  ] as MapperPoint;
}

function semanticRoleMeasureGuide(
  points: MapperPoint[],
  edges: number[],
  zoomLevel = 1,
) {
  if (points.length < 3 || !edges.length) return null;
  const valid = edges
    .filter((edge) => Number.isInteger(edge) && edge >= 0 && edge < points.length)
    .map((edge) => {
      const a = points[edge];
      const b = points[(edge + 1) % points.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return { a, b, length };
    })
    .filter((segment) => segment.length > 0);
  if (!valid.length) return null;

  const total = valid.reduce((sum, segment) => sum + segment.length, 0);
  let remaining = total / 2;
  let middle = valid[valid.length - 1];
  let ratio = 0.5;
  for (const segment of valid) {
    if (remaining <= segment.length) {
      middle = segment;
      ratio = segment.length ? remaining / segment.length : 0.5;
      break;
    }
    remaining -= segment.length;
  }

  const midpoint: MapperPoint = [
    middle.a[0] + (middle.b[0] - middle.a[0]) * ratio,
    middle.a[1] + (middle.b[1] - middle.a[1]) * ratio,
  ];
  const tangentLength = Math.max(
    1e-9,
    Math.hypot(middle.b[0] - middle.a[0], middle.b[1] - middle.a[1]),
  );
  const tangent: MapperPoint = [
    (middle.b[0] - middle.a[0]) / tangentLength,
    (middle.b[1] - middle.a[1]) / tangentLength,
  ];

  const center = polygonCenter(points);
  const centerVector: MapperPoint = [center[0] - midpoint[0], center[1] - midpoint[1]];
  const centerDistance = Math.max(1e-9, Math.hypot(centerVector[0], centerVector[1]));
  const inward: MapperPoint = [
    centerVector[0] / centerDistance,
    centerVector[1] / centerDistance,
  ];

  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const diagonal = Math.max(
    0.02,
    Math.hypot(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    ),
  );
  // Keep measurement guides visibly separated from the polygon boundary.
  // Values are normalized to plot size, so the spacing stays useful at 100%
  // and at the 1800% precision zoom without mutating stored geometry.
  const inwardOffset = Math.min(0.052, Math.max(0.012, diagonal * 0.09));
  const halfGuide = Math.min(
    diagonal * 0.28,
    Math.max(diagonal * 0.105, Math.min(total * 0.24, diagonal * 0.23)),
  );
  const anchor: MapperPoint = [
    midpoint[0] + inward[0] * inwardOffset,
    midpoint[1] + inward[1] * inwardOffset,
  ];
  // Keep the text just above its own guide line. The gap is counter-scaled
  // with mapper zoom, exactly like the text size, so 1800% precision mode does
  // not visually throw Front/Back/Depth labels far away from their lines.
  const labelGap = 0.013 / Math.max(1, zoomLevel);
  const label: MapperPoint = [
    anchor[0] + inward[0] * labelGap,
    anchor[1] + inward[1] * labelGap,
  ];
  const clamp = (value: number) => Math.max(0.002, Math.min(0.998, value));

  return {
    start: [
      clamp(anchor[0] - tangent[0] * halfGuide),
      clamp(anchor[1] - tangent[1] * halfGuide),
    ] as MapperPoint,
    end: [
      clamp(anchor[0] + tangent[0] * halfGuide),
      clamp(anchor[1] + tangent[1] * halfGuide),
    ] as MapperPoint,
    label: [clamp(label[0]), clamp(label[1])] as MapperPoint,
  };
}

function savedPlotFrontDirections(value: unknown) {
  const output: Record<string, EdgeDirection> = {};
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return output;
    for (const [id, direction] of Object.entries(parsed)) {
      if (["top", "right", "bottom", "left"].includes(String(direction))) {
        output[cleanPlotId(id)] = String(direction) as EdgeDirection;
      }
    }
  } catch {
    // Corrupt optional metadata must never break the mapper.
  }
  return output;
}

function currentPlotQuality(
  plots: Plot[],
  frontDirections: Record<string, EdgeDirection>,
): CurrentPlotQuality {
  const total = plots.length;
  let dimensionsComplete = 0;
  let roadComplete = 0;
  let fourSidesComplete = 0;
  let mappedSemanticsComplete = 0;
  let frontDirectionsComplete = 0;
  let genericAreaOnly = 0;

  for (const plot of plots) {
    const dimensions = String(plot.dimensions || "").trim();
    if (dimensions) dimensionsComplete += 1;
    if (String(plot.road || "").trim()) roadComplete += 1;
    const sidesComplete = plotHasRequiredSideMeasurements(plot);
    if (sidesComplete) fourSidesComplete += 1;
    const semanticsComplete = plotHasRequiredSideSemantics(plot);
    if (semanticsComplete) mappedSemanticsComplete += 1;
    if (frontDirections[plot.id] || semanticsComplete) frontDirectionsComplete += 1;
    if (
      /approved\s+(?:plan\s+)?area|sanctioned\s+irregular\s+plot/i.test(dimensions) &&
      !sidesComplete
    ) {
      genericAreaOnly += 1;
    }
  }

  return {
    total,
    dimensionsComplete,
    roadComplete,
    fourSidesComplete,
    mappedSemanticsComplete,
    frontDirectionsComplete,
    genericAreaOnly,
    richDetailReady:
      total > 0 &&
      dimensionsComplete === total &&
      roadComplete === total &&
      fourSidesComplete === total &&
      frontDirectionsComplete === total &&
      genericAreaOnly === 0,
  };
}

async function apiResult(response: Response) {
  const raw = await response.text();
  let result: Record<string, unknown> = {};
  try {
    result = raw ? JSON.parse(raw) : {};
  } catch {
    // Cloudflare can return plain text errors.
  }
  if (!response.ok) {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : raw.trim() || `Request failed (${response.status})`,
    );
  }
  return result;
}

function normalizedImageType(file: File) {
  const extension = file.name.toLowerCase().split(".").pop() || "";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "";
}

function normalizeMasterplanFile(file: File) {
  const canonicalType = normalizedImageType(file);
  const incomingType = String(file.type || "").toLowerCase();
  const alreadyCanonical = ["image/jpeg", "image/png", "image/webp"].includes(incomingType);
  if (alreadyCanonical || !canonicalType) return file;

  // Android file pickers sometimes report JPG as image/jpg, octet-stream or blank.
  // Re-wrap only known image extensions; the browser still has to decode the image
  // successfully before anything is uploaded.
  if (!incomingType || incomingType === "image/jpg" || incomingType === "application/octet-stream") {
    return new File([file], file.name, { type: canonicalType, lastModified: file.lastModified });
  }
  return file;
}

function masterplanProcessingLimits() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      mappingDimension: MAX_MAPPING_DIMENSION,
      mappingPixels: MAX_MAPPING_PIXELS,
      publicDimension: MAX_PUBLIC_DIMENSION,
      publicPixels: MAX_PUBLIC_PIXELS,
    };
  }
  const deviceMemory = Number(
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0,
  );
  const coarsePointer = Boolean(
    window.matchMedia?.("(any-pointer: coarse)")?.matches,
  );
  const constrained = coarsePointer || (deviceMemory > 0 && deviceMemory <= 4);
  return constrained
    ? {
        mappingDimension: MOBILE_MAPPING_DIMENSION,
        mappingPixels: MOBILE_MAPPING_PIXELS,
        publicDimension: MOBILE_PUBLIC_DIMENSION,
        publicPixels: MOBILE_PUBLIC_PIXELS,
      }
    : {
        mappingDimension: MAX_MAPPING_DIMENSION,
        mappingPixels: MAX_MAPPING_PIXELS,
        publicDimension: MAX_PUBLIC_DIMENSION,
        publicPixels: MAX_PUBLIC_PIXELS,
      };
}

async function readMasterplanDimensions(sourceFile: File) {
  const headerBytes = new Uint8Array(
    await sourceFile.slice(0, Math.min(sourceFile.size, 2 * 1024 * 1024)).arrayBuffer(),
  );
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...headerBytes.slice(start, start + length));
  const be32 = (offset: number) =>
    ((headerBytes[offset] << 24) |
      (headerBytes[offset + 1] << 16) |
      (headerBytes[offset + 2] << 8) |
      headerBytes[offset + 3]) >>> 0;
  const le16 = (offset: number) =>
    headerBytes[offset] | (headerBytes[offset + 1] << 8);
  const le24 = (offset: number) =>
    headerBytes[offset] | (headerBytes[offset + 1] << 8) | (headerBytes[offset + 2] << 16);

  // PNG IHDR.
  if (
    headerBytes.length >= 24 &&
    headerBytes[0] === 0x89 &&
    ascii(1, 3) === "PNG"
  ) {
    const width = be32(16);
    const height = be32(20);
    if (width > 0 && height > 0) return { width, height };
  }

  // JPEG SOF marker. Reading just the first 2 MB avoids allocating the whole
  // compressed source and is enough for normal EXIF/ICC-heavy production files.
  if (headerBytes.length >= 4 && headerBytes[0] === 0xff && headerBytes[1] === 0xd8) {
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < headerBytes.length) {
      if (headerBytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < headerBytes.length && headerBytes[offset] === 0xff) offset += 1;
      const marker = headerBytes[offset++];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > headerBytes.length) break;
      const length = (headerBytes[offset] << 8) | headerBytes[offset + 1];
      if (length < 2 || offset + length > headerBytes.length) break;
      if (sof.has(marker) && length >= 7) {
        const height = (headerBytes[offset + 3] << 8) | headerBytes[offset + 4];
        const width = (headerBytes[offset + 5] << 8) | headerBytes[offset + 6];
        if (width > 0 && height > 0) return { width, height };
      }
      offset += length;
    }
  }

  // WebP VP8X / VP8 / VP8L dimensions.
  if (
    headerBytes.length >= 30 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 4) === "WEBP"
  ) {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X" && headerBytes.length >= 30) {
      return { width: 1 + le24(24), height: 1 + le24(27) };
    }
    if (
      chunk === "VP8 " &&
      headerBytes.length >= 30 &&
      headerBytes[23] === 0x9d &&
      headerBytes[24] === 0x01 &&
      headerBytes[25] === 0x2a
    ) {
      return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    }
    if (chunk === "VP8L" && headerBytes.length >= 25 && headerBytes[20] === 0x2f) {
      const b0 = headerBytes[21];
      const b1 = headerBytes[22];
      const b2 = headerBytes[23];
      const b3 = headerBytes[24];
      return {
        width: 1 + b0 + ((b1 & 0x3f) << 8),
        height: 1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
      };
    }
  }

  // Compatibility fallback for unusual valid images whose dimensions could not
  // be read from the header. This is the old behavior, used only when necessary.
  const fallback = await createImageBitmap(sourceFile);
  try {
    return { width: fallback.width, height: fallback.height };
  } finally {
    fallback.close();
  }
}

async function prepareMasterplan(file: File) {
  const sourceFile = normalizeMasterplanFile(file);
  if (sourceFile.size > MAX_ORIGINAL_MASTERPLAN_BYTES) {
    throw new Error("Masterplan 100 MB se chhoti rakhein");
  }

  const sourceSize = await readMasterplanDimensions(sourceFile);
  const originalWidth = sourceSize.width;
  const originalHeight = sourceSize.height;
  if (!(originalWidth > 100 && originalHeight > 100)) {
    throw new Error("Masterplan dimensions invalid hain");
  }

  const limits = masterplanProcessingLimits();
  const mappingScale = Math.min(
    1,
    limits.mappingDimension / Math.max(originalWidth, originalHeight),
    Math.sqrt(limits.mappingPixels / (originalWidth * originalHeight)),
  );
  const width = Math.max(1, Math.round(originalWidth * mappingScale));
  const height = Math.max(1, Math.round(originalHeight * mappingScale));

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(
      sourceFile,
      mappingScale < 0.999
        ? {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: "high",
          }
        : undefined,
    );
  } catch {
    throw new Error(
      "Masterplan image decode nahi hui. JPG/PNG/WebP file ya thoda lower-resolution export try karein.",
    );
  }

  try {
    const renderWebp = async (
      source: CanvasImageSource,
      targetWidth: number,
      targetHeight: number,
      targetBytes: number,
      qualities: number[],
    ) => {
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      try {
        const context = canvas.getContext("2d", { alpha: true });
        if (!context) throw new Error("Masterplan process nahi ho payi");
        context.clearRect(0, 0, targetWidth, targetHeight);
        context.drawImage(source, 0, 0, targetWidth, targetHeight);
        const encode = (quality: number) =>
          new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/webp", quality),
          );
        let blob: Blob | null = null;
        for (const quality of qualities) {
          blob = await encode(quality);
          if (blob && blob.size <= targetBytes) break;
        }
        if (!blob) throw new Error("Masterplan image encode nahi hui");
        return blob;
      } finally {
        canvas.width = 1;
        canvas.height = 1;
      }
    };

    let mappingFile = sourceFile;
    if (mappingScale < 0.999 || sourceFile.size > TARGET_MAPPING_BYTES) {
      const blob = await renderWebp(
        bitmap,
        width,
        height,
        TARGET_MAPPING_BYTES,
        [0.92, 0.86, 0.8, 0.72, 0.64],
      );
      mappingFile = new File(
        [blob],
        (sourceFile.name.replace(/\.[^.]+$/, "") || "masterplan") + ".mapping.webp",
        { type: "image/webp" },
      );
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const publicScaleFromOriginal = Math.min(
      1,
      limits.publicDimension / Math.max(originalWidth, originalHeight),
      Math.sqrt(limits.publicPixels / (originalWidth * originalHeight)),
    );
    const publicWidth = Math.max(1, Math.round(originalWidth * publicScaleFromOriginal));
    const publicHeight = Math.max(1, Math.round(originalHeight * publicScaleFromOriginal));
    let publicFile = mappingFile;
    if (
      publicWidth !== width ||
      publicHeight !== height ||
      mappingFile.size > TARGET_PUBLIC_BYTES
    ) {
      const blob = await renderWebp(
        bitmap,
        publicWidth,
        publicHeight,
        TARGET_PUBLIC_BYTES,
        [0.86, 0.78, 0.7, 0.62, 0.54],
      );
      publicFile = new File(
        [blob],
        (sourceFile.name.replace(/\.[^.]+$/, "") || "masterplan") + ".public.webp",
        { type: "image/webp" },
      );
    }

    return {
      mappingFile,
      publicFile,
      originalFile: sourceFile,
      width,
      height,
      originalWidth,
      originalHeight,
    };
  } finally {
    bitmap.close();
  }
}

async function uploadMasterplanOriginal(
  projectId: string,
  file: File,
  onProgress: (percent: number) => void,
) {
  const contentType = normalizedImageType(file) || file.type || "application/octet-stream";
  const initiate = await apiResult(
    await fetch(
      `/api/super-mapper-masterplan-upload?projectId=${encodeURIComponent(projectId)}&action=initiate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType,
          size: file.size,
        }),
      },
    ),
  );
  const uploadId = String(initiate.uploadId || "");
  const token = String(initiate.token || "");
  if (!uploadId || !token) throw new Error("Large masterplan upload session start nahi hui");

  const completedParts: Array<{ partNumber: number; etag: string }> = [];
  try {
    let partNumber = 1;
    for (let offset = 0; offset < file.size; offset += MASTERPLAN_ORIGINAL_CHUNK_BYTES) {
      const end = Math.min(file.size, offset + MASTERPLAN_ORIGINAL_CHUNK_BYTES);
      const response = await fetch(
        `/api/super-mapper-masterplan-upload?projectId=${encodeURIComponent(projectId)}&action=part&token=${encodeURIComponent(token)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: file.slice(offset, end),
        },
      );
      const result = await apiResult(response);
      const etag = String(result.etag || "");
      if (!etag) throw new Error(`Masterplan chunk ${partNumber} verify nahi hua`);
      completedParts.push({ partNumber, etag });
      onProgress(Math.round((end / file.size) * 100));
      partNumber += 1;
    }

    await apiResult(
      await fetch(
        `/api/super-mapper-masterplan-upload?projectId=${encodeURIComponent(projectId)}&action=complete&token=${encodeURIComponent(token)}&uploadId=${encodeURIComponent(uploadId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parts: completedParts }),
        },
      ),
    );
    return { token };
  } catch (error) {
    try {
      await fetch(
        `/api/super-mapper-masterplan-upload?projectId=${encodeURIComponent(projectId)}&action=abort&token=${encodeURIComponent(token)}&uploadId=${encodeURIComponent(uploadId)}`,
        { method: "POST" },
      );
    } catch {
      // Best-effort cleanup only; the original error remains authoritative.
    }
    throw error;
  }
}

async function prepareProjectLogo(file: File) {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    throw new Error("Logo JPG, PNG ya WebP me upload karein");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Logo 8 MB se chhota rakhein");
  }

  const bitmap = await createImageBitmap(file);
  const maxSide = 512;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    bitmap.close();
    throw new Error("Logo process nahi ho paya");
  }
  context.clearRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const encode = (quality: number) =>
    new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );

  let blob: Blob | null = null;
  for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54]) {
    blob = await encode(quality);
    if (blob && blob.size <= 180 * 1024) break;
  }
  if (!blob) throw new Error("Logo encode nahi hua");
  if (blob.size > 512 * 1024) {
    throw new Error("Logo optimize karne ke baad bhi bahut bada hai");
  }

  const cleanName =
    file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9._-]+/gi, "-") ||
    "project-logo";
  return new File([blob], `${cleanName}.webp`, { type: "image/webp" });
}

function plotSort(a: Plot, b: Plot) {
  return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" });
}

function parsePolygon(plot: Plot) {
  try {
    const points = JSON.parse(plot.polygon || "[]") as MapperPoint[];
    return Array.isArray(points) && points.length >= 3 ? points : [];
  } catch {
    return [];
  }
}

function settingsNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeQuarterTurn(value: unknown): 0 | 1 | 2 | 3 {
  const parsed = Number(value);
  return parsed === 0 || parsed === 1 || parsed === 2 || parsed === 3
    ? (parsed as 0 | 1 | 2 | 3)
    : 0;
}

function segmentDirection(a: MapperPoint, b: MapperPoint, c: MapperPoint) {
  return (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
}

function segmentsCross(a: MapperPoint, b: MapperPoint, c: MapperPoint, d: MapperPoint) {
  const abC = segmentDirection(a, b, c);
  const abD = segmentDirection(a, b, d);
  const cdA = segmentDirection(c, d, a);
  const cdB = segmentDirection(c, d, b);
  return ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0));
}

function polygonSelfIntersects(points: MapperPoint[]) {
  if (points.length < 4) return false;
  for (let a = 0; a < points.length; a += 1) {
    const aNext = (a + 1) % points.length;
    for (let b = a + 1; b < points.length; b += 1) {
      const bNext = (b + 1) % points.length;
      if (a === b || aNext === b || bNext === a) continue;
      if (a === 0 && bNext === 0) continue;
      if (segmentsCross(points[a], points[aNext], points[b], points[bNext])) return true;
    }
  }
  return false;
}

function mappingDraftKey(projectId: string, plotId: string) {
  return `rekixo:mapper-draft:${projectId}:${cleanPlotId(plotId)}`;
}

function dimensionPair(value: string) {
  const match = String(value || "")
    .trim()
    .match(/(-?\d+(?:\.\d+)?)\s*(?:x|×|X)\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (!(first > 0) || !(second > 0)) return null;
  const lower = value.toLowerCase();
  const unit: "ft" | "m" =
    /\b(m|meter|metre|meters|metres)\b/.test(lower) ? "m" : "ft";
  return { first, second, unit };
}

export default function PlotMapper({
  notify,
  projectId,
  workspaceMode = "full",
}: {
  notify: (message: string) => void;
  projectId: string;
  workspaceMode?: "full" | "controls";
}) {
  const controlsWorkspace = workspaceMode === "controls";
  const completedProject = projectId === COMPLETED_PROJECT_ID;
  const assetUrl = (kind: string) =>
    completedProject && kind === "masterplan"
      ? "/project/masterplan.jpg"
      : `/api/project-asset/${kind}?projectId=${encodeURIComponent(projectId)}`;
  const masterplanAssetUrl = (
    quality: "preview" | "hd",
    version = "",
    retryToken = "",
  ) => {
    if (completedProject) return "/project/masterplan.jpg";
    const params = new URLSearchParams({ projectId, preview: "1" });
    if (quality === "preview") params.set("variant", "public");
    if (version) params.set("v", version);
    if (retryToken) params.set("retry", retryToken);
    return `/api/project-asset/masterplan?${params.toString()}`;
  };

  const [plots, setPlots] = useState<Plot[]>([]);
  const [settings, setSettings] = useState<MapperSettings>({});
  const [northCalibrationDraftSourceAngle, setNorthCalibrationDraftSourceAngle] = useState<number | null>(null);
  const [northCalibrationSaving, setNorthCalibrationSaving] = useState(false);
  const [cadGeometry, setCadGeometry] = useState<CadGeometry | null>(null);
  const [imageUrl, setImageUrl] = useState(() => assetUrl("masterplan"));
  const [imageReady, setImageReady] = useState(false);
  const [imageQuality, setImageQuality] = useState<"preview" | "hd">("preview");
  const [imageLoadState, setImageLoadState] = useState<
    "idle" | "preview-loading" | "preview-ready" | "hd-loading" | "hd-ready"
  >("idle");
  const [imageError, setImageError] = useState("");
  const [masterplanUploadProgress, setMasterplanUploadProgress] = useState<number | null>(null);
  // Actual decoded image dimensions are the final display truth. This prevents
  // metadata/CSS mismatch from ever stretching the masterplan.
  const [naturalImageSize, setNaturalImageSize] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);
  const [headerAddress, setHeaderAddress] = useState("");
  const [areaFactorText, setAreaFactorText] = useState("10.7639");
  const [settingsReady, setSettingsReady] = useState(false);
  const [lastVerifiedId, setLastVerifiedId] = useState("");
  const [zoom, setZoom] = useState(1);
  // 0/1/2/3 = 0°/90°/180°/270° clockwise. Rotation is mapping-view only:
  // persistent plot geometry always remains in the original masterplan coordinate space.
  const [rotation, setRotation] = useState<0 | 1 | 2 | 3>(0);
  const [toolMode, setToolMode] = useState<"pan" | "select">("pan");

  // Primary precision image mapper.
  const [plotId, setPlotId] = useState("1");
  const [dimensions, setDimensions] = useState("");
  const [sqft, setSqft] = useState("");
  const [road, setRoad] = useState("");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [depth, setDepth] = useState("");
  const [depth2, setDepth2] = useState("");
  const [dimensionUnit, setDimensionUnit] = useState<"ft" | "m">("ft");
  const [frontEdgeIndex, setFrontEdgeIndex] = useState("");
  const [depthEdgeIndex, setDepthEdgeIndex] = useState("");
  const [backEdgeIndex, setBackEdgeIndex] = useState("");
  const [depth2EdgeIndex, setDepth2EdgeIndex] = useState("");
  const [selectedSemanticEdge, setSelectedSemanticEdge] = useState<number | null>(null);
  const [edgeAssignMode, setEdgeAssignMode] = useState<PlotSideRole | null>(null);
  // Canonical multi-segment side semantics. Legacy *EdgeIndex fields keep the
  // first/primary edge only so existing projects and older readers stay valid.
  const [edgeSemanticsDraft, setEdgeSemanticsDraft] = useState("");
  const [sideLayout, setSideLayout] = useState<PlotSideLayout>("four");
  const [semanticChainRole, setSemanticChainRole] = useState<PlotSideRole | null>(null);
  const [semanticChainStart, setSemanticChainStart] = useState<number | null>(null);
  const [bulkSemanticMode, setBulkSemanticMode] = useState(false);
  const [bulkSemanticIds, setBulkSemanticIds] = useState<Set<string>>(() => new Set());
  const [points, setPoints] = useState<MapperPoint[]>([]);
  const [shape, setShape] = useState<"quad" | "polygon">("quad");
  const [manualPhase, setManualPhase] = useState<"select" | "details">("select");
  const [editingId, setEditingId] = useState("");

  // CAD calibration and automatic geometry matching.
  const [calibrationPairs, setCalibrationPairs] = useState<HomographyPair[]>([]);
  const [pendingCadPoint, setPendingCadPoint] = useState<MapperPoint | null>(null);
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [showCadOverlay, setShowCadOverlay] = useState(true);
  const [excludedAutoIds, setExcludedAutoIds] = useState<Set<string>>(() => new Set());

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imageWrapRef = useRef<HTMLDivElement | null>(null);
  const tapStartRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const activeGesturePointersRef = useRef<Map<number, GesturePoint>>(new Map());
  const panGestureRef = useRef<PanGesture | null>(null);
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const suppressTapUntilRef = useRef(0);
  const zoomRef = useRef(1);
  // Pointer events can arrive much faster than the screen can paint. Keep raw
  // coordinates in refs and mutate scroll/zoom at most once per animation frame.
  // This removes the Android/Chrome "kapkapi" caused by layout + scroll work on
  // every pointermove while preserving the exact latest finger position.
  const gestureFrameRef = useRef<number | null>(null);
  const pendingPanRef = useRef({ x: 0, y: 0 });
  const pendingPinchRef = useRef<PendingPinchFrame | null>(null);
  const handleFrameRef = useRef<number | null>(null);
  const pendingHandleRef = useRef<PendingHandleFrame | null>(null);
  const draggingPointRef = useRef<number | null>(null);
  const pointsRef = useRef<MapperPoint[]>([]);
  const frontFirstPendingRef = useRef(false);
  const loupeRef = useRef<HTMLDivElement | null>(null);
  const metadataRepairRef = useRef(false);
  const hdPreloadRef = useRef<HTMLImageElement | null>(null);


  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    if (!clearAllConfirmOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setClearAllConfirmOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, clearAllConfirmOpen]);

  useEffect(() => {
    if (!frontFirstPendingRef.current || shape !== "quad" || points.length !== 4) return;
    frontFirstPendingRef.current = false;
    if (
      [frontEdgeIndex, backEdgeIndex, depthEdgeIndex, depth2EdgeIndex].some(
        (value) => value.trim() !== "",
      )
    ) {
      return;
    }
    const resolved = frontFirstFourSideEdges(4);
    if (!resolved) return;
    setFrontEdgeIndex(String(resolved.front));
    setBackEdgeIndex(String(resolved.back));
    setDepthEdgeIndex(String(resolved.depthA));
    setDepth2EdgeIndex(String(resolved.depthB));
    setSideLayout("four");
    setEdgeSemanticsDraft(resolved.edgeSemantics);
    setSemanticChainRole(null);
    setSemanticChainStart(null);
    notify("Front-first mapping applied: pehli tapped boundary = road-facing Front");
  }, [
    backEdgeIndex,
    depth2EdgeIndex,
    depthEdgeIndex,
    frontEdgeIndex,
    notify,
    points.length,
    shape,
  ]);


  useLayoutEffect(() => {
    zoomRef.current = zoom;
    const anchor = zoomAnchorRef.current;
    if (!anchor) return;
    zoomAnchorRef.current = null;
    const canvas = canvasRef.current;
    const wrap = imageWrapRef.current;
    if (!canvas || !wrap) return;
    const box = wrap.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const anchoredClientX = box.left + anchor.visualX * box.width;
    const anchoredClientY = box.top + anchor.visualY * box.height;
    canvas.scrollLeft += anchoredClientX - anchor.clientX;
    canvas.scrollTop += anchoredClientY - anchor.clientY;
  }, [zoom]);

  function announceMapperSettingsUpdated() {
    window.dispatchEvent(
      new CustomEvent("rekixo:mapper-settings-updated", { detail: { projectId } }),
    );
  }

  function announceMapperDataUpdated() {
    window.dispatchEvent(
      new CustomEvent("rekixo:mapper-data-updated", { detail: { projectId } }),
    );
  }

  async function persistMapperSettings(next: Record<string, string>) {
    const response = await fetch("/api/super-mapper", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, settings: next }),
    });
    await apiResult(response);
    setSettings((current) => ({ ...current, ...next }));
    announceMapperSettingsUpdated();
  }

  async function saveHeaderAddress() {
    const value = headerAddress.trim().replace(/\s+/g, " ");
    if (value.length > 180) {
      notify("Website header address 180 characters se chhota rakhein");
      return;
    }
    setBusy(true);
    try {
      await persistMapperSettings({ address: value });
      setHeaderAddress(value);
      notify(
        value
          ? "Website header address save ho gaya — customer site title ke niche dikhega"
          : "Website header address clear ho gaya",
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Website header address save nahi hua",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveAreaFactor() {
    const parsed = Number(areaFactorText);
    if (!Number.isFinite(parsed) || parsed < 9 || parsed > 12) {
      notify("Sq.M → Sq.Ft factor 9 aur 12 ke beech valid number rakhein");
      return;
    }
    const normalized = String(Number(parsed.toFixed(6)));
    setBusy(true);
    try {
      await persistMapperSettings({ sqmToSqftFactor: normalized });
      setAreaFactorText(normalized);
      notify(`Area conversion policy saved: 1 Sq.M = ${normalized} Sq.Ft`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Area conversion policy save nahi hui",
      );
    } finally {
      setBusy(false);
    }
  }


  function preloadHdMasterplan(version: string) {
    if (completedProject) return;
    const retryToken = String(Date.now());
    const hdUrl = masterplanAssetUrl("hd", version, retryToken);
    const preload = new Image();
    hdPreloadRef.current = preload;
    setImageLoadState("hd-loading");
    preload.decoding = "async";
    preload.onload = () => {
      if (hdPreloadRef.current !== preload) return;
      const storedWidth = Number(settings.mapWidth);
      const storedHeight = Number(settings.mapHeight);
      if (storedWidth > 0 && storedHeight > 0) {
        const expected = storedWidth / storedHeight;
        const actual = preload.naturalWidth / Math.max(1, preload.naturalHeight);
        if (Math.abs(actual / expected - 1) > 0.015) {
          setImageError("HD masterplan aspect ratio mismatch mila; safe preview hi use ho raha hai.");
          setImageLoadState("preview-ready");
          return;
        }
      }
      setImageQuality("hd");
      setImageUrl(hdUrl);
    };
    preload.onerror = () => {
      if (hdPreloadRef.current !== preload) return;
      setImageError("HD precision masterplan load nahi hua. Light preview available hai; Retry se dobara koshish karein.");
      setImageLoadState("preview-ready");
    };
    preload.src = hdUrl;
  }

  function retryMasterplanLoad() {
    const version = String(settings.masterplanVersion || settings.masterplanName || "legacy");
    hdPreloadRef.current = null;
    setImageError("");
    setImageReady(false);
    setNaturalImageSize(null);
    setImageQuality("preview");
    setImageLoadState("preview-loading");
    setImageUrl(masterplanAssetUrl("preview", version, String(Date.now())));
  }


  async function reload() {
    setSettingsReady(false);
    const response = await fetch(`/api/super-mapper?projectId=${encodeURIComponent(projectId)}`, {
      cache: "no-store",
    });
    const data = await apiResult(response);
    const nextPlots = (data.plots || []) as Plot[];
    const nextSettings = (data.settings || {}) as MapperSettings;
    setPlots(nextPlots);
    setSettings(nextSettings);
    setHeaderAddress(String(nextSettings.address || ""));
    setAreaFactorText(String(normalizeSqmToSqftFactor(nextSettings.sqmToSqftFactor)));
    // Plot polygons always stay in canonical source-image coordinates.
    // publicRotation only controls the shared Super Admin/public presentation angle.
    setSettingsReady(true);
    setCadGeometry((data.cadGeometry || null) as CadGeometry | null);
    const masterplanVersion = String(
      nextSettings.masterplanVersion || nextSettings.masterplanName || "legacy",
    );
    hdPreloadRef.current = null;
    setImageError("");
    setImageQuality("preview");
    setImageLoadState(nextSettings.masterplanName ? "preview-loading" : "idle");
    setImageUrl(
      nextSettings.masterplanName
        ? masterplanAssetUrl("preview", masterplanVersion, String(Date.now()))
        : assetUrl("masterplan"),
    );
    setImageReady(false);
    setNaturalImageSize(null);
    const orderedNextPlots = [...nextPlots].sort(plotSort);
    if (controlsWorkspace) {
      const firstMapped = orderedNextPlots.find((plot) => Boolean(plot.polygon));
      if (firstMapped) loadPlotDetails(firstMapped, true);
      else if (orderedNextPlots.length) loadPlotDetails(orderedNextPlots[0], false);
      else setPlotId("1");
    } else {
      const firstUnmapped = orderedNextPlots.find((plot) => !plot.polygon);
      if (firstUnmapped) loadPlotDetails(firstUnmapped, false);
      else if (orderedNextPlots.length) loadPlotDetails(orderedNextPlots[0], false);
      else setPlotId("1");
    }
    setExcludedAutoIds(new Set());
    const savedPairs = String(nextSettings.calibrationPairs || "");
    if (savedPairs) {
      try {
        const parsed = JSON.parse(savedPairs) as HomographyPair[];
        if (
          Array.isArray(parsed) &&
          parsed.length >= 4 &&
          parsed.every(
            (pair) =>
              Array.isArray(pair?.source) &&
              pair.source.length === 2 &&
              Array.isArray(pair?.target) &&
              pair.target.length === 2,
          )
        ) {
          setCalibrationPairs(parsed.slice(0, 12));
          setCalibrationMode(false);
        } else setCalibrationPairs([]);
      } catch {
        setCalibrationPairs([]);
      }
    } else setCalibrationPairs([]);
  }

  useEffect(() => {
    if (
      completedProject ||
      !settingsReady ||
      imageQuality !== "hd" ||
      !naturalImageSize ||
      metadataRepairRef.current
    )
      return;

    const width = Math.round(naturalImageSize.width);
    const height = Math.round(naturalImageSize.height);
    if (!(width >= 100 && height >= 100 && width <= 10000 && height <= 10000)) return;

    const storedWidth = Number(settings.mapWidth);
    const storedHeight = Number(settings.mapHeight);
    if (storedWidth === width && storedHeight === height) return;

    metadataRepairRef.current = true;
    persistMapperSettings({ mapWidth: String(width), mapHeight: String(height) })
      .then(() => notify(`Masterplan dimensions auto-verified: ${width} × ${height}`))
      .catch((error) => {
        metadataRepairRef.current = false;
        notify(
          error instanceof Error
            ? error.message
            : "Masterplan dimensions auto-repair nahi hui",
        );
      });
  }, [
    completedProject,
    settingsReady,
    imageQuality,
    naturalImageSize,
    settings.mapWidth,
    settings.mapHeight,
    projectId,
  ]);

  // Rotation is presentation metadata only. Persisted polygon coordinates are
  // never rewritten when the shared Super Admin/public angle changes.

  useEffect(() => {
    resetGestureFrameQueue();
    activeGesturePointersRef.current.clear();
    panGestureRef.current = null;
    pinchGestureRef.current = null;
    zoomAnchorRef.current = null;
    tapStartRef.current = null;
    suppressTapUntilRef.current = 0;
    zoomRef.current = 1;
    setZoom(1);
    reload().catch(() => notify("Project mapper data load नहीं हुआ"));
    setNorthCalibrationDraftSourceAngle(null);
    // Restore this device's preferred mapping orientation for the project.
    try {
      const saved = Number(window.localStorage.getItem(`rekixo:mapper-rotation:${projectId}`));
      if (saved === 0 || saved === 1 || saved === 2 || saved === 3)
        setRotation(saved as 0 | 1 | 2 | 3);
      else setRotation(0);
    } catch {
      setRotation(0);
    }
    // projectId remounts the component in Super Admin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!settingsReady || completedProject) return;

    const serverRotation = normalizeQuarterTurn(settings.publicRotation);
    let localRotation: 0 | 1 | 2 | 3 | null = null;
    try {
      const raw = window.localStorage.getItem(`rekixo:mapper-rotation:${projectId}`);
      if (raw !== null) {
        const saved = Number(raw);
        if (saved === 0 || saved === 1 || saved === 2 || saved === 3) {
          localRotation = saved as 0 | 1 | 2 | 3;
        }
      }
    } catch {
      // Server setting remains authoritative when localStorage is unavailable.
    }

    // One-time compatibility bridge for projects created before public rotation
    // was shared: preserve the existing non-zero mapper angle when the server is
    // still at its legacy 0° default. Once a non-zero server value exists, it wins.
    const migrateExistingLocalAngle =
      serverRotation === 0 && localRotation !== null && localRotation !== 0;
    const nextRotation = migrateExistingLocalAngle ? localRotation! : serverRotation;

    setRotation(nextRotation);
    try {
      window.localStorage.setItem(
        `rekixo:mapper-rotation:${projectId}`,
        String(nextRotation),
      );
    } catch {
      // Local preference is optional; project-level server rotation is durable.
    }

    if (migrateExistingLocalAngle) {
      void persistMapperSettings({ publicRotation: String(nextRotation) }).catch((error) => {
        notify(
          error instanceof Error
            ? error.message
            : "Existing mapper rotation public site me sync nahi hui",
        );
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady, completedProject, projectId, settings.publicRotation]);

  useEffect(() => {
    if (completedProject || !plotId || editingId || points.length) return;
    try {
      const raw = window.localStorage.getItem(mappingDraftKey(projectId, plotId));
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        points?: MapperPoint[];
        shape?: "quad" | "polygon";
        manualPhase?: "select" | "details";
        edgeSemanticsDraft?: string;
        sideLayout?: PlotSideLayout;
      };
      const restored =
        Array.isArray(draft.points) &&
        draft.points.length > 0 &&
        draft.points.length <= 80 &&
        draft.points.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            Number.isFinite(point[0]) &&
            Number.isFinite(point[1]) &&
            point[0] >= 0 &&
            point[0] <= 1 &&
            point[1] >= 0 &&
            point[1] <= 1,
        );
      if (!restored) return;
      setPoints(draft.points as MapperPoint[]);
      setShape(draft.shape === "polygon" ? "polygon" : "quad");
      setManualPhase(draft.manualPhase === "details" && draft.points!.length >= 3 ? "details" : "select");
      const restoredSemantics = parsePlotSideSemantics(
        draft.edgeSemanticsDraft,
        draft.points!.length,
      );
      const restoredLayout: PlotSideLayout =
        draft.points!.length === 3
          ? "three"
          : restoredSemantics?.layout === "three" || draft.sideLayout === "three"
            ? "three"
            : "four";
      setSideLayout(restoredLayout);
      if (restoredSemantics) {
        setEdgeSemanticsDraft(JSON.stringify(restoredSemantics));
        const restoredRoles: PlotSideRoleEdges = {
          front: [...(restoredSemantics.roles.front || [])],
          back: [...(restoredSemantics.roles.back || [])],
          depthA: [...(restoredSemantics.roles.depthA || [])],
          depthB: [...(restoredSemantics.roles.depthB || [])],
        };
        syncPrimarySemanticEdges(restoredRoles);
      }
      setToolMode("select");
      notify(`Plot ${plotId} का unsaved shape draft restore हुआ`);
    } catch {
      // A broken local draft must never block the project mapper.
    }
    // Restore is intentionally scoped to project/plot changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, plotId]);

  useEffect(() => {
    if (completedProject || !plotId || !points.length) return;
    try {
      window.localStorage.setItem(
        mappingDraftKey(projectId, plotId),
        JSON.stringify({ points, shape, manualPhase, edgeSemanticsDraft, sideLayout }),
      );
    } catch {
      // Storage quota/private mode should not block mapping.
    }
  }, [completedProject, edgeSemanticsDraft, manualPhase, plotId, points, projectId, shape, sideLayout]);

  const mappedPlots = useMemo(() => plots.filter((plot) => parsePolygon(plot).length >= 3), [plots]);
  const plotFrontDirections = useMemo(
    () => savedPlotFrontDirections(settings.plotFrontDirections),
    [settings.plotFrontDirections],
  );
  const plotQuality = useMemo(
    () => currentPlotQuality(plots, plotFrontDirections),
    [plots, plotFrontDirections],
  );
  const inventoryPlots = useMemo(() => [...plots].sort(plotSort), [plots]);
  const unmappedPlots = useMemo(
    () => inventoryPlots.filter((plot) => parsePolygon(plot).length < 3),
    [inventoryPlots],
  );
  const mappedPolygons = useMemo(
    () => mappedPlots.filter((plot) => plot.id !== editingId).map(parsePolygon),
    [mappedPlots, editingId],
  );
  const mapWidth = settingsNumber(settings.mapWidth, completedProject ? 1200 : 2048);
  const mapHeight = settingsNumber(settings.mapHeight, completedProject ? 2133 : 1152);
  const hasMasterplan = completedProject || Boolean(settings.masterplanName);
  const hasCad = Boolean(settings.sourceCadName);
  const hasPlotSheet = Boolean(settings.plotSheetName) || plots.length > 0;
  const hasRoadAccessSheet = Boolean(settings.roadAccessSheetName);
  const hasSideMappingSheet = Boolean(settings.sideMappingSheetName);
  const hasMeasurementSheet = Boolean(settings.measurementSheetName);
  const sqmToSqftFactor = normalizeSqmToSqftFactor(settings.sqmToSqftFactor);
  const hasPdf = Boolean(settings.sourcePdfName);
  const hasLogo = Boolean(settings.logoName);
  const logoUrl = hasLogo
    ? `${assetUrl("logo")}&v=${encodeURIComponent(
        settings.logoVersion || settings.logoName || "1",
      )}`
    : "";

  const savedMatrix = useMemo(() => {
    try {
      const parsed = JSON.parse(settings.homography || "[]") as number[];
      return Array.isArray(parsed) && parsed.length === 9 ? parsed : null;
    } catch {
      return null;
    }
  }, [settings.homography]);

  const liveMatrix = useMemo(() => {
    if (calibrationPairs.length >= 4) {
      try {
        return solveHomography(calibrationPairs);
      } catch {
        return null;
      }
    }
    return savedMatrix;
  }, [calibrationPairs, savedMatrix]);

  const cadTransformed = useMemo(() => {
    if (!cadGeometry || !liveMatrix) return [];
    return cadGeometry.candidates
      .map((candidate) => {
        try {
          return { candidate, points: transformedCandidate(candidate, liveMatrix) };
        } catch {
          return null;
        }
      })
      .filter(
        (item): item is NonNullable<typeof item> =>
          Boolean(item && validNormalizedPolygon(item.points)),
      );
  }, [cadGeometry, liveMatrix]);

  const labelMatches = useMemo(() => {
    if (!cadGeometry || !liveMatrix || !inventoryPlots.length) return [];
    const inventoryById = new Map(inventoryPlots.map((plot) => [cleanPlotId(plot.id), plot]));
    const ids = new Set(inventoryById.keys());
    const used = new Set<string>();
    const matches: Omit<AutoMatch, "areaErrorRatio">[] = [];
    for (const candidate of cadGeometry.candidates) {
      const id = bestCadLabel(candidate, cadGeometry.labels, ids);
      if (!id || used.has(id)) continue;
      const plot = inventoryById.get(id);
      if (!plot) continue;
      let transformed: MapperPoint[];
      try {
        transformed = transformedCandidate(candidate, liveMatrix);
      } catch {
        continue;
      }
      if (!validNormalizedPolygon(transformed)) continue;
      used.add(id);
      matches.push({ plot, candidateKey: candidate.key, points: transformed, candidate });
    }
    return matches.sort((a, b) => plotSort(a.plot, b.plot));
  }, [cadGeometry, inventoryPlots, liveMatrix]);

  const cadAreaScale = useMemo(
    () =>
      estimateCadAreaScale(
        labelMatches.map((match) => ({ candidate: match.candidate, sqm: Number(match.plot.sqm) })),
      ),
    [labelMatches],
  );

  const scoredLabelMatches = useMemo<AutoMatch[]>(
    () =>
      labelMatches.map((match) => ({
        ...match,
        areaErrorRatio: cadAreaErrorRatio(match.candidate, Number(match.plot.sqm), cadAreaScale),
      })),
    [labelMatches, cadAreaScale],
  );

  // Exact unique ID + a CAD area consistent with the project-wide unit scale is
  // Auto-ready. Large area disagreement is never bulk-published silently.
  const autoMatches = useMemo(
    () =>
      scoredLabelMatches.filter(
        (match) => match.areaErrorRatio == null || match.areaErrorRatio <= 0.22,
      ),
    [scoredLabelMatches],
  );
  const areaReviewMatches = useMemo(
    () => scoredLabelMatches.filter((match) => (match.areaErrorRatio ?? 0) > 0.22),
    [scoredLabelMatches],
  );
  const acceptedAutoMatches = useMemo(
    () => autoMatches.filter((match) => !excludedAutoIds.has(match.plot.id)),
    [autoMatches, excludedAutoIds],
  );
  const excludedAutoMatches = useMemo(
    () => autoMatches.filter((match) => excludedAutoIds.has(match.plot.id)),
    [autoMatches, excludedAutoIds],
  );
  const autoMatchIds = useMemo(
    () => new Set(acceptedAutoMatches.map((match) => match.plot.id)),
    [acceptedAutoMatches],
  );
  const areaReviewIds = useMemo(
    () => new Set(areaReviewMatches.map((match) => match.plot.id)),
    [areaReviewMatches],
  );
  const reviewPlots = useMemo(
    () => inventoryPlots.filter((plot) => !plot.polygon && !autoMatchIds.has(plot.id)),
    [inventoryPlots, autoMatchIds],
  );

  function loadPlotDetails(plot: Plot, editBoundary: boolean) {
    setPlotId(plot.id);
    setDimensions(plot.dimensions || "");
    setSqft(plot.sqft ? String(plot.sqft) : "");
    setRoad(plot.road || "");
    setFront(plot.front != null ? String(plot.front) : "");
    setBack(plot.back != null ? String(plot.back) : "");
    setDepth(plot.depth != null ? String(plot.depth) : "");
    setDimensionUnit(plot.dimensionUnit === "m" ? "m" : "ft");

    const polygon = parsePolygon(plot);
    const semantics = parsePlotSideSemantics(
      plot.edgeSemantics,
      polygon.length >= 3 ? polygon.length : undefined,
    );
    const resolvedLayout: PlotSideLayout =
      polygon.length === 3
        ? "three"
        : semantics?.layout === "three"
          ? "three"
          : "four";
    setSideLayout(resolvedLayout);
    setDepth2(
      resolvedLayout === "three"
        ? ""
        : plot.depth2 != null
          ? String(plot.depth2)
          : "",
    );

    const frontSemantic = semantics?.roles.front?.[0];
    const backSemantic = semantics?.roles.back?.[0];
    const depthASemantic = semantics?.roles.depthA?.[0];
    const depthBSemantic = semantics?.roles.depthB?.[0];
    const canonicalSemantics =
      semantics
        ? JSON.stringify(semantics)
        : serializePlotSideSemantics(
            polygon.length,
            {
              ...(Number.isInteger(plot.frontEdgeIndex) ? { front: [Number(plot.frontEdgeIndex)] } : {}),
              ...(Number.isInteger(plot.backEdgeIndex) ? { back: [Number(plot.backEdgeIndex)] } : {}),
              ...(Number.isInteger(plot.depthEdgeIndex) ? { depthA: [Number(plot.depthEdgeIndex)] } : {}),
              ...(resolvedLayout === "four" && Number.isInteger(plot.depth2EdgeIndex)
                ? { depthB: [Number(plot.depth2EdgeIndex)] }
                : {}),
            },
            resolvedLayout,
          );
    setEdgeSemanticsDraft(canonicalSemantics || "");
    setSemanticChainRole(null);
    setSemanticChainStart(null);
    setFrontEdgeIndex(
      Number.isInteger(frontSemantic)
        ? String(frontSemantic)
        : Number.isInteger(plot.frontEdgeIndex)
          ? String(plot.frontEdgeIndex)
          : "",
    );
    setDepthEdgeIndex(
      Number.isInteger(depthASemantic)
        ? String(depthASemantic)
        : Number.isInteger(plot.depthEdgeIndex)
          ? String(plot.depthEdgeIndex)
          : "",
    );
    setBackEdgeIndex(
      Number.isInteger(backSemantic)
        ? String(backSemantic)
        : Number.isInteger(plot.backEdgeIndex)
          ? String(plot.backEdgeIndex)
          : "",
    );
    setDepth2EdgeIndex(
      resolvedLayout === "four"
        ? Number.isInteger(depthBSemantic)
          ? String(depthBSemantic)
          : Number.isInteger(plot.depth2EdgeIndex)
            ? String(plot.depth2EdgeIndex)
            : ""
        : "",
    );
    setEdgeAssignMode(null);
    setSelectedSemanticEdge(null);
    if (editBoundary && plot.polygon) {
      setPoints(polygon);
      setEditingId(plot.id);
      setShape(polygon.length === 4 && resolvedLayout === "four" ? "quad" : "polygon");
      setManualPhase("details");
      setToolMode("select");
      canvasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      setPoints([]);
      setEditingId("");
      setManualPhase("select");
      setToolMode("pan");
    }
  }

  function selectNextPlot(afterId = "", sourcePlots: Plot[] = plots) {
    const ordered = [...sourcePlots].sort(plotSort);
    const remaining = ordered.filter((plot) => !plot.polygon && plot.id !== afterId);
    const currentIndex = ordered.findIndex((plot) => plot.id === afterId);
    const next =
      remaining.find((plot) => ordered.indexOf(plot) > currentIndex) || remaining[0] || null;
    if (next) {
      loadPlotDetails(next, false);
      return true;
    }

    const fallback =
      ordered.find((plot) => plot.id === afterId) || ordered[0] || null;
    if (fallback) {
      loadPlotDetails(fallback, false);
      return false;
    }

    setPoints([]);
    setEditingId("");
    setManualPhase("select");
    setPlotId("1");
    setDimensions("");
    setSqft("");
    setRoad("");
    setFront("");
    setBack("");
    setDepth("");
    setDepth2("");
    setDimensionUnit("ft");
    setFrontEdgeIndex("");
    setDepthEdgeIndex("");
    setBackEdgeIndex("");
    setDepth2EdgeIndex("");
    setEdgeSemanticsDraft("");
    setSideLayout("four");
    setEdgeAssignMode(null);
    setSelectedSemanticEdge(null);
    setSemanticChainRole(null);
    setSemanticChainStart(null);
    return false;
  }

  function selectSiblingPlot(offset: -1 | 1) {
    if (!inventoryPlots.length) return;
    const currentIndex = Math.max(0, inventoryPlots.findIndex((plot) => plot.id === plotId));
    const nextIndex = Math.max(0, Math.min(inventoryPlots.length - 1, currentIndex + offset));
    const target = inventoryPlots[nextIndex];
    if (target) loadPlotDetails(target, Boolean(target.polygon));
  }


  function semanticEdgeValue(role: PlotSideRole | null) {
    if (role === "front") return frontEdgeIndex;
    if (role === "back") return backEdgeIndex;
    if (role === "depthA") return depthEdgeIndex;
    return depth2EdgeIndex;
  }

  function effectiveSideLayout(layout: PlotSideLayout = sideLayout): PlotSideLayout {
    return points.length === 3 ? "three" : layout;
  }

  function currentSemanticRoles(): PlotSideRoleEdges {
    const output = emptyPlotSideRoleEdges();
    const parsed = parsePlotSideSemantics(
      edgeSemanticsDraft,
      points.length >= 3 ? points.length : undefined,
    );
    const layout = effectiveSideLayout(
      parsed?.layout === "three" || parsed?.layout === "four"
        ? parsed.layout
        : sideLayout,
    );
    const roles: PlotSideRole[] = ["front", "back", "depthA", "depthB"];
    for (const role of roles) {
      if (layout === "three" && role === "depthB") continue;
      const semantic = parsed?.roles[role] || [];
      if (semantic.length) {
        output[role] = [...semantic];
        continue;
      }
      const raw = semanticEdgeValue(role);
      const legacy = raw.trim() === "" ? null : Number(raw);
      if (
        legacy != null &&
        Number.isInteger(legacy) &&
        legacy >= 0 &&
        legacy < points.length
      ) {
        output[role] = [legacy];
      }
    }
    return output;
  }

  function syncPrimarySemanticEdges(roles: PlotSideRoleEdges) {
    setFrontEdgeIndex(roles.front.length ? String(roles.front[0]) : "");
    setBackEdgeIndex(roles.back.length ? String(roles.back[0]) : "");
    setDepthEdgeIndex(roles.depthA.length ? String(roles.depthA[0]) : "");
    setDepth2EdgeIndex(roles.depthB.length ? String(roles.depthB[0]) : "");
  }

  function currentRoadFacingRoles(): PlotSideRole[] {
    const parsed = parsePlotSideSemantics(
      edgeSemanticsDraft,
      points.length >= 3 ? points.length : undefined,
    );
    // Front is the primary facing for every mapped plot once the feature is
    // enabled. Additional compass directions are additive; never let choosing
    // or toggling a secondary direction make the primary Front disappear.
    const explicit = parsed?.roadFacingRoles || [];
    return [...new Set<PlotSideRole>([
      ...(parsed?.roles.front?.length ? ["front" as PlotSideRole] : []),
      ...explicit,
    ])];
  }

  function currentFacingDirectionOverrides() {
    const parsed = parsePlotSideSemantics(
      edgeSemanticsDraft,
      points.length >= 3 ? points.length : undefined,
    );
    return { ...(parsed?.facingDirectionOverrides || {}) };
  }

  function serializedCurrentFacingSemantics(
    roadFacingRoles = currentRoadFacingRoles(),
    overrides = currentFacingDirectionOverrides(),
  ) {
    return serializePlotSideSemantics(
      points.length,
      currentSemanticRoles(),
      effectiveSideLayout(),
      roadFacingRoles,
      overrides,
    ) || "";
  }

  function hasSavedMasterplanNorthAngle() {
    return settings.masterplanNorthAngle != null &&
      String(settings.masterplanNorthAngle).trim() !== "";
  }

  function hasActiveMasterplanNorthAngle() {
    // Drafts preview exact calibration; only Save persists them.
    return hasSavedMasterplanNorthAngle() || northCalibrationDraftSourceAngle !== null;
  }

  function currentMasterplanNorthSourceAngle() {
    if (northCalibrationDraftSourceAngle !== null) {
      return normalizeMasterplanNorthAngle(northCalibrationDraftSourceAngle);
    }
    if (hasSavedMasterplanNorthAngle()) {
      return normalizeMasterplanNorthAngle(settings.masterplanNorthAngle);
    }
    return plotNorthDirectionToAngle(settings.plotNorthDirection || "top");
  }

  function currentMasterplanNorthDisplayAngle() {
    return displayNorthAngleFromSource(currentMasterplanNorthSourceAngle(), rotation);
  }

  function stepNorthCalibration(degrees: number) {
    setNorthCalibrationDraftSourceAngle(
      normalizeMasterplanNorthAngle(currentMasterplanNorthSourceAngle() + degrees),
    );
  }

  async function saveNorthCalibration() {
    if (completedProject || settings.plotFacingEnabled !== "1" || northCalibrationSaving) return;
    const sourceAngle = currentMasterplanNorthSourceAngle();
    setNorthCalibrationSaving(true);
    try {
      await persistMapperSettings({ masterplanNorthAngle: String(sourceAngle) });
      setNorthCalibrationDraftSourceAngle(null);
      notify(
        `North calibration saved · source bearing ${sourceAngle}° · verify facing, then Publish Update`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "North calibration save nahi hui");
    } finally {
      setNorthCalibrationSaving(false);
    }
  }

  async function resetNorthCalibration() {
    if (completedProject || northCalibrationSaving || !hasSavedMasterplanNorthAngle()) return;
    setNorthCalibrationSaving(true);
    try {
      // Empty setting opts out and restores legacy four-direction North behavior.
      // This edits project settings only; it never rewrites plot polygons or sides.
      await persistMapperSettings({ masterplanNorthAngle: "" });
      setNorthCalibrationDraftSourceAngle(null);
      notify("Exact North calibration cleared · legacy North setting is active");
    } catch (error) {
      notify(error instanceof Error ? error.message : "North calibration reset nahi hui");
    } finally {
      setNorthCalibrationSaving(false);
    }
  }

  function facingResultsForCurrentNorth(semantics: unknown) {
    return hasActiveMasterplanNorthAngle()
      ? plotFacingResultsForNorthAngle(points, semantics, currentMasterplanNorthSourceAngle(), rotation)
      : plotFacingResults(points, semantics, settings.plotNorthDirection || "top", rotation);
  }

  function sideDirectionsForCurrentNorth(semantics: unknown) {
    return hasActiveMasterplanNorthAngle()
      ? plotSideDirectionResultsForNorthAngle(points, semantics, currentMasterplanNorthSourceAngle(), rotation)
      : plotSideDirectionResults(points, semantics, settings.plotNorthDirection || "top", rotation);
  }

  function currentCompassFacingResults() {
    if (settings.plotFacingEnabled !== "1" || points.length < 3) return [];
    const semantics = serializedCurrentFacingSemantics();
    return facingResultsForCurrentNorth(semantics);
  }

  function normalizedFacingMetadata(
    roles: PlotSideRoleEdges,
    layout: PlotSideLayout,
    roadFacingRoles: PlotSideRole[] = currentRoadFacingRoles(),
    facingDirectionOverrides = currentFacingDirectionOverrides(),
  ) {
    const cleanRoadFacing = [...new Set(roadFacingRoles)].filter(
      (role) =>
        (layout === "four" || role !== "depthB") &&
        roles[role].length > 0,
    );
    // Front is a logical side, but compass-facing is an independent toggle.
    // Do not force Front back into roadFacingRoles after the operator unticks it.
    const cleanOverrides = { ...facingDirectionOverrides };
    delete cleanOverrides.front;
    (["front", "back", "depthA", "depthB"] as PlotSideRole[]).forEach((role) => {
      if (!cleanRoadFacing.includes(role) || !roles[role].length) {
        delete cleanOverrides[role];
      }
    });
    return {
      roadFacingRoles: cleanRoadFacing,
      facingDirectionOverrides: cleanOverrides,
    };
  }

  function commitSemanticRoles(
    roles: PlotSideRoleEdges,
    layout: PlotSideLayout = sideLayout,
    roadFacingRoles: PlotSideRole[] = currentRoadFacingRoles(),
    facingDirectionOverrides = currentFacingDirectionOverrides(),
  ) {
    const resolvedLayout = effectiveSideLayout(layout);
    const nextRoles: PlotSideRoleEdges = {
      front: [...roles.front],
      back: [...roles.back],
      depthA: [...roles.depthA],
      depthB: resolvedLayout === "four" ? [...roles.depthB] : [],
    };
    const facingMetadata = normalizedFacingMetadata(
      nextRoles,
      resolvedLayout,
      roadFacingRoles,
      facingDirectionOverrides,
    );
    const serialized =
      serializePlotSideSemantics(
        points.length,
        nextRoles,
        resolvedLayout,
        facingMetadata.roadFacingRoles,
        facingMetadata.facingDirectionOverrides,
      ) || "";
    setEdgeSemanticsDraft(serialized);
    syncPrimarySemanticEdges(nextRoles);
  }

  function toggleCompassFacing(direction: PlotFacingCardinalDirection) {
    if (settings.plotFacingEnabled !== "1") return;
    if (points.length < 3) {
      notify("Pehle plot boundary select karein");
      return;
    }
    const roles = currentSemanticRoles();
    if (!roles.front.length) {
      notify("Pehle Front side assign karein — primary facing Front se auto aati hai");
      return;
    }

    const roadFacingRoles = currentRoadFacingRoles();
    const overrides = currentFacingDirectionOverrides();
    const semantics = serializePlotSideSemantics(
      points.length,
      roles,
      effectiveSideLayout(),
      roadFacingRoles,
      overrides,
    );
    if (!semantics) return;

    const facingResults = facingResultsForCurrentNorth(semantics);
    const frontFacing = facingResults.find((item) => item.role === "front");
    if (frontFacing?.direction === direction) {
      // Front is the primary side and remains active. A click on its direction
      // must not remove it; users can toggle only additional directions.
      notify(`Plot ${plotId}: ${frontFacing.arrow} ${frontFacing.label} is the primary Front facing`);
      return;
    }

    const activeExtra = facingResults.find(
      (item) => item.role !== "front" && item.direction === direction,
    );
    if (activeExtra) {
      const nextRoadFacing = roadFacingRoles.filter(
        (role) => role !== activeExtra.role,
      );
      const nextOverrides = { ...overrides };
      delete nextOverrides[activeExtra.role];
      commitSemanticRoles(
        roles,
        sideLayout,
        nextRoadFacing,
        nextOverrides,
      );
      notify(
        `Plot ${plotId}: ${activeExtra.arrow} ${activeExtra.label} extra facing removed · Update ${plotId} to save`,
      );
      return;
    }

    const sideDirections = sideDirectionsForCurrentNorth(semantics)
      .filter((item) => item.role !== "front");
    const inactiveCandidates = sideDirections.filter(
      (item) => !roadFacingRoles.includes(item.role),
    );
    const candidates = inactiveCandidates.length
      ? inactiveCandidates
      : sideDirections;
    const candidate = [...candidates].sort(
      (a, b) =>
        cardinalDirectionDistance(a.direction, direction) -
        cardinalDirectionDistance(b.direction, direction),
    )[0];

    if (
      !candidate ||
      cardinalDirectionDistance(candidate.direction, direction) > 1
    ) {
      notify(
        `Plot ${plotId}: ${direction.toUpperCase()} ke paas mapped logical side nahi mili`,
      );
      return;
    }

    const nextRoadFacing = [
      ...new Set<PlotSideRole>([...roadFacingRoles, candidate.role]),
    ];
    const nextOverrides = {
      ...overrides,
      [candidate.role]: direction,
    };
    commitSemanticRoles(
      roles,
      sideLayout,
      nextRoadFacing,
      nextOverrides,
    );
    const label =
      direction === "north"
        ? "↑ North"
        : direction === "east"
          ? "→ East"
          : direction === "south"
            ? "↓ South"
            : "← West";
    notify(`Plot ${plotId}: ${label} second facing added · Update ${plotId} to save`);
  }

  function changeSideLayout(next: PlotSideLayout) {
    const resolved: PlotSideLayout = points.length === 3 ? "three" : next;
    const roles = currentSemanticRoles();
    if (resolved === "three") {
      roles.depthB = [];
      setDepth2("");
    }
    setSideLayout(resolved);
    commitSemanticRoles(roles, resolved);
    setSemanticChainRole(null);
    setSemanticChainStart(null);
    setSelectedSemanticEdge(null);
    notify(
      resolved === "three"
        ? "3-side mode: Front + Back + Depth. Depth B N/A hai."
        : "4-side mode: Front + Back + Depth A + Depth B.",
    );
  }

  function assignSemanticRoleEdges(role: PlotSideRole, requestedEdges: number[]) {
    if (effectiveSideLayout() === "three" && role === "depthB") return;
    const clean = requestedEdges.filter(
      (edge, index, list) =>
        Number.isInteger(edge) &&
        edge >= 0 &&
        edge < points.length &&
        list.indexOf(edge) === index,
    );
    if (!clean.length) return;
    const chosen = new Set(clean);
    const roles = currentSemanticRoles();
    (["front", "back", "depthA", "depthB"] as PlotSideRole[]).forEach((item) => {
      if (item !== role) roles[item] = roles[item].filter((edge) => !chosen.has(edge));
    });
    roles[role] = clean;
    commitSemanticRoles(roles);
  }

  function beginSemanticChain(role: PlotSideRole) {
    if (effectiveSideLayout() === "three" && role === "depthB") return;
    setSemanticChainRole(role);
    setSemanticChainStart(null);
    setSelectedSemanticEdge(null);
    setEdgeAssignMode(null);
    const label =
      role === "front" ? "Front" :
      role === "back" ? "Back" :
      role === "depthA" ? (effectiveSideLayout() === "three" ? "Depth" : "Depth A") : "Depth B";
    notify(`${label}: pehla numbered corner tap karein, phir last numbered corner tap karein`);
  }

  // REKIXO_IRREGULAR_CORNER_RANGE_V3
  function handleSemanticCornerTap(index: number) {
    if (!semanticChainRole || index < 0 || index >= points.length) return;
    if (semanticChainStart == null) {
      setSemanticChainStart(index);
      notify(`Corner ${index + 1} start hai — ab side ka last corner number tap karein`);
      return;
    }
    const chain = forwardCornerEdgeChain(semanticChainStart, index, points.length);
    if (!chain.length) {
      notify("Start aur end corner alag choose karein");
      return;
    }
    const role = semanticChainRole;
    assignSemanticRoleEdges(role, chain);
    const label =
      role === "front" ? "Front" :
      role === "back" ? "Back" :
      role === "depthA" ? (effectiveSideLayout() === "three" ? "Depth" : "Depth A") : "Depth B";
    const startNumber = semanticChainStart + 1;
    const endNumber = index + 1;
    setSemanticChainRole(null);
    setSemanticChainStart(null);
    setSelectedSemanticEdge(null);
    notify(
      `Plot ${plotId}: ${label} = corner ${startNumber} → ${endNumber} (${chain.length} segment${chain.length === 1 ? "" : "s"})`,
    );
  }

  function handleSemanticEdgeTap(index: number) {
    if (index < 0 || index >= points.length || semanticChainRole) return;
    setSelectedSemanticEdge(index);
    setEdgeAssignMode(null);
  }

  function chooseSemanticEdge(index: number) {
    if (index < 0 || index >= points.length || !edgeAssignMode) return;
    if (effectiveSideLayout() === "three" && edgeAssignMode === "depthB") return;
    assignSemanticRoleEdges(edgeAssignMode, [index]);
    const label =
      edgeAssignMode === "front"
        ? "Front"
        : edgeAssignMode === "back"
          ? "Back"
          : edgeAssignMode === "depthA"
            ? effectiveSideLayout() === "three" ? "Depth" : "Depth A"
            : "Depth B";
    setEdgeAssignMode(null);
    setSelectedSemanticEdge(null);
    setSemanticChainRole(null);
    setSemanticChainStart(null);
    notify(`Plot ${plotId}: ${label} edge ${index + 1} selected`);
  }

  // REKIXO_IRREGULAR_SIDE_ASSIGNER_V3_CORNER_RANGE
  function assignSelectedSemanticRole(role: PlotSideRole) {
    if (effectiveSideLayout() === "three" && role === "depthB") return;
    if (
      selectedSemanticEdge == null ||
      selectedSemanticEdge < 0 ||
      selectedSemanticEdge >= points.length
    ) {
      beginSemanticChain(role);
      return;
    }
    const edge = selectedSemanticEdge;
    const roles = currentSemanticRoles();
    const alreadyAssigned = roles[role].includes(edge);
    if (alreadyAssigned) {
      roles[role] = roles[role].filter((item) => item !== edge);
      commitSemanticRoles(roles);
    } else {
      assignSemanticRoleEdges(role, [...roles[role], edge]);
    }
    const label =
      role === "front" ? "Front" :
      role === "back" ? "Back" :
      role === "depthA" ? (effectiveSideLayout() === "three" ? "Depth" : "Depth A") : "Depth B";
    notify(
      alreadyAssigned
        ? `Plot ${plotId}: Edge ${edge + 1} ${label} group se removed`
        : `Plot ${plotId}: Edge ${edge + 1} ${label} group me added`,
    );
  }

  function clearSelectedSemanticRole() {
    if (selectedSemanticEdge == null) return;
    const edge = selectedSemanticEdge;
    const roles = currentSemanticRoles();
    (["front", "back", "depthA", "depthB"] as PlotSideRole[]).forEach((role) => {
      roles[role] = roles[role].filter((item) => item !== edge);
    });
    commitSemanticRoles(roles);
    notify(`Plot ${plotId}: Edge ${edge + 1} side role cleared`);
  }

  function toggleBulkSemanticPlot(id: string) {
    setBulkSemanticIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulkEdgeDirection(
    kind: PlotSideRole,
    direction: EdgeDirection,
  ) {
    const selected = mappedPlots.filter((plot) => bulkSemanticIds.has(plot.id));
    if (!selected.length) return notify("Bulk side ke liye pehle plots select karein");
    const eligible =
      kind === "depthB"
        ? selected.filter((plot) => resolvedPlotSideLayout(plot) === "four")
        : selected;
    if (!eligible.length)
      return notify("Depth B sirf 4-side plots par apply hota hai");

    const payload = eligible.map((plot) => {
      const polygon = parsePolygon(plot);
      const edge = edgeIndexForDisplayDirection(polygon, direction, rotation);
      const edgeSemantics = setPlotSideEdge(
        plot.edgeSemantics,
        kind,
        edge,
        polygon.length,
      );
      return {
        ...plot,
        edgeSemantics,
        ...(kind === "front" ? { frontEdgeIndex: edge } : {}),
        ...(kind === "back" ? { backEdgeIndex: edge } : {}),
        ...(kind === "depthA" ? { depthEdgeIndex: edge } : {}),
        ...(kind === "depthB" ? { depth2EdgeIndex: edge } : {}),
      };
    });

    setBusy(true);
    try {
      const response = await fetch("/api/super-mapper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, plots: payload }),
      });
      await apiResult(response);
      await reload();
      announceMapperDataUpdated();
      setBulkSemanticIds(new Set());
      const roleLabel =
        kind === "front" ? "Front" :
        kind === "back" ? "Back" :
        kind === "depthA" ? "Depth A" : "Depth B";
      notify(
        `${payload.length} plots: ${roleLabel} ${direction.toUpperCase()} SERVER SAVED ✓`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Bulk side save nahi hua");
    } finally {
      setBusy(false);
    }
  }

  function toggleMapperFullscreen() {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      const exit = document.exitFullscreen?.();
      if (exit) exit.catch(() => {});
      return;
    }
    const request = canvasRef.current?.requestFullscreen?.();
    if (request) request.catch(() => {});
  }

  function enableSelectMode() {
    setToolMode("select");
    setCalibrationMode(false);
    // On a real touch device, SELECT is also the mapping focus action.
    // Fullscreen removes Chrome browser chrome/menus from the tapping area.
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(any-pointer: coarse)").matches &&
      typeof document !== "undefined" &&
      !document.fullscreenElement
    ) {
      const request = canvasRef.current?.requestFullscreen?.();
      if (request) request.catch(() => {});
    }
  }

  function beginBoundaryShape(nextShape: "quad" | "polygon") {
    // Re-selecting the same mode must never destroy an in-progress boundary.
    // It only returns the operator to corner selection. Switching shape types
    // intentionally starts a fresh local boundary, matching the existing flow.
    if (shape === nextShape && points.length) {
      setManualPhase("select");
      setToolMode("select");
      setCalibrationMode(false);
      setSemanticChainRole(null);
      setSemanticChainStart(null);
      setSelectedSemanticEdge(null);
      setEdgeAssignMode(null);
      return;
    }

    setShape(nextShape);
    setPoints([]);
    setFrontEdgeIndex("");
    setBackEdgeIndex("");
    setDepthEdgeIndex("");
    setDepth2EdgeIndex("");
    setEdgeSemanticsDraft("");
    setSideLayout("four");
    setEdgeAssignMode(null);
    setSelectedSemanticEdge(null);
    setSemanticChainRole(null);
    setSemanticChainStart(null);
    frontFirstPendingRef.current = false;
    setManualPhase("select");
    setToolMode("select");
    setCalibrationMode(false);
  }

  function beginFourCornerBoundary() {
    beginBoundaryShape("quad");
  }

  function beginIrregularBoundary() {
    beginBoundaryShape("polygon");
  }

  function completeIrregularBoundary() {
    if (shape !== "polygon")
      return notify("Boundary complete irregular corner mode me use karein");
    if (points.length < 3)
      return notify("Irregular boundary complete karne ke liye kam se kam 3 corners chahiye");

    const nextLayout: PlotSideLayout = points.length === 3 ? "three" : "four";
    setSideLayout(nextLayout);
    setManualPhase("details");
    setSemanticChainRole(null);
    setSemanticChainStart(null);
    setSelectedSemanticEdge(null);
    setEdgeAssignMode(null);
    if (points.length === 3) {
      const roles = currentSemanticRoles();
      roles.depthB = [];
      commitSemanticRoles(roles, "three");
    }
  }

  function resetGeometryDerivedSideAssignments() {
    // Side measurements are business/source data and remain untouched. These
    // values are polygon-edge bindings, so any geometry mutation must make the
    // operator/re-resolver establish them again instead of reusing stale edges.
    setFrontEdgeIndex("");
    setDepthEdgeIndex("");
    setBackEdgeIndex("");
    setDepth2EdgeIndex("");
    setEdgeSemanticsDraft("");
    setEdgeAssignMode(null);
    setSelectedSemanticEdge(null);
    setSemanticChainRole(null);
    setSemanticChainStart(null);
    frontFirstPendingRef.current = false;
  }

  function clearCurrentPoints() {
    setPoints([]);
    setManualPhase("select");
    setEditingId("");
    resetGeometryDerivedSideAssignments();
    setSideLayout("four");
    setToolMode("select");
    try {
      window.localStorage.removeItem(mappingDraftKey(projectId, plotId));
    } catch {
      // Ignore local storage failures.
    }
  }

  function clearCurrentSelection() {
    const saved = plots.find(
      (plot) => plot.id === plotId && parsePolygon(plot).length >= 3,
    );
    if (saved) {
      // "Clear" on an already-mapped plot must clear the persisted clickable
      // boundary, not just hide its edit handles locally.
      void remove(saved);
      return;
    }
    clearCurrentPoints();
  }

  function undoPoint() {
    setPoints((current) => current.slice(0, -1));
    resetGeometryDerivedSideAssignments();
    setManualPhase("select");
    setToolMode("select");
  }

  function toggleBulkSidesMode() {
    setBulkSemanticMode((value) => !value);
    setBulkSemanticIds(new Set());
    setEdgeAssignMode(null);
    setSelectedSemanticEdge(null);
    setSemanticChainRole(null);
    setSemanticChainStart(null);
  }

  function clonePreviousShape() {
    const currentIndex = inventoryPlots.findIndex((plot) => plot.id === plotId);
    const before = currentIndex > 0 ? inventoryPlots.slice(0, currentIndex).reverse() : [];
    const source = before.find((plot) => parsePolygon(plot).length >= 3) ||
      [...inventoryPlots].reverse().find((plot) => plot.id !== plotId && parsePolygon(plot).length >= 3);
    if (!source) return notify("Clone करने के लिए पहले कोई mapped plot चाहिए");
    const polygon = parsePolygon(source);
    const clonedLayout: PlotSideLayout =
      polygon.length === 3 ? "three" : effectiveSideLayout();

    // Clone geometry only. Measurements currently loaded for the target plot
    // remain untouched, while source-plot edge bindings must never cross plots.
    setPoints(polygon.map(([x, y]) => [x, y] as MapperPoint));
    setShape(polygon.length === 4 && clonedLayout === "four" ? "quad" : "polygon");
    setSideLayout(clonedLayout);
    resetGeometryDerivedSideAssignments();
    setManualPhase("details");
    setEditingId("");
    setToolMode("select");
    canvasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    notify(`Plot ${source.id} geometry clone हुआ — ${plotId} की measurements सुरक्षित हैं; Front / Back / Depth side bindings target के हिसाब से select करें`);
  }

  function downloadPlotSheetTemplate() {
    const text = [
      "Plot No,Sqft,Sqm,Sqyd,Dimensions,Road Access,Front,Back,Depth,Depth 2,Dimension Unit,Front Edge,Back Edge,Depth Edge,Depth 2 Edge,Front Label,Back Label,Depth Label,Depth 2 Label,Side Dimensions,Notes",
      "1,,108,,Irregular,12.000 M WIDE ROAD,12,10,9,9.5,m,,,,,12 m,10 m,9 m,9.5 m,Front 12 m · Back 10 m · Depth A 9 m · Depth B 9.5 m,Verified from sanctioned plan; facing is selected in mapper, not AI CSV",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "rekixo-plot-sheet-template.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function downloadMeasurementTemplate() {
    const text = [
      "Plot No,Front,Back,Depth A,Depth B,Measurement Unit,Front Label,Back Label,Depth A Label,Depth B Label,Road Access,Side Measurements,Source Ref,Confidence,Verified,Raw Source Text",
      "1,12,10,9,9.5,m,12 m,10 m,9 m,9.5 m,12.000 M WIDE ROAD,Front 12 m · Back 10 m · Depth A 9 m · Depth B 9.5 m,Sanctioned plan page 1,high,true,Verified from source drawing",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "rekixo-ai-measurement-manifest.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function downloadRoadAccessTemplate() {
    const text = [
      "Plot No,Road Access",
      "1,60 FT ROAD",
      "110,48.0 MTR ROAD",
      "122,48.0 MTR ROAD / 30 FT ROAD",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "rekixo-road-access-template.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function downloadSideMappingTemplate() {
    const text = [
      "Plot No,Front Direction",
      "1,right",
      "61,left",
      "110,right",
      "124,top",
      "S-13,left",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "rekixo-side-mapping-template.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function preflightPlotSheet(file: File) {
    setBusy(true);
    let quality: PlotSheetQualitySummary | null = null;
    let inventory: PlotInventorySummary | null = null;
    let inventoryConfirmation = "";
    try {
      const data = new FormData();
      data.append("projectId", projectId);
      data.append("kind", "plotSheetPreflight");
      data.append("file", file);
      const response = await fetch("/api/super-mapper", {
        method: "POST",
        body: data,
      });
      const result = await apiResult(response);
      quality = (result.quality || null) as PlotSheetQualitySummary | null;
      inventory = (result.inventory || null) as PlotInventorySummary | null;
      if (!quality) throw new Error("Plot sheet quality report nahi mila");
      if (!inventory) throw new Error("Plot inventory reconciliation report nahi mila");

      if (inventory.confirmationRequired) {
        const examples = inventory.missingIds.slice(0, 16);
        const proceed = window.confirm(
          [
            "Canonical Plot Data inventory change detected.",
            "",
            `Current active plots: ${inventory.existingActiveCount}`,
            `Incoming canonical plots: ${inventory.incomingCount}`,
            `Plots missing from new sheet: ${inventory.missingIds.length}`,
            examples.length ? `Missing examples: ${examples.join(", ")}` : "",
            inventory.missingMappedIds.length
              ? `Mapped boundaries affected: ${inventory.missingMappedIds.length}`
              : "",
            inventory.missingNonAvailableIds.length
              ? `Booked/Sold affected: ${inventory.missingNonAvailableIds.length}`
              : "",
            inventory.missingPricedIds.length
              ? `Pricing rows affected: ${inventory.missingPricedIds.length}`
              : "",
            "",
            "Confirm करने पर ये plots mapper draft inventory से हटेंगे.",
            "Current published customer website पर ये Publish Update तक बने रहेंगे.",
            "Publish Update के समय removal final होगा.",
            "",
            "Inventory reconciliation confirm करें?",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        if (!proceed) {
          notify("Plot inventory reconciliation cancel की गई — कोई बदलाव नहीं हुआ");
          return;
        }
        inventoryConfirmation = inventory.confirmationToken;
      }

      if (!quality.richDetailReady) {
        const problemLines = [
          quality.missingDimensions.length
            ? `Dimensions missing: ${quality.missingDimensions.length}`
            : "",
          quality.missingRoad.length
            ? `Road Access missing: ${quality.missingRoad.length}`
            : "",
          quality.missingSideMeasurements.length
            ? `Front/Back/Depth A/Depth B missing: ${quality.missingSideMeasurements.length}`
            : "",
          quality.partialSideMeasurements.length
            ? `Partial side measurements: ${quality.partialSideMeasurements.length}`
            : "",
          quality.genericAreaOnlyDimensions.length
            ? `Generic approved-area text without sides: ${quality.genericAreaOnlyDimensions.length}`
            : "",
        ].filter(Boolean);

        const examples = [
          ...quality.missingSideMeasurements,
          ...quality.partialSideMeasurements,
          ...quality.genericAreaOnlyDimensions,
        ].filter((id, index, list) => list.indexOf(id) === index).slice(0, 12);

        const proceed = window.confirm(
          [
            `CSV parse OK: ${quality.total} plots.`,
            "",
            "Rich plot details abhi complete nahi hain:",
            ...problemLines.map((line) => "• " + line),
            examples.length ? `Affected examples: ${examples.join(", ")}` : "",
            "",
            "Aise import karne par complete Front / Back / Depth measurement sab plots me nahi dikhega.",
            "Phir bhi import karna hai?",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        if (!proceed) {
          notify("Plot CSV import roka gaya — pehle quality issues correct karein");
          return;
        }
      } else {
        notify(
          `Preflight PASS ✓ — ${quality.fullDetailCount}/${quality.total} plots rich-detail ready`,
        );
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Plot CSV preflight fail hui");
      return;
    } finally {
      setBusy(false);
    }

    if (quality && inventory)
      await upload(file, "plotSheet", { inventoryConfirmation });
  }

  async function upload(
    file: File,
    kind: "masterplan" | "sourcePdf" | "sourceCad" | "plotSheet" | "measurementSheet" | "roadAccessSheet" | "sideMappingSheet" | "logo",
    options: { inventoryConfirmation?: string } = {},
  ) {
    if (completedProject && !["sourcePdf", "logo", "measurementSheet", "roadAccessSheet", "sideMappingSheet"].includes(kind)) {
      notify("Tiyansh completed project locked है");
      return;
    }
    setBusy(true);
    let masterplanStage = "prepare";
    try {
      const data = new FormData();
      data.append("projectId", projectId);
      data.append("kind", kind);
      if (kind === "plotSheet" && options.inventoryConfirmation) {
        data.append("inventoryConfirmation", options.inventoryConfirmation);
      }
      if (kind === "logo") {
        data.append("file", await prepareProjectLogo(file));
      } else if (kind === "masterplan") {
        masterplanStage = "process";
        const prepared = await prepareMasterplan(file);

        // A replacement may change pixels/resolution but must not silently change
        // the coordinate plane underneath already-mapped plots. Same-aspect HD
        // renders are safe because plot polygons are normalized 0..1 coordinates.
        const existingWidth = settingsNumber(
          settings.masterplanOriginalWidth,
          settingsNumber(settings.mapWidth, prepared.originalWidth),
        );
        const existingHeight = settingsNumber(
          settings.masterplanOriginalHeight,
          settingsNumber(settings.mapHeight, prepared.originalHeight),
        );
        if (hasMasterplan && mappedPlots.length && existingWidth > 0 && existingHeight > 0) {
          const existingAspect = existingWidth / existingHeight;
          const nextAspect = prepared.originalWidth / prepared.originalHeight;
          const aspectDrift = Math.abs(nextAspect / existingAspect - 1);
          if (aspectDrift > 0.0025) {
            throw new Error(
              "New masterplan ka aspect ratio current mapped project se match nahi karta. Polygons safe rakhne ke liye upload block kiya gaya.",
            );
          }
        }

        masterplanStage = "original upload";
        setMasterplanUploadProgress(0);
        const originalUpload = await uploadMasterplanOriginal(
          projectId,
          prepared.originalFile,
          setMasterplanUploadProgress,
        );

        data.append("file", prepared.mappingFile);
        data.append("publicFile", prepared.publicFile);
        data.append("originalUploadCompleted", "1");
        data.append("originalObjectToken", originalUpload.token);
        data.append("originalFileName", prepared.originalFile.name);
        data.append("originalFileSize", String(prepared.originalFile.size));
        data.append("mapWidth", String(prepared.width));
        data.append("mapHeight", String(prepared.height));
        data.append("originalWidth", String(prepared.originalWidth));
        data.append("originalHeight", String(prepared.originalHeight));
      } else data.append("file", file);

      let response: Response;
      if (kind === "masterplan") {
        masterplanStage = "derivative finalize";
        const controller = new AbortController();
        const timeoutId = window.setTimeout(
          () => controller.abort(),
          MASTERPLAN_FINALIZE_TIMEOUT_MS,
        );
        try {
          response = await fetch("/api/super-mapper", {
            method: "POST",
            body: data,
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw new Error(
              "Masterplan derivatives finalize 180 seconds me complete nahi hue. Retry karein; original multipart upload safe hai.",
            );
          }
          throw error;
        } finally {
          window.clearTimeout(timeoutId);
        }
      } else {
        // Preserve the existing upload path for logo/PDF/CAD/plot-sheet.
        response = await fetch("/api/super-mapper", { method: "POST", body: data });
      }

      masterplanStage = "server verify";
      const result = await apiResult(response);
      if (kind === "sourceCad" && result.cadError) {
        notify("CAD save हुआ, auto-detect review चाहिए: " + String(result.cadError));
      } else if (kind === "sourceCad") {
        notify(String((result.cadGeometry as CadGeometry | undefined)?.candidates.length || 0) + " CAD boundaries मिलीं");
      } else if (kind === "plotSheet") {
        const quality = (result.quality || null) as PlotSheetQualitySummary | null;
        const inventory = (result.inventory || null) as PlotInventorySummary | null;
        const autoSideMapped = Number(result.autoSideMapped || 0);
        const pendingRemoval = inventory?.missingIds.length || 0;
        notify(
          quality
            ? `${Number(result.count || 0)} plots imported · full details ${quality.fullDetailCount}/${quality.total}${autoSideMapped ? ` · ${autoSideMapped} side maps auto-applied` : ""}${pendingRemoval ? ` · ${pendingRemoval} removals pending Publish Update` : ""}`
            : String(Number(result.count || 0)) + " plot records import हुए",
        );
      } else if (kind === "measurementSheet") {
        notify(
          `${Number(result.count || 0)} measurement rows imported · full sides ${Number(result.fullSidesCount || 0)} · verified ${Number(result.verifiedCount || 0)} · review ${Number(result.reviewCount || 0)}`,
        );
      } else if (kind === "roadAccessSheet") {
        notify(String(Number(result.count || 0)) + " plots ka Road Access update hua — बाकी data untouched");
      } else if (kind === "sideMappingSheet") {
        notify(String(Number(result.count || 0)) + " plots ke Front/Back/Depth edges map hue — measurements untouched");
      } else if (kind === "masterplan") {
        notify("Masterplan replace ho gaya — existing polygons/statuses preserve hain");
      } else if (kind === "logo") {
        notify("Project logo save ho gaya — customer site aur Client Admin me sync hoga");
      } else notify("Technical PDF reference save हो गया");
      await reload();
      announceMapperDataUpdated();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload नहीं हुआ";
      notify(
        kind === "masterplan"
          ? "Masterplan " + masterplanStage + " failed: " + message
          : message,
      );
    } finally {
      if (kind === "masterplan") setMasterplanUploadProgress(null);
      setBusy(false);
    }
  }

  function handleMasterplanUploadInput(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Reset only the masterplan picker so selecting the same HD image after a
    // failure always emits a fresh change event. Other uploader contracts stay
    // unchanged.
    input.value = "";
    if (file) void upload(file, "masterplan");
  }


  function clampMapperZoom(value: number) {
    return Math.max(1, Math.min(MAX_MAPPER_ZOOM, value));
  }

  function setMapperZoom(nextValue: number, clientX?: number, clientY?: number) {
    const next = clampMapperZoom(nextValue);
    const wrap = imageWrapRef.current;
    if (
      wrap &&
      typeof clientX === "number" &&
      typeof clientY === "number"
    ) {
      const box = wrap.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        zoomAnchorRef.current = {
          clientX,
          clientY,
          visualX: Math.max(0, Math.min(1, (clientX - box.left) / box.width)),
          visualY: Math.max(0, Math.min(1, (clientY - box.top) / box.height)),
        };
      }
    } else {
      zoomAnchorRef.current = null;
    }
    if (Math.abs(next - zoomRef.current) < 0.0015) {
      zoomAnchorRef.current = null;
      return;
    }
    zoomRef.current = next;
    setZoom(next);
  }

  function zoomAtCanvasCenter(nextValue: number) {
    const canvas = canvasRef.current;
    if (!canvas) {
      setMapperZoom(nextValue);
      return;
    }
    const box = canvas.getBoundingClientRect();
    setMapperZoom(
      nextValue,
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
  }

  function mapperGestureTargetIsHandle(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(".mapper-point-handle"));
  }

  function latestPointerClient(event: {
    clientX: number;
    clientY: number;
    nativeEvent: PointerEvent;
  }) {
    const native = event.nativeEvent;
    try {
      const samples =
        typeof native.getCoalescedEvents === "function"
          ? native.getCoalescedEvents()
          : [];
      const latest = samples.length ? samples[samples.length - 1] : native;
      return { x: latest.clientX, y: latest.clientY };
    } catch {
      return { x: event.clientX, y: event.clientY };
    }
  }

  function currentTouchPair() {
    const touchPoints = [...activeGesturePointersRef.current.values()];
    if (touchPoints.length < 2) return null;
    const [a, b] = touchPoints;
    return {
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      centerX: (a.x + b.x) / 2,
      centerY: (a.y + b.y) / 2,
    };
  }

  function armPanGesture(pointerId: number, x: number, y: number) {
    panGestureRef.current = {
      pointerId,
      startX: x,
      startY: y,
      lastX: x,
      lastY: y,
      moved: false,
    };
  }

  function resetGestureFrameQueue() {
    if (gestureFrameRef.current !== null) {
      cancelAnimationFrame(gestureFrameRef.current);
      gestureFrameRef.current = null;
    }
    if (handleFrameRef.current !== null) {
      cancelAnimationFrame(handleFrameRef.current);
      handleFrameRef.current = null;
    }
    pendingPanRef.current = { x: 0, y: 0 };
    pendingPinchRef.current = null;
    pendingHandleRef.current = null;
    draggingPointRef.current = null;
    if (loupeRef.current) loupeRef.current.style.display = "none";
  }

  function scheduleGestureFrame() {
    if (gestureFrameRef.current !== null) return;
    gestureFrameRef.current = requestAnimationFrame(() => {
      gestureFrameRef.current = null;
      const canvas = canvasRef.current;
      const pinch = pendingPinchRef.current;
      const pan = pendingPanRef.current;
      pendingPinchRef.current = null;
      pendingPanRef.current = { x: 0, y: 0 };
      if (!canvas) return;

      if (pinch) {
        // Finger-center movement and pinch scale are committed together in ONE
        // frame. Tiny sub-pixel tremor is ignored instead of shaking the image.
        if (Math.abs(pinch.panX) >= 0.25) canvas.scrollLeft += pinch.panX;
        if (Math.abs(pinch.panY) >= 0.25) canvas.scrollTop += pinch.panY;
        setMapperZoom(pinch.zoom, pinch.centerX, pinch.centerY);
        return;
      }

      if (Math.abs(pan.x) >= 0.25) canvas.scrollLeft += pan.x;
      if (Math.abs(pan.y) >= 0.25) canvas.scrollTop += pan.y;
    });
  }

  function queuePanDelta(x: number, y: number) {
    pendingPanRef.current = {
      x: pendingPanRef.current.x + x,
      y: pendingPanRef.current.y + y,
    };
    scheduleGestureFrame();
  }

  function queuePinchFrame(
    zoomValue: number,
    centerX: number,
    centerY: number,
    panX: number,
    panY: number,
  ) {
    const pending = pendingPinchRef.current;
    pendingPinchRef.current = {
      zoom: zoomValue,
      centerX,
      centerY,
      panX: (pending?.panX || 0) + panX,
      panY: (pending?.panY || 0) + panY,
    };
    // A pinch owns the frame; stale one-finger delta must never fight it.
    pendingPanRef.current = { x: 0, y: 0 };
    scheduleGestureFrame();
  }

  function handleMapperGesturePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!imageReady || mapperGestureTargetIsHandle(event.target)) return;

    if (event.pointerType === "touch") {
      activeGesturePointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      const pair = currentTouchPair();
      if (pair) {
        // Once a second finger arrives, capture BOTH active pointers so pinch/pan
        // remains stable even when fingers leave the visible image bounds.
        for (const pointerId of activeGesturePointersRef.current.keys()) {
          try {
            event.currentTarget.setPointerCapture(pointerId);
          } catch {
            // An already-ended pointer simply cannot be captured.
          }
        }
        pinchGestureRef.current = {
          startDistance: pair.distance,
          startZoom: zoomRef.current,
          lastCenterX: pair.centerX,
          lastCenterY: pair.centerY,
        };
        panGestureRef.current = null;
        tapStartRef.current = null;
        suppressTapUntilRef.current = Date.now() + 600;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      // In PAN mode one finger moves immediately. In SELECT mode we only start
      // moving after a >10px drag, so a normal tap still creates an exact corner.
      armPanGesture(event.pointerId, event.clientX, event.clientY);
      if (toolMode === "pan" && !calibrationMode) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Keep panning while the pointer remains inside if capture is unavailable.
        }
        event.preventDefault();
        event.stopPropagation();
      }
      // IMPORTANT: SELECT single-tap is deliberately NOT captured here. Its
      // pointerup must still bubble to the SVG tap handler and create a corner.
      return;
    }

    if (toolMode === "pan" && !calibrationMode && event.button === 0) {
      armPanGesture(event.pointerId, event.clientX, event.clientY);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Mouse/pen drag can continue without capture while inside the mapper.
      }
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleMapperGesturePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (mapperGestureTargetIsHandle(event.target)) return;

    const pointer = latestPointerClient(event);

    if (
      event.pointerType === "touch" &&
      activeGesturePointersRef.current.has(event.pointerId)
    ) {
      activeGesturePointersRef.current.set(event.pointerId, {
        x: pointer.x,
        y: pointer.y,
      });
    }

    const pair = currentTouchPair();
    if (pair) {
      let pinch = pinchGestureRef.current;
      if (!pinch) {
        pinch = {
          startDistance: pair.distance,
          startZoom: zoomRef.current,
          lastCenterX: pair.centerX,
          lastCenterY: pair.centerY,
        };
        pinchGestureRef.current = pinch;
      }

      const panX = pinch.lastCenterX - pair.centerX;
      const panY = pinch.lastCenterY - pair.centerY;
      pinch.lastCenterX = pair.centerX;
      pinch.lastCenterY = pair.centerY;

      const nextZoom =
        pinch.startZoom * (pair.distance / Math.max(1, pinch.startDistance));
      tapStartRef.current = null;
      suppressTapUntilRef.current = Date.now() + 600;
      queuePinchFrame(nextZoom, pair.centerX, pair.centerY, panX, panY);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const pan = panGestureRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;

    const totalMovement = Math.hypot(
      pointer.x - pan.startX,
      pointer.y - pan.startY,
    );
    const shouldPan =
      !calibrationMode &&
      (
        toolMode === "pan" ||
        (event.pointerType === "touch" && totalMovement > 10)
      );
    if (!shouldPan) return;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may be unavailable for a pointer that just ended.
    }

    const deltaX = pan.lastX - pointer.x;
    const deltaY = pan.lastY - pointer.y;
    pan.lastX = pointer.x;
    pan.lastY = pointer.y;
    queuePanDelta(deltaX, deltaY);

    if (!pan.moved) {
      pan.moved = true;
      tapStartRef.current = null;
    }
    suppressTapUntilRef.current = Date.now() + 350;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleMapperGesturePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (mapperGestureTargetIsHandle(event.target)) return;

    const pointerWasTracked =
      event.pointerType === "touch" &&
      activeGesturePointersRef.current.has(event.pointerId);
    const wasPinching =
      Boolean(pinchGestureRef.current) ||
      activeGesturePointersRef.current.size >= 2;
    const pan = panGestureRef.current;
    const wasPanning =
      Boolean(pan && pan.pointerId === event.pointerId && pan.moved);

    if (pointerWasTracked) activeGesturePointersRef.current.delete(event.pointerId);

    const blockTap =
      wasPinching ||
      wasPanning ||
      Date.now() < suppressTapUntilRef.current;
    if (blockTap) {
      tapStartRef.current = null;
      suppressTapUntilRef.current = Date.now() + 350;
      event.preventDefault();
      event.stopPropagation();
    }

    if (activeGesturePointersRef.current.size < 2) {
      pinchGestureRef.current = null;
    }

    const remaining = [...activeGesturePointersRef.current.entries()][0];
    if (remaining) {
      const [pointerId, point] = remaining;
      armPanGesture(pointerId, point.x, point.y);
    } else if (!pan || pan.pointerId === event.pointerId) {
      panGestureRef.current = null;
    }

    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Nothing to release.
    }
  }

  function handleMapperGesturePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (mapperGestureTargetIsHandle(event.target)) return;
    resetGestureFrameQueue();
    activeGesturePointersRef.current.delete(event.pointerId);
    panGestureRef.current = null;
    pinchGestureRef.current = null;
    tapStartRef.current = null;
    suppressTapUntilRef.current = Date.now() + 350;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleMapperLostPointerCapture(event: React.PointerEvent<HTMLDivElement>) {
    activeGesturePointersRef.current.delete(event.pointerId);
    if (panGestureRef.current?.pointerId === event.pointerId) {
      panGestureRef.current = null;
    }
    if (activeGesturePointersRef.current.size < 2) {
      pinchGestureRef.current = null;
    }
  }

  function sourcePointFromDisplay(point: MapperPoint): MapperPoint {
    const [x, y] = point;
    // Exact inverse of displayPoint. A tap made on a rotated view is converted
    // back to source-image coordinates before snap/save, so live SVG/2D/3D stay correct.
    if (rotation === 1) return [y, 1 - x];
    if (rotation === 2) return [1 - x, 1 - y];
    if (rotation === 3) return [1 - y, x];
    return [x, y];
  }

  function rotateMapperView(direction: -1 | 1) {
    const next = ((rotation + direction + 4) % 4) as 0 | 1 | 2 | 3;
    setRotation(next);
    try {
      window.localStorage.setItem(`rekixo:mapper-rotation:${projectId}`, String(next));
    } catch {
      // Local preference is optional; mapping must keep working.
    }
    if (!completedProject) {
      void persistMapperSettings({ publicRotation: String(next) }).catch((error) => {
        notify(
          error instanceof Error ? error.message : "Public rotation save nahi hui",
        );
      });
    }
    // A quarter turn changes portrait/landscape bounds. Fit once, then user can zoom again.
    resetGestureFrameQueue();
    activeGesturePointersRef.current.clear();
    panGestureRef.current = null;
    pinchGestureRef.current = null;
    zoomAnchorRef.current = null;
    tapStartRef.current = null;
    suppressTapUntilRef.current = Date.now() + 250;
    zoomRef.current = 1;
    setZoom(1);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.scrollLeft = 0;
          canvas.scrollTop = 0;
        }
      });
    });
  }

  function resetMapperView() {
    resetGestureFrameQueue();
    activeGesturePointersRef.current.clear();
    panGestureRef.current = null;
    pinchGestureRef.current = null;
    zoomAnchorRef.current = null;
    tapStartRef.current = null;
    suppressTapUntilRef.current = Date.now() + 250;
    zoomRef.current = 1;
    setZoom(1);
    setRotation(0);
    if (!completedProject) {
      void persistMapperSettings({ publicRotation: "0" }).catch((error) => {
        notify(
          error instanceof Error ? error.message : "Public rotation reset nahi hui",
        );
      });
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.scrollLeft = 0;
          canvas.scrollTop = 0;
        }
      });
    });
    try {
      window.localStorage.setItem(`rekixo:mapper-rotation:${projectId}`, "0");
    } catch {
      // Ignore private-mode/localStorage failures.
    }
  }

  function svgPointFromClient(clientX: number, clientY: number): MapperPoint | null {
    const wrap = imageWrapRef.current;
    if (!wrap) return null;
    const box = wrap.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const visual: MapperPoint = [
      Math.max(0, Math.min(1, (clientX - box.left) / box.width)),
      Math.max(0, Math.min(1, (clientY - box.top) / box.height)),
    ];
    // Rotation is view-only. Convert the visible portrait/landscape coordinates
    // back into the original masterplan coordinate system before snapping/saving.
    return sourcePointFromDisplay(visual);
  }

  function precisePoint(raw: MapperPoint) {
    const wrap = imageWrapRef.current;
    if (!wrap) return raw;
    const box = wrap.getBoundingClientRect();
    const sourceRenderedWidth = rotation === 1 || rotation === 3 ? box.height : box.width;
    const sourceRenderedHeight = rotation === 1 || rotation === 3 ? box.width : box.height;
    const snapThresholdPx = Math.max(
      8,
      Math.min(18, 18 / Math.sqrt(Math.max(1, zoomRef.current))),
    );
    return snapPoint(
      raw,
      mappedPolygons,
      sourceRenderedWidth,
      sourceRenderedHeight,
      snapThresholdPx,
    ).point;
  }

  function imageTap(point: MapperPoint) {
    if (completedProject) return;
    if (calibrationMode) {
      if (!pendingCadPoint) {
        notify("पहले CAD preview में reference point tap करें");
        return;
      }
      setCalibrationPairs((current) => [
        ...current.slice(0, 11),
        { source: pendingCadPoint, target: point },
      ]);
      setPendingCadPoint(null);
      notify(
        calibrationPairs.length + 1 >= 4
          ? "Calibration ready — overlay check करें, जरूरत हो तो extra pair जोड़ें"
          : `Pair ${calibrationPairs.length + 1} saved — अगला CAD point चुनें`,
      );
      return;
    }
    if (toolMode !== "select") return;
    if (manualPhase !== "select") return;
    const snapped = precisePoint(point);
    setPoints((current) => {
      if (shape === "quad") {
        if (current.length >= 4) return [snapped];
        const next = [...current, snapped];
        if (next.length === 4) {
          frontFirstPendingRef.current = true;
          setManualPhase("details");
        }
        return next;
      }
      return current.length < 80 ? [...current, snapped] : current;
    });
  }

  function handleImagePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!calibrationMode && toolMode !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    tapStartRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }

  function handleImagePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (!calibrationMode && toolMode !== "select") return;
    if (Date.now() < suppressTapUntilRef.current) {
      tapStartRef.current = null;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const start = tapStartRef.current;
    tapStartRef.current = null;
    if (!start || start.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
    const point = svgPointFromClient(event.clientX, event.clientY);
    if (point) imageTap(point);
  }

  function renderHandlePreview(
    index: number,
    point: MapperPoint,
    element: HTMLButtonElement,
  ) {
    const next = pointsRef.current.map((item, cursor) =>
      cursor === index ? point : item,
    );
    pointsRef.current = next;

    element.style.left = `${point[0] * 100}%`;
    element.style.top = `${point[1] * 100}%`;

    const draft = imageWrapRef.current?.querySelector<SVGPolygonElement>("polygon.draft");
    if (draft && next.length >= 2) {
      draft.setAttribute(
        "points",
        next.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" "),
      );
    }

    const loupe = loupeRef.current;
    if (loupe) {
      loupe.style.display = "block";
      loupe.style.backgroundImage = `url(${imageUrl})`;
      loupe.style.backgroundSize = `${Math.max(4, zoomRef.current * 4) * 100}% auto`;
      loupe.style.backgroundPosition = `${point[0] * 100}% ${point[1] * 100}%`;
      loupe.style.transform = `rotate(${rotation * 90}deg)`;
    }
  }

  function flushPendingHandleFrame() {
    if (handleFrameRef.current !== null) {
      cancelAnimationFrame(handleFrameRef.current);
      handleFrameRef.current = null;
    }
    const pending = pendingHandleRef.current;
    pendingHandleRef.current = null;
    if (!pending || draggingPointRef.current !== pending.index) return;
    const point = svgPointFromClient(pending.clientX, pending.clientY);
    if (!point) return;
    renderHandlePreview(
      pending.index,
      precisePoint(point),
      pending.element,
    );
  }

  function queueHandleFrame(
    index: number,
    clientX: number,
    clientY: number,
    element: HTMLButtonElement,
  ) {
    pendingHandleRef.current = { index, clientX, clientY, element };
    if (handleFrameRef.current !== null) return;
    handleFrameRef.current = requestAnimationFrame(() => {
      handleFrameRef.current = null;
      const pending = pendingHandleRef.current;
      pendingHandleRef.current = null;
      if (!pending || draggingPointRef.current !== pending.index) return;
      const point = svgPointFromClient(pending.clientX, pending.clientY);
      if (!point) return;
      renderHandlePreview(
        pending.index,
        precisePoint(point),
        pending.element,
      );
    });
  }

  function dragHandle(event: React.PointerEvent<HTMLButtonElement>, index: number) {
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Keep drag inside the mapper if capture is unavailable.
    }
    draggingPointRef.current = index;
    const pointer = latestPointerClient(event);
    queueHandleFrame(index, pointer.x, pointer.y, event.currentTarget);
  }

  function moveHandle(event: React.PointerEvent<HTMLButtonElement>, index: number) {
    if (draggingPointRef.current !== index) return;
    event.preventDefault();
    event.stopPropagation();
    const pointer = latestPointerClient(event);
    queueHandleFrame(index, pointer.x, pointer.y, event.currentTarget);
  }

  function endHandle(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    flushPendingHandleFrame();
    if (draggingPointRef.current !== null) {
      setPoints(pointsRef.current.map(([x, y]) => [x, y] as MapperPoint));
      resetGeometryDerivedSideAssignments();
    }
    draggingPointRef.current = null;
    if (loupeRef.current) loupeRef.current.style.display = "none";
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Nothing to release.
    }
  }

  async function verifyPlotPersistence(saved: Plot) {
    const expected = parsePolygon(saved);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const verifyResponse = await fetch(
        `/api/super-mapper?projectId=${encodeURIComponent(projectId)}&verify=${Date.now()}`,
        { cache: "no-store" },
      );
      const verifyData = await apiResult(verifyResponse);
      const verifiedPlots = (verifyData.plots || []) as Plot[];
      const persisted = verifiedPlots.find((item) => item.id === saved.id);
      if (persisted) {
        const actual = parsePolygon(persisted);
        const sameGeometry =
          expected.length === actual.length &&
          expected.every(
            (point, index) =>
              Math.abs(point[0] - actual[index][0]) <= 1e-9 &&
              Math.abs(point[1] - actual[index][1]) <= 1e-9,
          );
        const sameOptionalNumber = (left: number | null | undefined, right: number | null | undefined) =>
          left == null && right == null
            ? true
            : left != null && right != null && Math.abs(Number(left) - Number(right)) <= 1e-9;
        const sameMetadata =
          sameOptionalNumber(saved.front, persisted.front) &&
          sameOptionalNumber(saved.depth, persisted.depth) &&
          sameOptionalNumber(saved.back, persisted.back) &&
          sameOptionalNumber(saved.depth2, persisted.depth2) &&
          String(saved.dimensionUnit || "") === String(persisted.dimensionUnit || "") &&
          (saved.frontEdgeIndex == null && persisted.frontEdgeIndex == null
            ? true
            : Number(saved.frontEdgeIndex) === Number(persisted.frontEdgeIndex)) &&
          (saved.depthEdgeIndex == null && persisted.depthEdgeIndex == null
            ? true
            : Number(saved.depthEdgeIndex) === Number(persisted.depthEdgeIndex)) &&
          (saved.backEdgeIndex == null && persisted.backEdgeIndex == null
            ? true
            : Number(saved.backEdgeIndex) === Number(persisted.backEdgeIndex)) &&
          (saved.depth2EdgeIndex == null && persisted.depth2EdgeIndex == null
            ? true
            : Number(saved.depth2EdgeIndex) === Number(persisted.depth2EdgeIndex)) &&
          String(saved.frontLabel || "") === String(persisted.frontLabel || "") &&
          String(saved.depthLabel || "") === String(persisted.depthLabel || "") &&
          String(saved.backLabel || "") === String(persisted.backLabel || "") &&
          String(saved.depth2Label || "") === String(persisted.depth2Label || "") &&
          String(saved.sideDimensions || "") === String(persisted.sideDimensions || "") &&
          String(saved.edgeSemantics || "") === String(persisted.edgeSemantics || "");
        if (sameGeometry && sameMetadata) return { plot: persisted, plots: verifiedPlots };
      }
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
      }
    }
    throw new Error(
      `Plot ${saved.id} server read-back verify नहीं हुआ. Current shape screen/draft में सुरक्षित है; आगे नहीं बढ़ाया गया.`,
    );
  }

  async function verifyAllBoundariesCleared() {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const verifyResponse = await fetch(
        `/api/super-mapper?projectId=${encodeURIComponent(projectId)}&verify=${Date.now()}`,
        { cache: "no-store" },
      );
      const verifyData = await apiResult(verifyResponse);
      const verifiedPlots = (verifyData.plots || []) as Plot[];
      if (!verifiedPlots.some((plot) => String(plot.polygon || "").trim())) {
        return verifiedPlots;
      }
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
      }
    }
    throw new Error(
      "Clear all server read-back verify नहीं हुआ। दोबारा try करें; कोई plot detail/status नहीं बदला गया।",
    );
  }

  async function createInventoryPlots(rows: Array<{id:string;dimensions:string;front:number;back:number;depth:number;depth2:number;dimensionUnit:"ft";sqft:number;road:string;notes:string}>) {
    setBusy(true);
    try {
      const response = await fetch("/api/super-mapper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, action: "add_inventory_plots", newPlots: rows }),
      });
      const result = await apiResult(response);
      const created = (result.plots || []) as Plot[];
      setPlots((current) => [...current, ...created].sort(plotSort));
      setLastVerifiedId("");
      const first = [...created].sort(plotSort)[0];
      if (first) {
        setPlotId(first.id);
        setDimensions(first.dimensions || "");
        setSqft(first.sqft ? String(first.sqft) : "");
        setRoad(first.road || "");
        setFront(first.front == null ? "" : String(first.front));
        setBack(first.back == null ? "" : String(first.back));
        setDepth(first.depth == null ? "" : String(first.depth));
        setDepth2(first.depth2 == null ? "" : String(first.depth2));
        setDimensionUnit("ft");
        setPoints([]);
        setEditingId("");
        setSideLayout("four");
        resetGeometryDerivedSideAssignments();
        setManualPhase("select");
        setToolMode("select");
      }
      notify(`${Number(result.count || 0)} new shops inventory me add hui. Ab dropdown se ek-ek shop select karke boundary map karein.`);
      await reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "New shops add nahi hui");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPlot() {
    const id = cleanPlotId(plotId);
    const existing = plots.find((plot) => plot.id === editingId || plot.id === id);
    const parsedArea = Number(sqft);
    const area = Number.isFinite(parsedArea) && parsedArea > 0
      ? parsedArea
      : Number(existing?.sqft || 0);
    if (!id) return notify("Plot number जरूरी है");
    if (points.length < 3) return notify("पहले plot boundary पूरी select करें");
    if (shape === "quad" && points.length !== 4)
      return notify("4-corner plot के चारों corners select करें");
    if (polygonSelfIntersects(points))
      return notify("Shape cross हो रही है — corner order/handles ठीक करें");
    if (!editingId && plots.some((plot) => plot.id === id && plot.polygon)) {
      return notify(`${id} पहले से mapped है — list से Edit करें`);
    }
    if (editingId && id !== editingId && plots.some((plot) => plot.id === id)) {
      return notify(`Plot ${id} inventory में पहले से मौजूद है`);
    }
    const resolvedSideLayout = effectiveSideLayout();
    const frontValue = front.trim() ? Number(front) : null;
    const backValue = back.trim() ? Number(back) : null;
    const depthValue = depth.trim() ? Number(depth) : null;
    const depth2Value =
      resolvedSideLayout === "three"
        ? null
        : depth2.trim()
          ? Number(depth2)
          : null;
    let roleEdges = currentSemanticRoles();
    if (resolvedSideLayout === "three") roleEdges.depthB = [];
    let edgeValue = roleEdges.front[0] ?? null;
    let backEdgeValue = roleEdges.back[0] ?? null;
    let depthEdgeValue = roleEdges.depthA[0] ?? null;
    let depth2EdgeValue = roleEdges.depthB[0] ?? null;

    if (
      edgeValue === null &&
      backEdgeValue === null &&
      depthEdgeValue === null &&
      depth2EdgeValue === null &&
      points.length >= 4
    ) {
      // Do not fabricate "edge 0 = Front" for cloned or edited geometry.
      // Fresh front-first tapping already commits semantics through the dedicated
      // effect; fallback resolution here may only use target-specific metadata.
      const storedDirection = plotFrontDirections[id];
      const resolved =
        storedDirection
          ? resolveFourSideEdges(
              points,
              storedDirection,
              normalizeQuarterTurn(settings.publicRotation),
            )
          : null;
      if (resolved) {
        const parsed = parsePlotSideSemantics(resolved.edgeSemantics, points.length);
        roleEdges = {
          front: [...(parsed?.roles.front || [resolved.front])],
          back: [...(parsed?.roles.back || [resolved.back])],
          depthA: [...(parsed?.roles.depthA || [resolved.depthA])],
          depthB: [...(parsed?.roles.depthB || [resolved.depthB])],
        };
        edgeValue = roleEdges.front[0] ?? null;
        backEdgeValue = roleEdges.back[0] ?? null;
        depthEdgeValue = roleEdges.depthA[0] ?? null;
        depth2EdgeValue = roleEdges.depthB[0] ?? null;
      }
    }
    if (frontValue !== null && (!Number.isFinite(frontValue) || frontValue <= 0))
      return notify("Front positive number hona chahiye");
    if (backValue !== null && (!Number.isFinite(backValue) || backValue <= 0))
      return notify("Back positive number hona chahiye");
    if (depthValue !== null && (!Number.isFinite(depthValue) || depthValue <= 0))
      return notify("Depth A positive number hona chahiye");
    if (depth2Value !== null && (!Number.isFinite(depth2Value) || depth2Value <= 0))
      return notify("Depth B positive number hona chahiye");

    const allRoleEdges = (Object.entries(roleEdges) as [PlotSideRole, number[]][]).flatMap(
      ([role, edges]) => edges.map((edge) => ({ role, edge })),
    );
    if (
      allRoleEdges.some(
        ({ edge }) =>
          !Number.isInteger(edge) || edge < 0 || edge >= points.length,
      )
    )
      return notify("Front / Back / Depth side group me invalid polygon edge hai");
    if (frontValue !== null && !roleEdges.front.length)
      return notify("Front/Depth save karne se pehle road-facing Front edge/chain select karein");

    const seenRoleByEdge = new Map<number, PlotSideRole>();
    for (const { role, edge } of allRoleEdges) {
      const existingRole = seenRoleByEdge.get(edge);
      if (existingRole && existingRole !== role)
        return notify("Same boundary segment do alag side roles me assign nahi ho sakta");
      seenRoleByEdge.set(edge, role);
    }

    const originalPointCount = existing ? parsePolygon(existing).length : points.length;
    if (
      existing &&
      originalPointCount >= 3 &&
      originalPointCount !== points.length &&
      allRoleEdges.length
    )
      return notify(
        "Plot corner count badla hai — logical Front / Back / Depth sides dobara select karein",
      );

    // Preserve project-facing metadata together with logical side geometry.
    // Previously this save path serialized only roles/layout, which silently
    // dropped the compass-selected second facing during "Update plot".
    const facingMetadata = normalizedFacingMetadata(
      roleEdges,
      resolvedSideLayout,
    );
    const edgeSemantics = serializePlotSideSemantics(
      points.length,
      roleEdges,
      resolvedSideLayout,
      facingMetadata.roadFacingRoles,
      facingMetadata.facingDirectionOverrides,
    );

    // Explicit Mapping Controls updates reconcile display text with numeric
    // values, even when the numeric draft had already been saved earlier.
    const manualLabel = (
      value: number | null,
      previousValue: number | null | undefined,
      label: string | null | undefined,
    ) => controlsWorkspace
      ? syncManualDimensionLabel(value, previousValue, label, dimensionUnit, existing?.dimensionUnit)
      : label || null;
    const previousLabels = [
      existing?.frontLabel, existing?.backLabel, existing?.depthLabel, existing?.depth2Label,
    ];
    const nextLabels = controlsWorkspace
      ? [
          manualLabel(frontValue, existing?.front, existing?.frontLabel),
          manualLabel(backValue, existing?.back, existing?.backLabel),
          manualLabel(depthValue, existing?.depth, existing?.depthLabel),
          manualLabel(depth2Value, existing?.depth2, existing?.depth2Label),
        ]
      : previousLabels;
    const anySideEdited = controlsWorkspace && nextLabels.some(
      (label, index) => (label || "") !== (previousLabels[index] || ""),
    );

    const unchangedInventoryArea =
      Boolean(existing) && area > 0 && Math.abs(Number(existing?.sqft || 0) - area) < 0.0001;
    const plot: Plot = {
      id,
      sqft: area,
      sqm: area > 0
        ? unchangedInventoryArea
          ? Number(existing?.sqm || sqftToSqm(area, sqmToSqftFactor))
          : sqftToSqm(area, sqmToSqftFactor)
        : Number(existing?.sqm || 0),
      sqyd: area > 0
        ? unchangedInventoryArea
          ? Number(existing?.sqyd || sqmToSqyd(sqftToSqm(area, sqmToSqftFactor)))
          : sqmToSqyd(sqftToSqm(area, sqmToSqftFactor))
        : Number(existing?.sqyd || 0),
      dimensions: dimensions.trim() || existing?.dimensions || "",
      road: road.trim() || existing?.road || "",
      front: frontValue,
      depth: depthValue,
      back: backValue,
      depth2: resolvedSideLayout === "three" ? null : depth2Value,
      dimensionUnit:
        frontValue !== null ||
        backValue !== null ||
        depthValue !== null ||
        depth2Value !== null
          ? dimensionUnit
          : null,
      frontEdgeIndex: edgeValue,
      depthEdgeIndex: depthEdgeValue,
      backEdgeIndex: backEdgeValue,
      depth2EdgeIndex: resolvedSideLayout === "three" ? null : depth2EdgeValue,
      frontLabel: nextLabels[0],
      depthLabel: nextLabels[2],
      backLabel: nextLabels[1],
      depth2Label: resolvedSideLayout === "three" ? null : nextLabels[3],
      // Old aggregate source text can contradict newly corrected individual sides.
      sideDimensions: anySideEdited ? null : existing?.sideDimensions || null,
      edgeSemantics,
      status: existing?.status || "available",
      notes: existing?.notes || "",
      featured: existing?.featured || false,
      polygon: JSON.stringify(points),
    };
    setBusy(true);
    try {
      const response = await fetch("/api/super-mapper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, plot }),
      });
      const result = await apiResult(response);
      const saved = result.plot as Plot;

      // Never clear the draft or advance to the next plot until a second,
      // no-cache server read confirms the exact polygon that was just written.
      const verified = await verifyPlotPersistence(saved);
      setPlots(verified.plots);
      setLastVerifiedId(verified.plot.id);
      announceMapperDataUpdated();
      try {
        window.localStorage.removeItem(mappingDraftKey(projectId, verified.plot.id));
      } catch {
        // Ignore local draft cleanup failures.
      }
      if (controlsWorkspace) {
        loadPlotDetails(verified.plot, true);
        notify(`Plot ${verified.plot.id} manual details SERVER VERIFIED ✓`);
      } else {
        setToolMode("pan");
        const hasNextInventoryPlot = selectNextPlot(
        verified.plot.id,
        verified.plots,
      );
        notify(
          hasNextInventoryPlot
            ? `Plot ${verified.plot.id} SERVER VERIFIED ✓ — next inventory plot open`
            : `Plot ${verified.plot.id} SERVER VERIFIED ✓ — all ${verified.plots.length} inventory plots mapped`,
        );
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Plot save नहीं हुआ");
    } finally {
      setBusy(false);
    }
  }

  async function remove(plot: Plot) {
    if (!confirm(`Plot ${plot.id} की saved clickable boundary हटाएँ? Plot details/status सुरक्षित रहेंगे।`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/super-mapper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "clear_plot_boundary",
          plot: { id: plot.id },
        }),
      });
      const result = await apiResult(response);
      const saved = result.plot as Plot;

      // Clearing a mapped plot is also a persistent mutation. Do not tell the
      // operator it is gone until a second no-cache read confirms polygon="".
      const verified = await verifyPlotPersistence(saved);
      setPlots(verified.plots);
      setLastVerifiedId(verified.plot.id);
      announceMapperDataUpdated();
      setPoints([]);
      setEditingId("");
      setManualPhase("select");
      setToolMode("select");
      try {
        window.localStorage.removeItem(mappingDraftKey(projectId, verified.plot.id));
      } catch {
        // Local draft cleanup is best-effort; server data is already verified.
      }
      loadPlotDetails({ ...verified.plot, polygon: "" }, false);
      notify(`Plot ${verified.plot.id} boundary SERVER VERIFIED removed ✓; side bindings reset · details/status सुरक्षित हैं`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Boundary नहीं हटी");
    } finally {
      setBusy(false);
    }
  }

  function requestClearAllSelections() {
    if (!mappedPlots.length) {
      notify("Clear करने के लिए कोई saved selection नहीं है");
      return;
    }
    setClearAllConfirmOpen(true);
  }

  async function clearAllSelections() {
    const mappedCount = mappedPlots.length;
    if (!mappedCount) {
      setClearAllConfirmOpen(false);
      return notify("Clear करने के लिए कोई saved selection नहीं है");
    }

    setClearAllConfirmOpen(false);
    setBusy(true);
    try {
      const response = await fetch("/api/super-mapper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "clear_all_polygons",
          confirmation: `CLEAR ${projectId}`,
        }),
      });
      const result = await apiResult(response);
      const verifiedPlots = await verifyAllBoundariesCleared();

      setPlots(verifiedPlots);
      setPoints([]);
      setEditingId("");
      setManualPhase("select");
      setToolMode("select");
      setLastVerifiedId("");
      setExcludedAutoIds(new Set());
      announceMapperDataUpdated();
      try {
        for (const plot of plots) {
          window.localStorage.removeItem(mappingDraftKey(projectId, plot.id));
        }
        window.localStorage.removeItem(mappingDraftKey(projectId, plotId));
      } catch {
        // Local draft cleanup is best-effort; the server clear is already verified.
      }

      const firstPlot = [...verifiedPlots].sort(plotSort)[0];
      if (firstPlot) loadPlotDetails(firstPlot, false);
      else {
        setPlotId("1");
        setDimensions("");
        setSqft("");
        setRoad("");
      }
      notify(
        `${typeof result.cleared === "number" ? result.cleared : mappedCount} selections SERVER VERIFIED removed ✓; details/status सुरक्षित हैं`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Clear all selections नहीं हुआ");
    } finally {
      setBusy(false);
    }
  }

  function cadTap(event: React.PointerEvent<SVGSVGElement>) {
    if (!calibrationMode || completedProject) return;
    const box = event.currentTarget.getBoundingClientRect();
    const point: MapperPoint = [
      Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    ];
    setPendingCadPoint(point);
    notify("अब masterplan image पर यही reference point tap करें");
    canvasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveCalibration() {
    if (calibrationPairs.length < 4 || !liveMatrix)
      return notify("पहले 4 दूर-दूर calibration pairs बनाएं");
    const error = calibrationPairs.length >= 4 ? calibrationError(liveMatrix, calibrationPairs) : 0;
    setBusy(true);
    try {
      const response = await fetch("/api/super-mapper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          settings: {
            homography: JSON.stringify(liveMatrix),
            calibrationPairs: JSON.stringify(calibrationPairs),
            calibrationError: String(error),
            cadMatchedCount: String(acceptedAutoMatches.length),
            cadReviewCount: String(reviewPlots.length),
          },
        }),
      });
      await apiResult(response);
      setSettings((current) => ({
        ...current,
        homography: JSON.stringify(liveMatrix),
        calibrationPairs: JSON.stringify(calibrationPairs),
        calibrationError: String(error),
        cadMatchedCount: String(acceptedAutoMatches.length),
        cadReviewCount: String(reviewPlots.length),
      }));
      setCalibrationMode(false);
      notify(`Calibration saved — ${acceptedAutoMatches.length} Auto-ready, ${reviewPlots.length} Review`);
    } catch (errorValue) {
      notify(errorValue instanceof Error ? errorValue.message : "Calibration save नहीं हुई");
    } finally {
      setBusy(false);
    }
  }

  async function publishAutoMatches() {
    const pending = acceptedAutoMatches.filter((match) => !match.plot.polygon);
    if (!pending.length) return notify("Auto-matched new plots बाकी नहीं हैं");
    if (!confirm(`${pending.length} matched plots को clickable 2D + 3D publish करें?`)) return;
    setBusy(true);
    try {
      const payload = pending.map(({ plot, points: polygon }) => ({
        ...plot,
        // CAD auto-match creates new geometry. Preserve source measurements,
        // but force geometry-derived side bindings to be resolved for this polygon.
        frontEdgeIndex: null,
        backEdgeIndex: null,
        depthEdgeIndex: null,
        depth2EdgeIndex: null,
        edgeSemantics: null,
        polygon: JSON.stringify(
          polygon.map(([x, y]) => [
            Math.max(0, Math.min(1, x)),
            Math.max(0, Math.min(1, y)),
          ]),
        ),
      }));
      const response = await fetch("/api/super-mapper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, plots: payload }),
      });
      const result = await apiResult(response);
      const saved = (result.plots || []) as Plot[];
      const byId = new Map(saved.map((plot) => [plot.id, plot]));
      setPlots((current) => current.map((plot) => byId.get(plot.id) || plot));
      announceMapperDataUpdated();
      notify(`${saved.length} plots एक साथ 2D + 3D clickable publish हुए`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Auto publish नहीं हुआ");
    } finally {
      setBusy(false);
    }
  }

  const currentPlot = plots.find((plot) => plot.id === plotId);
  const currentHasSavedBoundary = Boolean(
    currentPlot && parsePolygon(currentPlot).length >= 3,
  );

  const savedCurrentPolygon = currentPlot ? parsePolygon(currentPlot) : [];
  const measurementOverlayPoints =
    points.length >= 3 ? points : savedCurrentPolygon.length >= 3 ? savedCurrentPolygon : [];
  const measurementOverlayRoles: PlotSideRoleEdges =
    points.length >= 3
      ? currentSemanticRoles()
      : savedPlotSemanticRoles(currentPlot, savedCurrentPolygon);

  // After a verified save the mapper normally advances to the next inventory
  // plot. Keep the just-saved polygon's side measurements visible on the mapped
  // layer so the operator can visually verify the final result without reopening it.
  const lastVerifiedPlot =
    lastVerifiedId && lastVerifiedId !== plotId
      ? plots.find((plot) => plot.id === lastVerifiedId) || null
      : null;
  const lastVerifiedPolygon = lastVerifiedPlot ? parsePolygon(lastVerifiedPlot) : [];
  const lastVerifiedLayout =
    lastVerifiedPlot && lastVerifiedPolygon.length >= 3
      ? resolvedPlotSideLayout(lastVerifiedPlot, lastVerifiedPolygon)
      : "four";
  const lastVerifiedRoles = savedPlotSemanticRoles(
    lastVerifiedPlot,
    lastVerifiedPolygon,
  );

  const currentRoleMeasurementText = (role: PlotSideRole) => {
    const liveValue =
      role === "front" ? front :
      role === "back" ? back :
      role === "depthA" ? depth : depth2;
    const savedValue =
      role === "front" ? currentPlot?.front :
      role === "back" ? currentPlot?.back :
      role === "depthA" ? currentPlot?.depth : currentPlot?.depth2;
    const savedLabel =
      role === "front" ? currentPlot?.frontLabel :
      role === "back" ? currentPlot?.backLabel :
      role === "depthA" ? currentPlot?.depthLabel : currentPlot?.depth2Label;
    const roleName =
      role === "front" ? "Front" :
      role === "back" ? "Back" :
      role === "depthA"
        ? effectiveSideLayout() === "three" ? "Depth" : "Depth A"
        : "Depth B";
    const raw = String(liveValue || "").trim();
    if (!raw) return "";
    const numeric = Number(raw);
    const savedNumeric = savedValue == null ? null : Number(savedValue);
    const canUsePreciseSavedLabel =
      Boolean(String(savedLabel || "").trim()) &&
      Number.isFinite(numeric) &&
      savedNumeric != null &&
      Number.isFinite(savedNumeric) &&
      Math.abs(numeric - savedNumeric) <= 1e-9;
    const measurement = canUsePreciseSavedLabel
      ? String(savedLabel).trim()
      : `${raw} ${dimensionUnit}`;
    return `${roleName} · ${measurement}`;
  };

  const currentCenter = points.length ? polygonCenter(points) : null;
  const shapeInvalid = points.length >= 4 && polygonSelfIntersects(points);
  const shapeReady = points.length >= 3 && (shape === "polygon" || points.length === 4) && !shapeInvalid;
  const rotationDegrees = rotation * 90;
  const rotationSwapsAxes = rotation === 1 || rotation === 3;
  // Prefer dimensions decoded from the ACTUAL displayed mapping image. Stored
  // original dimensions are fallback only; mapping dimensions are final fallback.
  const sourceWidth =
    naturalImageSize?.width ||
    settingsNumber(settings.masterplanOriginalWidth, mapWidth);
  const sourceHeight =
    naturalImageSize?.height ||
    settingsNumber(settings.masterplanOriginalHeight, mapHeight);
  const sourceAspect = sourceWidth / sourceHeight;

  const mapperAspectRatio = rotationSwapsAxes
    ? `${sourceHeight} / ${sourceWidth}`
    : `${sourceWidth} / ${sourceHeight}`;

  // 100% = complete undistorted image fit. Zoom only scales this base; it never
  // changes proportions. For 90/270 the OUTER viewport swaps axes.
  const visualAspect = rotationSwapsAxes ? 1 / sourceAspect : sourceAspect;
  const mapperViewportWidth =
    `min(${zoom * 100}%, ${(zoom * 58 * visualAspect).toFixed(4)}vh)`;

  // REKIXO_MAPPER_ZOOM_STABLE_LABELS_V1
  // The whole SVG scales linearly with mapper zoom. Counter-scale ONLY the
  // assistive mapped-plot labels so 1800% zoom cannot turn "29" into a giant
  // overlay that hides adjacent plot boundaries. Geometry itself stays untouched.
  const mappedPlotLabelZoom = Math.max(1, zoom);
  const mappedPlotLabelStyle = {
    fontSize: `${(MAPPER_LABEL_SCREEN_FONT_PX / mappedPlotLabelZoom).toFixed(4)}px`,
    strokeWidth: `${(MAPPER_LABEL_SCREEN_STROKE_PX / mappedPlotLabelZoom).toFixed(4)}px`,
  };

  // Image, SVG, saved polygons and handles all live on the exact same natural-ratio
  // source plane. Quarter-turn rotation changes orientation, never geometry ratio.
  const sourceSceneWidth = rotationSwapsAxes
    ? `${sourceAspect * 100}%`
    : "100%";
  const sourceSceneAspectRatio = `${sourceWidth} / ${sourceHeight}`;

  function renderMappingControlsCard() {
    return (
        <div className="card manual-fallback-card">
          <div className="manual-fallback-head">
            <div>
              <small>PLOT MAPPING CONTROLS</small>
              <h3>{currentPlot ? `Plot ${currentPlot.id}` : `Plot ${plotId}`}</h3>
              <p>
                {controlsWorkspace
                  ? "Mapped plot select karke Dimensions, Area, Facing/Road aur Front/Back/Depth size manually update karein."
                  : "Main image source of truth है. Plot को full zoom करें, corners clockwise mark करें, handles से exact boundary fit करके Confirm करें."}
              </p>
            </div>
            <select value={plotId} onChange={(event) => {
              const id = event.target.value;
              const plot = plots.find((item) => item.id === id);
              if (plot) loadPlotDetails(plot, Boolean(plot.polygon));
              else setPlotId(id);
            }}>
              {plots.length ? (controlsWorkspace ? mappedPlots : inventoryPlots).map((plot) => <option key={plot.id} value={plot.id}>{plot.id} · {plot.polygon ? "mapped" : autoMatchIds.has(plot.id) ? "auto" : "review"}</option>) : <option value={plotId}>{plotId}</option>}
            </select>
          </div>

          {manualPhase === "select" ? <>
            <div className="mapper-mode">
              <button className={shape === "quad" ? "active" : ""} onClick={beginFourCornerBoundary}>
                <FourCornerIcon />Front-first plot · 4 corners
              </button>
              <button className={shape === "polygon" ? "active" : ""} onClick={beginIrregularBoundary}>
                <IrregularCornerIcon />Irregular · corner taps
              </button>
            </div>
            <div className="mapper-actions compact">
              <button disabled={!points.length} onClick={undoPoint}><Undo2 />Undo</button>
              <button
                disabled={busy || (!points.length && !currentHasSavedBoundary)}
                onClick={clearCurrentSelection}
              >{currentHasSavedBoundary ? "Remove saved boundary" : "Clear"}</button>
              <button onClick={clonePreviousShape}><Copy />Clone previous</button>
              {shape === "polygon" && <button
                className="primary"
                disabled={points.length < 3}
                onClick={completeIrregularBoundary}
              ><CheckCircle2 />Boundary complete</button>}
            </div>
            <small className="mapper-help">4-corner plot: Tap 1 + Tap 2 road-facing Front boundary ke dono endpoints par karein, phir same direction me clockwise baki 2 corners tap karein. Rekixo automatically Front → Depth A → Back → Depth B bind karega. Existing vertex/edge auto-snap hota hai.</small>
          </> : <>
            <div className="mapper-fields guided-fields">
              <label><span>Plot number</span><input value={plotId} readOnly={Boolean(currentPlot)} onChange={(event) => setPlotId(event.target.value)} /></label>
              <label><span>Dimensions (legacy/reference)</span><input value={dimensions} onChange={(event) => setDimensions(event.target.value)} placeholder="18 x 40 ft" /></label>
              <label><span>Area (sq.ft)</span><input type="number" min="0" value={sqft} onChange={(event) => setSqft(event.target.value)} /></label>
              <label><span>Facing / road</span><input value={road} onChange={(event) => setRoad(event.target.value)} placeholder="East face / 40 ft road" /></label>
              <label><span>Front (road side)</span><input type="number" min="0" step="0.01" value={front} onChange={(event) => setFront(event.target.value)} placeholder="18" /></label>
              <label><span>Back</span><input type="number" min="0" step="0.01" value={back} onChange={(event) => setBack(event.target.value)} placeholder="18" /></label>
              <label><span>{effectiveSideLayout() === "three" ? "Depth" : "Depth A"}</span><input type="number" min="0" step="0.01" value={depth} onChange={(event) => setDepth(event.target.value)} placeholder="40" /></label>
              {effectiveSideLayout() === "four" && (
                <label><span>Depth B</span><input type="number" min="0" step="0.01" value={depth2} onChange={(event) => setDepth2(event.target.value)} placeholder="40" /></label>
              )}
              <label><span>Size unit</span><select value={dimensionUnit} onChange={(event) => setDimensionUnit(event.target.value === "m" ? "m" : "ft")}><option value="ft">ft (feet)</option><option value="m">m (metre)</option></select></label>
            </div>
            <div className="mapper-actions compact">
              <button type="button" onClick={() => {
                const parsed = dimensionPair(dimensions);
                if (!parsed) return notify("Dimensions me 18 x 40 ft jaisa pair nahi mila");
                setFront(String(parsed.first));
                setDepth(String(parsed.second));
                setDimensionUnit(parsed.unit);
                notify("Dimensions se Front/Depth fill hua — road-facing Front edge verify karein; zarurat ho to Swap karein");
              }}>Dimensions → Front/Depth</button>
              <button type="button" disabled={!front && !depth} onClick={() => { setFront(depth); setDepth(front); }}>Swap Front ↔ Depth</button>
            </div>
            <small className="mapper-help">Normal 4-corner plot me first tapped boundary road-facing Front hai aur side roles auto-bind ho chuke hain. Irregular plot me numbered corner-range se logical sides assign karein. Triangle automatically 3-side mode use karta hai; 4+ corners par 3-side ya 4-side choose kar sakte hain. Measurements Plot Data ya AI Measurement Manifest se aati hain.</small>
            <div className="mapper-actions">
              <button
                onClick={() => {
                  if (controlsWorkspace) {
                    notify("Boundary edit ke liye Plot Mapper page use karein — Mapping Controls manual size/details ke liye focused hai");
                    return;
                  }
                  setManualPhase("select");
                }}
              ><Pencil />Boundary बदलें</button>
              <button className="primary mapper-confirm" disabled={busy || !shapeReady} onClick={confirmPlot}><Save />{busy ? "Saving…" : controlsWorkspace ? `Update ${plotId}` : editingId ? `Update ${plotId}` : `Save shape ${plotId} & open next`}</button>
            </div>
            <small className="mapper-help">Legacy Dimensions / area / facing optional metadata hain. Front/Depth semantic metadata alag save hota hai. Shape independent save hoti hai; plot-sheet re-import geometry aur live Booked/Sold status preserve karta hai.</small>
            {controlsWorkspace && (
              <small className="mapper-help mapping-controls-inline-disclaimer">
                Update selected project ki editable mapping me save hota hai. Live customer site Publish Update ke bina change nahi hoti — neeche Review & Publish se latest change live karein.
              </small>
            )}
            {currentCenter && <small className="mapper-help">Boundary center {currentCenter[0].toFixed(4)}, {currentCenter[1].toFixed(4)} · normalized geometry यही SVG hit-area, 2D और 3D use करेंगे.</small>}
          </>}
        </div>
    );
  }

  if (controlsWorkspace) {
    return (
      <section className="mapper-shell auto-cad-mapper mapping-controls-workspace">
        {!settingsReady ? (
          <div className="card mapping-controls-empty">Mapping Controls load ho raha hai…</div>
        ) : !hasMasterplan ? (
          <div className="card mapping-controls-empty">
            Pehle Plot Mapper me masterplan aur plot mapping ready karein.
          </div>
        ) : !mappedPlots.length ? (
          <div className="card mapping-controls-empty">
            Abhi koi mapped plot nahi hai. Pehle Plot Mapper me boundary map karein; uske baad manual size/details yahan edit honge.
          </div>
        ) : (
          renderMappingControlsCard()
        )}
      </section>
    );
  }

  return (
    <section
      className={`mapper-shell auto-cad-mapper${controlsWorkspace ? " mapping-controls-workspace" : ""}`}
      onContextMenu={(event) => event.preventDefault()}
    >
      {!controlsWorkspace && (
      <div className="card mapper-tools mapper-v2-head">
        <div className="section-title">
          <MousePointer2 />
          <div>
            <h2>Rekixo Plot Mapper</h2>
            <p>Main masterplan image → full zoom → exact corners → SVG hotspot → details → publish. CAD optional assistant है.</p>
          </div>
        </div>

        <div className="mapper-v2-progress">
          <span className={hasMasterplan ? "done" : "active"}><b>1</b> Sources</span>
          <span className={mappedPlots.length ? "done" : hasMasterplan ? "active" : ""}><b>2</b> Plot Mapping</span>
          <span className={hasPlotSheet ? (plotQuality.richDetailReady ? "done" : "active") : ""}>
            <b>3</b> Details{hasPlotSheet && !plotQuality.richDetailReady ? " ⚠" : ""}
          </span>
          <span className={unmappedPlots.length ? "active" : mappedPlots.length ? "done" : ""}><b>4</b> Review</span>
          <span className={mappedPlots.length && !unmappedPlots.length ? "done" : ""}><b>5</b> Publish</span>
        </div>

        {!completedProject && (
          <div className="mapper-inventory-add card">
            <div className="section-title">
              <Target />
              <div>
                <h3>Add Shops (safe inventory addition)</h3>
                <p>Existing plots, polygons, status, pricing aur published customer snapshot untouched rahenge. New shops un-mapped entries hongi.</p>
              </div>
            </div>
            <button type="button" disabled={busy} onClick={() => {
              const confirmed = window.confirm("Shop-1 se Shop-5 tak paanch inventory rows add karni hain? Existing plot data overwrite nahi hoga. Publish karne tak customer site unchanged rahegi.");
              if (!confirmed) return;
              void createInventoryPlots([
                {id:"SHOP-1",dimensions:"8 x 15 ft",front:8,back:8,depth:15,depth2:15,dimensionUnit:"ft",sqft:120,road:"Road-facing shop frontage",notes:"Added separately; map boundary on masterplan. Source: owner-provided size 8 x 15 ft; Front 8 ft."},
                {id:"SHOP-2",dimensions:"8 x 15 ft",front:8,back:8,depth:15,depth2:15,dimensionUnit:"ft",sqft:120,road:"Road-facing shop frontage",notes:"Added separately; map boundary on masterplan. Source: owner-provided size 8 x 15 ft; Front 8 ft."},
                {id:"SHOP-3",dimensions:"8 x 15 ft",front:8,back:8,depth:15,depth2:15,dimensionUnit:"ft",sqft:120,road:"Road-facing shop frontage",notes:"Added separately; map boundary on masterplan. Source: owner-provided size 8 x 15 ft; Front 8 ft."},
                {id:"SHOP-4",dimensions:"8 x 15 ft",front:8,back:8,depth:15,depth2:15,dimensionUnit:"ft",sqft:120,road:"Road-facing shop frontage",notes:"Added separately; map boundary on masterplan. Source: owner-provided size 8 x 15 ft; Front 8 ft."},
                {id:"SHOP-5",dimensions:"8 x 15 ft",front:8,back:8,depth:15,depth2:15,dimensionUnit:"ft",sqft:120,road:"Road-facing shop frontage",notes:"Added separately; map boundary on masterplan. Source: owner-provided size 8 x 15 ft; Front 8 ft."},
              ]);
            }}><span>Add 5 Shops (8 x 15 ft)</span></button>
          </div>
        )}

        <div className="mapper-normal-flow">
          <b>Normal new-project flow</b>
          <span>Masterplan → verified Plot Data → AI measurement manifest when needed → front-first boundaries → quality check → preview → publish</span>
        </div>

        <div className="mapper-source-grid">
          <label className={`mapper-upload-card ${hasMasterplan ? "ready" : ""}`}>
            <span><ImagePlus /></span>
            <div>
              <b>{hasMasterplan ? "Masterplan ready" : "1. Masterplan image"}</b>
              <small>
                {masterplanUploadProgress != null
                  ? `Original upload ${masterplanUploadProgress}% · safe multipart`
                  : settings.masterplanName || "High-resolution JPG/PNG/WebP · original up to 100 MB"}
              </small>
            </div>
            {hasMasterplan && <CheckCircle2 className="mapper-ready-icon" />}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || completedProject} onChange={(event) => handleMasterplanUploadInput(event)} />
          </label>

          <label className={`mapper-upload-card ${hasLogo ? "ready" : ""}`}>
            <span>{hasLogo ? <img className="mapper-logo-thumb" src={logoUrl} alt="" /> : <ImagePlus />}</span>
            <div>
              <b>{hasLogo ? "Project logo ready · tap to replace" : "Project logo"}</b>
              <small>{settings.logoName || "Customer site + Client Admin · JPG/PNG/WebP"}</small>
            </div>
            {hasLogo && <CheckCircle2 className="mapper-ready-icon" />}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(event) =>
                event.target.files?.[0] && upload(event.target.files[0], "logo")
              }
            />
          </label>

          <label className={`mapper-upload-card mapper-canonical-data ${hasPlotSheet ? "ready" : ""}`}>
            <span><FileText /></span>
            <div>
              <b>{hasPlotSheet ? `Plot Data · ${plots.length} plots` : "2. Verified Plot Data"}</b>
              <small>{settings.plotSheetName || "CSV/JSON: authoritative area + road + side sizes; Front Direction legacy/optional"}</small>
            </div>
            {hasPlotSheet && <CheckCircle2 className="mapper-ready-icon" />}
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              disabled={busy || completedProject}
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0] || null;
                input.value = "";
                if (file) void preflightPlotSheet(file);
              }}
            />
          </label>

          <label className={`mapper-upload-card ${hasMeasurementSheet ? "ready" : ""}`}>
            <span><Target /></span>
            <div>
              <b>{hasMeasurementSheet ? `AI measurements · ${settings.measurementSheetCount || "saved"}` : "3. AI Measurement Manifest"}</b>
              <small>{settings.measurementSheetName || "CSV/JSON backfill: Front/Back/Depth + source ref + confidence; geometry/status untouched"}</small>
            </div>
            {hasMeasurementSheet && <CheckCircle2 className="mapper-ready-icon" />}
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              disabled={busy}
              onChange={(event) =>
                event.target.files?.[0] && upload(event.target.files[0], "measurementSheet")
              }
            />
          </label>

          <label className={`mapper-upload-card ${hasPdf ? "ready" : ""}`}>
            <span><FileText /></span>
            <div>
              <b>{hasPdf ? "Technical PDF saved" : "4. Technical PDF reference"}</b>
              <small>{settings.sourcePdfName || "Original sanctioned/technical sheet · reference only"}</small>
            </div>
            {hasPdf && <CheckCircle2 className="mapper-ready-icon" />}
            <input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => event.target.files?.[0] && upload(event.target.files[0], "sourcePdf")} />
          </label>
        </div>

        <details className="mapper-advanced-sources">
          <summary>
            <span>
              <b>Advanced / corrections</b>
              <small>Normal project me zaroori nahi — CAD assistant ya later field correction ke liye.</small>
            </span>
            <em>{[hasCad, hasRoadAccessSheet, hasSideMappingSheet].filter(Boolean).length}/3 saved</em>
          </summary>
          <div className="mapper-source-grid">
            <label className={`mapper-upload-card ${hasCad ? "ready" : ""}`}>
              <span><FileText /></span>
              <div><b>{hasCad ? "CAD source saved" : "DWG / DXF"}</b><small>{settings.sourceCadName || "Optional geometry assistant"}</small></div>
              {hasCad && <CheckCircle2 className="mapper-ready-icon" />}
              <input type="file" accept=".dwg,.dxf,application/acad,application/dxf,application/octet-stream" disabled={busy || completedProject} onChange={(event) => event.target.files?.[0] && upload(event.target.files[0], "sourceCad")} />
            </label>

            <label className={`mapper-upload-card ${hasRoadAccessSheet ? "ready" : ""}`}>
              <span><FileText /></span>
              <div>
                <b>{hasRoadAccessSheet ? `Road correction · ${settings.roadAccessSheetCount || "saved"}` : "Road Access correction CSV"}</b>
                <small>{settings.roadAccessSheetName || "Only road field update; inventory/status/geometry untouched"}</small>
              </div>
              {hasRoadAccessSheet && <CheckCircle2 className="mapper-ready-icon" />}
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(event) =>
                  event.target.files?.[0] && upload(event.target.files[0], "roadAccessSheet")
                }
              />
            </label>

            <label className={`mapper-upload-card ${hasSideMappingSheet ? "ready" : ""}`}>
              <span><Target /></span>
              <div>
                <b>{hasSideMappingSheet ? `Side correction · ${settings.sideMappingSheetCount || "saved"}` : "Side Mapping correction CSV"}</b>
                <small>{settings.sideMappingSheetName || "Normal flow me Front Direction canonical Plot Data me hi रखें"}</small>
              </div>
              {hasSideMappingSheet && <CheckCircle2 className="mapper-ready-icon" />}
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(event) =>
                  event.target.files?.[0] && upload(event.target.files[0], "sideMappingSheet")
                }
              />
            </label>
          </div>
          <div className="mapper-advanced-template-actions">
            <button type="button" onClick={downloadRoadAccessTemplate}>
              <FileText /> Road Access correction template
            </button>
            <button type="button" onClick={downloadSideMappingTemplate}>
              <Target /> Side Mapping correction template
            </button>
          </div>
        </details>

        <ProjectPricingSource
          key={`pricing:${projectId}`}
          projectId={projectId}
          notify={notify}
        />

        <ProjectStartView
          key={`start-view:${projectId}`}
          projectId={projectId}
          plots={plots}
          masterplanUrl={imageUrl}
          notify={notify}
        />

        <div className="mapper-header-address-card">
          <div className="mapper-header-address-copy">
            <b>Website header subtitle / address</b>
            <small>
              Customer site me project title ke just niche reference jaisa text dikhega.
              Example: MALE, RATNAGIRI
            </small>
          </div>
          <div className="mapper-header-address-controls">
            <input
              type="text"
              maxLength={180}
              value={headerAddress}
              disabled={busy}
              placeholder="Example: MALE, RATNAGIRI"
              aria-label="Customer website header address"
              onChange={(event) => setHeaderAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveHeaderAddress();
                }
              }}
            />
            <button
              type="button"
              disabled={
                busy ||
                headerAddress.trim().replace(/\s+/g, " ") ===
                  String(settings.address || "").trim().replace(/\s+/g, " ")
              }
              onClick={() => void saveHeaderAddress()}
            >
              <Save /> Save
            </button>
          </div>
        </div>

        <div className="mapper-header-address-card">
          <div className="mapper-header-address-copy">
            <b>Area conversion policy</b>
            <small>
              Sq.M → Sq.Ft project-specific factor. Standard default 10.7639; Mangal Raj Park uses 10.76.
              Sq.Yd standard metric conversion se independent derive hota hai.
            </small>
          </div>
          <div className="mapper-header-address-controls">
            <input
              type="number"
              min="9"
              max="12"
              step="0.000001"
              value={areaFactorText}
              disabled={busy}
              aria-label="Square meter to square feet factor"
              onChange={(event) => setAreaFactorText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveAreaFactor();
                }
              }}
            />
            <button
              type="button"
              disabled={
                busy ||
                Math.abs(
                  normalizeSqmToSqftFactor(areaFactorText) -
                    normalizeSqmToSqftFactor(settings.sqmToSqftFactor),
                ) < 1e-9
              }
              onClick={() => void saveAreaFactor()}
            >
              <Save /> Save factor
            </button>
          </div>
        </div>

        <div className="mapper-source-actions">
          <button type="button" className="primary" onClick={downloadPlotSheetTemplate}>
            <FileText /> Download verified Plot Data template
          </button>
          <button type="button" onClick={downloadMeasurementTemplate}>
            <Target /> Download AI Measurement Manifest template
          </button>
          <small>
            New project ke liye bas isi canonical template ko fill/import karein. Correction templates Advanced section ke andar hain.
          </small>
        </div>

        <div className="mapper-source-meta">
          <span>Mapping: <b>{Math.round(mapWidth)} × {Math.round(mapHeight)}</b></span>
          {settings.masterplanOriginalWidth && settings.masterplanOriginalHeight && <span>Source: <b>{settings.masterplanOriginalWidth} × {settings.masterplanOriginalHeight}</b></span>}
          <span>Inventory: <b>{plots.length}</b></span>
          <span>Mapped: <b>{mappedPlots.length}</b></span>
          <span>Review: <b>{unmappedPlots.length}</b></span>
          <span>Last server verify: <b>{lastVerifiedId ? `Plot ${lastVerifiedId} ✓` : "—"}</b></span>
          {!completedProject && <span>Mapper view: <b>{rotationDegrees}° local</b></span>}
        </div>

        {plots.length > 0 && (
          <div className={`mapper-data-quality ${plotQuality.richDetailReady ? "ready" : "warning"}`}>
            <div className="mapper-data-quality-head">
              <div>
                <b>Plot Data Quality</b>
                <small>
                  Customer drawer me complete details ke liye har plot ka Dimensions + Road +
                  required logical sides hona chahiye. 3-side plot me Front/Back/Depth;
                  4-side plot me Front/Back/Depth A/Depth B.
                </small>
              </div>
              <strong>
                {plotQuality.richDetailReady
                  ? "RICH DETAILS READY"
                  : `${plotQuality.fourSidesComplete}/${plotQuality.total} REQUIRED SIDES`}
              </strong>
            </div>
            <div className="mapper-data-quality-grid">
              <span>Dimensions <b>{plotQuality.dimensionsComplete}/{plotQuality.total}</b></span>
              <span>Road Access <b>{plotQuality.roadComplete}/{plotQuality.total}</b></span>
              <span>Required side measurements <b>{plotQuality.fourSidesComplete}/{plotQuality.total}</b></span>
              <span>Front / side binding <b>{plotQuality.frontDirectionsComplete}/{plotQuality.total}</b></span>
              <span>Mapped side semantics <b>{plotQuality.mappedSemanticsComplete}/{plotQuality.total}</b></span>
              {hasMeasurementSheet && <span>Source verified <b>{settings.measurementSheetVerifiedCount || "0"}/{settings.measurementSheetCount || "0"}</b></span>}
              {hasMeasurementSheet && <span>Source review <b>{settings.measurementSheetReviewCount || "0"}</b></span>}
            </div>
            {!plotQuality.richDetailReady && (
              <p>
                ⚠ CSV import ho sakti hai, lekin incomplete rows customer site par Front /
                Back / Depth detail nahi dikhayengi.
                {plotQuality.genericAreaOnly
                  ? ` ${plotQuality.genericAreaOnly} plot(s) me generic approved-area text mila.`
                  : ""}
              </p>
            )}
          </div>
        )}
        {settings.sourcePdfName && <a className="mapper-pdf-link" href={assetUrl("sourcePdf")} target="_blank" rel="noreferrer"><FileText /> Open technical PDF reference</a>}
        {settings.cadParseError && <div className="mapper-warning">CAD source सुरक्षित है, लेकिन automatic geometry parse नहीं हुआ: {settings.cadParseError}. DXF export upload करें या Manual Precise fallback use करें.</div>}
      </div>
      )}

      {cadGeometry && !completedProject && !controlsWorkspace && (
        <details className="card cad-assistant-card">
          <summary>
            <span><b>Advanced CAD Assistant</b><small>Optional auto-suggestions; normal plot mapping main image par hoti hai.</small></span>
            <em>{cadGeometry.candidates.length} candidates</em>
          </summary>
          <div className="calibration-card">
          <div className="calibration-head">
            <div>
              <small>AUTO CAD CALIBRATION</small>
              <h3>{cadGeometry.candidates.length} closed CAD boundaries detected</h3>
              <p>CAD और rendered masterplan के वही 4 दूर-दूर reference points pair करें. Extra 1–4 pairs accuracy और improve कर सकते हैं.</p>
            </div>
            <div className="calibration-count"><b>{calibrationPairs.length || (savedMatrix ? 4 : 0)}</b><span>pairs</span></div>
          </div>

          <div className="calibration-actions">
            <button className={calibrationMode ? "primary" : ""} onClick={() => { setCalibrationMode((value) => !value); setPendingCadPoint(null); }}>
              {calibrationMode ? "Calibration ON" : savedMatrix ? "Recalibrate" : "Start calibration"}
            </button>
            <button disabled={!calibrationPairs.length} onClick={() => { setCalibrationPairs((current) => current.slice(0, -1)); setPendingCadPoint(null); }}><Undo2 />Undo pair</button>
            <button disabled={!calibrationPairs.length} onClick={() => { setCalibrationPairs([]); setPendingCadPoint(null); }}>Reset pairs</button>
            <button className="primary" disabled={calibrationPairs.length < 4 || !liveMatrix || busy} onClick={saveCalibration}><Save />Save calibration</button>
          </div>

          <div className="calibration-grid">
            <div className="cad-preview-wrap">
              <div className="preview-label"><b>A. CAD reference</b><span>{pendingCadPoint ? "Selected ✓ — now tap image" : calibrationMode ? "Tap reference point" : "Preview"}</span></div>
              <svg className="cad-preview" viewBox="0 0 1000 1000" preserveAspectRatio="none" onPointerUp={cadTap}>
                {cadGeometry.candidates.map((candidate) => <polygon key={candidate.key} points={candidate.points.map(([x,y]) => `${x * 1000},${y * 1000}`).join(" ")} />)}
                {cadGeometry.labels.slice(0, 600).map((label, index) => <text key={`${label.text}-${index}`} x={label.point[0] * 1000} y={label.point[1] * 1000}>{label.text}</text>)}
                {calibrationPairs.map((pair, index) => <g key={`cad-pair-${index}`}><circle cx={pair.source[0] * 1000} cy={pair.source[1] * 1000} r="14"/><text className="pair-number" x={pair.source[0] * 1000} y={pair.source[1] * 1000}>{index + 1}</text></g>)}
                {pendingCadPoint && <circle className="pending" cx={pendingCadPoint[0] * 1000} cy={pendingCadPoint[1] * 1000} r="18" />}
              </svg>
            </div>
            <div className="calibration-instructions">
              <b>Best anchors</b>
              <p>Site boundary / road intersection जैसे साफ points चुनें — चारों corners में spread रखें. Plot-number text को anchor मत बनाएं.</p>
              <div className="calibration-stats">
                <span>CAD candidates <b>{cadGeometry.candidates.length}</b></span>
                <span>CAD labels <b>{cadGeometry.labels.length}</b></span>
                <span>Auto ready <b>{acceptedAutoMatches.length}</b></span>
                <span>Area review <b>{areaReviewMatches.length}</b></span>
                <span>Need review <b>{reviewPlots.length}</b></span>
                <span>Area validation <b>{cadAreaScale ? "ON" : "—"}</b></span>
              </div>
              {liveMatrix && <label className="overlay-toggle"><input type="checkbox" checked={showCadOverlay} onChange={(event) => setShowCadOverlay(event.target.checked)} /> Show transformed CAD overlay on masterplan</label>}
            </div>
          </div>
          </div>
        </details>
      )}


      <div className="mapper-work mapper-v4-work">
        <div
          ref={canvasRef}
          className={`mapper-canvas card mapper-precision-canvas mapper-v4-canvas ${toolMode === "pan" ? "pan-mode" : "select-mode"}`}
          onContextMenu={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
        >
          <div className="mapper-v4-current">
            <button type="button" onClick={() => selectSiblingPlot(-1)} disabled={!inventoryPlots.length} aria-label="Previous plot"><ChevronLeft /></button>
            <label>
              <small>Current plot</small>
              <select value={plotId} onChange={(event) => {
                const next = plots.find((item) => item.id === event.target.value);
                if (next) loadPlotDetails(next, Boolean(next.polygon));
                else setPlotId(event.target.value);
              }}>
                {inventoryPlots.length
                  ? inventoryPlots.map((plot) => <option key={plot.id} value={plot.id}>{plot.id} · {plot.polygon ? "mapped" : "pending"}</option>)
                  : <option value={plotId}>{plotId}</option>}
              </select>
            </label>
            <span><b>{mappedPlots.length}</b>/{plots.length || "—"}</span>
            <button type="button" onClick={() => selectSiblingPlot(1)} disabled={!inventoryPlots.length} aria-label="Next plot"><ChevronRight /></button>
          </div>
          <div className="mapper-zoombar mapper-v4-toolbar">
            <button className={toolMode === "pan" ? "active" : ""} type="button" onClick={() => { setToolMode("pan"); setCalibrationMode(false); }}><Hand />Pan</button>
            <button className={toolMode === "select" ? "active" : ""} type="button" onClick={enableSelectMode}><Target />Select</button>
            {!completedProject && (
              <button
                type="button"
                className="primary mapper-focus-confirm mapper-focus-primary-action"
                disabled={busy || !shapeReady}
                onClick={confirmPlot}
              ><CheckCircle2 />{busy ? "Saving…" : editingId ? `Update ${plotId}` : `Confirm ${plotId}`}</button>
            )}
            <strong>{shape === "quad" ? `Plot ${plotId} · ${points.length}/4 corners` : `Plot ${plotId} · ${points.length} corners`}</strong>
            {!completedProject && (
              <div className="mapper-inline-shape-tools" aria-label="Plot boundary controls">
                <button
                  type="button"
                  className={shape === "quad" && manualPhase === "select" ? "active" : ""}
                  disabled={busy}
                  onClick={beginFourCornerBoundary}
                  aria-label="4-corner plot"
                  title="4-corner plot"
                ><FourCornerIcon /></button>
                <button
                  type="button"
                  className={shape === "polygon" && manualPhase === "select" ? "active" : ""}
                  disabled={busy}
                  onClick={beginIrregularBoundary}
                  aria-label="Irregular corner plot"
                  title="Irregular corner plot"
                ><IrregularCornerIcon /></button>
                <button
                  type="button"
                  className="complete"
                  disabled={busy || manualPhase !== "select" || shape !== "polygon" || points.length < 3}
                  onClick={completeIrregularBoundary}
                  aria-label="Boundary complete"
                  title="Boundary complete"
                ><CheckCircle2 /></button>
              </div>
            )}
            <span>{Math.round(zoom * 100)}%</span>
            <input className="mapper-zoom-range" type="range" min="1" max={MAX_MAPPER_ZOOM} step="0.1" value={zoom} onChange={(event) => zoomAtCanvasCenter(Number(event.target.value))} aria-label="Zoom level" aria-valuetext={`${Math.round(zoom * 100)}%`} />
            <button aria-label="Zoom out" disabled={zoom <= 1} onClick={() => zoomAtCanvasCenter(zoomRef.current - 0.5)}><ZoomOut /></button>
            <button aria-label="Zoom in" disabled={zoom >= MAX_MAPPER_ZOOM} onClick={() => zoomAtCanvasCenter(zoomRef.current + 0.5)}><ZoomIn /></button>
            <button
              type="button"
              aria-label="Rotate masterplan left 90 degrees"
              title="Rotate 90° left — portrait/landscape mapping view"
              onClick={() => rotateMapperView(-1)}
            >↺ 90°</button>
            <button
              type="button"
              aria-label="Rotate masterplan right 90 degrees"
              title="Rotate 90° right — portrait/landscape mapping view"
              onClick={() => rotateMapperView(1)}
            >↻ 90°</button>
            <button aria-label="Reset zoom and rotation" title="Reset orientation" onClick={resetMapperView}><RotateCcw /></button>
            <button aria-label="Toggle mapping focus/fullscreen" onClick={toggleMapperFullscreen}><Maximize2 />Focus</button>

            {!completedProject && (
              <div className="mapper-focus-actions" aria-label="Focus mapping actions">
                <button type="button" disabled={!points.length} onClick={undoPoint}><Undo2 />Undo</button>
                <button
                  type="button"
                  disabled={busy || (!points.length && !currentHasSavedBoundary)}
                  onClick={clearCurrentSelection}
                >{currentHasSavedBoundary ? "Remove saved" : "Clear"}</button>
                <button type="button" onClick={clonePreviousShape}><Copy />Clone prev</button>
                <button
                  type="button"
                  className={bulkSemanticMode ? "active" : ""}
                  onClick={toggleBulkSidesMode}
                >Bulk sides</button>
              </div>
            )}

            <button
              className="mapper-clear-all"
              type="button"
              disabled={busy || completedProject || mappedPlots.length === 0}
              onClick={requestClearAllSelections}
              aria-label="Clear all saved plot selections"
              title="Remove every saved clickable boundary; plot details and status stay safe"
            ><Trash2 />Clear all selections</button>
          </div>

          {settings.plotFacingEnabled === "1" && !completedProject && hasMasterplan && (
            <div className="mapper-north-calibration-layer" aria-label="Masterplan North calibration">
              <div className="mapper-north-calibration">
                <div className="mapper-north-calibration-heading">
                  <svg viewBox="0 0 48 48" aria-hidden="true">
                    <circle cx="24" cy="24" r="21" />
                    <circle cx="24" cy="24" r="15" />
                    <g transform={`rotate(${currentMasterplanNorthDisplayAngle()} 24 24)`}>
                      <path d="M24 7 L17 26 L24 21 L31 26 Z" className="mapper-north-needle" />
                      <path d="M17 26 L24 21 L24 39 Z" className="mapper-north-needle-back" />
                    </g>
                    <circle cx="24" cy="24" r="2.8" className="mapper-north-pivot" />
                  </svg>
                  <div>
                    <b>North calibration</b>
                    <small>{hasSavedMasterplanNorthAngle() ? "Exact bearing active" : "Four-way North fallback"}</small>
                  </div>
                  <strong>{Math.round(currentMasterplanNorthDisplayAngle()) % 360}°</strong>
                </div>
                <div className="mapper-north-calibration-controls">
                  <button
                    type="button"
                    aria-label="Rotate North marker counterclockwise 15 degrees"
                    disabled={northCalibrationSaving}
                    onClick={() => stepNorthCalibration(-15)}
                  >−15°</button>
                  <input
                    type="range"
                    min="0"
                    max="359"
                    step="1"
                    value={Math.round(currentMasterplanNorthDisplayAngle()) % 360}
                    aria-label="North bearing on displayed masterplan"
                    aria-valuetext={`${Math.round(currentMasterplanNorthDisplayAngle()) % 360} degrees clockwise from screen-up`}
                    onChange={(event) => setNorthCalibrationDraftSourceAngle(
                      sourceNorthAngleFromDisplay(Number(event.target.value), rotation),
                    )}
                  />
                  <button
                    type="button"
                    aria-label="Rotate North marker clockwise 15 degrees"
                    disabled={northCalibrationSaving}
                    onClick={() => stepNorthCalibration(15)}
                  >+15°</button>
                </div>
                <div className="mapper-north-calibration-actions">
                  <button
                    type="button"
                    className="mapper-north-save"
                    disabled={northCalibrationSaving || (hasSavedMasterplanNorthAngle() &&
                      northCalibrationDraftSourceAngle === null)}
                    onClick={() => void saveNorthCalibration()}
                  ><Save />{northCalibrationSaving ? "Saving…" : "Save North"}</button>
                  {hasSavedMasterplanNorthAngle() && (
                    <button
                      type="button"
                      className="mapper-north-reset"
                      disabled={northCalibrationSaving}
                      onClick={() => void resetNorthCalibration()}
                    >Use legacy North</button>
                  )}
                </div>
                <small className="mapper-north-calibration-note">
                  Bearing is saved against the original image. Display rotation never alters plot geometry. Existing manual facing overrides stay untouched—review them after calibration. Publish Update is required for customer display.
                </small>
              </div>
            </div>
          )}

          {settings.plotFacingEnabled === "1" &&
            !completedProject &&
            manualPhase === "details" &&
            points.length >= 3 && (() => {
              const facingResults = currentCompassFacingResults();
              const primaryDirection = facingResults.find(
                (item) => item.role === "front",
              )?.direction;
              const activeDirections = new Set(
                facingResults.map((item) => item.direction),
              );
              const calibratedCompassAngle = hasActiveMasterplanNorthAngle()
                ? currentMasterplanNorthDisplayAngle()
                : 0;
              const compassOffsets: Record<PlotFacingCardinalDirection, number> = {
                north: 0,
                east: 90,
                south: 180,
                west: 270,
              };
              const compassButtons: Array<{
                direction: PlotFacingCardinalDirection;
                label: string;
                arrow: string;
                className: string;
              }> = [
                { direction: "north", label: "North", arrow: "↑", className: "north" },
                { direction: "west", label: "West", arrow: "←", className: "west" },
                { direction: "east", label: "East", arrow: "→", className: "east" },
                { direction: "south", label: "South", arrow: "↓", className: "south" },
              ];
              return (
                <div
                  className="mapper-facing-compass-layer"
                  aria-label={`Plot ${plotId} facing compass`}
                >
                  <div className="mapper-facing-compass">
                    {compassButtons.map((item) => {
                      const active = activeDirections.has(item.direction);
                      const primary = primaryDirection === item.direction;
                      const visualBearing = calibratedCompassAngle + compassOffsets[item.direction];
                      const radians = (visualBearing * Math.PI) / 180;
                      return (
                        <button
                          key={item.direction}
                          type="button"
                          className={`${item.className}${active ? " active" : ""}${primary ? " primary-facing" : ""}`}
                          style={{
                            left: `calc(50% - 16.7% + ${(29.4 * Math.sin(radians)).toFixed(4)}%)`,
                            top: `calc(50% - 16.7% - ${(29.4 * Math.cos(radians)).toFixed(4)}%)`,
                          }}
                          onClick={() => toggleCompassFacing(item.direction)}
                          aria-pressed={active}
                          title={
                            primary
                              ? `${item.label} · Front auto facing`
                              : active
                                ? `${item.label} · click to remove extra facing`
                                : `Add ${item.label} as second facing`
                          }
                        >
                          <strong style={{ transform: `rotate(${calibratedCompassAngle}deg)` }}>{item.arrow}</strong>
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                    <div className="mapper-facing-compass-center" aria-hidden="true">
                      <b>{plotId}</b>
                      <small>{facingResults.length > 1 ? `${facingResults.length} faces` : "Front auto"}</small>
                    </div>
                  </div>
                </div>
              );
            })()}

          {clearAllConfirmOpen && (
            <div
              className="mapper-clear-confirm-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !busy) {
                  setClearAllConfirmOpen(false);
                }
              }}
            >
              <div
                className="mapper-clear-confirm-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="mapper-clear-confirm-title"
                aria-describedby="mapper-clear-confirm-description"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="mapper-clear-confirm-head">
                  <span className="mapper-clear-confirm-icon"><AlertTriangle /></span>
                  <div>
                    <small>DESTRUCTIVE ACTION</small>
                    <h3 id="mapper-clear-confirm-title">Clear all selections?</h3>
                  </div>
                </div>
                <p id="mapper-clear-confirm-description">
                  <b>{mappedPlots.length}</b> saved plot {mappedPlots.length === 1 ? "boundary" : "boundaries"} हटेंगी।
                  Plot details और status सुरक्षित रहेंगे।
                </p>
                <div className="mapper-clear-confirm-actions">
                  <button
                    type="button"
                    autoFocus
                    disabled={busy}
                    onClick={() => setClearAllConfirmOpen(false)}
                  >Cancel</button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void clearAllSelections()}
                  ><Trash2 />{busy ? "Clearing…" : `Clear ${mappedPlots.length} selections`}</button>
                </div>
              </div>
            </div>
          )}

          {!imageReady && (
            <div className="mapper-loading">
              {hasMasterplan ? "Masterplan preview load हो रहा है…" : "पहले masterplan image upload करें"}
            </div>
          )}
          {imageReady && imageLoadState === "hd-loading" && (
            <div className="mapper-loading">
              Light preview ready · HD precision masterplan background में load हो रहा है…
            </div>
          )}
          {imageError && (
            <div className="mapper-warning">
              {imageError}{" "}
              <button type="button" onClick={retryMasterplanLoad}>Retry masterplan</button>
            </div>
          )}
          <div
            ref={imageWrapRef}
            className="mapper-image-wrap mapper-image-v2"
            style={{
              width: mapperViewportWidth,
              maxWidth: "none",
              aspectRatio: mapperAspectRatio,
              overflow: "hidden",
              marginInline: "auto",
              flex: "0 0 auto",
            }}
            onPointerDownCapture={handleMapperGesturePointerDown}
            onPointerMoveCapture={handleMapperGesturePointerMove}
            onPointerUpCapture={handleMapperGesturePointerEnd}
            onPointerCancelCapture={handleMapperGesturePointerCancel}
            onLostPointerCapture={handleMapperLostPointerCapture}
            onContextMenu={(event) => event.preventDefault()}
            onDragStart={(event) => event.preventDefault()}
          >
            <div
              className="mapper-rotated-scene"
              data-rotation={rotationDegrees}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: sourceSceneWidth,
                aspectRatio: sourceSceneAspectRatio,
                transform: `translate(-50%, -50%) rotate(${rotationDegrees}deg)`,
                transformOrigin: "center center",
              }}
            >
              <img
                src={imageUrl}
                alt="Project masterplan"
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                    setNaturalImageSize({
                      width: image.naturalWidth,
                      height: image.naturalHeight,
                    });
                  }
                  setImageReady(true);
                  setImageError("");
                  if (imageQuality === "preview" && !completedProject) {
                    setImageLoadState("preview-ready");
                    preloadHdMasterplan(
                      String(settings.masterplanVersion || settings.masterplanName || "legacy"),
                    );
                  } else {
                    setImageLoadState("hd-ready");
                  }
                }}
                onError={() => {
                  if (imageQuality === "hd" && hasMasterplan && !completedProject) {
                    const version = String(
                      settings.masterplanVersion || settings.masterplanName || "legacy",
                    );
                    setImageQuality("preview");
                    setImageLoadState("preview-loading");
                    setImageError("HD masterplan decode fail hua; light preview par fallback kiya gaya.");
                    setImageUrl(
                      masterplanAssetUrl("preview", version, String(Date.now())),
                    );
                    return;
                  }
                  setNaturalImageSize(null);
                  setImageReady(false);
                  setImageLoadState("idle");
                  setImageError(
                    hasMasterplan
                      ? "Masterplan image load nahi hui. Retry karein; saved plots/status safe hain."
                      : "",
                  );
                }}
                draggable={false}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  maxWidth: "none",
                  maxHeight: "none",
                  objectFit: "contain",
                  objectPosition: "center",
                  transform: "none",
                }}
              />
              {imageReady && (
                <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" onPointerDown={handleImagePointerDown} onPointerUp={handleImagePointerUp}>
                  {mappedPlots.map((plot) => {
                    const polygon = parsePolygon(plot);
                    if (polygon.length < 3) return null;
                    const center = polygonCenter(polygon);
                    return <g key={plot.id} className={editingId === plot.id ? "mapped-plot editing" : "mapped-plot"}>
                      <polygon points={polygon.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")} />
                      <text x={center[0] * 1000} y={center[1] * 1000} style={mappedPlotLabelStyle}>{plot.id}</text>
                    </g>;
                  })}
                  {!calibrationMode && lastVerifiedPlot && lastVerifiedPolygon.length >= 3 && ([
                    ["front", "#22c55e"],
                    ["back", "#60a5fa"],
                    ["depthA", "#f59e0b"],
                    ...(lastVerifiedLayout === "four"
                      ? [["depthB", "#a78bfa"] as const]
                      : []),
                  ] as const).map(([role, color]) => {
                    const guide = semanticRoleMeasureGuide(
                      lastVerifiedPolygon,
                      lastVerifiedRoles[role],
                      zoom,
                    );
                    const textValue = savedPlotRoleMeasurementText(
                      lastVerifiedPlot,
                      role,
                      lastVerifiedLayout,
                    );
                    if (!guide || !textValue) return null;
                    return (
                      <g
                        key={`saved-semantic-measure-${lastVerifiedPlot.id}-${role}`}
                        className="semantic-side-measurement saved"
                        style={{ pointerEvents: "none" }}
                      >
                        <line
                          x1={guide.start[0] * 1000}
                          y1={guide.start[1] * 1000}
                          x2={guide.end[0] * 1000}
                          y2={guide.end[1] * 1000}
                          stroke={color}
                          strokeOpacity={.96}
                          strokeWidth={2.25}
                          vectorEffect="non-scaling-stroke"
                          strokeLinecap="round"
                        />
                        <text
                          x={guide.label[0] * 1000}
                          y={guide.label[1] * 1000}
                          fill="#ffffff"
                          stroke="#06101f"
                          strokeWidth={3.6 / Math.max(1, zoom)}
                          paintOrder="stroke"
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={18 / Math.max(1, zoom)}
                          fontWeight={950}
                        >{textValue}</text>
                      </g>
                    );
                  })}
                  {bulkSemanticMode && mappedPlots.map((plot) => {
                    const polygon = parsePolygon(plot);
                    if (polygon.length < 3) return null;
                    const active = bulkSemanticIds.has(plot.id);
                    return (
                      <polygon
                        key={`bulk-semantic-${plot.id}`}
                        points={polygon.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")}
                        fill={active ? "rgba(34,197,94,.26)" : "rgba(59,130,246,.08)"}
                        stroke={active ? "#22c55e" : "#60a5fa"}
                        strokeWidth={active ? 7 : 4}
                        vectorEffect="non-scaling-stroke"
                        style={{ cursor: "pointer", pointerEvents: "all" }}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onPointerUp={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleBulkSemanticPlot(plot.id);
                        }}
                      />
                    );
                  })}
                  {!calibrationMode && manualPhase === "details" && points.length >= 3 && points.map((point, index) => {
                    const next = points[(index + 1) % points.length];
                    const selected = selectedSemanticEdge === index;
                    const semanticRoles = currentSemanticRoles();
                    const role =
                      semanticRoles.front.includes(index) ? "front" :
                      semanticRoles.back.includes(index) ? "back" :
                      semanticRoles.depthA.includes(index) ? "depthA" :
                      semanticRoles.depthB.includes(index) ? "depthB" : null;
                    const roleColor =
                      role === "front" ? "#22c55e" :
                      role === "back" ? "#60a5fa" :
                      role === "depthA" ? "#f59e0b" :
                      role === "depthB" ? "#a78bfa" : "#ffffff";
                    const handleEdgePointerDown = (event: React.PointerEvent<SVGLineElement>) => {
                      event.preventDefault();
                      event.stopPropagation();
                    };
                    const handleEdgePointerUp = (event: React.PointerEvent<SVGLineElement>) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleSemanticEdgeTap(index);
                    };
                    return (
                      <g key={`semantic-edge-picker-${index}`}>
                        {/*
                          Keep a generous invisible hit target for Android accuracy, but
                          render the visible semantic guide as a thin dashed line. This
                          prevents Front/Back/Depth overlays from hiding the actual
                          masterplan boundary at 1800% zoom.
                        */}
                        <line
                          className="semantic-edge-hit-target"
                          x1={point[0] * 1000}
                          y1={point[1] * 1000}
                          x2={next[0] * 1000}
                          y2={next[1] * 1000}
                          stroke="rgba(255,255,255,0.001)"
                          strokeWidth={30}
                          vectorEffect="non-scaling-stroke"
                          style={{
                            cursor: semanticChainRole ? "default" : "pointer",
                            pointerEvents: semanticChainRole ? "none" : "stroke",
                          }}
                          onPointerDown={handleEdgePointerDown}
                          onPointerUp={handleEdgePointerUp}
                        />
                        <line
                          className="semantic-edge-visible-guide"
                          x1={point[0] * 1000}
                          y1={point[1] * 1000}
                          x2={next[0] * 1000}
                          y2={next[1] * 1000}
                          stroke={selected ? "#ffffff" : roleColor}
                          strokeOpacity={selected ? .95 : role ? .82 : .34}
                          strokeWidth={selected ? 4.5 : role ? 3.5 : 2.5}
                          strokeDasharray={selected ? "8 5" : role ? "7 5" : "5 6"}
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                          style={{ pointerEvents: "none" }}
                        />
                      </g>
                    );
                  })}
                  {!calibrationMode && points.length >= 3 && ([
                    ["front", "F", "#22c55e"],
                    ["back", "B", "#60a5fa"],
                    ["depthA", effectiveSideLayout() === "three" ? "D" : "D1", "#f59e0b"],
                    ...(effectiveSideLayout() === "four"
                      ? [["depthB", "D2", "#a78bfa"] as const]
                      : []),
                  ] as const).map(([role, badge, color]) => {
                    const edges = currentSemanticRoles()[role];
                    const midpoint = semanticRoleMidpoint(points, edges);
                    if (!midpoint) return null;
                    return (
                      <text
                        key={`semantic-badge-${role}`}
                        x={midpoint[0] * 1000}
                        y={midpoint[1] * 1000}
                        fill={color}
                        stroke="#08111f"
                        strokeWidth={2.4 / Math.max(1, zoom)}
                        paintOrder="stroke"
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={19 / Math.max(1, zoom)}
                        fontWeight={900}
                        style={{ pointerEvents: "none" }}
                      >{badge}</text>
                    );
                  })}
                  {!calibrationMode && measurementOverlayPoints.length >= 3 && ([
                    ["front", "#22c55e"],
                    ["back", "#60a5fa"],
                    ["depthA", "#f59e0b"],
                    ...(effectiveSideLayout() === "four"
                      ? [["depthB", "#a78bfa"] as const]
                      : []),
                  ] as const).map(([role, color]) => {
                    const edges = measurementOverlayRoles[role];
                    const textValue = currentRoleMeasurementText(role);
                    const guide = semanticRoleMeasureGuide(measurementOverlayPoints, edges, zoom);
                    if (!guide || !textValue) return null;
                    return (
                      <g
                        key={`semantic-measure-${role}`}
                        className="semantic-side-measurement"
                        style={{ pointerEvents: "none" }}
                      >
                        <line
                          x1={guide.start[0] * 1000}
                          y1={guide.start[1] * 1000}
                          x2={guide.end[0] * 1000}
                          y2={guide.end[1] * 1000}
                          stroke={color}
                          strokeOpacity={.98}
                          strokeWidth={2.25}
                          vectorEffect="non-scaling-stroke"
                          strokeLinecap="round"
                        />
                        <text
                          x={guide.label[0] * 1000}
                          y={guide.label[1] * 1000}
                          fill="#ffffff"
                          stroke="#06101f"
                          strokeWidth={3.6 / Math.max(1, zoom)}
                          paintOrder="stroke"
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={18 / Math.max(1, zoom)}
                          fontWeight={950}
                        >{textValue}</text>
                      </g>
                    );
                  })}
                  {showCadOverlay && liveMatrix && cadTransformed.map(({ candidate, points: polygon }) => (
                    <polygon key={`cad-${candidate.key}`} className="cad-transformed" points={polygon.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")} />
                  ))}
                  {acceptedAutoMatches.map((match) => !match.plot.polygon && (
                    <polygon key={`match-${match.plot.id}`} className="auto-match" points={match.points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")} />
                  ))}
                  {[...areaReviewMatches, ...excludedAutoMatches].map((match) => !match.plot.polygon && (
                    <polygon key={`review-${match.plot.id}`} className="cad-review" points={match.points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")} />
                  ))}
                  {points.length >= 2 && <polygon className="draft" points={points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")} />}
                  {calibrationPairs.map((pair, index) => (
                    <g key={`img-pair-${index}`} className="image-calibration-point">
                      <circle cx={pair.target[0] * 1000} cy={pair.target[1] * 1000} r="12"/>
                      <text x={pair.target[0] * 1000} y={pair.target[1] * 1000}>{index + 1}</text>
                    </g>
                  ))}
                </svg>
              )}
              {!calibrationMode && imageReady && points.map(([x, y], index) => (
                <button
                  type="button"
                  className="mapper-point-handle draggable"
                  key={`handle-${index}`}
                  style={{
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    transform: `translate(-50%, -50%) rotate(${-rotationDegrees}deg)`,
                    // Keep the draggable hit target large for touch accuracy, while
                    // shrinking only the visible numbered badge as zoom increases.
                    // At 1800% the badge is 25% of its normal size (75% smaller).
                    "--mapper-corner-visual-scale": String(
                      Math.max(
                        0.25,
                        1 -
                          ((Math.max(1, zoom) - 1) /
                            Math.max(1, MAX_MAPPER_ZOOM - 1)) *
                            0.75,
                      ),
                    ),
                  } as React.CSSProperties}
                  data-corner={index + 1}
                  onPointerDown={(event) => {
                    if (semanticChainRole) {
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    dragHandle(event, index);
                  }}
                  onPointerMove={(event) => {
                    if (semanticChainRole) return;
                    moveHandle(event, index);
                  }}
                  onPointerUp={(event) => {
                    if (semanticChainRole) {
                      event.preventDefault();
                      event.stopPropagation();
                      handleSemanticCornerTap(index);
                      return;
                    }
                    endHandle(event);
                  }}
                  onPointerCancel={(event) => {
                    if (semanticChainRole) {
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    endHandle(event);
                  }}
                  aria-label={
                    semanticChainRole
                      ? `Choose corner ${index + 1} for side range`
                      : `Drag corner ${index + 1}`
                  }
                />
              ))}
            </div>
            <div
              ref={loupeRef}
              className="mapper-loupe"
              style={{ display: "none" }}
            ><i /></div>
          </div>
          {!completedProject && (
            <div
              className={`mapper-v4-bottom-bar ${
                manualPhase === "details" && points.length >= 3 ? "has-side-dock" : ""
              }`}
            >
              <div className="mapper-v4-bottom-tools">
                <button type="button" disabled={!points.length} onClick={undoPoint}><Undo2 />Undo</button>
                <button
                  type="button"
                  disabled={busy || (!points.length && !currentHasSavedBoundary)}
                  onClick={clearCurrentSelection}
                >{currentHasSavedBoundary ? "Remove saved" : "Clear"}</button>
                <button type="button" onClick={clonePreviousShape}><Copy />Clone prev</button>
                <button
                  type="button"
                  className={bulkSemanticMode ? "primary" : ""}
                  onClick={toggleBulkSidesMode}
                >Bulk sides</button>
              </div>
              <div
                className={`mapper-v4-bottom-action-row ${
                  manualPhase === "details" && points.length >= 3 ? "has-side-dock" : ""
                }`}
              >
                <button
                  type="button"
                  className="primary mapper-confirm-button"
                  disabled={busy || !shapeReady}
                  onClick={confirmPlot}
                ><CheckCircle2 />{busy ? "Saving…" : editingId ? `Update ${plotId}` : `Confirm ${plotId} →`}</button>

                {manualPhase === "details" && points.length >= 3 && (
                  <div className="plot-side-assigner mapper-side-dock">
                    <div className="plot-side-assigner-head">
                      <div>
                        <b>Assign plot sides</b>
                        <span>
                          {semanticChainRole
                            ? semanticChainStart == null
                              ? "Role selected · start corner number tap karein"
                              : `Corner ${semanticChainStart + 1} selected · end corner tap karein`
                            : selectedSemanticEdge == null
                              ? "Role → start corner → end corner"
                              : `Edge ${selectedSemanticEdge + 1} selected`}
                        </span>
                      </div>
                      {semanticChainRole ? (
                        <button type="button" onClick={() => {
                          setSemanticChainRole(null);
                          setSemanticChainStart(null);
                          setSelectedSemanticEdge(null);
                          notify("Side chain selection cancel hui");
                        }}>Cancel</button>
                      ) : selectedSemanticEdge != null ? (
                        <button type="button" onClick={clearSelectedSemanticRole}>Clear role</button>
                      ) : null}
                    </div>
                    {shape === "polygon" && (
                      <div className="mapper-actions compact plot-side-layout-toggle">
                        <span>
                          <b>{effectiveSideLayout() === "three" ? "3 sides" : "4 sides"}</b>
                          {points.length === 3 ? " · triangle auto" : ""}
                        </span>
                        <button
                          type="button"
                          className={effectiveSideLayout() === "three" ? "primary" : ""}
                          onClick={() => changeSideLayout("three")}
                        >3 sides</button>
                        <button
                          type="button"
                          className={effectiveSideLayout() === "four" ? "primary" : ""}
                          disabled={points.length === 3}
                          onClick={() => changeSideLayout("four")}
                        >4 sides</button>
                      </div>
                    )}
                    <div className="plot-side-role-grid">
                      {([
                        ["front", "Front", "#22c55e"],
                        ["back", "Back", "#60a5fa"],
                        ["depthA", effectiveSideLayout() === "three" ? "Depth" : "Depth A", "#f59e0b"],
                        ...(effectiveSideLayout() === "four"
                          ? [["depthB", "Depth B", "#a78bfa"] as const]
                          : []),
                      ] as const).map(([role, label, color]) => {
                        const groupedEdges = currentSemanticRoles()[role];
                        const active =
                          semanticChainRole === role ||
                          (selectedSemanticEdge != null && groupedEdges.includes(selectedSemanticEdge));
                        const chainWaiting =
                          semanticChainRole === role
                            ? semanticChainStart == null
                              ? "Tap start corner"
                              : "Tap end corner"
                            : "";
                        return (
                          <button
                            key={`assign-${role}`}
                            type="button"
                            className={active ? "active" : ""}
                            style={{ "--side-color": color } as React.CSSProperties}
                            onClick={() => assignSelectedSemanticRole(role)}
                          >
                            <strong>{label}</strong>
                            <small>
                              {chainWaiting ||
                                (groupedEdges.length > 1
                                  ? `${groupedEdges.length} edges`
                                  : groupedEdges.length === 1
                                    ? `Edge ${groupedEdges[0] + 1}`
                                    : "Select")}
                            </small>
                          </button>
                        );
                      })}
                    </div>
                    <small className="plot-side-assigner-help">
                      Role button → numbered start corner → end corner. Curved segments beech me
                      automatically same side group banenge.
                    </small>
                  </div>
                )}

              </div>
            </div>
          )}
          {!completedProject && bulkSemanticMode && (
            <div className="mapper-actions compact">
              <span>{bulkSemanticIds.size} plots selected · visible mapper direction</span>
              {([
                ["front", "F"],
                ["back", "B"],
                ["depthA", "D1"],
                ["depthB", "D2"],
              ] as const).flatMap(([role, short]) =>
                ([
                  ["top", "↑"],
                  ["right", "→"],
                  ["bottom", "↓"],
                  ["left", "←"],
                ] as const).map(([direction, arrow]) => (
                  <button
                    key={`${role}-${direction}`}
                    disabled={!bulkSemanticIds.size || busy}
                    onClick={() => applyBulkEdgeDirection(role, direction)}
                  >{short} {arrow}</button>
                )),
              )}
            </div>
          )}
          {shapeInvalid && <div className="mapper-shape-error">Shape cross ho rahi hai. Handles ko clockwise order me adjust karein.</div>}
        </div>

        <aside className="card mapper-list mapper-review-list">
          <h3>Project plots <b>{mappedPlots.length}/{plots.length || "—"}</b></h3>
          <div className="review-summary">
            <span className="ok">Mapped {mappedPlots.length}</span>
            <span className="auto">Auto ready {acceptedAutoMatches.filter((match) => !match.plot.polygon).length}</span>
            <span className="warn">Review {reviewPlots.length}</span>
          </div>
          {inventoryPlots.length ? inventoryPlots.map((plot) => {
            const mapped = Boolean(plot.polygon);
            const rawAuto = !mapped && autoMatches.some((match) => match.plot.id === plot.id);
            const autoReady = !mapped && autoMatchIds.has(plot.id);
            const areaReview = !mapped && areaReviewIds.has(plot.id);
            return <article key={plot.id} className={mapped ? "mapped" : autoReady ? "auto-ready" : "needs-review"}>
              <button className="plot-row-main" onClick={() => loadPlotDetails(plot, mapped)}>
                <b>{plot.id}</b><small>{plot.dimensions || `${Number(plot.sqft).toFixed(0)} sq.ft`}</small>
                <em>{mapped ? "Mapped" : autoReady ? "Auto" : areaReview ? "Area review" : "Review"}</em>
              </button>
              {!completedProject && <div className="mapper-list-actions">
                {mapped ? <>
                  <button className="edit" onClick={() => loadPlotDetails(plot, true)} aria-label={`Edit ${plot.id}`}><Pencil /></button>
                  <button onClick={() => remove(plot)} aria-label={`Remove ${plot.id}`}><Trash2 /></button>
                </> : rawAuto ? <button
                  className={autoReady ? "auto-toggle included" : "auto-toggle"}
                  onClick={() => setExcludedAutoIds((current) => {
                    const next = new Set(current);
                    if (next.has(plot.id)) next.delete(plot.id); else next.add(plot.id);
                    return next;
                  })}
                  aria-label={autoReady ? `Move ${plot.id} to review` : `Use auto match for ${plot.id}`}
                >{autoReady ? "Auto ✓" : "Use Auto"}</button> : null}
              </div>}
            </article>;
          }) : <p>Plot sheet import करें या manual plot number से शुरू करें.</p>}
        </aside>
      </div>

      {!controlsWorkspace && !completedProject && liveMatrix && acceptedAutoMatches.length > 0 && (
        <div className="card auto-publish-card cad-only-card">
          <div>
            <small>AUTO MATCH REVIEW</small>
            <h3>{acceptedAutoMatches.length} Auto-ready · {reviewPlots.length} Review</h3>
            <p>Unique exact Plot ID के साथ CAD area भी project-wide inventory scale से verify होता है. {areaReviewMatches.length} area-mismatch match yellow Review में रोके गए हैं. Blue Auto row को भी tap करके Review में भेज सकते हैं — कोई geometry silently publish नहीं होती.</p>
          </div>
          <button className="primary" disabled={busy || !liveMatrix || !acceptedAutoMatches.some((match) => !match.plot.polygon)} onClick={publishAutoMatches}><CheckCircle2 /> Publish {acceptedAutoMatches.filter((match) => !match.plot.polygon).length} reviewed Auto plots</button>
        </div>
      )}

      {!completedProject && hasMasterplan && renderMappingControlsCard()}
    </section>
  );
}
