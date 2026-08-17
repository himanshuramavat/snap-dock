import { HOMEPAGE_URL } from '@/manifest.config';

/**
 * The standing links row: What's New, GitHub, Privacy Policy.
 *
 * Shared by the popup and the settings page so the two never drift. The repository URL
 * comes from `manifest.config.ts`, which is also what `homepage_url` is built from, so
 * there is one place to change it.
 *
 * Labels come from `_locales` rather than being hardcoded, since everything else
 * user-visible in the manifest already does.
 */

/** Deep link to the privacy policy in the repository, matching the sibling projects. */
const PRIVACY_URL = `${HOMEPAGE_URL}/blob/main/PRIVACY.md`;

function label(key: string, fallback: string): string {
  // getMessage returns '' for a missing key, and an empty link is worse than English.
  const message = chrome.i18n?.getMessage(key);
  return message || fallback;
}

export function ExternalLinks() {
  return (
    <nav className="sd-links" aria-label="About SnapDock">
      <a
        className="sd-links__item"
        // Resolved through the extension URL so it works in both engines.
        href={chrome.runtime.getURL('changelog/changelog.html')}
        target="_blank"
        rel="noopener noreferrer"
      >
        {label('linkWhatsNew', "What's New")}
      </a>
      <span className="sd-links__dot" aria-hidden="true">
        ·
      </span>
      <a
        className="sd-links__item"
        href={HOMEPAGE_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        {label('linkGitHub', 'GitHub')}
      </a>
      <span className="sd-links__dot" aria-hidden="true">
        ·
      </span>
      <a className="sd-links__item" href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
        {label('linkPrivacyPolicy', 'Privacy Policy')}
      </a>
    </nav>
  );
}
