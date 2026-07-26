import './StatGrid.css';

export function StatGrid({ className = '', children, ...rest }) {
  return <div className={`ui-statgrid${className ? ` ${className}` : ''}`} {...rest}>{children}</div>;
}

export function Stat({ value, label, tone, className = '', ...rest }) {
  return (
    <div className={`ui-stat${className ? ` ${className}` : ''}`} {...rest}>
      <div className={`ui-stat-value money${tone === 'green' ? ' green' : ''}`}>{value}</div>
      <div className="ui-stat-label">{label}</div>
    </div>
  );
}
