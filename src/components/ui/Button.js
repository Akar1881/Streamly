import Link from 'next/link';
import Icon from './Icon';

/**
 * The one button used across the site.
 *
 * Variants:
 *   primary   solid accent — the main call to action ("Watch now")
 *   secondary bordered card — supporting actions ("Trailer", "Share")
 *   ghost     no chrome until hovered — icon buttons and toolbars
 */
const VARIANTS = {
  primary:
    'bg-accent text-accent-text hover:opacity-90 border border-transparent',
  secondary:
    'bg-card text-text border border-line hover:bg-card-hover',
  ghost:
    'bg-transparent text-muted border border-transparent hover:bg-card hover:text-text',
};

const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2.5',
};

export default function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  href,
  pill = true,
  className = '',
  ...rest
}) {
  const classes = `inline-flex shrink-0 items-center justify-center font-medium
    transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50
    ${pill ? 'rounded-[var(--radius-pill)]' : 'rounded-[var(--radius-button)]'}
    ${VARIANTS[variant]} ${SIZES[size]} ${className}`;

  const content = (
    <>
      {icon && <Icon name={icon} size={size === 'lg' ? 18 : 15} />}
      {children}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} {...rest}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={classes} {...rest}>
      {content}
    </button>
  );
}
