import './Panel.css';

export function Panel({ title, className = '', children, ...rest }) {
  return (
    <div className={`ui-panel${className ? ` ${className}` : ''}`} {...rest}>
      {title && <div className="ui-panel-title">{title}</div>}
      {children}
    </div>
  );
}

export function PanelRow({ label, value, onValueTap, className = '', ...rest }) {
  return (
    <div className={`ui-panel-row${className ? ` ${className}` : ''}`} {...rest}>
      <span className="ui-panel-row-label">{label}</span>
      {onValueTap ? (
        <button type="button" className="ui-panel-row-value money ui-panel-tap" onClick={onValueTap}>{value}</button>
      ) : (
        <span className="ui-panel-row-value money">{value}</span>
      )}
    </div>
  );
}

export function PanelTotal({ label, value, tone = 'green', solo = false, className = '', ...rest }) {
  className = `${solo ? 'solo' : ''}${className ? ` ${className}` : ''}`.trim();
  return (
    <div className={`ui-panel-total${className ? ` ${className}` : ''}`} {...rest}>
      <span className="ui-panel-total-label">{label}</span>
      <span className={`ui-panel-total-value money ui-panel-total-${tone}`}>{value}</span>
    </div>
  );
}
