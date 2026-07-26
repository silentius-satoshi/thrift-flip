import './Panel.css';

export function Panel({ title, className = '', children, ...rest }) {
  return (
    <div className={`ui-panel${className ? ` ${className}` : ''}`} {...rest}>
      {title && <div className="ui-panel-title">{title}</div>}
      {children}
    </div>
  );
}

export function PanelRow({ label, value, className = '', ...rest }) {
  return (
    <div className={`ui-panel-row${className ? ` ${className}` : ''}`} {...rest}>
      <span className="ui-panel-row-label">{label}</span>
      <span className="ui-panel-row-value money">{value}</span>
    </div>
  );
}

export function PanelTotal({ label, value, tone = 'green', className = '', ...rest }) {
  return (
    <div className={`ui-panel-total${className ? ` ${className}` : ''}`} {...rest}>
      <span className="ui-panel-total-label">{label}</span>
      <span className={`ui-panel-total-value money ui-panel-total-${tone}`}>{value}</span>
    </div>
  );
}
