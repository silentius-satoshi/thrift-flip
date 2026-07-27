import IconButton from './ui/IconButton';
import StatusTag from './ui/StatusTag';
import './PreviewMode.css';

export default function PreviewMode({ previewData, onBack }) {
  const { title, price, selectedCondition, photos, specifics, shippingLabel, description, selectedCategory } = previewData;
  const filledSpecifics = Object.entries(specifics).filter(([, v]) => v.trim());

  return (
    <div className="preview-screen ui-light">
      <div className="preview-topbar">
        <IconButton label="Back to listing" size="sm" className="preview-back-btn" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </IconButton>
        <span className="preview-topbar-title">Preview</span>
        <span className="preview-topbar-spacer" />
      </div>

      <div className="preview-body">
        <div className="preview-cover">
          {photos[0]
            ? <img src={photos[0].dataUrl} alt="Cover" />
            : <div className="preview-cover-placeholder">No photo added yet</div>
          }
        </div>

        <div className="preview-content">
          <h2 className="preview-title">{title || 'No title'}</h2>

          <div className="preview-meta">
            <span className="preview-price">
              {price ? `$${parseFloat(price).toFixed(2)}` : '—'}
            </span>
            <StatusTag tone="mute">{selectedCondition}</StatusTag>
          </div>

          {filledSpecifics.length > 0 && (
            <table className="preview-specifics">
              <tbody>
                {filledSpecifics.map(([k, v]) => (
                  <tr key={k}>
                    <td className="preview-spec-key">{k}</td>
                    <td className="preview-spec-val">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="preview-shipping">{shippingLabel}</div>

          <div className="preview-row">
            <span className="preview-label">Category</span>
            <span className="preview-value">{selectedCategory}</span>
          </div>

          <div
            className="preview-description"
            dangerouslySetInnerHTML={{ __html: description.replace(/\n/g, '<br>') }}
          />
        </div>
      </div>
    </div>
  );
}
