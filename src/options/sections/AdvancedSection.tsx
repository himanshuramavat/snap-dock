import type { Settings } from '@/types';
import { Button, Switch } from '@/ui/components';
import { LIMITS } from '@/settings/schema';
import type { DeepPartial } from '@/settings/SettingsStore';
import { Panel, Setting } from '../components/Panel';

/**
 * Settings that only matter when the defaults don't work.
 *
 * Kept short on purpose. Every knob here exists because a real page defeats the
 * default: sites that lazy-load slowly, sites that scroll forever, and sticky
 * headers that would otherwise repeat down a stitched capture.
 */
export function AdvancedSection({
  settings,
  onChange,
  onReset,
}: {
  settings: Settings;
  onChange: (patch: DeepPartial<Settings>) => void;
  onReset: () => void;
}) {
  const { advanced } = settings;

  return (
    <Panel title="Advanced" description="For pages that don't behave.">
      <Setting
        label="Preview before saving"
        description="Check the capture and file name before it uploads."
        layout="switch"
        control={
          <Switch
            checked={advanced.previewBeforeSave}
            onChange={(previewBeforeSave) => onChange({ advanced: { previewBeforeSave } })}
            label="Preview before saving"
          />
        }
      />

      <Setting
        label="Open in Drive after saving"
        description="Opens the uploaded file in a background tab. Only applies to Google Drive; local files have no web address."
        layout="switch"
        control={
          <Switch
            checked={advanced.openAfterUpload}
            onChange={(openAfterUpload) => onChange({ advanced: { openAfterUpload } })}
            label="Open in Drive after saving"
          />
        }
      />

      <Setting
        label="Hide sticky headers and footers"
        description="Stops pinned bars from repeating down a full-page capture."
        layout="switch"
        control={
          <Switch
            checked={advanced.hideStickyElements}
            onChange={(hideStickyElements) => onChange({ advanced: { hideStickyElements } })}
            label="Hide sticky headers and footers"
          />
        }
      />

      <Setting
        label="Wait between scroll steps"
        description="Raise this if images are still loading when a full-page capture reaches them."
        control={
          <>
            <input
              type="range"
              className="sd-range"
              min={LIMITS.scrollSettleMs.min}
              max={LIMITS.scrollSettleMs.max}
              step={20}
              value={advanced.scrollSettleMs}
              aria-label="Wait between scroll steps in milliseconds"
              onChange={(event) =>
                onChange({ advanced: { scrollSettleMs: Number(event.target.value) } })
              }
            />
            <span className="sd-value">{advanced.scrollSettleMs} ms</span>
          </>
        }
      />

      <Setting
        label="Maximum page height"
        description="Full-page captures stop here. Protects against pages that scroll forever."
        control={
          <>
            <input
              type="range"
              className="sd-range"
              min={LIMITS.maxFullPageHeight.min}
              max={LIMITS.maxFullPageHeight.max}
              step={1000}
              value={advanced.maxFullPageHeight}
              aria-label="Maximum full page height in pixels"
              onChange={(event) =>
                onChange({ advanced: { maxFullPageHeight: Number(event.target.value) } })
              }
            />
            <span className="sd-value">{(advanced.maxFullPageHeight / 1000).toFixed(0)}k px</span>
          </>
        }
      />

      <Setting
        label="Reset settings"
        description="Restores every setting to its default. Presets and your Drive connection are kept."
        control={
          <Button variant="danger" onClick={onReset}>
            Reset to defaults
          </Button>
        }
      />
    </Panel>
  );
}
