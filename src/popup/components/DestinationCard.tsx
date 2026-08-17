import { useState } from 'react';
import type { ConnectionStatus, DestinationMode, DestinationRef } from '@/types';
import { send } from '@/utils/messaging';
import { toAppError, type SerializedError } from '@/utils/errors';
import { Banner, Button, Segmented, type SegmentedOption } from '@/ui/components';
import { IconCheck, IconFolder, IconGoogleDrive } from '@/ui/icons';
import { describeShortfall, modeIncludes } from '@/storage/destination';

/**
 * Destination picker: where this capture will be saved.
 *
 * The switch lives here rather than only in Settings because it is a routine choice,
 * not a configuration one. Someone may want the next capture on disk and the one after
 * that in a shared Drive folder, and making them open a separate page to do that would
 * be the worst click in the product. Settings still owns the *default*.
 *
 * "Both" is the reason `describeShortfall` exists: choosing it with Drive unconfigured
 * must not silently degrade into "device only". The user is told up front, before
 * capturing, and the capture still goes ahead because having the file on disk is
 * better than refusing to work.
 */

const MODES: readonly SegmentedOption<DestinationMode>[] = [
  {
    value: 'local',
    label: 'This device',
    icon: <IconFolder size={14} />,
    title: 'Save to your Downloads folder. No account needed.',
  },
  {
    value: 'google-drive',
    label: 'Drive',
    icon: <IconGoogleDrive size={14} />,
    title: 'Save straight into a Google Drive folder',
  },
  {
    value: 'both',
    label: 'Both',
    icon: <IconCheck size={14} />,
    title: 'Save to this device and to Google Drive',
  },
];

export function DestinationCard({
  mode,
  connection,
  destinations,
  onModeChange,
  onChangeFolder,
  onChanged,
}: {
  mode: DestinationMode;
  connection: ConnectionStatus;
  destinations: DestinationRef[];
  onModeChange: (mode: DestinationMode) => void;
  onChangeFolder: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SerializedError | null>(null);

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (cause) {
      const appError = toAppError(cause).toJSON();
      // Cancelling a Google consent screen is a decision, not an error to shout about.
      if (appError.code !== 'AUTH_CANCELLED') setError(appError);
    } finally {
      setBusy(false);
    }
  };

  const localDest = destinations.find((d) => d.providerId === 'local');
  const driveDest = destinations.find((d) => d.providerId === 'google-drive');
  const driveReady = connection.connected && Boolean(driveDest);
  const shortfall = describeShortfall(mode, driveReady);

  return (
    <div className="sd-stack" style={{ gap: 9 }}>
      <Segmented label="Where to save" options={MODES} value={mode} onChange={onModeChange} compact />

      {modeIncludes(mode, 'local') ? (
        <div className="sd-dest">
          <IconFolder size={18} style={{ color: 'var(--sd-text-subtle)' }} />
          <div className="sd-dest__text">
            <span className="sd-dest__provider">This device</span>
            <span className="sd-dest__path sd-truncate" title={localDest?.folderPath}>
              {localDest?.folderPath ?? 'Downloads'}
            </span>
          </div>
        </div>
      ) : null}

      {modeIncludes(mode, 'google-drive') ? (
        connection.connected ? (
          <div className="sd-dest">
            <IconGoogleDrive size={20} />
            <div className="sd-dest__text">
              <span className="sd-dest__provider">Google Drive</span>
              <span className="sd-dest__path sd-truncate" title={driveDest?.folderPath}>
                {driveDest ? driveDest.folderPath || driveDest.folderName : 'No folder chosen yet'}
              </span>
            </div>
            <div className="sd-dest__actions">
              <Button size="sm" onClick={onChangeFolder} disabled={busy}>
                {driveDest ? 'Change' : 'Choose'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="sd-dest sd-dest--empty">
            <IconGoogleDrive size={20} />
            <div className="sd-dest__text">
              <span className="sd-dest__provider">Google Drive</span>
              <span className="sd-dest__path">Not connected</span>
            </div>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              onClick={() => void run(() => send('drive/connect', {}))}
            >
              Connect
            </Button>
          </div>
        )
      ) : null}

      {shortfall ? (
        <Banner tone={shortfall.blocking ? 'info' : 'warning'}>{shortfall.message}</Banner>
      ) : null}

      {mode === 'local' ? (
        <p className="sd-hint" style={{ margin: 0 }}>
          Saved straight to your Downloads folder. Change the folder name in Settings.
        </p>
      ) : null}

      {modeIncludes(mode, 'google-drive') && connection.connected ? (
        <div className="sd-row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <span className="sd-hint sd-truncate" title={connection.account}>
            {connection.account ? `Connected as ${connection.account}` : 'Connected'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => send('drive/disconnect'))}
          >
            Disconnect
          </Button>
        </div>
      ) : null}

      {error ? <Banner tone="error">{error.userMessage}</Banner> : null}
    </div>
  );
}
