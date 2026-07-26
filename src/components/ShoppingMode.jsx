import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { analyzeItem } from '../utils/webhooks';
import { saveConversation, markStatus, getConversation } from '../utils/conversationStore';
import { useToast } from '../contexts/ToastContext';
import { shoppingService } from '../utils/storageService';
import { useUser } from '../contexts/UserContext';
import { calcProfit, checkRules } from '../utils/calculations';
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

// TODO(V1): replace with the real inversion in src/utils/calculations.js (plan §6.1 formula)
const pencilFloorStub = (goodwillPrice) => Math.max(goodwillPrice * 3, 46.50);

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

export default function ShoppingMode({ onAddToCart, onNavigateToCart, onGoToFlip, onGoToSelling, onCamActive }) {
  const { showToast } = useToast();
  const { user } = useUser(); // TODO: check user.plan analysis limits before analyze

  const savedForm    = useRef(loadForm());
  const savedVerdict = useRef(loadVerdict());

  const [phase, setPhase] = useState(() => {
    if (savedVerdict.current?.phase === 'verdict' && savedVerdict.current?.analysisResult) return 'verdict';
    if (savedVerdict.current?.phase === 'pencil' && savedVerdict.current?.itemId) return 'pencil';
    return 'capture';
  });
  const [photos, setPhotos] = useState(() => {
    const savedPhotos = savedForm.current?.photoBase64s ?? [];
    return savedPhotos.map(item => {
      const b64  = typeof item === 'string' ? item : item.b64;
      const mime = typeof item === 'string' ? 'image/jpeg' : (item.mime || 'image/jpeg');
      if (!b64) return null;
      return {
        file: null,
        base64: b64,
        mimeType: mime,
        previewUrl: URL.createObjectURL(
          new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: mime })
        ),
      };
    }).filter(Boolean);
  });
  const [details,        setDetails]       = useState(() => savedForm.current?.details       ?? '');
  const [condition,      setCondition]     = useState(() => savedForm.current?.condition     ?? '');
  const [goodwillPrice,  setGoodwillPrice] = useState(() => savedForm.current?.goodwillPrice ?? '');
  const [analysisResult, setAnalysisResult]= useState(() => savedVerdict.current?.analysisResult ?? null);
  const [itemId,         setItemId]        = useState(() => savedVerdict.current?.itemId     ?? null);
  const [chatHistory,    setChatHistory]   = useState(() => {
    const id = savedVerdict.current?.itemId;
    return id ? (getConversation(id)?.chatHistory ?? []) : [];
  });
  const [signalLost,     setSignalLost]    = useState(false);
  const [whyOpen,        setWhyOpen]       = useState(false);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);

  const fileInputRef = useRef(null);
  const photosRef    = useRef([]);
  const reqSeq       = useRef(0);

  // Keep photosRef in sync for unmount cleanup
  useEffect(() => { photosRef.current = photos; }, [photos]);

  // Only revoke blob URLs for fresh photos on unmount — restored photos (file: null) keep their URLs alive across tab switches
  useEffect(() => () => {
    photosRef.current
      .filter(p => p.file !== null)
      .forEach(p => URL.revokeObjectURL(p.previewUrl));
  }, []);

  useEffect(() => {
    shoppingService.setForm({ details, condition, goodwillPrice, photoBase64s: photos.map(p => ({ b64: p.base64, mime: p.mimeType })).filter(p => p.b64) });
  }, [details, condition, goodwillPrice, photos]);

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

  // Resume an analysis lost to a refresh — restored pencil phase re-fires from persisted form data
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

  async function handlePhotoChange(e) {
    const files = Array.from(e.target.files);
    const remaining = 3 - photos.length;
    if (files.length > remaining) showToast('Maximum 3 photos allowed', 'error');
    const taken = files.slice(0, remaining);
    const newPhotos = await Promise.all(taken.map(async f => {
      const previewUrl = URL.createObjectURL(f);
      const base64 = await fileToBase64({ previewUrl });
      return { file: f, previewUrl, base64, mimeType: f.type || 'image/jpeg' };
    }));
    setPhotos(prev => [...prev, ...newPhotos]);
    e.target.value = '';
  }

  function handleRemovePhoto(index) {
    const target = photos[index];
    if (target) URL.revokeObjectURL(target.previewUrl);
    const next = photos.filter((_, i) => i !== index);
    setPhotos(next);
    if (next.length === 0) setPhotoSheetOpen(false);
  }

  async function runAnalyze(id) {
    const myReq = ++reqSeq.current;
    try {
      const validPhotos = photos.filter(p => p.previewUrl);
      const photoBase64s = await Promise.all(validPhotos.map(fileToBase64));
      const price = parseFloat(goodwillPrice);
      const result = await analyzeItem({ photoBase64s, details, condition, goodwillPrice: price });
      if (reqSeq.current !== myReq) return; // stale — skipped, carted, or reset mid-flight
      saveConversation(id, details.slice(0, 60) || 'Item', result.chatHistory || [], { details, condition, goodwillPrice: price });
      setAnalysisResult(result);
      setChatHistory(result.chatHistory || []);
      setPhase('verdict');
    } catch (err) {
      // Unreachable with today's mock (no network call) — V1's real webhook lands here
      console.error('runAnalyze error:', err);
      if (reqSeq.current === myReq) setSignalLost(true);
    }
  }

  function handleGetVerdict() {
    const price = parseFloat(goodwillPrice);
    if (!price || price <= 0) {
      showToast('Enter a Goodwill price first', 'error');
      return;
    }
    const newId = Date.now();
    setItemId(newId);
    setSignalLost(false);
    setPhase('pencil');
    runAnalyze(newId);
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
      const { estSellPrice, fees, netProfit, soldCount, sellThroughRate, avgDaysToSell, activeListings } = analysisResult;
      payload = {
        id: itemId,
        name: details.slice(0, 60) || 'Unnamed Item',
        condition,
        goodwillPrice: gp,
        estSellPrice,
        fees,
        shipping: 5.00,
        netProfit,
        soldCount,
        sellThroughRate,
        avgDaysToSell,
        activeListings,
        chatHistory,
      };
    } else {
      // Pencil-phase add: local figures only; V1's verdict reconciliation flags this item later
      const floor = pencilFloorStub(gp);
      const { ebayFee, net } = calcProfit(floor, gp);
      payload = {
        id: itemId,
        name: details.slice(0, 60) || 'Unnamed Item',
        condition,
        goodwillPrice: gp,
        estSellPrice: floor,
        fees: ebayFee,
        shipping: 5.00,
        netProfit: net,
        soldCount: 0,
        sellThroughRate: '–',
        avgDaysToSell: '–',
        activeListings: 0,
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
    setSignalLost(false);
    setWhyOpen(false);
    setPhotoSheetOpen(false);
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
          {lastPhoto && <img className="buy-vf-backdrop" src={lastPhoto.previewUrl} alt="" />}
          <i className="buy-bk buy-bk1" /><i className="buy-bk buy-bk2" />
          <i className="buy-bk buy-bk3" /><i className="buy-bk buy-bk4" />
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
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="Goodwill price $0.00"
            value={goodwillPrice}
            onChange={e => setGoodwillPrice(e.target.value)}
          />
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
          <Shutter onClick={() => fileInputRef.current?.click()} aria-label="Take photo" />
          <CamSide onClick={onGoToSelling} aria-label="Selling"><ChartIcon /></CamSide>
        </div>
        <Sheet open={photoSheetOpen} onClose={() => setPhotoSheetOpen(false)} title={`Photos · ${photos.length} / 3`}>
          <div className="buy-sheet-strip">
            {photos.map((p, i) => (
              <div key={i} className="buy-sheet-thumb">
                <img src={p.previewUrl} alt={`Photo ${i + 1}`} />
                <PhotoRemoveDot onClick={() => handleRemovePhoto(i)} />
              </div>
            ))}
          </div>
          {photos.length < 3 && (
            <Button variant="outline" full onClick={() => fileInputRef.current?.click()}>Add another photo</Button>
          )}
        </Sheet>
      </div>
    );
  }

  function renderPencil() {
    const gp = parseFloat(goodwillPrice) || 0;
    const floor = pencilFloorStub(gp);
    const feesAtFloor = calcProfit(floor, gp).ebayFee;
    return (
      <div className="screen buy-barred">
        {signalLost && (
          <StatusTag tone="mute" className="buy-sig">
            <i className="buy-sig-dot" />No signal · the verdict catches up on its own
          </StatusTag>
        )}
        <VerdictBanner verdict="pencil" label="Your call for now" detail="figured on this phone" />
        <Panel title="What it must sell for">
          <div className="buy-floor money">
            ${floor.toFixed(2)}<span className="buy-floor-suffix"> or more</span>
          </div>
          <PanelRow label="Paid at Goodwill" value={`−$${gp.toFixed(2)}`} />
          <PanelRow label="Fees + shipping at that price" value={`−$${(feesAtFloor + 5).toFixed(2)}`} />
          <PanelRow label="Your rules — 3× and $20 net" value={`$${floor.toFixed(2)} floor`} />
          <div className="buy-floor-q">Would a buyer pay ${Math.ceil(floor)}?</div>
        </Panel>
        <p className="buy-reassure">Acting now is fine — if the verdict disagrees later, it flags the item in your cart.</p>
        <ActionBar>
          <Button variant="danger" onClick={handleSkip}>Skip it</Button>
          <Button onClick={handleAddToCart}>Add to cart</Button>
        </ActionBar>
      </div>
    );
  }

  function renderWhySheet() {
    const { estSellPrice, soldCount, recentSales } = analysisResult;
    const prices = (recentSales ?? []).map(s => s.price).sort((a, b) => a - b);
    const median = prices.length ? prices[Math.floor(prices.length / 2)] : estSellPrice;
    const lo = prices.length ? prices[0] : estSellPrice;
    const hi = prices.length ? prices[prices.length - 1] : estSellPrice;
    return (
      <Sheet
        open={whyOpen}
        onClose={() => setWhyOpen(false)}
        title={<>Where <span className="money">${estSellPrice.toFixed(2)}</span> comes from</>}
      >
        <div className="buy-src">
          <div className="buy-src-ic green"><CheckIcon /></div>
          <div>
            <b>Your own sales</b>
            <p>Sample data — your sales history connects in V1. Two prior sales like this weigh heaviest: your niche, your photos, your buyers.</p>
          </div>
        </div>
        <div className="buy-src">
          <div className="buy-src-ic blue"><SearchIcon /></div>
          <div>
            <b>eBay sold listings</b>
            <p>{soldCount} sold in 30 days, median ${median.toFixed(2)}, range ${lo.toFixed(2)}–${hi.toFixed(2)}.</p>
          </div>
        </div>
        <div className="buy-src">
          <div className="buy-src-ic mute"><BulbIcon /></div>
          <div>
            <b>Model read</b>
            <p>Agrees with the sold-listing read. Runs on your key, from this phone.</p>
          </div>
        </div>
        <div className="buy-src-footer">
          <Button variant="outline" full>See these sold listings on eBay</Button>
        </div>
      </Sheet>
    );
  }

  function renderVerdict() {
    const gp = parseFloat(goodwillPrice) || 0;
    const { estSellPrice, fees, netProfit, soldCount, avgDaysToSell } = analysisResult;
    const { rule1, rule2, verdict } = checkRules(estSellPrice, gp, netProfit);
    const go = verdict === 'buy';
    return (
      <div className="screen buy-barred">
        <VerdictBanner
          verdict={go ? 'go' : 'skip'}
          label={go ? 'BUY IT' : 'SKIP IT'}
          detail={go ? `${(estSellPrice / pencilFloorStub(gp)).toFixed(1)}× over your floor` : 'under your floor'}
        />
        <ListingPreviewCard
          className={go ? undefined : 'buy-skip-card'}
          photos={photos.length ? photos.map((p, i) => <img key={i} src={p.previewUrl} alt={`Photo ${i + 1}`} />) : null}
          title={details || 'Untitled find'}
          condition={condition ? `Pre-owned · ${condition}` : 'Pre-owned'}
          price={`$${estSellPrice.toFixed(2)}`}
          obo={go}
          struck={!go}
          shipping={go ? `+$5.00 shipping · sells in ~${avgDaysToSell} days` : null}
          soldLine={go ? `${soldCount} sold in the last 30 days` : 'Too common at this price'}
          onSoldTap={go ? () => setWhyOpen(true) : undefined}
        />
        <Panel title="Your earnings">
          <PanelRow label="Item price" value={`$${estSellPrice.toFixed(2)}`} onValueTap={go ? () => setWhyOpen(true) : undefined} />
          <PanelRow label="Selling costs · 13.25% + $0.30" value={`−$${fees.toFixed(2)}`} />
          <PanelRow label="Shipping label" value="−$5.00" />
          <PanelRow label="Paid at Goodwill" value={`−$${gp.toFixed(2)}`} />
          <PanelTotal label="You'd keep" value={`$${netProfit.toFixed(2)}`} tone={go ? 'green' : 'red'} />
          <div className="buy-checks">
            <span className={rule1 ? 'y' : 'n'}>{rule1 ? '✓' : '✗'} 3× rule</span>
            <span className={rule2 ? 'y' : 'n'}>{rule2 ? '✓' : '✗'} $20 minimum</span>
          </div>
        </Panel>
        {/* The prototype's "It'd need to be $X to work" skip line is omitted — its price
            inversion belongs to V1's calculations.js work (plan §6.1), same as the pencil floor. */}
        {go && (
          <Card className="buy-advisor">
            <div className="buy-advisor-av">F</div>
            <p className="buy-advisor-teaser">{analysisResult.chatHistory?.[0]?.text ?? ''}</p>
            <button type="button" className="buy-advisor-chat" onClick={() => onGoToFlip?.(itemId)} aria-label="Ask Flip">
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
