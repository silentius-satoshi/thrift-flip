import './ActionBar.css';

export default function ActionBar({ className = '', children, ...rest }) {
  return <div className={`ui-actionbar${className ? ` ${className}` : ''}`} {...rest}>{children}</div>;
}
