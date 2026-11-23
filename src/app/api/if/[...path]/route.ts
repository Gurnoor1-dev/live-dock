import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { BlobPreconditionFailedError, del, head, list, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { getIFDeviceId, getIFSession } from "@/lib/infinite-flight/session";

export const runtime = "nodejs";
const API_BASE = "https://api.infiniteflight.com/public/v3";
type RouteContext = { params: Promise<{ path: string[] }> };
type CacheEntry = { body: string; status: number; headers: Record<string, string>; storedAt: number; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const rateLimitUntil = new Map<string, number>();
const UUID = "[0-9a-fA-F-]{36}";
const SEG = "[A-Za-z0-9._-]+";

function allowed(method: string, path: string) {
  const rules: Array<[string, RegExp]> = [
    ["GET", /^\/sessions$/], ["GET", new RegExp(`^/sessions/${SEG}$`)],
    ["GET", new RegExp(`^/sessions/${SEG}/flights$`)],
    ["GET", new RegExp(`^/sessions/${SEG}/flights/${SEG}$`)],
    ["GET", new RegExp(`^/sessions/${SEG}/flights/${SEG}/(route|flightplan)$`)],
    ["GET", new RegExp(`^/sessions/${SEG}/atc$`)],
    ["POST", /^\/sessions\/[A-Za-z0-9._-]+\/flights\/flightplans$/],
    ["POST", /^\/users$/], ["GET", new RegExp(`^/users/${SEG}$`)],
    ["GET", new RegExp(`^/users/${SEG}/flights$`)],
    ["GET", new RegExp(`^/users/${SEG}/flights/${SEG}$`)],
    ["GET", new RegExp(`^/users/${SEG}/atc$`)],
    ["GET", new RegExp(`^/users/${SEG}/atc/${SEG}$`)],
    ["GET", new RegExp(`^/sessions/${SEG}/airport/${SEG}/(atis|status)$`)],
    ["GET", new RegExp(`^/sessions/${SEG}/world$`)],
    ["GET", /^\/tracks$/], ["GET", new RegExp(`^/sessions/${SEG}/notams$`)],
    ["GET", /^\/aircraft$/], ["GET", new RegExp(`^/aircraft/${SEG}/liveries$`)],
    ["GET", /^\/aircraft\/liveries$/], ["GET", new RegExp(`^/airport/${SEG}$`)], ["GET", /^\/airports$/],
    ["GET", /^\/live\/organizations$/],
    ["GET", new RegExp(`^/live/organizations/${UUID}$`)],
    ["GET", new RegExp(`^/live/organizations/${UUID}/(members|aircraft|schedules)$`)],
    ["GET", new RegExp(`^/live/aircraft/${UUID}$`)],
    ["GET", new RegExp(`^/live/aircraft/${UUID}/(position|flights|schedules)$`)],
    ["POST", new RegExp(`^/live/aircraft/${UUID}/schedules$`)],
    ["PUT", new RegExp(`^/live/schedules/${UUID}$`)],
    ["PUT", new RegExp(`^/live/schedules/${UUID}/flightplan$`)],
    ["PUT", new RegExp(`^/live/schedules/${UUID}/crew/${UUID}$`)],
    ["DELETE", new RegExp(`^/live/schedules/${UUID}/crew/${UUID}$`)],
    ["PUT", new RegExp(`^/live/aircraft/${UUID}/schedules/reorder$`)],
    ["DELETE", new RegExp(`^/live/schedules/${UUID}$`)]
  ];
  return rules.some(([verb, expression]) => verb === method && expression.test(path));
}

function ttlFor(method: string, path: string) {
  // Schedule creation relies on the live fleet slot state; never reuse a cached aircraft roster.
  if (method === "GET" && /^\\/live\\/organizations\\/[0-9a-fA-F-]{36}\\/aircraft$/.test(path)) return 0;
  if (method === "GET" && (path === "/sessions" || (path.startsWith("/sessions/") && path.split("/").length === 3))) return 10 * 60_000;
  if (path.startsWith("/sessions/") && (path.endsWith("/flights") || path.includes("/flights/") || path.endsWith("/atc") || path.endsWith("/status") || path.endsWith("/atis"))) return 15_000;
  if (path.startsWith("/users/") || path === "/users") return 5 * 60_000;
  if (path === "/aircraft" || path === "/airports" || path === "/aircraft/liveries" || path.startsWith("/aircraft/") || path.startsWith("/airport/")) return 60 * 60_000;
  if (path.startsWith("/live/aircraft/") && path.endsWith("/position")) return 15_000;
  if (path.startsWith("/live/aircraft/") && path.endsWith("/flights")) return 5 * 60_000;
  if (path.startsWith("/live/")) return 60_000;
  return 0;
}

function response(body: string, status: number, headers: Record<string, string> = {}) {
  const output = new Headers(headers);
  output.set("Cache-Control", "no-store");
  output.set("Content-Type", output.get("Content-Type") || "application/json; charset=utf-8");
  return new NextResponse(body || null, { status, headers: output });
}

async function proxy(request: NextRequest, context: RouteContext) {
  const now = Date.now();
  for (const [key, entry] of cache) if (now >= entry.expiresAt) cache.delete(key);
  for (const [key, until] of rateLimitUntil) if (now >= until) rateLimitUntil.delete(key);
  const session = await getIFSession();
  if (!session) return NextResponse.json({ error: "Sign in with Infinite Flight to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const { path: parts } = await context.params;
  if (parts?.[0] === "gallery") return galleryRoute(request, parts);
  if (!parts?.length || parts.some(part => part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part))) return NextResponse.json({ error: "Invalid API path." }, { status: 400 });
  const path = "/" + parts.join("/");
  if (!allowed(request.method, path)) return NextResponse.json({ error: "This Infinite Flight API operation is not enabled in this app." }, { status: 405 });

  // A leading slash in URL() would discard the /public/v3 base path.
  const target = new URL(`${API_BASE}${path}`);
  target.search = request.nextUrl.search;
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.text();
  const tokenKey = createHash("sha256").update(session.accessToken).digest("hex");
  const deviceId = await getIFDeviceId();
  const bodyKey = body ? createHash("sha256").update(body).digest("hex") : "";
  const cacheKey = `${tokenKey}:${deviceId}:${request.method}:${target.toString()}:${bodyKey}`;
  const ttl = ttlFor(request.method, path);
  const canCache = ttl > 0 && (request.method === "GET" || (request.method === "POST" && (path === "/users" || path.endsWith("/flights/flightplans"))));

  if (canCache) {
    const cached = cache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      return response(cached.body, cached.status, cached.headers);
    }
    if (cached) cache.delete(cacheKey);
  }

  const blockedUntil = rateLimitUntil.get(tokenKey);
  if (blockedUntil && now < blockedUntil) {
    const waitSeconds = Math.max(1, Math.ceil((blockedUntil - now) / 1000));
    return NextResponse.json({ error: "Infinite Flight rate limit reached. Wait before retrying." }, { status: 429, headers: { "Retry-After": String(waitSeconds), "Cache-Control": "no-store" } });
  }

  const upstream = await fetch(target, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(body ? { "Content-Type": request.headers.get("content-type") || "application/json" } : {})
    },
    body,
    cache: "no-store"
  });
  const text = await upstream.text();
  if (upstream.status === 429) {
    const retryAfter = upstream.headers.get("retry-after");
    const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
    const retryAt = retryAfter && Number.isFinite(seconds) ? now + Math.max(1, seconds) * 1000 : retryAfter ? Date.parse(retryAfter) : Number.NaN;
    rateLimitUntil.set(tokenKey, Number.isFinite(retryAt) && retryAt > now ? retryAt : now + 60_000);
  }
  const headers: Record<string, string> = {};
  for (const name of ["content-type", "retry-after", "x-rate-limit-remaining", "x-rate-limit-reset", "x-user-pro"]) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }

  if (canCache && upstream.ok) {
    cache.set(cacheKey, { body: text, status: upstream.status, headers, storedAt: now, expiresAt: now + ttl });
    if (cache.size > 500) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  }

  if (["POST", "PUT", "DELETE"].includes(request.method) && path.startsWith("/live/")) {
    for (const key of cache.keys()) if (key.startsWith(tokenKey + ":")) cache.delete(key);
  }
  return response(text, upstream.status, headers);
}


