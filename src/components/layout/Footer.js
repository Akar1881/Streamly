import site from '@config/site';
import Icon from '@/components/ui/Icon';

export default function Footer() {
  const { footer } = site;
  const copyright = footer.copyright.replace('{year}', String(new Date().getFullYear()));

  return (
    <footer className="border-t border-line px-4 py-6 sm:px-6 lg:px-8">
      <div
        className="flex flex-col items-center gap-3 text-center text-sm text-muted
          sm:flex-row sm:justify-between sm:text-left"
      >
        <div className="space-y-1">
          <p>{copyright}</p>
          {footer.disclaimer && (
            <p className="max-w-xl text-xs leading-relaxed opacity-70">{footer.disclaimer}</p>
          )}
        </div>

        {footer.socials.length > 0 && (
          <ul className="flex items-center gap-4">
            {footer.socials.map((social) => (
              <li key={social.href}>
                <a
                  href={social.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 transition-colors hover:text-text"
                >
                  <Icon name={social.icon} size={16} />
                  <span>{social.label}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </footer>
  );
}
