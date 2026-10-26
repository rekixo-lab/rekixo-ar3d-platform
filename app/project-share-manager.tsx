"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  ImagePlus,
  Save,
  Share2,
  Upload,
} from "lucide-react";
import { GLOBAL_SHARE_BRAND, SHARE_TEMPLATE } from "./share-branding";
import { GLOBAL_SHARE_BRAND_DATA_URL } from "./share-branding-logo";

type ShareState = {
  projectId?: string;
  projectName?: string;
  publicStatus?: string;
  shareTitle?: string;
  shareDescription?: string;
  shareVersion?: string;
  shareTemplate?: string;
  logoUrl?: string;
  cardUrl?: string;
  shareUrl?: string;
  publicUrl?: string;
  publishedShareVersion?: string;
  publishedShareImage?: boolean;
  publishedSnapshotReady?: boolean;
};

const MAX_SHARE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_WHATSAPP_SHARE_IMAGE_BYTES = 550 * 1024;
const SHARE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function dispatchShareUpdate(projectId: string) {
  window.dispatchEvent(
    new CustomEvent("rekixo:share-profile-updated", {
      detail: { projectId },
    }),
  );
}

async function apiJson(response: Response) {
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    // Cloudflare can return plain text on infrastructure errors.
  }
  if (!response.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : raw.trim() || `Request failed (${response.status})`,
    );
  }
  return data;
}

async function prepareProjectLogo(file: File) {
  if (!SHARE_IMAGE_TYPES.includes(file.type))
    throw new Error("Logo JPG, PNG ya WebP me upload karein");
  if (file.size > 8 * 1024 * 1024)
    throw new Error("Logo 8 MB se chhota rakhein");

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
  if (!blob || blob.size > 512 * 1024)
    throw new Error("Logo optimize nahi ho paya");

  return new File([blob], "project-logo.webp", { type: "image/webp" });
}

function validateShareImage(file: File) {
  if (!SHARE_IMAGE_TYPES.includes(file.type))
    throw new Error("Share image JPG, PNG ya WebP me choose karein");
  if (!file.size)
    throw new Error("Share image empty hai");
  if (file.size > MAX_SHARE_IMAGE_BYTES)
    throw new Error("Share image 8 MB se chhoti rakhein");
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  );
}

async function loadGlobalShareBrandBitmap() {
  const response = await fetch(GLOBAL_SHARE_BRAND_DATA_URL);
  if (!response.ok) throw new Error("AR3D branding logo load nahi hua");
  return createImageBitmap(await response.blob());
}