const ORGANIZATION_ID = "d50dcc80-8dac-4608-970c-61d6a4739488";
const GALLERY_MANIFEST_PATH = "aircraft-gallery/manifest.json";
type GalleryPhoto = { id: string; fileName: string; blobPath: string; url: string; altText: string; caption: string; credit: { name: string; url: string; displayText: string }; displayOrder: number; isVisible: boolean; uploadedAt: string };
type GalleryManifest = { schemaVersion: number; manifestVersion: number; lastUpdatedAt: string; organization: { id: string; name: string }; settings: { maxPhotosPerAircraft: number; slideshowIntervalMs: number; transition: string }; instructions: Record<string, string>; examplePhoto: GalleryPhoto; aircraft: Record<string, { registration: string; photos: GalleryPhoto[] }> };

function emptyGalleryManifest(): GalleryManifest {
  return {
    schemaVersion: 1, manifestVersion: 1, lastUpdatedAt: new Date().toISOString(),
    organization: { id: ORGANIZATION_ID, name: "Virtual Blue" },
    settings: { maxPhotosPerAircraft: 4, slideshowIntervalMs: 2000, transition: "crossfade" },
    instructions: {
      purpose: "Public aircraft photography for the Virtual Blue fleet. This file is the only gallery metadata store.",
      manualUpload: "Upload an image into aircraft-gallery/images/ in Vercel Blob, then add its public URL and pathname as a photo object under aircraft[REGISTRATION].photos.",
      manualDelete: "Delete the image from Blob and remove its matching photo object from this file.",
      registration: "Use the exact aircraft registration as the key, for example N123VB. The key must match an aircraft registration returned by Infinite Flight.",
      maxPhotos: "Keep no more than four photo objects per registration. displayOrder starts at 0.",
      credit: "Always fill credit.name when a photographer is known. credit.url is optional; displayText is the compact visible credit.",
      fields: "url is the public Blob URL; blobPath is the exact Blob pathname; isVisible controls whether the site displays the image.",
      addEntry: "Copy examplePhoto into the photos array for the correct registration. Replace every example value, especially id, fileName, blobPath, url and uploadedAt. Keep displayOrder unique starting at 0.",
      editEntry: "You may edit caption, credit.name, credit.url, credit.displayText, displayOrder and isVisible directly in this JSON file. Do not change the schemaVersion or remove required fields.",
      warning: "examplePhoto is a template only. The website ignores it. Never leave the template inside an aircraft photos array."
    },
    examplePhoto: { id: "replace-with-a-unique-id", fileName: "example-aircraft-photo.jpg", blobPath: "aircraft-gallery/images/example-aircraft-photo.jpg", url: "https://replace-with-your-public-blob-url", altText: "Aircraft registration aircraft photograph", caption: "Optional short caption", credit: { name: "Photographer name", url: "", displayText: "Photo: Photographer name" }, displayOrder: 0, isVisible: true, uploadedAt: "2026-11-21T00:00:00.000Z" },
    aircraft: {}
  };
}

