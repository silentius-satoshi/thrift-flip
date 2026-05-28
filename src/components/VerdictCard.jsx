import { checkRules } from '../utils/calculations';
import './VerdictCard.css';

export default function VerdictCard({ analysisResult, goodwillPrice }) {
  const { estSellPrice, fees, shipping, netProfit, strategyNote } = analysisResult;
  const { rule1, rule2, verdict } = checkRules(estSellPrice, goodwillPrice, netProfit);
  const isBuy = verdict === 'buy';

  const profitColor = netProfit >= 20
    ? 'var(--green)'
    : netProfit > 0
      ? 'var(--amber)'
      : 'var(--red)';

  return (
    <div className="card">
      <div className="verdict-header">
        <span className={`verdict-badge ${isBuy ? 'buy' : 'skip'}`}>
          {isBuy ? 'BUY IT' : 'SKIP IT'}
        </span>
        <span className="verdict-badge-sub">
          {isBuy ? 'Strong flip potential' : 'Margins too thin'}
        </span>
      </div>

      <div className="price-rows">
        <div className="price-row">
          <span className="pr-label">Goodwill Price</span>
          <span className="pr-value">-${goodwillPrice.toFixed(2)}</span>
        </div>
        <div className="price-row">
          <span className="pr-label">Est. eBay Sale</span>
          <span className="pr-value">${estSellPrice.toFixed(2)}</span>
        </div>
        <div className="price-row">
          <span className="pr-label">eBay Fees (13.25% + $0.30)</span>
          <span className="pr-value">-${fees.toFixed(2)}</span>
        </div>
        <div className="price-row">
          <span className="pr-label">Est. Shipping</span>
          <span className="pr-value">-${(shipping || 5).toFixed(2)}</span>
        </div>
        <div className="price-row">
          <span className="pr-label">Net Profit</span>
          <span className="pr-value profit" style={{ color: profitColor }}>
            ${netProfit.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="verdict-rules">
        <span className={`pill ${rule1 ? 'pill-green' : 'pill-red'}`}>
          {rule1 ? '✓' : '✗'} 3× Rule
        </span>
        <span className={`pill ${rule2 ? 'pill-green' : 'pill-red'}`}>
          {rule2 ? '✓' : '✗'} $20 Min
        </span>
      </div>

      {strategyNote && (
        <div className="verdict-strategy">{strategyNote}</div>
      )}
    </div>
  );
}
