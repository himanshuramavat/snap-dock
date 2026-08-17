import { useState } from 'react';
import type { ConnectionStatus, DestinationMode, DestinationRef, Settings } from '@/types';
import { send } from '@/utils/messaging';
import { toAppError } from '@/utils/errors';
import { Banner, Button, Segmented, Switch, type SegmentedOption } from '@/ui/components';
import { IconCheck, IconExternal, IconFolder, IconGoogleDrive } from '@/ui/icons';
import { ACCESS_LEVEL_COPY } from '@/auth/scopes';
import { describeShortfall, formatLocalPath, modeIncludes } from '@/storage/destination';
import type { DeepPartial } from '@/settings/SettingsStore';
import { Panel, Setting } from '../components/Panel';

/**
 * Where captures go, and everything that configures it.
 *
 * The three modes are shown as equals rather than Drive being the headline and local a
 * fallback, because for most people local *is* the answer: it needs no account and
 * works immediately. Drive is what you choose when you want captures synced or shared,
 * and "Both" is for when a local copy plus a shared copy are both worth having.
 *
 * Only the settings relevant to the chosen mode are rendered, so "This device" never
 * shows a Drive connection panel. "Both" shows each, since both apply.
 */

const MODES: readonly SegmentedOption<DestinationMode>[] = [
  { value: 'local', label: 'This device', icon: <IconFolder size={15} /> },
  { value: 'google-drive', label: 'Google Drive', icon: <IconGoogleDrive size={15} /> },
  { value: 'both', label: 'Both', icon: <IconCheck size={15} /> },
];