async function readGalleryManifest(): Promise<GalleryManifest> {
  const result = await list({ prefix: GALLERY_MANIFEST_PATH, limit: 1 });
  const manifestBlob = result.blobs.find(blob => blob.pathname === GALLERY_MANIFEST_PATH);
  if (!manifestBlob) {
    const initial = emptyGalleryManifest();
    await put(GALLERY_MANIFEST_PATH, JSON.stringify(initial, null, 2) + "\n", {
      access: "public", addRandomSuffix: false, allowOverwrite: true,
      contentType: "application/json", cacheControlMaxAge: 60
    });
    return initial;
  }
  const response = await fetch(manifestBlob.url + "?v=" + Date.now(), { cache: "no-store" });
  if (!response.ok) throw new Error("The aircraft gallery manifest could not be read from Blob.");
  const parsed = await response.json() as GalleryManifest;
  if (!parsed || typeof parsed !== "object" || !parsed.aircraft) throw new Error("The aircraft gallery manifest is invalid. Check aircraft-gallery/manifest.json.");
  return parsed;
}

async function mutateGalleryManifest(update: (manifest: GalleryManifest) => void): Promise<GalleryManifest> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await readGalleryManifest();
    const metadata = await head(GALLERY_MANIFEST_PATH);
    const { blobs } = await list({ prefix: GALLERY_MANIFEST_PATH, limit: 1 });
    const manifestBlob = blobs.find(blob => blob.pathname === GALLERY_MANIFEST_PATH);
    if (!manifestBlob) continue;
    const freshUrl = manifestBlob.url + "?etag=" + encodeURIComponent(metadata.etag);
    const response = await fetch(freshUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("The aircraft gallery manifest could not be read from Blob.");
    const manifest = await response.json() as GalleryManifest;
    if (!manifest || typeof manifest !== "object" || !manifest.aircraft) throw new Error("The aircraft gallery manifest is invalid.");
    update(manifest);
    manifest.manifestVersion = (Number(manifest.manifestVersion) || 0) + 1;
    manifest.lastUpdatedAt = new Date().toISOString();
    try {
      await put(GALLERY_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", {
        access: "public", addRandomSuffix: false, allowOverwrite: true,
        ifMatch: metadata.etag, contentType: "application/json", cacheControlMaxAge: 60
      });
      return manifest;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError && attempt < 3) continue;
      throw error;
    }
  }
  throw new Error("The gallery manifest changed repeatedly. Please retry the operation.");
}

