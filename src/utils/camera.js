// The camera seam. `getUserMedia` and `<canvas>` cannot run in the node test
// environment, so this module is the only place that touches either — the same
// shape keyVault.js uses for WebAuthn, where one module holds the untestable
// primitive and everything around it stays stubbable.
//
// It also owns the downscale, because there are now two ways a photo arrives —
// the native camera through the file input, and a frame grabbed off the live
// viewfinder — and they must produce byte-identical output. One resize, two
// callers.

// Photos are the one thing that can fill localStorage mid-trip, so they are
// downscaled at capture — this is also what goes to the model.
export const MAX_PHOTO_EDGE = 1280;
export const PHOTO_QUALITY = 0.8;

// `facingMode: { ideal: ... }` rather than `exact`: a laptop with only a front
// camera should still get a viewfinder, not a rejection.
export const VIDEO_CONSTRAINTS = { video: { facingMode: { ideal: 'environment' } }, audio: false };

const DEFAULTS = {
  // Referenced lazily: `navigator` does not exist at import time under vitest.
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createCanvas: () => document.createElement('canvas'),
  createImage: () => new Image(),
};
let seam = { ...DEFAULTS };

/**
 * Acquire the rear camera. Never throws — a denied permission, a machine with
 * no camera and an insecure context are all the same answer to the caller:
 * fall back to the file input. `reason` is carried for logging only; nothing
 * in the UI branches on it, because there is no useful difference between
 * "denied" and "absent" when the fallback is identical.
 */
export async function openCamera() {
  try {
    const stream = await seam.getUserMedia(VIDEO_CONSTRAINTS);
    if (!stream) return { ok: false, reason: 'no-stream' };
    return { ok: true, stream };
  } catch (e) {
    return { ok: false, reason: e?.name ?? 'unknown' };
  }
}

/** Stops every track. Safe to call twice, and on null. */
export function stopStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) {
    try { track.stop(); } catch { /* already ended */ }
  }
}

/**
 * The one resize. Takes anything drawable plus its intrinsic dimensions, so a
 * <video> (videoWidth/videoHeight) and an <img> (width/height) go through the
 * same arithmetic. Never upscales.
 */
export function drawScaled(source, width, height) {
  const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(width, height));
  const canvas = seam.createCanvas();
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export const canvasToBase64 = (canvas) =>
  canvas.toDataURL('image/jpeg', PHOTO_QUALITY).split(',')[1];

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') return resolve(null);
    canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY);
  });
}

/**
 * Grab the current frame off a live <video>.
 *
 * Returns a blob as well as the base64 so the caller can build a real File and
 * hand it to the existing photo pipeline unchanged — a viewfinder photo is the
 * same shape as a file-input one, including the `file` field that the unmount
 * cleanup uses to decide whether a blob URL is fresh enough to revoke.
 *
 * Null when the stream has not produced a frame yet: a tap that would save a
 * black rectangle is better spent doing nothing.
 */
export async function captureFrame(video) {
  const width = video?.videoWidth ?? 0;
  const height = video?.videoHeight ?? 0;
  if (!width || !height) return null;
  const canvas = drawScaled(video, width, height);
  return { blob: await canvasToBlob(canvas), base64: canvasToBase64(canvas), mimeType: 'image/jpeg' };
}

/**
 * The file-input path: decode, then the same resize. A phone photo is ~4MB and
 * localStorage caps near 5MB, so full-size base64 fills it inside a dozen items.
 * Resolves null rather than rejecting — the caller falls back to the original
 * bytes.
 */
export function downscaleFile(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = seam.createImage();
    img.onload = () => {
      let base64 = null;
      try { base64 = canvasToBase64(drawScaled(img, img.width, img.height)); } catch { /* fall back */ }
      URL.revokeObjectURL(url);
      resolve(base64);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

export const __testSeam = {
  set(overrides) { seam = { ...seam, ...overrides }; },
  reset() { seam = { ...DEFAULTS }; },
};
