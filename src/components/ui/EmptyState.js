import Icon from './Icon';
import Button from './Button';

/**
 * Shown wherever a list comes back empty — no results, nothing saved, a failed
 * request. Keeps those states from looking like a broken page.
 */
export default function EmptyState({
  icon = 'search',
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="grid size-14 place-items-center rounded-full border border-line bg-card text-muted">
        <Icon name={icon} size={24} />
      </div>

      <div className="space-y-1">
        <p className="text-base font-medium text-text">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      </div>

      {actionLabel && (
        <Button variant="secondary" href={actionHref} onClick={onAction} className="mt-2">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
