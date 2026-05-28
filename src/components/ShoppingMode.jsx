import { useState, useRef, useEffect } from 'react';
import { analyzeItem } from '../utils/webhooks';
import { useToast } from '../contexts/ToastContext';
import VerdictCard from './VerdictCard';
import SellVelocity from './SellVelocity';
import ChatThread from './ChatThread';
import './ShoppingMode.css';

const LOADING_MESSAGES = [
  'Searching eBay sold listings...',
  'Calculating flip potential...',
  'Analyzing market demand...',
  'Checking sell-through rates...',
  'Generating your verdict...',
];

export default function ShoppingMode({ onAddToCart, onNavigateToCart }) {
  const { showToast } = useToast();

  const [phase, setPhase] = useState('form');
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoBase64, setPhotoBase64] = useState(null);
  const [details, setDetails] = useState('');
  const [condition, setCondition] = useState('');
  const [goodwillPrice, setGoodwillPrice] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);

  const fileInputRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  function handlePhotoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhotoPreview(ev.target.result);
      setPhotoBase64(ev.target.result.split(',')[1]);
    };
    reader.readAsDataURL(file);
  }

  async function handleAnalyze() {
    const price = parseFloat(goodwillPrice);
    if (!price || price <= 0) {
      showToast('Enter a Goodwill price first', 'error');
      return;
    }
    setPhase('loading');
    setLoadingMsgIndex(0);
    intervalRef.current = setInterval(() => {
      setLoadingMsgIndex(i => (i + 1) % LOADING_MESSAGES.length);
    }, 800);

    try {
      const result = await analyzeItem({ photoBase64, details, condition, goodwillPrice: price });
      clearInterval(intervalRef.current);
      setAnalysisResult(result);
      setChatHistory(result.chatHistory || []);
      setPhase('verdict');
    } catch (err) {
      clearInterval(intervalRef.current);
      showToast('Analysis failed — try again', 'error');
      setPhase('form');
    }
  }

  function handleSkip() {
    resetForm();
  }

  function handleAddToCart() {
    if (!analysisResult) return;
    const { estSellPrice, fees, netProfit, soldCount, sellThroughRate, avgDaysToSell, activeListings } = analysisResult;
    onAddToCart({
      name: details.slice(0, 60) || 'Unnamed Item',
      condition,
      goodwillPrice: parseFloat(goodwillPrice),
      estSellPrice,
      fees,
      shipping: 5.00,
      netProfit,
      soldCount,
      sellThroughRate,
      avgDaysToSell,
      activeListings,
      chatHistory,
      photoBase64: photoPreview,
    });
    showToast('Added to cart!');
    setTimeout(() => {
      resetForm();
      onNavigateToCart();
    }, 1200);
  }

  function resetForm() {
    setPhase('form');
    setPhotoPreview(null);
    setPhotoBase64(null);
    setDetails('');
    setCondition('');
    setGoodwillPrice('');
    setAnalysisResult(null);
    setChatHistory([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const isBuy = analysisResult
    ? analysisResult.estSellPrice >= parseFloat(goodwillPrice) * 3 && analysisResult.netProfit >= 20
    : false;

  if (phase === 'loading') {
    return (
      <div className="screen">
        <div className="loading-screen">
          <div className="loading-dots"><span /><span /><span /></div>
          <div className="loading-msg">{LOADING_MESSAGES[loadingMsgIndex]}</div>
        </div>
      </div>
    );
  }

  if (phase === 'verdict' && analysisResult) {
    return (
      <div className="screen">
        <div className="verdict-phase">
          <VerdictCard analysisResult={analysisResult} goodwillPrice={parseFloat(goodwillPrice)} />
          <SellVelocity analysisResult={analysisResult} />
          <ChatThread
            chatHistory={chatHistory}
            onUpdateHistory={setChatHistory}
            itemContext={{ details, condition, goodwillPrice: parseFloat(goodwillPrice) }}
          />
        </div>
        <div className="verdict-action-bar">
          <button className="btn btn-red" onClick={handleSkip}>Skip it ✕</button>
          {isBuy && (
            <button className="btn btn-amber" onClick={handleAddToCart}>Add to cart</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="shop-form">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handlePhotoChange}
        />
        <div
          className={`photo-upload-area ${photoPreview ? 'has-photo' : ''}`}
          onClick={() => fileInputRef.current?.click()}
        >
          {photoPreview ? (
            <img src={photoPreview} alt="Item preview" />
          ) : (
            <>
              <span className="photo-upload-icon">📷</span>
              <span className="photo-upload-label">Tap to take or choose a photo</span>
            </>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8, lineHeight: 1.4 }}>
          This photo is for AI analysis only and will not be used in your eBay listing.
        </p>

        <div className="form-group">
          <label className="form-label">Item details</label>
          <textarea
            className="form-textarea"
            placeholder="Brand, model, size, color, any labels you can see..."
            value={details}
            onChange={e => setDetails(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Condition</label>
          <textarea
            className="form-textarea"
            placeholder="Working, scratched, missing parts, box included..."
            value={condition}
            onChange={e => setCondition(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Goodwill price</label>
          <div className="form-input-prefix">
            <span className="prefix">$</span>
            <input
              type="number"
              className="form-input"
              placeholder="0.00"
              min="0"
              step="0.01"
              value={goodwillPrice}
              onChange={e => setGoodwillPrice(e.target.value)}
            />
          </div>
        </div>

        <button
          className="btn btn-full"
          style={{ background: '#fff', color: '#000', fontWeight: 600 }}
          onClick={handleAnalyze}
          disabled={!goodwillPrice || parseFloat(goodwillPrice) <= 0}
        >
          Should I buy this? →
        </button>
      </div>
    </div>
  );
}
