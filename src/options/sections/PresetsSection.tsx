import { useState } from 'react';
import type { CaptureMode, DestinationRef, OutputType, Preset, Settings } from '@/types';
import { send } from '@/utils/messaging';
import { toAppError } from '@/utils/errors';
import { Banner, Button, IconButton, Select } from '@/ui/components';
import { IconBolt, IconPlus, IconTrash } from '@/ui/icons';
import { PRESET_LIMIT } from '@/presets/PresetStore';
import { Panel } from '../components/Panel';

const CAPTURE_LABELS: Record<CaptureMode, string> = {
  visible: 'Visible area',
  region: 'Selected area',
  fullpage: 'Full page',
};

const CAPTURE_OPTIONS = (Object.keys(CAPTURE_LABELS) as CaptureMode[]).map((value) => ({
  value,
  label: CAPTURE_LABELS[value],
}));

const OUTPUT_OPTIONS: { value: OutputType; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'pdf', label: 'PDF' },
];

/**
 * Preset management.
 *
 * A new preset is seeded from the user's current defaults rather than from an empty
 * form. The common case is "what I have now, but for bug reports", and starting
 * from blank would make them re-enter choices they have already made.
 */
export function PresetsSection({
  presets,
  settings,
  driveDestination,
  onChanged,
}: {
  presets: Preset[];
  settings: Settings;
  /** The chosen Drive folder, which is the only thing a preset can pin. */
  driveDestination: DestinationRef | null;
  onChanged: (presets: Preset[]) => void;
}) {
  const [editing, setEditing] = useState<Preset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<Preset[]>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action());
    } catch (cause) {
      setError(toAppError(cause).userMessage);
    } finally {
      setBusy(false);
    }
  };

  const startNew = (): void => {
    const now = Date.now();
    setEditing({
      id: crypto.randomUUID(),
      name: '',
      captureMode: settings.defaultCaptureMode,
      outputType: settings.defaultOutputType,
      image: settings.image,
      pdf: settings.pdf,
      filenameTemplate: settings.filename.template,
      destination: null,
      // Follows the user's global destination setting unless they pin a folder.
      destinationMode: null,
      createdAt: now,
      updatedAt: now,
    });
  };

  return (
    <Panel
      title="Presets"
      description="One click in the popup runs a whole configuration: capture mode, format and destination."
    >
      {presets.length === 0 && !editing ? (
        <div className="sd-empty" style={{ padding: '22px 8px' }}>
          <IconBolt size={20} style={{ color: 'var(--sd-text-subtle)' }} />
          <span className="sd-empty__title">No presets yet</span>
          <span style={{ fontSize: 12 }}>
            Save a capture setup you use often and it becomes a single click.
          </span>
        </div>
      ) : (
        presets.map((preset) => (
          <div key={preset.id} className="sd-preset-card">
            <IconBolt size={15} style={{ color: 'var(--sd-accent)' }} />
            <div className="sd-preset-card__text">
              <div className="sd-preset-card__name">{preset.name}</div>
              <div className="sd-preset-card__meta">
                {CAPTURE_LABELS[preset.captureMode]} · {preset.outputType.toUpperCase()} ·{' '}
                {preset.destination ? preset.destination.folderName : 'Default folder'} ·{' '}
                <span className="sd-mono">{preset.filenameTemplate}</span>
              </div>
            </div>
            <Button size="sm" onClick={() => setEditing(preset)} disabled={busy}>
              Edit
            </Button>
            <IconButton
              label={`Delete ${preset.name}`}
              disabled={busy}
              onClick={() => void run(() => send('presets/delete', { id: preset.id }))}
            >
              <IconTrash size={14} />
            </IconButton>
          </div>
        ))
      )}

      {editing ? (
        <div style={{ paddingTop: 14, borderTop: '1px solid var(--sd-border)', marginTop: 6 }}>
          <div className="sd-stack" style={{ gap: 11 }}>
            <div>
              <label className="sd-label" htmlFor="sd-preset-name">
                Name
              </label>
              <input
                id="sd-preset-name"
                className="sd-input"
                value={editing.name}
                autoFocus
                maxLength={60}
                placeholder="e.g. Bug report"
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
              <div>
                <label className="sd-label" htmlFor="sd-preset-mode">
                  Capture
                </label>
                <Select
                  id="sd-preset-mode"
                  value={editing.captureMode}
                  options={CAPTURE_OPTIONS}
                  onChange={(captureMode) => setEditing({ ...editing, captureMode })}
                />
              </div>
              <div>
                <label className="sd-label" htmlFor="sd-preset-output">
                  Save as
                </label>
                <Select
                  id="sd-preset-output"
                  value={editing.outputType}
                  options={OUTPUT_OPTIONS}
                  onChange={(outputType) => setEditing({ ...editing, outputType })}
                />
              </div>
            </div>

            <div>
              <label className="sd-label" htmlFor="sd-preset-template">
                File name template
              </label>
              <input
                id="sd-preset-template"
                className="sd-input"
                value={editing.filenameTemplate}
                spellCheck={false}
                maxLength={200}
                onChange={(event) => setEditing({ ...editing, filenameTemplate: event.target.value })}
              />
            </div>

            <div>
              <label className="sd-label" htmlFor="sd-preset-destination">
                Destination
              </label>
              <Select
                id="sd-preset-destination"
                value={editing.destination ? 'pinned' : 'default'}
                options={[
                  { value: 'default', label: 'Use my default folder' },
                  {
                    value: 'pinned',
                    label: driveDestination
                      ? `Always: ${driveDestination.folderName}`
                      : 'Always: (choose a Drive folder first)',
                  },
                ]}
                onChange={(value) =>
                  setEditing({
                    ...editing,
                    destination: value === 'pinned' ? driveDestination : null,
                  })
                }
              />
              <p className="sd-setting__desc">
                Pinning uses whichever Drive folder is currently selected, and keeps it even if you
                change the default later.
              </p>
            </div>

            {error ? <Banner tone="error">{error}</Banner> : null}

            <div className="sd-row" style={{ gap: 8 }}>
              <Button
                variant="primary"
                disabled={!editing.name.trim() || busy}
                onClick={() =>
                  void run(async () => {
                    const saved = await send('presets/save', { preset: editing });
                    setEditing(null);
                    return saved;
                  })
                }
              >
                Save preset
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ paddingTop: 12 }}>
          <Button
            icon={<IconPlus size={14} />}
            onClick={startNew}
            disabled={busy || presets.length >= PRESET_LIMIT}
          >
            New preset
          </Button>
          {presets.length >= PRESET_LIMIT ? (
            <p className="sd-setting__desc">You've reached the maximum of {PRESET_LIMIT} presets.</p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