async function requireGalleryAdmin() {
  const session = await getIFSession();
  if (!session) return { ok: false as const, status: 401, message: "Sign in with Infinite Flight first." };
  const response = await fetch(API_BASE + "/live/organizations/" + ORGANIZATION_ID, {
    headers: { Authorization: "Bearer " + session.accessToken }, cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  const role = payload?.result?.role;
  if (!response.ok || (role !== 1 && role !== 2)) return { ok: false as const, status: 403, message: "Only Virtual Blue organisation admins and owners can manage aircraft photos." };
  return { ok: true as const };
}

async function galleryRoute(request: NextRequest, parts: string[]) {
  try {
    if (parts.length === 1 && request.method === "GET") {
      return NextResponse.json(await readGalleryManifest(), { headers: { "Cache-Control": "no-store" } });
    }
    if (parts[1] === "upload" && request.method === "POST") {
      const auth = await requireGalleryAdmin();
      if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
      const form = await request.formData();
      const registration = String(form.get("registration") || "").trim().toUpperCase();
      const file = form.get("file");
      const creditName = String(form.get("creditName") || "").trim();
      const creditUrl = String(form.get("creditUrl") || "").trim();
      const caption = String(form.get("caption") || "").trim();
      if (!/^[A-Z0-9-]{2,16}$/.test(registration)) return NextResponse.json({ error: "Enter a valid aircraft registration." }, { status: 400 });
      if (!(file instanceof File) || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) return NextResponse.json({ error: "Choose a JPEG, PNG or WebP image." }, { status: 400 });
      if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "Images must be 4 MB or smaller." }, { status: 413 });
      if (creditUrl && !/^https?:\/\//i.test(creditUrl)) return NextResponse.json({ error: "Credit URL must start with https:// or http://." }, { status: 400 });
      const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
      const pathname = "aircraft-gallery/images/" + registration.toLowerCase() + "-" + randomUUID() + "." + extension;
      const blob = await put(pathname, file, { access: "public", addRandomSuffix: false, contentType: file.type, cacheControlMaxAge: 31536000 });
      const photo: GalleryPhoto = {
        id: randomUUID(), fileName: file.name, blobPath: blob.pathname, url: blob.url,
        altText: registration + " aircraft photograph", caption,
        credit: { name: creditName, url: creditUrl, displayText: creditName ? "Photo: " + creditName : "" },
        displayOrder: 0, isVisible: true, uploadedAt: new Date().toISOString()
      };
      try {
        const manifest = await mutateGalleryManifest(current => {
          const entry = current.aircraft[registration] || { registration, photos: [] };
          if (entry.photos.length >= 4) throw new Error("This aircraft already has four photos. Delete one before adding another.");
          photo.displayOrder = entry.photos.length;
          entry.photos.push(photo);
          current.aircraft[registration] = entry;
        });
        return NextResponse.json({ photo, manifestVersion: manifest.manifestVersion }, { status: 201 });
      } catch (error) {
        await del(blob.url).catch(() => undefined);
        if (error instanceof Error && error.message.includes("already has four photos")) return NextResponse.json({ error: error.message }, { status: 409 });
        throw error;
      }
    }
    if (parts[1] === "photo" && (request.method === "PATCH" || request.method === "DELETE")) {
      const auth = await requireGalleryAdmin();
      if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
      const payload = await request.json().catch(() => ({}));
      const registration = String(payload.registration || "").trim().toUpperCase();
      const photoId = String(payload.photoId || "");
      let removedUrl = "";
      const manifest = await mutateGalleryManifest(current => {
        const entry = current.aircraft[registration];
        const index = entry ? entry.photos.findIndex(photo => photo.id === photoId) : -1;
        if (!entry || index < 0) throw new Error("Photo not found in the gallery manifest.");
        if (request.method === "PATCH") {
          const photo = entry.photos[index];
          if (typeof payload.creditName === "string") photo.credit.name = payload.creditName.trim();
          if (typeof payload.creditUrl === "string") photo.credit.url = payload.creditUrl.trim();
          if (typeof payload.caption === "string") photo.caption = payload.caption.trim();
          if (typeof payload.isVisible === "boolean") photo.isVisible = payload.isVisible;
          photo.credit.displayText = photo.credit.name ? "Photo: " + photo.credit.name : "";
        } else {
          const removed = entry.photos.splice(index, 1)[0];
          removedUrl = removed.url;
          entry.photos.forEach((photo, order) => { photo.displayOrder = order; });
        }
      });
      if (request.method === "DELETE" && removedUrl) await del(removedUrl);
      return NextResponse.json({ success: true, manifestVersion: manifest.manifestVersion });
    }
    return NextResponse.json({ error: "Unknown aircraft gallery operation." }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Aircraft gallery operation failed.";
    return NextResponse.json({ error: message }, { status: message.includes("Photo not found") ? 404 : 500 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const PATCH = proxy;
