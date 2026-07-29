import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { analyzeItem } from '../utils/ai';
import { openCamera, stopStream, captureFrame, downscaleFile } from '../utils/camera';
import * as photoStore from '../utils/photoStore';
import { saveConversation, updateItemContext, markStatus, getConversation } from '../utils/conversationStore';
import { useToast } from '../contexts/ToastContext';
import { shoppingService } from '../utils/storageService';
import { useUser } from '../contexts/UserContext';
import { calcProfit, checkRules, pencilFloor, usablePrice } from '../utils/calculations';
import { getSoldComps, repriceFromComps } from '../utils/soldComps';
import { researchQuery, soldSearchUrl, copyText, RESEARCH_STEPS } from '../utils/researchRails';
import { DEFAULT_SHIPPING } from '../config/gemini';
import Button from './ui/Button';
import Chip from './ui/Chip';
import StatusTag from './ui/StatusTag';
import Card from './ui/Card';
import { Panel, PanelRow, PanelTotal } from './ui/Panel';
import VerdictBanner from './ui/VerdictBanner';
import ListingPreviewCard from './ui/ListingPreviewCard';
import Sheet from './ui/Sheet';
import { Input } from './ui/Field';
import ActionBar from './ui/ActionBar';
import { Shutter, CamSide, PhotoRemoveDot } from './ui/CameraControls';
import './ShoppingMode.css';

const CONDITIONS = ['Like New', 'Excellent', 'Good', 'Fair'];
const MAX_PHOTOS = 3;

// Analyze failures get specific copy — never "something went wrong". A wrong
// diagnosis here sends someone to re-paste a key that was fine all along.
const ERROR_COPY = {
  'bad-key': "That key didn't work — check the paste caught the whole thing",
  quota: 'Key works but Google says it’s out of free calls today',
  offline: 'No signal · the verdict catches up on its own',
  'bad-response': 'Odd reply from the model — try again',
  // The other 429, and the one a free-tier key actually hits on a real trip:
  // 20 requests a day against a Saturday of ~35 items (H2). "Try again in a
  // minute" would be a lie, so this says what is true and points at the two
  // things that still work without the model.
  'quota-daily': 'Daily AI limit reached — verdicts return tomorrow. Pencil math still works, and the cart flags anything it disagrees with later.',
  // N1-lite: the key is in the vault, so a declined unlock is its own failure
  // and must not be diagnosed as a bad key.
  locked: 'Unlock cancelled — verdicts need your key',
  'vault-unavailable': "Private Browsing won't let Thrift Flip open your key",
  'crypto-unavailable': 'Verdicts need a secure (https) connection',
};

function loadForm() {
  // Direct read — sync required for useState lazy init
  try { return JSON.parse(localStorage.getItem('thrift-flip-shopping-form')); } catch { return null; }
}
function loadVerdict() {
  // Direct read — sync required for useState lazy init
  try { return JSON.parse(localStorage.getItem('thrift-flip-shopping-verdict')); } catch { return null; }
}

async function fileToBase64(photo) {
  if (photo.base64) return photo.base64;
  const response = await fetch(photo.previewUrl);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e  => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function ChartIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 15l4-4 3 3 5-6" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}
function BulbIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a7 7 0 017 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 017-7z" />
      <path d="M9 22h6" />
    </svg>
  );
}

