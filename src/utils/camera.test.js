import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  openCamera, stopStream, drawScaled, captureFrame, downscaleFile,
  canvasToBase64, MAX_PHOTO_EDGE, PHOTO_QUALITY, VIDEO_CONSTRAINTS, __testSeam,
} from './camera';

// A canvas that records what it was asked to do. The real one needs a browser;
// what these specs care about is the arithmetic and the plumbing around it.
function fakeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    drawn: null,
    quality: null,
    getContext: () => ({
      drawImage: (source, x, y, w, h) => { canvas.drawn = { source, x, y, w, h }; },
    }),
    toDataURL: (type, quality) => {
      canvas.quality = quality;
      return `data:${type};base64,PIXELS-${canvas.width}x${canvas.height}`;
    },
    toBlob: (cb, type, quality) => { canvas.quality = quality; cb({ type, size: 128 }); },
  };
  return canvas;
}

let canvases;
beforeEach(() => {
  canvases = [];
  __testSeam.set({ createCanvas: () => { const c = fakeCanvas(); canvases.push(c); return c; } });
});
afterEach(() => __testSeam.reset());

describe('openCamera — the fallback decision', () => {
  it('asks for the rear camera and no microphone', async () => {
    let asked;
    __testSeam.set({ getUserMedia: async (c) => { asked = c; return { getTracks: () => [] }; } });
    await openCamera();
    expect(asked).toEqual(VIDEO_CONSTRAINTS);
    expect(asked.video.facingMode).toEqual({ ideal: 'environment' });
    expect(asked.audio).toBe(false);
  });

  it('reports ok with the stream when the camera opens', async () => {
    const stream = { getTracks: () => [] };
    __testSeam.set({ getUserMedia: async () => stream });
    expect(await openCamera()).toEqual({ ok: true, stream });
  });

  // Denied, absent and insecure are one answer to the caller: use the file
  // input. Nothing in the UI branches on which — the fallback is identical.
  it.each([
    ['NotAllowedError', 'permission denied'],
    ['NotFoundError', 'no camera on the device'],
    ['NotReadableError', 'another app holds it'],
    ['TypeError', 'insecure context — mediaDevices is undefined'],
  ])('falls back on %s (%s)', async (name) => {
    __testSeam.set({ getUserMedia: async () => { const e = new Error('x'); e.name = name; throw e; } });
    const result = await openCamera();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(name);
  });

  it('falls back rather than throwing when getUserMedia resolves nothing', async () => {
    __testSeam.set({ getUserMedia: async () => null });
    expect(await openCamera()).toEqual({ ok: false, reason: 'no-stream' });
  });

  it('stops every track, and survives being called twice or on null', () => {
    const stopped = [];
    const stream = { getTracks: () => [{ stop: () => stopped.push('a') }, { stop: () => stopped.push('b') }] };
    stopStream(stream);
    stopStream(stream);
    stopStream(null);
    expect(stopped).toEqual(['a', 'b', 'a', 'b']);
  });

  it('does not let one dead track stop the rest', () => {
    const stopped = [];
    stopStream({ getTracks: () => [
      { stop: () => { throw new Error('already ended'); } },
      { stop: () => stopped.push('b') },
    ] });
    expect(stopped).toEqual(['b']);
  });
});

describe('drawScaled — one resize for both capture paths', () => {
  it('scales a landscape source to the long edge', () => {
    const canvas = drawScaled({}, 4032, 3024);
    expect(canvas.width).toBe(MAX_PHOTO_EDGE);
    expect(canvas.height).toBe(960);
  });

  it('scales a portrait source to the long edge', () => {
    const canvas = drawScaled({}, 3024, 4032);
    expect(canvas.width).toBe(960);
    expect(canvas.height).toBe(MAX_PHOTO_EDGE);
  });

  it('never upscales something already small', () => {
    const canvas = drawScaled({}, 640, 480);
    expect([canvas.width, canvas.height]).toEqual([640, 480]);
  });

  it('draws the whole source into the scaled box', () => {
    const source = { tag: 'video' };
    const canvas = drawScaled(source, 1920, 1080);
    expect(canvas.drawn).toEqual({ source, x: 0, y: 0, w: canvas.width, h: canvas.height });
  });

  it('encodes at the shared quality', () => {
    const canvas = drawScaled({}, 100, 100);
    expect(canvasToBase64(canvas)).toBe('PIXELS-100x100');
    expect(canvas.quality).toBe(PHOTO_QUALITY);
  });
});

describe('captureFrame — the frame to blob path', () => {
  it('measures the video by its intrinsic size, not its CSS box', async () => {
    const video = { videoWidth: 1920, videoHeight: 1080, clientWidth: 362, clientHeight: 480 };
    const frame = await captureFrame(video);
    expect(canvases[0].width).toBe(MAX_PHOTO_EDGE);
    expect(canvases[0].height).toBe(720);
    expect(frame.base64).toBe(`PIXELS-${MAX_PHOTO_EDGE}x720`);
  });

  it('returns a jpeg blob alongside the base64, at the shared quality', async () => {
    const frame = await captureFrame({ videoWidth: 800, videoHeight: 600 });
    expect(frame.blob).toEqual({ type: 'image/jpeg', size: 128 });
    expect(frame.mimeType).toBe('image/jpeg');
    expect(canvases[0].quality).toBe(PHOTO_QUALITY);
  });

  // A tap before the first frame would otherwise save a black rectangle.
  it.each([
    ['no frame yet', { videoWidth: 0, videoHeight: 0 }],
    ['no video at all', null],
  ])('returns null when there is nothing to grab — %s', async (_label, video) => {
    expect(await captureFrame(video)).toBeNull();
    expect(canvases).toHaveLength(0);
  });

  it('resolves the base64 even where toBlob is unavailable', async () => {
    __testSeam.set({ createCanvas: () => { const c = fakeCanvas(); c.toBlob = undefined; canvases.push(c); return c; } });
    const frame = await captureFrame({ videoWidth: 400, videoHeight: 400 });
    expect(frame.blob).toBeNull();
    expect(frame.base64).toBe('PIXELS-400x400');
  });
});

describe('downscaleFile — the file-input path shares the same resize', () => {
  const withImage = (behaviour) => {
    const revoked = [];
    globalThis.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: (u) => revoked.push(u) };
    __testSeam.set({
      createImage: () => {
        const img = { width: 3000, height: 2000 };
        Object.defineProperty(img, 'src', { set() { queueMicrotask(() => behaviour(img)); } });
        return img;
      },
    });
    return revoked;
  };

  it('produces the same output as a frame of the same dimensions', async () => {
    withImage((img) => img.onload());
    expect(await downscaleFile({})).toBe(`PIXELS-${MAX_PHOTO_EDGE}x853`);
  });

  it('revokes the object URL on both success and failure', async () => {
    let revoked = withImage((img) => img.onload());
    await downscaleFile({});
    expect(revoked).toEqual(['blob:fake']);

    revoked = withImage((img) => img.onerror());
    expect(await downscaleFile({})).toBeNull();
    expect(revoked).toEqual(['blob:fake']);
  });

  // Without the guard the promise never settles and the capture screen hangs
  // on a photo that will never arrive.
  it('resolves null rather than hanging when the canvas throws', async () => {
    withImage((img) => img.onload());
    __testSeam.set({ createCanvas: () => { throw new Error('no 2d context'); } });
    expect(await downscaleFile({})).toBeNull();
  });
});
