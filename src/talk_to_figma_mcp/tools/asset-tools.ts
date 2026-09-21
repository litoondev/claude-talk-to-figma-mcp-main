/**
 * The asset pipeline: Figma's image bytes onto disk, without passing through
 * model context.
 *
 * WHY THIS EXISTS
 * ---------------
 * `export_node_as_image` hands the model an MCP image block. The model can look
 * at the picture and has no way to save it, so generated projects ended up with
 * placeholder images — the only thing the model could actually write. The one
 * tool that wrote files, `get_image_bytes`, was disabled.
 *
 * `export_assets` closes that gap. The model calls it once with the frames it
 * cares about; this module talks to the plugin, reassembles the bytes here in
 * the server, writes real files and returns nothing but a summary and a
 * manifest path. Bytes never enter the conversation.
 *
 * Two details that are easy to get wrong and expensive to discover later:
 *
 *   - `getBytesAsync()` returns the ORIGINAL uploaded file, which is as often
 *     JPEG as PNG. The plugin sniffs the container and reports the true
 *     extension; assuming PNG silently corrupts every photo.
 *   - A whole file cannot be sent in one frame. Bun's default cap is 16MB and
 *     base64 inflates by a third, so a 12MB photo sent whole fails silently.
 *     Transfers arrive in slices and are joined here.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

import { sendCommandToFigma } from "../utils/websocket";
import {
  hasFigmaToken,
  getImageFillUrls,
  getRenderedImageUrls,
  downloadAssetBinary,
} from "../utils/figma-rest";
import { logger } from "../utils/logger";

/** One asset as the plugin's scanner describes it — no bytes. */
interface ScannedAsset {
  assetId: string;
  nodeId: string;
  name: string;
  slug: string;
  kind: "image" | "icon" | "logo" | "illustration" | "background";
  mode: "bytes" | "render" | "svg";
  page: string;
  rootId: string;
  rootWidth: number | null;
  rendered: { width: number; height: number } | null;
  layout: string | null;
  cornerRadius: number | null;
  opacity: number;
  insideInstance: boolean;
  imageHash?: string | null;
  scaleMode?: string;
  focalPoint?: { x: number; y: number } | null;
  intrinsic?: { width: number; height: number } | null;
  isBackground?: boolean;
  renderWholeNode?: boolean;
}

interface ScanResult {
  assets: ScannedAsset[];
  failures: Array<{ nodeId: string; reason: string }>;
  scanned: number;
}

interface ChunkResult {
  assetId: string;
  chunkIndex: number;
  totalChunks: number;
  data: string;
  mimeType: string;
  ext: string;
  byteSize: number;
}

/**
 * Identify a downloaded file from its magic bytes.
 *
 * The REST CDN serves the ORIGINAL upload, which is as often JPEG as PNG.
 * Trusting the requested format here is how every photo ends up with the wrong
 * extension — the same bug that got the old byte path disabled.
 */
function sniffBuffer(buffer: Buffer): { ext: string; mime: string } {
  if (buffer.length >= 4) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return { ext: "png", mime: "image/png" };
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return { ext: "jpg", mime: "image/jpeg" };
    if (buffer[0] === 0x47 && buffer[1] === 0x49) return { ext: "gif", mime: "image/gif" };
    if (buffer[0] === 0x52 && buffer[1] === 0x49) return { ext: "webp", mime: "image/webp" };
  }
  const head = buffer.subarray(0, 300).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return { ext: "svg", mime: "image/svg+xml" };
  return { ext: "bin", mime: "application/octet-stream" };
}

/** Where each kind of asset is filed. One store, every platform reads it. */
function folderFor(kind: ScannedAsset["kind"], ext: string): string {
  if (ext === "svg") return kind === "logo" ? "source/icons" : "source/icons";
  if (kind === "illustration") return "source/illustrations";
  return "source/images";
}

/**
 * Breakpoint is decided by the width of the top-level frame an asset sits in,
 * matching the skill's own 375/768/1024+ ladder.
 */