function clampShareColor(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function lightenShareColor(
  color: readonly [number, number, number],
  amount: number,
) {
  return [
    clampShareColor(color[0] + amount),
    clampShareColor(color[1] + amount),
    clampShareColor(color[2] + amount),
  ] as const;
}

function shareColorCss(color: readonly [number, number, number]) {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function footerCornerColors(bitmap: ImageBitmap) {
  const sourceSampleWidth = Math.max(
    GLOBAL_SHARE_BRAND.footerMinSamplePx,
    Math.round(
      bitmap.width * GLOBAL_SHARE_BRAND.footerCornerSampleWidthRatio,
    ),
  );
  const sourceSampleHeight = Math.max(
    GLOBAL_SHARE_BRAND.footerMinSamplePx,
    Math.round(
      bitmap.height * GLOBAL_SHARE_BRAND.footerCornerSampleHeightRatio,
    ),
  );
  const sourceX = Math.max(0, bitmap.width - sourceSampleWidth);
  const sourceY = Math.max(0, bitmap.height - sourceSampleHeight);
  const sampleSize = GLOBAL_SHARE_BRAND.footerAnalysisSizePx;

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleSize;
  sampleCanvas.height = sampleSize;
  const sampleContext = sampleCanvas.getContext("2d", {
    alpha: true,
    willReadFrequently: true,
  });

  if (!sampleContext) {
    return {
      base: GLOBAL_SHARE_BRAND.footerFallbackBackground,
      lift: GLOBAL_SHARE_BRAND.footerFallbackBackground,
    };
  }

  // Only the small bottom-right corner is sampled. We never reuse a full
  // bottom strip, so people, shadows or objects elsewhere cannot leak into
  // the branding footer.
  sampleContext.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceSampleWidth,
    sourceSampleHeight,
    0,
    0,
    sampleSize,
    sampleSize,
  );

  try {
    const pixels = sampleContext.getImageData(
      0,
      0,
      sampleSize,
      sampleSize,
    ).data;
    const visible: Array<[number, number, number, number]> = [];

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3] / 255;
      if (alpha < 0.08) continue;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      visible.push([red, green, blue, luminance]);
    }

    if (!visible.length) {
      return {
        base: GLOBAL_SHARE_BRAND.footerFallbackBackground,
        lift: GLOBAL_SHARE_BRAND.footerFallbackBackground,
      };
    }

    // Trim only luminance extremes so a tiny highlight or deep shadow in the
    // selected corner cannot dominate the final footer tone.
    visible.sort((left, right) => left[3] - right[3]);
    const trim = Math.floor(
      visible.length * GLOBAL_SHARE_BRAND.footerOutlierTrimRatio,
    );
    const stable =
      trim > 0 && visible.length - trim * 2 >= 8
        ? visible.slice(trim, visible.length - trim)
        : visible;

    let red = 0;
    let green = 0;
    let blue = 0;
    for (const pixel of stable) {
      red += pixel[0];
      green += pixel[1];
      blue += pixel[2];
    }

    const baseTuple = [
      clampShareColor(red / stable.length),
      clampShareColor(green / stable.length),
      clampShareColor(blue / stable.length),
    ] as const;
    const liftTuple = lightenShareColor(
      baseTuple,
      GLOBAL_SHARE_BRAND.footerGradientLift,
    );

    return {
      base: shareColorCss(baseTuple),
      lift: shareColorCss(liftTuple),
    };
  } catch {
    return {
      base: GLOBAL_SHARE_BRAND.footerFallbackBackground,
      lift: GLOBAL_SHARE_BRAND.footerFallbackBackground,
    };
  }
}

function drawImageDerivedFooter(
  context: CanvasRenderingContext2D,
  sourceBitmap: ImageBitmap,
  width: number,
  imageHeight: number,
  footerHeight: number,
) {
  const colors = footerCornerColors(sourceBitmap);
  const gradient = context.createLinearGradient(
    0,
    imageHeight,
    0,
    imageHeight + footerHeight,
  );
  gradient.addColorStop(0, colors.lift);
  gradient.addColorStop(1, colors.base);
  context.fillStyle = gradient;
  context.fillRect(0, imageHeight, width, footerHeight);
}