export default function ShoppingMode({ onAddToCart, onNavigateToCart, onGoToFlip, onGoToSelling, onCamActive, onOpenSettings }) {
  const { showToast } = useToast();
  const { user } = useUser(); // TODO: check user.plan analysis limits before analyze

  // Read once at mount and never written again. Held in state rather than a ref
  // so the lazy initializers below may legally read it during render — the same
  // correction VaultGate took at N1-lite, for the same rule.
  const [savedForm]    = useState(loadForm);
  const [savedVerdict] = useState(loadVerdict);

  const [phase, setPhase] = useState(() => {
    if (savedVerdict?.phase === 'verdict' && savedVerdict?.analysisResult) return 'verdict';
    if (savedVerdict?.phase === 'pencil' && savedVerdict?.itemId) return 'pencil';
    return 'capture';
  });
  // Photos live in IndexedDB since V3, so they cannot be read synchronously in
  // a lazy initializer the way the rest of the form is. They arrive in the
  // rehydration effect below; `photoCount` is what the form now carries, purely
  // so the capture strip knows how many are coming.
  const [photos, setPhotos] = useState([]);
  const [photosHydrated, setPhotosHydrated] = useState(false);
  const [details,        setDetails]       = useState(() => savedForm?.details       ?? '');
  const [condition,      setCondition]     = useState(() => savedForm?.condition     ?? '');
  const [goodwillPrice,  setGoodwillPrice] = useState(() => savedForm?.goodwillPrice ?? '');
  const [analysisResult, setAnalysisResult]= useState(() => savedVerdict?.analysisResult ?? null);
  const [itemId,         setItemId]        = useState(() => savedVerdict?.itemId     ?? null);
  const [chatHistory,    setChatHistory]   = useState(() => {
    const id = savedVerdict?.itemId;
    return id ? (getConversation(id)?.chatHistory ?? []) : [];
  });
  const [errorCode,      setErrorCode]     = useState(null);
  const [keyCardHidden,  setKeyCardHidden] = useState(false); // per session, never a wall
  const [whyOpen,        setWhyOpen]       = useState(false);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  // Shown under the price field when he taps through without reading the tag.
  // Cleared by the next keystroke there — it is a reminder, not a rejection.
  const [priceNudge,     setPriceNudge]     = useState(false);
  const [rechecking,     setRechecking]     = useState(false);
  // The research coach mark. Persistent rather than a toast: it carries four
  // steps he has to perform, and a toast clears before he has read them.
  const [researchCopied, setResearchCopied] = useState(false);

  // The live viewfinder. `stream` drives the render; `streamRef` is the
  // synchronous truth the acquire/release pair needs, since both can run
  // between two renders.
  const [stream, setStreamState] = useState(null);
  const [camFailed, setCamFailed] = useState(false);
  const camMode = stream ? 'live' : camFailed ? 'fallback' : 'idle';

  const fileInputRef  = useRef(null);
  const priceInputRef = useRef(null);
  const videoRef     = useRef(null);
  const streamRef    = useRef(null);
  const photosRef    = useRef([]);
  const reqSeq       = useRef(0);
  const quotaWarned  = useRef(false);
  // The double-tap latch. A ref because `setRechecking` does not land until the
  // next render: two taps inside one frame both read `false` from the state and
  // both bill his key. `disabled` covers the human case; this covers the frame.
  const recheckLatch = useRef(false);

  const setStream = (next) => { streamRef.current = next; setStreamState(next); };

  // A blob URL from stored bytes, so a restored photo renders like a fresh one.
  const toPreview = ({ base64, mimeType }) => ({
    file: null,
    base64,
    mimeType: mimeType || 'image/jpeg',
    previewUrl: URL.createObjectURL(
      new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: mimeType || 'image/jpeg' })
    ),
  });

  // Rehydrate the capture strip, and migrate any pre-V3 photos out of the form
  // on the way. `savedForm` was read before any effect ran, so the
  // legacy bytes are still readable here even though the persistence effect
  // below has already rewritten the slimmed form.
  useEffect(() => {
    let live = true;
    const restoreKey = savedVerdict?.itemId ?? photoStore.IN_FLIGHT;
    (async () => {
      const legacy = savedForm?.photoBase64s ?? [];
      if (legacy.length) {
        const migrated = legacy
          .map(item => (typeof item === 'string'
            ? { base64: item, mimeType: 'image/jpeg' }
            : { base64: item.b64, mimeType: item.mime || 'image/jpeg' }))
          .filter(p => p.base64);
        if (migrated.length) await photoStore.put(restoreKey, migrated);
      }
      const stored = await photoStore.get(restoreKey);
      if (live) setPhotos(stored.map(toPreview));
    })()
      .catch(() => { /* a broken store must not take the capture screen down */ })
      .finally(() => { if (live) setPhotosHydrated(true); });
    return () => { live = false; };
    // Both are set once and never written again, so listing them keeps this a
    // mount-only effect while satisfying the rule honestly.
  }, [savedForm, savedVerdict]);

  // Capture writes straight through to the store, under the item's id once it
  // has one and the reserved in-flight key before that.
  useEffect(() => {
    if (!photosHydrated) return;
    const payload = photos.map(p => ({ base64: p.base64, mimeType: p.mimeType })).filter(p => p.base64);
    photoStore.put(itemId ?? photoStore.IN_FLIGHT, payload).catch(() => { /* surfaced on read */ });
  }, [photos, itemId, photosHydrated]);

  // Keep photosRef in sync for unmount cleanup
  useEffect(() => { photosRef.current = photos; }, [photos]);

  // Only revoke blob URLs for fresh photos on unmount — restored photos (file: null) keep their URLs alive across tab switches
  useEffect(() => () => {
    photosRef.current
      .filter(p => p.file !== null)
      .forEach(p => URL.revokeObjectURL(p.previewUrl));
  }, []);

  useEffect(() => {
    // No photo bytes here any more — they are in photoStore. This form was the
    // single biggest thing in localStorage and the first thing a real trip
    // would have broken (plan §6.1).
    // `shipping` left this blob at M2 — the key is unchanged, the field simply
    // stops being written, and a stale one in an old blob stops being read.
    shoppingService.setForm({ details, condition, goodwillPrice, photoCount: photos.length }).then(written => {
      // A full quota is a silent write failure otherwise — and the thing lost is
      // the capture in progress. Latched so it warns once, not once per keystroke.
      if (written === false && !quotaWarned.current) {
        quotaWarned.current = true;
        showToast('Storage full — export a backup, then remove old drafts', 'error');
      } else if (written !== false) {
        quotaWarned.current = false;
      }
    });
  }, [details, condition, goodwillPrice, photos, showToast]);

  useEffect(() => {
    if (phase === 'pencil' && itemId) {
      shoppingService.setVerdict({ phase: 'pencil', itemId });
    } else if (phase === 'verdict' && analysisResult) {
      shoppingService.setVerdict({ analysisResult, phase, itemId });
    }
  }, [phase, analysisResult, itemId]);

  // The capture phase owns the whole viewport — App hides the nav while it's up.
  // Layout effect so in-session phase transitions repaint App before the frame (no nav pop).
  useLayoutEffect(() => { onCamActive?.(phase === 'capture'); }, [phase, onCamActive]);

  // The camera runs only while the capture screen is up, and only while the app
  // is in front. iOS reclaims the stream on backgrounding, so re-acquiring on
  // return is the ordinary path rather than error handling — but a *failed*
  // acquisition is terminal for this visit. It means no camera or a declined
  // permission, and asking again would be a nag; the file input is the flow
  // that worked before any of this existed.
  useEffect(() => {
    if (phase !== 'capture') return undefined;
    let cancelled = false;

    function release() {
      stopStream(streamRef.current);
      setStream(null);
    }

    async function acquire() {
      if (cancelled || streamRef.current || document.visibilityState === 'hidden') return;
      const result = await openCamera();
      // The permission sheet can outlive the screen that asked for it.
      if (cancelled || document.visibilityState === 'hidden') return stopStream(result.stream);
      if (!result.ok) return setCamFailed(true);
      for (const track of result.stream.getTracks()) track.addEventListener('ended', onTrackEnded);
      setCamFailed(false);
      setStream(result.stream);
    }

    function onTrackEnded() {
      if (cancelled) return;
      release();
      acquire();
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') release();
      else acquire();
    }

    acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [phase]);

  // srcObject has no React prop, and the element only exists once the stream
  // has caused a render — so the assignment belongs in an effect, not in acquire.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    // Muted + playsInline, so a refusal here means no preview rather than a
    // policy violation; either way it must not take the screen down.
    if (stream) video.play?.().catch(() => {});
  }, [stream]);

  // The one place the cap lives, so it cannot drift between the two ways a
  // photo now arrives. `offered` is how many were handed over before the caller
  // trimmed them, which is what decides whether to say anything.
  function addPhotos(incoming, offered = incoming.length) {
    if (offered > MAX_PHOTOS - photos.length) showToast(`Maximum ${MAX_PHOTOS} photos allowed`, 'error');
    if (!incoming.length) return;
    // Clamped inside the updater too: two shutter taps in the same frame would
    // otherwise both read the same stale length.
    setPhotos(prev => [...prev, ...incoming].slice(0, MAX_PHOTOS));
  }

  async function handlePhotoChange(e) {
    const files = Array.from(e.target.files);
    const room = Math.max(0, MAX_PHOTOS - photos.length);
    const newPhotos = await Promise.all(files.slice(0, room).map(async f => {
      const previewUrl = URL.createObjectURL(f);
      const downscaled = await downscaleFile(f);
      // Canvas re-encodes to JPEG; fall back to the original bytes if it fails
      return downscaled
        ? { file: f, previewUrl, base64: downscaled, mimeType: 'image/jpeg' }
        : { file: f, previewUrl, base64: await fileToBase64({ previewUrl }), mimeType: f.type || 'image/jpeg' };
    }));
    addPhotos(newPhotos, files.length);
    e.target.value = '';
  }

  // One tap. Live: grab the frame that is already on screen. Anything else:
  // the native camera, exactly as before this existed.
  async function handleShutter() {
    if (camMode !== 'live') return fileInputRef.current?.click();
    const frame = await captureFrame(videoRef.current);
    if (!frame) return; // no frame yet — a tap that would save black does nothing
    const file = frame.blob
      ? new File([frame.blob], `capture-${Date.now()}.jpg`, { type: frame.mimeType })
      : null;
    addPhotos([{
      file,
      // A data URL when there is no blob to point at; revoking one is a no-op,
      // which is why the cleanup's `file !== null` test stays correct.
      previewUrl: file ? URL.createObjectURL(file) : `data:${frame.mimeType};base64,${frame.base64}`,
      base64: frame.base64,
      mimeType: frame.mimeType,
    }]);
  }

  function handleRemovePhoto(index) {
    const target = photos[index];
    if (target) URL.revokeObjectURL(target.previewUrl);
    const next = photos.filter((_, i) => i !== index);
    setPhotos(next);
    if (next.length === 0) setPhotoSheetOpen(false);
  }

  /**
   * Comps tier A. Runs AFTER the verdict is rendered and upgrades it in place.
   *
   * Every failure here is silent by design. A scraper that cannot reach eBay is
   * not a fact about the mug in his hand, and the model's estimate — which is
   * already on screen — remains a complete answer on its own.
   */
  async function attachSoldComps(id, myReq, result, price) {
    let sold;
    try {
      sold = await getSoldComps({
        identification: result?.identification,
        listingTitle: result?.listing?.title,
      });
    } catch { return; }
    if (!sold) return;                        // no data is the common answer
    if (reqSeq.current !== myReq) return;     // skipped, carted or re-checked meanwhile

    const { next, flipped } = repriceFromComps(result, sold, price);
    setAnalysisResult(prev => (prev ? { ...prev, ...next } : next));
    // The chat gets the same sales the banner did, so Flip defends the price
    // on screen rather than re-deriving a different one.
    updateItemContext(id, { soldComps: sold });
    // A price that merely moves stays quiet. A verdict that reverses after he
    // has already read BUY is the one case that must interrupt — he may have
    // the thing in his hand by now.
    if (flipped) {
      const { verdict } = checkRules(next.estSellPrice, Number(price) || 0, next.netProfit);
      showToast(
        verdict === 'buy'
          ? `Sold data says BUY IT — ${next.soldComps.count} recent sales`
          : `Sold data says LEAVE IT — ${next.soldComps.count} recent sales`,
        verdict === 'buy' ? 'success' : 'error',
      );
    }
  }

  /**
   * @param {object} [opts]
   * @param {boolean} [opts.revision] A re-check of an item that already has a
   *   verdict. It carries new notes or a new condition, so the item's *context*
   *   changes — but the conversation about it does not. saveConversation writes
   *   the whole record, chatHistory included, so using it here would replace a
   *   real Flip thread with this analysis's one-line teaser.
   */
  async function runAnalyze(id, { revision = false } = {}) {
    const myReq = ++reqSeq.current;
    try {
      const validPhotos = photos.filter(p => p.previewUrl);
      const photoBase64s = await Promise.all(validPhotos.map(fileToBase64));
      const mimeTypes = validPhotos.map(p => p.mimeType || 'image/jpeg');
      const price = parseFloat(goodwillPrice);
      const result = await analyzeItem({
        photoBase64s, mimeTypes, details, condition,
        goodwillPrice: price,
      });
      if (reqSeq.current !== myReq) return; // stale — skipped, carted, or reset mid-flight
      const context = { details, condition, goodwillPrice: price };
      if (revision) updateItemContext(id, context);
      else saveConversation(id, details.slice(0, 60) || 'Item', result.chatHistory || [], context);
      // `analyzedAs` is what this verdict was actually computed from, so the
      // re-check row below knows whether anything has since changed. Both it and
      // `revised` ride the result, which is already persisted whole — no new
      // storage key, and both reach the cart for free.
      setAnalysisResult({ ...result, revised: revision, analyzedAs: { details, condition } });
      // A revision is not a chat turn: the thread it would overwrite is the one
      // the requirement says has to survive.
      if (!revision) setChatHistory(result.chatHistory || []);
      setErrorCode(null);
      setPhase('verdict');
      // Tier A, deliberately unawaited: the verdict is on screen by now and
      // must never wait on a network round-trip to a scraper. Comps attach.
      attachSoldComps(id, myReq, result, price);
    } catch (e) {
      // Log the code only — an error carrying the request URL would carry the key
      console.error('runAnalyze failed:', e?.code ?? 'unknown');
      if (reqSeq.current !== myReq) return;
      setErrorCode(e?.code ?? 'bad-response');
      // A cancelled unlock deserves an immediate answer rather than only the
      // banner; the pencil floor stays on screen and nothing retries.
      if (e?.code === 'locked') showToast(ERROR_COPY.locked, 'error');
      // The pencil screen carries a banner for this; the verdict screen does not,
      // and the standing verdict stays up because it is still the last real
      // answer. A toast is the whole of the report.
      else if (revision) showToast(ERROR_COPY[e?.code] ?? ERROR_COPY['bad-response'], 'error');
    }
  }

  // Resume an analysis lost to a refresh — restored pencil phase re-fires from
  // persisted form data. Declared after runAnalyze so the reference is a plain read.
  useEffect(() => {
    if (phase === 'pencil' && !analysisResult) {
      const price = parseFloat(goodwillPrice);
      if (!price || price <= 0 || !itemId) {
        shoppingService.clearVerdict();
        setPhase('capture');
        return;
      }
      runAnalyze(itemId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleGetVerdict() {
    // Against a cost basis of zero the 3× rule reads `sellPrice >= 0` and stops
    // meaning anything, so no price means no analysis. Inline and quiet: he is
    // holding the thing, not filling in a form.
    if (!usablePrice(goodwillPrice)) {
      setPriceNudge(true);
      priceInputRef.current?.focus();
      return;
    }
    const newId = Date.now();
    // The photos were captured before this item had an id; hand them over.
    photoStore.promote(photoStore.IN_FLIGHT, newId).catch(() => { /* surfaced on read */ });
    setItemId(newId);
    setErrorCode(null);
    setPhase('pencil');
    runAnalyze(newId);
  }

  // The third door into runAnalyze, and the one this build added — so it asks
  // the same question of the price the other two do.
  async function handleRecheck() {
    if (recheckLatch.current) return;
    if (!usablePrice(goodwillPrice)) return;
    recheckLatch.current = true;
    setRechecking(true);
    try {
      await runAnalyze(itemId, { revision: true });
    } finally {
      recheckLatch.current = false;
      setRechecking(false);
    }
  }

  function handleSkip() {
    reqSeq.current++; // invalidate any in-flight verdict
    resetForm();
  }

  function handleAddToCart() {
    reqSeq.current++; // invalidate any in-flight verdict — no stamped flash during the toast window
    const gp = parseFloat(goodwillPrice);
    let payload;
    if (phase === 'verdict' && analysisResult) {
      const { estSellPrice, fees, netProfit, soldCount, sellThroughRate, avgDaysToSell, activeListings,
              listing, listingMercari } = analysisResult;
      // The model's clamped estimate, already spent in `fees` and `netProfit`
      // by adapt() — recomputing it here would let the two disagree.
      const ship = analysisResult.shipping ?? DEFAULT_SHIPPING;
      payload = {
        id: itemId,
        name: details.slice(0, 60) || 'Unnamed Item',
        condition,
        goodwillPrice: gp,
        estSellPrice,
        fees,
        shipping: ship,
        netProfit,
        // Model-only comps at V1 — the cart renders these straight into pills,
        // so nulls have to become dashes here or they print as "nulld avg sale"
        soldCount: soldCount ?? 0,
        sellThroughRate: sellThroughRate ?? '–',
        avgDaysToSell: avgDaysToSell ?? '–',
        activeListings: activeListings ?? 0,
        // The model's own listing, both registers — the editor seeds from these
        // instead of regenerating a placeholder one (V1.5/E0)
        listing: listing ?? null,
        listingMercari: listingMercari ?? null,
        chatHistory,
      };
    } else {
      // Pencil-phase add: local figures only; the verdict reconciliation flags
      // this item later. No analysis means no shipping estimate, so the house
      // default stands in — as it did for every pencil item before M2.
      const ship = DEFAULT_SHIPPING;
      const floor = pencilFloor(gp, ship);
      const { ebayFee, net } = calcProfit(floor, gp, ship);
      payload = {
        id: itemId,
        name: details.slice(0, 60) || 'Unnamed Item',
        condition,
        goodwillPrice: gp,
        estSellPrice: floor,
        fees: ebayFee,
        shipping: ship,
        netProfit: net,
        soldCount: 0,
        sellThroughRate: '–',
        avgDaysToSell: '–',
        activeListings: 0,
        // Pencil items were never analyzed, so there is no model listing to carry;
        // CartMode falls back to the mock generator for these.
        listing: null,
        listingMercari: null,
        chatHistory: [],
        pending: true,
      };
    }
    onAddToCart(payload);
    if (itemId) markStatus(itemId, 'cart');
    showToast('Added to cart!');
    setTimeout(() => {
      resetForm();
      onNavigateToCart();
    }, 1200);
  }

  function resetForm() {
    shoppingService.clearAll();
    photos.forEach(p => URL.revokeObjectURL(p.previewUrl));
    setPhotos([]);
    setPhase('capture');
    setDetails('');
    setCondition('');
    setGoodwillPrice('');
    setAnalysisResult(null);
    setChatHistory([]);
    setItemId(null);
    setErrorCode(null);
    setWhyOpen(false);
    setPhotoSheetOpen(false);
    setResearchCopied(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const lastPhoto = photos[photos.length - 1];

  function renderCapture() {
    return (
      <div className="buy-cam">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          style={{ display: 'none' }}
          onChange={handlePhotoChange}
        />
        <div className="buy-vf">
          {camMode !== 'fallback' && (
            <video ref={videoRef} className="buy-vf-video" autoPlay playsInline muted />
          )}
          {/* Only the fallback needs framing help — with a live preview the
              brackets would sit over the thing they were standing in for. */}
          {camMode === 'fallback' && (
            <>
              {lastPhoto && <img className="buy-vf-backdrop" src={lastPhoto.previewUrl} alt="" />}
              <i className="buy-bk buy-bk1" /><i className="buy-bk buy-bk2" />
              <i className="buy-bk buy-bk3" /><i className="buy-bk buy-bk4" />
            </>
          )}
        </div>
        <div className="buy-details">
          <Input
            placeholder="Notes — brand, model, size"
            value={details}
            onChange={e => setDetails(e.target.value)}
          />
          <div className="buy-chips">
            {CONDITIONS.map(c => (
              <Chip key={c} selected={condition === c} onPress={() => setCondition(c)}>{c}</Chip>
            ))}
          </div>
          {/* Shipping used to sit beside this. Nobody can weigh a lamp in an
              aisle, so the model estimates it now and the verdict shows what it
              assumed. The sticker price is the one number Dad can actually read. */}
          <div className="buy-money-row">
            <Input
              ref={priceInputRef}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="Goodwill price $0.00"
              value={goodwillPrice}
              onChange={e => { setGoodwillPrice(e.target.value); setPriceNudge(false); }}
            />
          </div>
          {priceNudge && <p className="buy-price-nudge">What's on the tag?</p>}
          {photos.length > 0 && (
            <Button full onClick={handleGetVerdict}>Get the verdict</Button>
          )}
        </div>
        <div className="buy-cam-ctl">
          {lastPhoto ? (
            <CamSide onClick={() => setPhotoSheetOpen(true)} aria-label="Manage photos">
              <img src={lastPhoto.previewUrl} alt="" />
            </CamSide>
          ) : (
            <span className="buy-cam-spacer" />
          )}
          <Shutter onClick={handleShutter} aria-label="Take photo" />
          <CamSide onClick={onGoToSelling} aria-label="Selling"><ChartIcon /></CamSide>
        </div>
        <Sheet open={photoSheetOpen} onClose={() => setPhotoSheetOpen(false)} title={`Photos · ${photos.length} / ${MAX_PHOTOS}`}>
          <div className="buy-sheet-strip">
            {photos.map((p, i) => (
              <div key={i} className="buy-sheet-thumb">
                <img src={p.previewUrl} alt={`Photo ${i + 1}`} />
                <PhotoRemoveDot onClick={() => handleRemovePhoto(i)} />
              </div>
            ))}
          </div>
          {photos.length < MAX_PHOTOS && (
            <Button variant="outline" full onClick={() => fileInputRef.current?.click()}>Add another photo</Button>
          )}
        </Sheet>
      </div>
    );
  }

  function renderPencil() {
    const gp = parseFloat(goodwillPrice) || 0;
    // No analysis has come back, so there is no estimate to use — this is the
    // house figure, and the panel says so rather than implying it was measured.
    const ship = DEFAULT_SHIPPING;
    const floor = pencilFloor(gp, ship);
    const feesAtFloor = calcProfit(floor, gp, ship).ebayFee;
    const noKey = errorCode === 'no-key';
    return (
      <div className="screen buy-barred">
        {errorCode && !noKey && (
          <StatusTag tone="mute" className="buy-sig">
            <i className="buy-sig-dot" />{ERROR_COPY[errorCode] ?? ERROR_COPY['bad-response']}
          </StatusTag>
        )}
        <VerdictBanner verdict="pencil" label="Your call for now" detail="figured on this phone" />
        <Panel title="What it must sell for">
          <div className="buy-floor money">
            ${floor.toFixed(2)}<span className="buy-floor-suffix"> or more</span>
          </div>
          <PanelRow label="Paid at Goodwill" value={`−$${gp.toFixed(2)}`} />
          <PanelRow label={`Fees + shipping (est. $${ship})`} value={`−$${(feesAtFloor + ship).toFixed(2)}`} />
          <PanelRow label="Your rules — 3× and $20 net" value={`$${floor.toFixed(2)} floor`} />
          <div className="buy-floor-q">Would a buyer pay ${Math.ceil(floor)}?</div>
        </Panel>
        {noKey && !keyCardHidden && (
          <Card className="buy-keycard">
            <div>
              <b>Add your AI key to get stamped verdicts</b>
              <p>Verdicts run on your key, straight from this phone, no middleman.</p>
            </div>
            <div className="buy-keycard-actions">
              <Button size="sm" onClick={onOpenSettings}>Add key</Button>
              <Button size="sm" variant="outline" onClick={() => setKeyCardHidden(true)}>Not now</Button>
            </div>
          </Card>
        )}
        {errorCode === 'bad-key' && (
          <Button variant="outline" full onClick={onOpenSettings}>Check your AI key</Button>
        )}
        <p className="buy-reassure">Acting now is fine — if the verdict disagrees later, it flags the item in your cart.</p>
        <ActionBar>
          <Button variant="danger" onClick={handleSkip}>Skip it</Button>
          <Button onClick={handleAddToCart}>Add to cart</Button>
        </ActionBar>
      </div>
    );
  }

  /**
   * Velocity in the words Dad already uses. The deep-dive (§6) records his
   * second question after "what's it worth" as "do they sell often?", and this
   * is that answer — sit-time, not margin.
   *
   * Null when the window could not be measured. A confident "sells ~4/week" on
   * a shelf-sitter would cost him a month of storage, so silence wins.
   */
  function velocityLine(sold) {
    const v = sold?.velocityPerWeek;
    if (!Number.isFinite(v) || v <= 0) return null;
    if (v >= 1) return `Sells ~${Math.round(v)}/week — moves quickly.`;
    if (v >= 0.25) return `Sells ~${Math.round(v * 4.3)}/month.`;
    return 'Slow mover — expect 1–2 months on the shelf.';
  }

  // Closing the sheet retires the coach mark: its four steps describe a
  // clipboard that the next item's copy will have replaced.
  function closeWhySheet() {
    setWhyOpen(false);
    setResearchCopied(false);
  }

  /**
   * The hand-off into the app that has the good data.
   *
   * Nothing is opened afterwards — there is no URL that reaches Product
   * Research on a phone. The clipboard IS the rail, so the copy has to be
   * reported honestly: a silent failure would send him to the app to paste
   * something that is not there.
   */
  async function handleCopyForResearch() {
    const query = researchQuery({
      identification: analysisResult?.identification,
      listingTitle: analysisResult?.listing?.title,
      note: details,
    });
    if (await copyText(query)) {
      setResearchCopied(true);
      showToast('Copied — paste it in the eBay app', 'success');
    } else {
      setResearchCopied(false);
      showToast('Copy failed — long-press the title above to copy it', 'error');
    }
  }

  function renderWhySheet() {
    const { estSellPrice, confidence, rationale, priceRange } = analysisResult;
    const [lo, hi] = priceRange ?? [];
    const hasRange = Number.isFinite(lo) && Number.isFinite(hi);
    // One string behind both rails. `researchQuery` normalizes the model's read
    // the same way the comps lookup does and falls back to what Dad typed, so
    // the link and the clipboard can never describe two different items.
    const searchTitle = researchQuery({
      identification: analysisResult.identification,
      listingTitle: analysisResult.listing?.title,
      note: details,
    }) || 'thrift find';
    // The comps that actually informed THIS estimate, carried back by adapt() —
    // not recomputed, so the sheet can never cite a sale the model never saw.
    const ownSales = analysisResult.comps?.samples ?? [];
    const soldComps = analysisResult.soldComps ?? null;
    const soldPriced = analysisResult.source === 'ebay-sold';
    const modelEstimate = analysisResult.modelEstimate;
    const velocity = velocityLine(soldComps);
    return (
      <Sheet
        open={whyOpen}
        onClose={closeWhySheet}
        title={<>Where <span className="money">${estSellPrice.toFixed(2)}</span> comes from</>}
      >
        <div className="buy-src">
          <div className="buy-src-ic mute"><BulbIcon /></div>
          <div>
            <b>Model read · {confidence ?? 'low'} confidence</b>
            <p>{rationale || 'No reasoning came back with this estimate.'}</p>
            {/* Once sold data has taken the wheel the model's own number stays
                on screen beside it. He asked for a price and got two; hiding
                the one that lost is how a receipt becomes an assertion. */}
            {soldPriced && Number.isFinite(modelEstimate) && (
              <p className="money">It estimated ${modelEstimate.toFixed(2)}.</p>
            )}
            {hasRange && !soldPriced && <p className="money">Range ${lo.toFixed(2)}–${hi.toFixed(2)}.</p>}
          </div>
        </div>
        <div className="buy-src">
          <div className="buy-src-ic green"><CheckIcon /></div>
          <div>
            <b>Your own sales</b>
            {ownSales.length === 0 ? (
              <p>None yet — fills in as you sell.</p>
            ) : ownSales.slice(0, 2).map((s, i) => (
              <p key={i}>
                You sold one for ${s.price.toFixed(2)}
                {s.daysToSell === null ? '' : ` in ${s.approxDays ? 'about ' : ''}${s.daysToSell} day${s.daysToSell === 1 ? '' : 's'}`}.
              </p>
            ))}
          </div>
        </div>
        <div className="buy-src">
          <div className="buy-src-ic blue"><SearchIcon /></div>
          <div>
            <b>eBay sold listings</b>
            {!soldComps ? (
              <p>Not available for this one — check them yourself below. Sold prices are the only ground truth.</p>
            ) : (
              <>
                <p className="money">
                  Median ${soldComps.median.toFixed(2)} · ${soldComps.low.toFixed(2)}–${soldComps.high.toFixed(2)}
                  {' '}across {soldComps.count} sold
                  {soldComps.windowDays ? ` in ${soldComps.windowDays} days` : ''}.
                </p>
                {/* Under three sales there is no median worth the name, so the
                    model keeps the price and this stays context. Saying which
                    is which is the difference between data and decoration. */}
                {!soldPriced && (
                  <p>Only {soldComps.count} recent sale{soldComps.count === 1 ? '' : 's'} — thin data, so the model&rsquo;s price stands.</p>
                )}
                {velocity && <p>{velocity}</p>}
                {soldComps.samples?.map((s, i) => (
                  <p key={i}>
                    {s.link ? (
                      <a href={s.link} target="_blank" rel="noopener noreferrer">{s.title}</a>
                    ) : s.title}
                    {' — '}<span className="money">${s.price.toFixed(2)}</span>
                    {s.date ? ` · ${s.date}` : ''}
                  </p>
                ))}
              </>
            )}
          </div>
        </div>
        <div className="buy-src-footer">
          <Button
            variant="outline"
            full
            onClick={() => window.open(soldSearchUrl(searchTitle), '_blank', 'noopener')}
          >
            See sold listings on eBay
          </Button>
          {/* The richest sold data he can get is free and three years deep, and
              on a phone it is reachable only inside the eBay app — no published
              deep link, so no `ebay://` guess here: a scheme that dumps him on
              the app's home screen reads as broken software and costs more
              trust than the tap saves. A paste is two seconds and always works. */}
          <Button variant="outline" full onClick={handleCopyForResearch}>
            Research solds in the eBay app
          </Button>
          {researchCopied && (
            <StatusTag tone="green" className="buy-src-copied">{RESEARCH_STEPS}</StatusTag>
          )}
        </div>
      </Sheet>
    );
  }

  function renderVerdict() {
    const gp = parseFloat(goodwillPrice) || 0;
    const { estSellPrice, fees, netProfit, confidence } = analysisResult;
    // What adapt() actually spent, and whose number it was. Items analyzed
    // before M2 carry neither, and fall back to the house figure unlabelled.
    const ship = analysisResult.shipping ?? DEFAULT_SHIPPING;
    const shipFromModel = analysisResult.shippingFromModel === true;
    // Tier A, if it landed. `soldPriced` is the narrower question — comps can
    // be present as context and still not be the price of record.
    const soldComps = analysisResult.soldComps ?? null;
    const soldPriced = analysisResult.source === 'ebay-sold' && Number.isFinite(soldComps?.count);
    const { rule1, rule2, verdict } = checkRules(estSellPrice, gp, netProfit);
    const go = verdict === 'buy';
    // Where this price came from, in the banner, always.
    //
    // The old rule hid the confidence word whenever the model said `high` and
    // showed a "2.4× over your floor" multiplier instead. R1 and H2 measured
    // what `high` is worth on this prompt — every graded item claimed it, and
    // they scored 0–67%. So `high` is no longer a reason to stop saying whose
    // number this is: model-only verdicts name the model at every confidence
    // level. Sold-priced verdicts drop the word entirely, because provenance
    // has replaced it with something checkable.
    const goDetail = soldPriced
      ? `priced from ${soldComps.count} sold`
      : `model estimate · ${confidence ?? 'low'} confidence`;
    // His words for months in Gemini, so they are the app's words now. BUY IT
    // was already his verbatim and is untouched. The internal token stays
    // 'skip' — it is checkRules' contract, and nobody reads it.
    const detail = go ? goDetail : 'on the shelf · under your floor';
    // What this verdict was computed from. A verdict stored before this build
    // has no baseline; treating the fields as changed offers him an action that
    // is never harmful, which beats hiding it over missing bookkeeping.
    const analyzedAs = analysisResult.analyzedAs ?? { details: '', condition: '' };
    const changed = details !== analyzedAs.details || condition !== analyzedAs.condition;
    return (
      <div className="screen buy-barred">
        <VerdictBanner
          verdict={go ? 'go' : 'skip'}
          label={go ? 'BUY IT' : 'LEAVE IT'}
          detail={analysisResult.revised ? `Revised · ${detail}` : detail}
        />
        <ListingPreviewCard
          className={go ? undefined : 'buy-skip-card'}
          photos={photos.length ? photos.map((p, i) => <img key={i} src={p.previewUrl} alt={`Photo ${i + 1}`} />) : null}
          title={details || 'Untitled find'}
          condition={condition ? `Pre-owned · ${condition}` : 'Pre-owned'}
          price={`$${estSellPrice.toFixed(2)}`}
          obo={go}
          struck={!go}
          shipping={go ? `+$${ship.toFixed(2)} shipping` : null}
          soldLine={
            soldPriced
              ? `${soldComps.count} sold${soldComps.windowDays ? ` in ${soldComps.windowDays} days` : ''} — median $${estSellPrice.toFixed(2)}`
              : go ? 'Model estimate — verify before big buys' : 'Under your floor at this price'
          }
          onSoldTap={go ? () => setWhyOpen(true) : undefined}
        />
        <Panel title="Your earnings">
          <PanelRow
            label={soldPriced
              ? `Item price · ${soldComps.count} sold${soldComps.windowDays ? `, last ${soldComps.windowDays}d` : ''}`
              : 'Item price'}
            value={`$${estSellPrice.toFixed(2)}`}
            // The receipt is worth reading on a LEAVE IT too once there is real
            // sold data behind the number — that is the case where he is most
            // likely to want to argue with it.
            onValueTap={go || soldPriced ? () => setWhyOpen(true) : undefined}
          />
          <PanelRow label="Selling costs · 13.25% + $0.30" value={`−$${fees.toFixed(2)}`} />
          <PanelRow label={shipFromModel ? 'Shipping label · AI estimate' : 'Shipping label'} value={`−$${ship.toFixed(2)}`} />
          <PanelRow label="Paid at Goodwill" value={`−$${gp.toFixed(2)}`} />
          <PanelTotal label="You'd keep" value={`$${netProfit.toFixed(2)}`} tone={go ? 'green' : 'red'} />
          <div className="buy-checks">
            <span className={rule1 ? 'y' : 'n'}>{rule1 ? '✓' : '✗'} 3× rule</span>
            <span className={rule2 ? 'y' : 'n'}>{rule2 ? '✓' : '✗'} $20 minimum</span>
          </div>
        </Panel>
        {/* The prototype's "It'd need to be $X to work" skip line is omitted — its price
            inversion belongs to V1's calculations.js work (plan §6.1), same as the pencil floor. */}
        {/* He does not open a panel to add what he just noticed — in Gemini he
            simply types more and gets a revised answer back. So the field is
            already here, and Re-check wakes the moment it says something new.
            Photos are untouched: the same frames go back up. */}
        <Panel title="Anything else?" className="buy-recheck">
          <Input
            placeholder="e.g. the box is a bit rough"
            aria-label="Anything else about this item"
            value={details}
            onChange={e => setDetails(e.target.value)}
          />
          <div className="buy-chips">
            {CONDITIONS.map(c => (
              <Chip key={c} selected={condition === c} onPress={() => setCondition(c)}>{c}</Chip>
            ))}
          </div>
          <Button variant="outline" full disabled={!changed || rechecking} onClick={handleRecheck}>
            {rechecking ? 'Re-checking…' : 'Re-check'}
          </Button>
        </Panel>
        {go && (
          <Card className="buy-advisor">
            <div className="buy-advisor-av">F</div>
            <p className="buy-advisor-teaser">{analysisResult.chatHistory?.[0]?.text ?? ''}</p>
            <button type="button" className="buy-advisor-chat tap44" onClick={() => onGoToFlip?.(itemId)} aria-label="Ask Flip">
              <ChatIcon />
            </button>
          </Card>
        )}
        <ActionBar>
          {go ? (
            <>
              <Button variant="danger" onClick={handleSkip}>Skip it</Button>
              <Button onClick={handleAddToCart}>Add to cart</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleSkip}>Next item</Button>
              <Button variant="danger" className="buy-bar-narrow" onClick={handleAddToCart}>Cart anyway</Button>
            </>
          )}
        </ActionBar>
        {renderWhySheet()}
      </div>
    );
  }

  if (phase === 'pencil') return renderPencil();
  if (phase === 'verdict' && analysisResult) return renderVerdict();
  return renderCapture();
}