function breakpointOf(width: number | null): string {
  if (width === null) return "unknown";
  if (width <= 480) return "mobile";
  if (width <= 900) return "tablet";
  return "desktop";
}

/** Assets that are the same file are stored once; this is what "same" means. */
function dedupeKeyOf(asset: ScannedAsset): string {
  if (asset.mode === "bytes" && asset.imageHash) return `hash:${asset.imageHash}`;
  return `node:${asset.nodeId}:${asset.mode}`;
}

export function registerAssetTools(server: McpServer): void {
  server.tool(
    "export_assets",
    "Export every image, icon, logo and illustration under the given frames to disk and write assets.manifest.json. " +
      "Call this ONCE per project instead of exporting nodes one by one. Image bytes are written by the server and " +
      "never returned to you; read the manifest for what was produced. Required before generating any code that shows an image.",
    {
      rootNodeIds: z
        .array(z.string())
        .min(1)
        .describe("Page or top-level frame IDs to walk. Pass every page/breakpoint frame the project needs."),
      outputDir: z
        .string()
        .describe("Absolute path of the asset folder to write, e.g. /path/to/project/assets"),
      scale: z.coerce.number().positive().optional().describe("Scale for rendered exports (default 2)"),
      includeInstances: z.boolean().optional().describe("Walk into component instances (default true)"),
      fileKey: z
        .string()
        .optional()
        .describe(
          "Figma file key, enabling the REST fallback when a plugin export fails. Omit to resolve it from the " +
            "connected plugin. Needs FIGMA_ACCESS_TOKEN with files:read — read access is enough, never edit access."
        ),
    },
    async ({ rootNodeIds, outputDir, scale, includeInstances, fileKey }) => {
      try {
        if (!path.isAbsolute(outputDir)) {
          return text(`outputDir must be an absolute path. Received: ${outputDir}`);
        }

        const exportScale = scale ?? 2;
        const scan = (await sendCommandToFigma(
          "scan_assets" as never,
          { rootNodeIds, includeInstances: includeInstances ?? true },
          180000
        )) as ScanResult;

        const assets = scan.assets || [];
        const failures: Array<{ nodeId: string; reason: string }> = [...(scan.failures || [])];

        // The REST fallback is prepared lazily: nothing is fetched unless a
        // plugin export actually fails.
        const fallback = await prepareFallback(fileKey);

        if (assets.length === 0) {
          return text(
            `No assets found under ${rootNodeIds.length} root node(s).\n` +
              (failures.length ? `Failures:\n${failures.map((f) => `- ${f.nodeId}: ${f.reason}`).join("\n")}` : "") +
              `\nIf the design does contain images, check that the frames passed are the right ones — images are ` +
              `paints on a node (fills[].type === "IMAGE"), not a node type of their own.`
          );
        }

        // Group first: the same photo placed ten times is one file and ten usages.
        const groups = new Map<string, ScannedAsset[]>();
        for (const asset of assets) {
          const key = dedupeKeyOf(asset);
          const list = groups.get(key);
          if (list) list.push(asset);
          else groups.set(key, [asset]);
        }

        fs.mkdirSync(outputDir, { recursive: true });

        const bySha = new Map<string, string>(); // sha256 -> relative file path
        const manifestAssets: Record<string, unknown>[] = [];
        let written = 0;
        let reused = 0;
        let bytesTotal = 0;
        let restRescued = 0;

        for (const [, members] of groups) {
          const lead = members[0];
          try {
            const { buffer, ext, mime, via } = await pullAsset(lead, exportScale, fallback);
            if (via === "rest") restRescued++;
            const sha = crypto.createHash("sha256").update(buffer).digest("hex");

            let relPath = bySha.get(sha);
            if (relPath) {
              reused++;
            } else {
              const folder = folderFor(lead.kind, ext);
              const slug = lead.slug || `${lead.kind}-${lead.page ? slugify(lead.page) : "asset"}`;
              const base = `${ext === "svg" ? "icon" : "img"}-${slug}-${sha.slice(0, 4)}.${ext}`;
              relPath = `${folder}/${base}`;
              const abs = path.join(outputDir, relPath);
              fs.mkdirSync(path.dirname(abs), { recursive: true });
              fs.writeFileSync(abs, buffer);
              bySha.set(sha, relPath);
              written++;
              bytesTotal += buffer.length;
            }

            manifestAssets.push({
              id: path.basename(relPath, path.extname(relPath)),
              kind: lead.kind,
              file: relPath,
              format: ext,
              hash: sha,
              intrinsic: lead.intrinsic ?? null,
              nodes: members.map((m) => ({
                nodeId: m.nodeId,
                page: m.page,
                breakpoint: breakpointOf(m.rootWidth),
                rendered: m.rendered,
                layout: m.layout,
                scaleMode: m.scaleMode ?? null,
                focalPoint: m.focalPoint ?? null,
                cornerRadius: m.cornerRadius,
                opacity: m.opacity,
                isBackground: Boolean(m.isBackground),
                insideInstance: m.insideInstance,
                // Filled by the model from the layer name or nearest heading.
                isAboveFold: null,
              })),
              // The model writes a real description for content images; the
              // scanner cannot know what a photo depicts.
              alt: "",
              decorative: false,
              monochrome: ext === "svg" ? null : false,
            });
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            failures.push({ nodeId: lead.nodeId, reason });
            logger.warn(`[assets] ${lead.assetId} failed: ${reason}`);
          }
        }

        const manifest = {
          exportedAt: new Date().toISOString(),
          outputDir,
          scale: exportScale,
          fileKey: fallback.fileKey ?? null,
          restFallbackAvailable: fallback.available,
          assets: manifestAssets,
          failures,
        };
        const manifestPath = path.join(outputDir, "assets.manifest.json");
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

        const byKind = manifestAssets.reduce<Record<string, number>>((acc, a) => {
          const k = String(a.kind);
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {});

        const lines = [
          `Exported ${written} file(s) from ${assets.length} asset placement(s).`,
          `  deduplicated: ${reused} placement group(s) reused an identical file`,
          `  total size:   ${(bytesTotal / 1024).toFixed(0)} KB`,
          `  by kind:      ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`,
          `  manifest:     ${manifestPath}`,
          ...(restRescued ? [`  REST fallback rescued ${restRescued} asset(s) the plugin could not export`] : []),
          "",
          `Read the manifest and wire every entry into the generated code by nodeId.`,
        ];

        if (failures.length) {
          lines.push(
            "",
            `${failures.length} failure(s) — these MUST be raised with the user, not replaced with placeholders:`,
            ...failures.slice(0, 20).map((f) => `- ${f.nodeId}: ${f.reason}`)
          );
          if (failures.length > 20) lines.push(`  …and ${failures.length - 20} more (see manifest.failures)`);
        }

        return text(lines.join("\n"));
      } catch (error) {
        return text(`Error exporting assets: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
}

/** What the REST path needs to stand in for the plugin, resolved once. */
interface Fallback {
  available: boolean;
  fileKey?: string;
  reason?: string;
  /** imageHash -> CDN url, fetched on first use. */
  fillUrls?: Record<string, string>;
}

/**
 * Work out whether a REST fallback is possible, without spending a request.
 *
 * A missing token or file key is not an error here — it only means a plugin
 * failure will be reported rather than rescued, and the summary says so.
 */
async function prepareFallback(fileKey?: string): Promise<Fallback> {
  if (!hasFigmaToken()) {
    return { available: false, reason: "FIGMA_ACCESS_TOKEN is not set" };
  }

  let key = fileKey;
  if (!key) {
    try {
      const connected = (await sendCommandToFigma("get_file_key" as never)) as { fileKey?: string };
      key = connected?.fileKey;
    } catch {
      // The plugin is how we would have asked; if it is unreachable the caller
      // must pass fileKey explicitly.
    }
  }

  if (!key) {
    return { available: false, reason: "no fileKey (pass it explicitly, or connect the plugin)" };
  }
  return { available: true, fileKey: key };
}

/**
 * Fetch one asset over REST after the plugin could not produce it.
 *
 * Image fills come from the file's image index, keyed by hash; everything else
 * is rendered server-side by Figma. Both need only `files:read`.
 */
async function pullViaRest(
  asset: ScannedAsset,
  scale: number,
  fallback: Fallback
): Promise<{ buffer: Buffer; ext: string; mime: string }> {
  if (!fallback.available || !fallback.fileKey) {
    throw new Error(fallback.reason || "REST fallback unavailable");
  }

  let url: string | null | undefined;

  if (asset.mode === "bytes" && asset.imageHash) {
    if (!fallback.fillUrls) {
      fallback.fillUrls = await getImageFillUrls(fallback.fileKey);
    }
    url = fallback.fillUrls[asset.imageHash];
    if (!url) throw new Error(`no REST url for image hash ${asset.imageHash}`);
  } else {
    const format = asset.mode === "svg" ? "svg" : "png";
    const rendered = await getRenderedImageUrls(fallback.fileKey, [asset.nodeId], format, scale);
    url = rendered[asset.nodeId];
    if (!url) throw new Error(`Figma declined to render ${asset.nodeId} as ${format}`);
  }

  const buffer = await downloadAssetBinary(url);
  const sniffed = sniffBuffer(buffer);
  return { buffer, ext: sniffed.ext, mime: sniffed.mime };
}

/**
 * Pull one asset's bytes across as many slices as it takes, falling back to
 * REST when the plugin cannot deliver.
 */
async function pullAsset(
  asset: ScannedAsset,
  scale: number,
  fallback: Fallback
): Promise<{ buffer: Buffer; ext: string; mime: string; via: "plugin" | "rest" }> {
  try {
    return { ...(await pullViaPlugin(asset, scale)), via: "plugin" };
  } catch (pluginError) {
    const why = pluginError instanceof Error ? pluginError.message : String(pluginError);
    if (!fallback.available) {
      throw new Error(`${why} (no REST fallback: ${fallback.reason})`);
    }
    logger.info(`[assets] ${asset.assetId}: plugin export failed (${why}) — retrying over REST`);
    try {
      return { ...(await pullViaRest(asset, scale, fallback)), via: "rest" };
    } catch (restError) {
      const restWhy = restError instanceof Error ? restError.message : String(restError);
      throw new Error(`plugin: ${why}; REST: ${restWhy}`);
    }
  }
}

/** Pull one asset's bytes across as many slices as the plugin needs. */
async function pullViaPlugin(
  asset: ScannedAsset,
  scale: number
): Promise<{ buffer: Buffer; ext: string; mime: string }> {
  const parts: string[] = [];
  let total = 1;
  let ext = "png";
  let mime = "image/png";

  for (let index = 0; index < total; index++) {
    const chunk = (await sendCommandToFigma(
      "export_asset_chunk" as never,
      {
        assetId: asset.assetId,
        nodeId: asset.nodeId,
        imageHash: asset.imageHash ?? null,
        mode: asset.mode,
        scale,
        chunkIndex: index,
      },
      180000
    )) as ChunkResult;

    total = chunk.totalChunks;
    ext = chunk.ext;
    mime = chunk.mimeType;
    parts.push(chunk.data);

    // A malformed reply must not spin forever.
    if (!Number.isFinite(total) || total < 1 || total > 5000) {
      throw new Error(`implausible chunk count ${total} for ${asset.assetId}`);
    }
  }

  const buffer = Buffer.from(parts.join(""), "base64");
  if (buffer.length === 0) throw new Error(`export produced zero bytes for ${asset.assetId}`);
  return { buffer, ext, mime };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function text(message: string) {
  return { content: [{ type: "text" as const, text: message }] };
}