async function prepareBrandedShareImage(file: File) {
  validateShareImage(file);
  const sourceBitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(
      1,
      GLOBAL_SHARE_BRAND.maxOutputDimension /
        Math.max(sourceBitmap.width, sourceBitmap.height),
      Math.sqrt(
        GLOBAL_SHARE_BRAND.maxOutputPixels /
          (sourceBitmap.width * sourceBitmap.height),
      ),
    );
    const width = Math.max(1, Math.round(sourceBitmap.width * scale));
    const height = Math.max(1, Math.round(sourceBitmap.height * scale));
    const brandBitmap = await loadGlobalShareBrandBitmap();
    const logoCeiling = Math.max(
      1,
      Math.min(
        GLOBAL_SHARE_BRAND.maxLogoPx,
        Math.round(width * GLOBAL_SHARE_BRAND.maxWidthRatio),
        Math.round(height * GLOBAL_SHARE_BRAND.heightLimitRatio),
      ),
    );
    const logoWidth = Math.max(
      1,
      Math.min(
        logoCeiling,
        Math.max(
          GLOBAL_SHARE_BRAND.minLogoPx,
          Math.round(width * GLOBAL_SHARE_BRAND.widthRatio),
        ),
      ),
    );
    const logoHeight = Math.max(
      1,
      Math.round(logoWidth * (brandBitmap.height / brandBitmap.width)),
    );
    const footerPadding = Math.max(
      GLOBAL_SHARE_BRAND.minFooterPaddingPx,
      Math.round(width * GLOBAL_SHARE_BRAND.footerPaddingRatio),
    );
    const footerHeight = Math.max(
      GLOBAL_SHARE_BRAND.minFooterHeightPx,
      logoHeight + footerPadding * 2,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height + footerHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      brandBitmap.close();
      throw new Error("Share image process nahi ho payi");
    }

    // Source image is never covered or cropped. Branding gets its own footer,
    // whose background is derived from the customer's image instead of a
    // fixed color strip.
    context.drawImage(sourceBitmap, 0, 0, width, height);
    drawImageDerivedFooter(context, sourceBitmap, width, height, footerHeight);

    context.fillStyle = GLOBAL_SHARE_BRAND.dividerColor;
    context.fillRect(0, height, width, GLOBAL_SHARE_BRAND.dividerHeightPx);

    try {
      const logoX = Math.round((width - logoWidth) / 2);
      const logoY = height + Math.round((footerHeight - logoHeight) / 2);
      context.drawImage(
        brandBitmap,
        logoX,
        logoY,
        logoWidth,
        logoHeight,
      );
    } finally {
      brandBitmap.close();
    }

    // WhatsApp crawlers are most compatible with JPEG images. If necessary,
    // scale the entire composed poster (including its AR3D footer) without cropping.
    let blob: Blob | null = null;
    for (const ratio of [1, 0.9, 0.8, 0.7, 0.6, 0.5]) {
      let outputCanvas = canvas;
      if (ratio < 1) {
        outputCanvas = document.createElement("canvas");
        outputCanvas.width = Math.max(1, Math.round(canvas.width * ratio));
        outputCanvas.height = Math.max(1, Math.round(canvas.height * ratio));
        const scaledContext = outputCanvas.getContext("2d", { alpha: false });
        if (!scaledContext) throw new Error("Share image resize nahi ho payi");
        scaledContext.drawImage(canvas, 0, 0, outputCanvas.width, outputCanvas.height);
      }
      for (const quality of [0.86, 0.76, 0.66, 0.56, 0.46]) {
        const candidate = await canvasBlob(outputCanvas, "image/jpeg", quality);
        if (
          candidate?.type === "image/jpeg" &&
          candidate.size <= MAX_WHATSAPP_SHARE_IMAGE_BYTES
        ) {
          blob = candidate;
          break;
        }
      }
      if (blob) break;
    }
    if (!blob)
      throw new Error("WhatsApp JPEG image 550 KB ke andar optimize nahi hui");

    return new File([blob], "share-branded.jpg", { type: "image/jpeg" });
  } finally {
    sourceBitmap.close();
  }
}

