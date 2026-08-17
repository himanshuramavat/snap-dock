import type { JobResult } from '@/types';
import { formatBytes } from '@/utils/format';
import { PROVIDER_LABELS } from '@/storage/destination';
import { IconCheckCircle } from '@/ui/icons';

/**
 * Confirmation for a capture that saved cleanly.
 *
 * Deliberately a single line rather than a screen. The user's next action is almost
 * always another capture, so the confirmation sits above a ready capture view instead
 * of replacing it and asking to be dismissed first.
 *
 * It still names the file and where it went, because "it worked" without saying *what*
 * worked is not useful once more than one destination is possible.
 *
 * It also clears itself. See SAVED_NOTICE_MS in App: the countdown runs from when the
 * save finished, not from when the popup opened, so reopening the popup later shows a
 * ready capture screen rather than a log of past captures.
 */
export function SavedNotice({ result, leaving }: { result: JobResult; leaving?: boolean }) {
  const where = result.outcomes
    .filter((outcome) => outcome.status === 'saved')
    .map((outcome) => PROVIDER_LABELS[outcome.providerId])
    .join(' and ');

  return (
    <div className={`sd-saved${leaving ? ' sd-saved--leaving' : ''}`} role="status">
      <IconCheckCircle size={15} className="sd-saved__icon" />
      <div className="sd-saved__text">
        <span className="sd-saved__name sd-truncate" title={result.filename}>
          {result.filename}
        </span>
        <span className="sd-saved__meta">
          Saved to {where} · {formatBytes(result.bytes)}
        </span>
      </div>
    </div>
  );
}