export function DestinationSection({
  settings,
  connection,
  driveDestination,
  localDirectory,
  onChange,
  onChanged,
  onChangeFolder,
}: {
  settings: Settings;
  connection: ConnectionStatus;
  driveDestination: DestinationRef | null;
  /** Real download root, once a save has revealed it. Null before the first save. */
  localDirectory: string | null;
  onChange: (patch: DeepPartial<Settings>) => void;
  onChanged: () => void | Promise<void>;
  onChangeFolder: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (cause) {
      const appError = toAppError(cause);
      if (appError.code !== 'AUTH_CANCELLED') setError(appError.userMessage);
    } finally {
      setBusy(false);
    }
  };

  const mode = settings.destinationMode;
  const level = connection.fullAccess ? 'full-drive' : 'app-folders';
  const shortfall = describeShortfall(mode, connection.connected && Boolean(driveDestination));
  // The exact path a capture will be written to, using the real root once known.
  const savePath = formatLocalPath(localDirectory, settings.local.subfolder);

  return (
    <Panel title="Destination" description="Where your captures are saved.">
      {/*
        Stacked rather than inline: three options with labels this long do not fit the
        narrow right-hand column without wrapping, and a wrapped segmented control
        looks broken. Given the full width they sit on one line each, left-aligned.
      */}
      <Setting
        label="Save captures to"
        description="This is the default for every capture. Google Drive is optional; saving to this device needs no account."
        layout="stacked"
        control={
          <Segmented
            label="Destination"
            options={MODES}
            value={mode}
            onChange={(destinationMode) => onChange({ destinationMode })}
            compact
            align="start"
          />
        }
      />

      {shortfall ? (
        <div style={{ padding: '0 0 13px' }}>
          <Banner tone={shortfall.blocking ? 'info' : 'warning'}>{shortfall.message}</Banner>
        </div>
      ) : null}

      {modeIncludes(mode, 'local') ? (
        <>
          <Setting
            label="Folder name"
            description="A folder inside your browser download location. Leave empty to save directly there; Chrome creates the folder for you."
            htmlFor="sd-subfolder"
            control={
              <input
                id="sd-subfolder"
                className="sd-input"
                value={settings.local.subfolder}
                spellCheck={false}
                maxLength={120}
                placeholder="SnapDock"
                onChange={(event) => onChange({ local: { subfolder: event.target.value } })}
              />
            }
          />

          {/*
            The real absolute path is shown once a save has revealed it. Chrome exposes
            no API to read the configured download directory up front, so before the
            first save this falls back to the generic label rather than guessing at a
            platform-specific path that might be wrong.
          */}
          <Setting
            label="Files are saved to"
            description={
              localDirectory
                ? 'The exact location on this computer.'
                : 'Your browser download location. The full path appears here after your first capture.'
            }
            layout="stacked"
            control={
              <div style={{ width: '100%' }}>
                <div className="sd-preview-name">{savePath}</div>
                <div className="sd-row" style={{ gap: 8, marginTop: 10 }}>
                  <Button
                    size="sm"
                    icon={<IconExternal size={13} />}
                    onClick={() => {
                      // Chrome owns the base download directory; this is where the user
                      // changes it, and it is the same page on every platform.
                      void chrome.tabs.create({ url: 'chrome://settings/downloads' });
                    }}
                  >
                    Change browser download location
                  </Button>
                </div>
                <p className="sd-setting__desc">
                  Extensions cannot write outside the browser download location. To save
                  anywhere else, turn on <strong>Ask where to save each time</strong> below and pick
                  the folder yourself.
                </p>
              </div>
            }
          />

          <Setting
            label="Ask where to save each time"
            description="Opens your system's save dialog for every capture, so you can choose any folder."
            layout="switch"
            control={
              <Switch
                checked={settings.local.askEveryTime}
                onChange={(askEveryTime) => onChange({ local: { askEveryTime } })}
                label="Ask where to save each time"
              />
            }
          />
        </>
      ) : null}

      {modeIncludes(mode, 'google-drive') ? (
        <>
          <Setting
            label="Connection"
            description={
              connection.connected
                ? connection.account
                  ? `Connected as ${connection.account}`
                  : 'Connected'
                : 'Not connected yet. Captures cannot be saved to Drive until you connect.'
            }
            control={
              connection.connected ? (
                <Button
                  variant="danger"
                  loading={busy}
                  onClick={() => void run(() => send('drive/disconnect'))}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  variant="primary"
                  loading={busy}
                  icon={<IconGoogleDrive size={15} />}
                  onClick={() => void run(() => send('drive/connect', {}))}
                >
                  Connect Google Drive
                </Button>
              )
            }
          />

          {connection.connected ? (
            <>
              <Setting
                label="Drive folder"
                description={
                  driveDestination
                    ? driveDestination.folderPath || driveDestination.folderName
                    : 'No folder chosen. Captures cannot be saved until you pick one.'
                }
                control={
                  <>
                    {driveDestination ? (
                      <Button
                        variant="ghost"
                        icon={<IconExternal size={14} />}
                        onClick={() => {
                          void chrome.tabs.create({
                            url: `https://drive.google.com/drive/folders/${driveDestination.folderId}`,
                          });
                        }}
                      >
                        Open
                      </Button>
                    ) : null}
                    <Button onClick={onChangeFolder}>
                      {driveDestination ? 'Change' : 'Choose folder'}
                    </Button>
                  </>
                }
              />

              <Setting
                label="What SnapDock can see"
                description={ACCESS_LEVEL_COPY[level].description}
                layout="stacked"
                control={
                  connection.fullAccess ? (
                    <p className="sd-hint" style={{ margin: 0 }}>
                      SnapDock currently has access to all folders in your Drive. To narrow it
                      again, disconnect and reconnect. It will go back to only the folders it
                      creates.
                    </p>
                  ) : (
                    <Button
                      loading={busy}
                      onClick={() => void run(() => send('drive/connect', { fullAccess: true }))}
                    >
                      Let SnapDock see all my folders
                    </Button>
                  )
                }
              />
            </>
          ) : null}
        </>
      ) : null}

      {error ? (
        <div style={{ paddingBottom: 12 }}>
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}
    </Panel>
  );
}
