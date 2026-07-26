import './StatusTag.css';

export default function StatusTag({ tone = 'mute', className = '', children, ...rest }) {
  return (
    <span className={`ui-tag ui-tag-${tone}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </span>
  );
}