export default function ProjectShareManager({
  projectId,
  notify,
}: {
  projectId: string;
  notify: (message: string) => void;
}) {
  const [state, setState] = useState<ShareState>({});
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [shareSourceFile, setShareSourceFile] = useState<File | null>(null);
  const [shareImageFile, setShareImageFile] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [brandBusy, setBrandBusy] = useState(false);

  async function load() {
    const response = await fetch(
      `/api/admin/project-share?projectId=${encodeURIComponent(projectId)}`,
      { cache: "no-store" },
    );
    const data = (await apiJson(response)) as ShareState;
    setState(data);
    setTitle(data.shareTitle || data.projectName || "");
    setDescription(data.shareDescription || "");
  }

  useEffect(() => {
    setShareSourceFile(null);
    setShareImageFile(null);
    load().catch((error) =>
      notify(error instanceof Error ? error.message : "Share profile load nahi hua"),
    );
  }, [projectId]);

  useEffect(() => {
    if (!shareImageFile) {
      setLocalPreview("");
      return;
    }
    const objectUrl = URL.createObjectURL(shareImageFile);
    setLocalPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [shareImageFile]);

  const shareUrl = state.shareUrl || state.publicUrl || "";
  const previewUrl = localPreview || state.cardUrl || "";
  const shareHost = useMemo(() => {
    try {
      return shareUrl ? new URL(shareUrl).host : "";
    } catch {
      return "";
    }
  }, [shareUrl]);
  const published = state.publicStatus === "published";
  const publishedSnapshotReady =
    published &&
    state.publishedSnapshotReady === true &&
    Boolean(state.publishedShareImage) &&
    Boolean(state.publishedShareVersion);
  const canCopyShare = Boolean(
    published && state.cardUrl && shareUrl && publishedSnapshotReady,
  );
  const validDetails =
    title.trim().length >= 3 && description.trim().length >= 10;

  async function uploadLogo(file: File | undefined) {
    if (!file || logoBusy) return;
    setLogoBusy(true);
    try {
      const optimized = await prepareProjectLogo(file);
      const form = new FormData();
      form.set("projectId", projectId);
      form.set("kind", "logo");
      form.set("file", optimized);
      await apiJson(
        await fetch("/api/super-mapper", {
          method: "POST",
          body: form,
        }),
      );
      await load();
      dispatchShareUpdate(projectId);
      notify("Project logo update ho gaya");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Logo update nahi hua");
    } finally {
      setLogoBusy(false);
    }
  }

  async function saveDetails() {
    if (!validDetails) {
      notify("Title kam se kam 3 aur description 10 characters rakhein");
      return;
    }
    setBusy(true);
    try {
      const data = (await apiJson(
        await fetch("/api/admin/project-share", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId,
            shareTitle: title,
            shareDescription: description,
          }),
        }),
      )) as ShareState;
      setState((current) => ({ ...current, ...data }));
      dispatchShareUpdate(projectId);
      notify("Share details save ho gaye");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Share details save nahi hue");
    } finally {
      setBusy(false);
    }
  }

  async function saveShareImage() {
    if (!validDetails) {
      notify("Title kam se kam 3 aur description 10 characters rakhein");
      return;
    }
    if (!shareSourceFile || !shareImageFile) {
      notify("Pehle share image choose karke AR3D branding ready hone dein");
      return;
    }

    try {
      validateShareImage(shareSourceFile);
      validateShareImage(shareImageFile);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Share image invalid hai");
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.set("projectId", projectId);
      form.set("kind", "card");
      form.set("shareTemplate", SHARE_TEMPLATE);
      form.set("shareTitle", title.trim());
      form.set("shareDescription", description.trim());

      // The uploaded source stays recoverable; only the branded derivative is public.
      form.set("file", shareImageFile);
      form.set("sourceFile", shareSourceFile);

      const data = (await apiJson(
        await fetch("/api/admin/project-share", {
          method: "POST",
          body: form,
        }),
      )) as ShareState;

      setState((current) => ({ ...current, ...data }));
      setShareSourceFile(null);
      setShareImageFile(null);
      dispatchShareUpdate(projectId);
      notify("AR3D branded share image save ho gayi");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Share image save nahi hui");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!canCopyShare) {
      notify(
        published
          ? publishedSnapshotReady
            ? "Pehle share image save karein"
            : "Publish Update ke baad WhatsApp share link ready hoga"
          : "Project publish hone ke baad share link copy hoga",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      notify("Share link copy ho gaya");
    } catch {
      notify("Clipboard copy fail hua");
    }
  }

  return (
    <section className="card rekixo-share-panel">
      <div className="section-title">
        <Share2 />
        <div>
          <h2>Share & Branding</h2>
          <p>
            Poster upload karein. System original source ko safe rakhega aur
            AR 3D Vision Studio branding ke liye neeche dedicated footer automatically add
            karke share-ready derivative banayega.
          </p>
        </div>
      </div>

      <div className="rekixo-share-status">
        <span className={state.logoUrl ? "ready" : "warn"}>
          {state.logoUrl ? <CheckCircle2 /> : <Upload />}
          {state.logoUrl ? "Project logo linked" : "Project logo optional"}
        </span>
        <span className={state.cardUrl ? "ready" : "warn"}>
          {state.cardUrl ? <CheckCircle2 /> : <ImagePlus />}
          {state.cardUrl ? "AR3D branded share image ready" : "Share image pending"}
        </span>
        <span className={published ? "ready" : "warn"}>
          {published ? <CheckCircle2 /> : <Share2 />}
          {published
            ? publishedSnapshotReady
              ? "Link share-ready"
              : "Publish Update required"
            : "Project draft"}
        </span>
      </div>

      <div className="rekixo-share-layout">
        <div className="rekixo-share-fields">
          <label>
            <span>PROJECT LOGO</span>
            <div className="rekixo-share-logo-row">
              {state.logoUrl ? (
                <img src={state.logoUrl} alt="Project logo" />
              ) : (
                <div className="rekixo-share-logo-empty">LOGO</div>
              )}
              <label className="rekixo-file-button">
                <Upload /> {logoBusy ? "Uploading…" : "Upload / replace logo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={logoBusy}
                  onChange={(event) => uploadLogo(event.target.files?.[0])}
                />
              </label>
            </div>
          </label>

          <label>
            <span>SHARE TITLE</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="Project name / headline"
            />
            <small>{title.length}/120</small>
          </label>

          <label>
            <span>SHARE DESCRIPTION</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              maxLength={280}
              placeholder="Short project description"
            />
            <small>{description.length}/280</small>
          </label>

          <label>
            <span>SHARE IMAGE / WHATSAPP POSTER</span>
            <label className="rekixo-cover-picker">
              <ImagePlus />
              <b>
                {brandBusy
                  ? "AR3D branding prepare ho rahi hai…"
                  : shareSourceFile
                    ? shareSourceFile.name
                    : state.cardUrl
                      ? "Choose a new image to replace the current poster"
                      : "Choose final share image"}
              </b>
              <small>
                Source max 8 MB · final WhatsApp card ≤550 KB · no crop · AR3D footer auto
              </small>
              <input
                key={
                  shareSourceFile
                    ? `${shareSourceFile.name}-${shareSourceFile.lastModified}`
                    : "share-image"
                }
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={brandBusy}
                onChange={async (event) => {
                  const input = event.currentTarget;
                  const file = input.files?.[0] || null;
                  if (!file) return;
                  setBrandBusy(true);
                  try {
                    validateShareImage(file);
                    const branded = await prepareBrandedShareImage(file);
                    setShareSourceFile(file);
                    setShareImageFile(branded);
                    notify("AR3D branding preview ready hai");
                  } catch (error) {
                    setShareSourceFile(null);
                    setShareImageFile(null);
                    notify(
                      error instanceof Error
                        ? error.message
                        : "Share image branding fail hui",
                    );
                  } finally {
                    setBrandBusy(false);
                    input.value = "";
                  }
                }}
              />
            </label>
          </label>

          <div className="rekixo-share-actions">
            <button onClick={saveDetails} disabled={busy || !validDetails}>
              <Save /> {busy ? "Saving…" : "Save details"}
            </button>
            <button
              className="primary"
              onClick={saveShareImage}
              disabled={
                busy || brandBusy || !shareSourceFile || !shareImageFile || !validDetails
              }
            >
              <ImagePlus /> {busy ? "Saving…" : "Save branded share image"}
            </button>
            <button onClick={copyLink} disabled={!canCopyShare}>
              <Copy /> Copy share link
            </button>
            {published && state.publicUrl ? (
              <a href={state.publicUrl} target="_blank" rel="noreferrer">
                <ExternalLink /> Open live project
              </a>
            ) : null}
          </div>
        </div>

        <div className="rekixo-whatsapp-shell">
          <div className="rekixo-whatsapp-head">LINK PREVIEW</div>
          <div className="rekixo-whatsapp-card">
            {previewUrl ? (
              <img src={previewUrl} alt="Share image preview" />
            ) : (
              <div className="rekixo-share-empty">
                Poster choose karein. Yahan original image ke neeche AR3D footer wala preview dikhega.
              </div>
            )}
            <div className="rekixo-whatsapp-copy">
              <b>{title || state.projectName || "Project"}</b>
              <p>{description || "Project description yahan dikhai degi."}</p>
              <small>{shareHost || "project-link"}</small>
            </div>
          </div>
          <div className="rekixo-share-link-box">
            <span>Versioned share link</span>
            <code>{shareUrl || "Publish/link configuration ke baad available"}</code>
          </div>
        </div>
      </div>
    </section>
  );
}
