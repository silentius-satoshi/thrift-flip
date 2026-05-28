import './SellVelocity.css';

export default function SellVelocity({ analysisResult }) {
  const {
    soldCount, sellThroughRate, avgDaysToSell, activeListings,
    recentSales, demandScore, tipText,
  } = analysisResult;

  const barColor = demandScore >= 70 ? 'green' : demandScore >= 40 ? 'amber' : 'red';
  const isFast = avgDaysToSell <= 7;

  return (
    <div className="card">
      <div className="velocity-title">Sell Velocity</div>

      <div className="velocity-grid">
        <div className="velocity-stat">
          <div className="stat-value">{soldCount}</div>
          <div className="stat-label">Sold last 30 days</div>
        </div>
        <div className="velocity-stat">
          <div className="stat-value">{sellThroughRate}%</div>
          <div className="stat-label">Sell-through rate</div>
        </div>
        <div className="velocity-stat">
          <div className="stat-value">{avgDaysToSell}d</div>
          <div className="stat-label">Avg days to sell</div>
        </div>
        <div className="velocity-stat">
          <div className="stat-value">{activeListings}</div>
          <div className="stat-label">Active listings</div>
          <div className="stat-sub">competing now</div>
        </div>
      </div>

      <div className="demand-section">
        <div className="demand-bar-row">
          <div className="demand-bar-label">
            <span>Demand Score</span>
            <span>{demandScore}/100</span>
          </div>
          <div className="demand-bar-track">
            <div className={`demand-bar-fill ${barColor}`} style={{ width: `${demandScore}%` }} />
          </div>
        </div>
      </div>

      <div className="sold-section">
        <div className="sold-section-label">
          <span>Recent Sold Prices</span>
          <span className={`speed-badge ${isFast ? 'fast' : 'slow'}`}>
            {isFast ? 'Fast mover' : 'Slow mover'}
          </span>
        </div>
        <div className="sold-list">
          {recentSales.map((sale, i) => {
            const isRecent = sale.daysAgo <= 10;
            return (
              <div className="sold-item" key={i}>
                <span
                  className="sold-dot"
                  style={{ background: isRecent ? 'var(--green)' : 'var(--text-muted)' }}
                />
                <span className="sold-price">${sale.price.toFixed(2)}</span>
                <span className="sold-ago">{sale.daysAgo}d ago</span>
              </div>
            );
          })}
        </div>
      </div>

      {tipText && <div className="tip-box">{tipText}</div>}
    </div>
  );
}
