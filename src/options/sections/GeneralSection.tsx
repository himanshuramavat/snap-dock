import type { CaptureMode, ImageFormat, OutputType, Settings } from '@/types';
import { Select } from '@/ui/components';
import { LIMITS } from '@/settings/schema';
import type { DeepPartial } from '@/settings/SettingsStore';
import { Panel, Setting } from '../components/Panel';

const CAPTURE_MODES: { value: CaptureMode; label: string }[] = [
  { value: 'visible', label: 'Visible area' },
  { value: 'region', label: 'Selected area' },
  { value: 'fullpage', label: 'Full page' },
];

const OUTPUT_TYPES: { value: OutputType; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'pdf', label: 'PDF' },
];

const IMAGE_FORMATS: { value: ImageFormat; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
];

const SCALES = [
  { value: '0.5', label: '50% (smaller files)' },
  { value: '1', label: '100% (as captured)' },
  { value: '1.5', label: '150%' },
  { value: '2', label: '200% (sharper on print)' },
];

export function GeneralSection({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: DeepPartial<Settings>) => void;
}) {
  const lossless = settings.image.format === 'png';

  return (
    <Panel title="General" description="What SnapDock does when you open it and press capture.">
      <Setting
        label="Default capture mode"
        description="Pre-selected each time the popup opens."
        control={
          <Select
            value={settings.defaultCaptureMode}
            options={CAPTURE_MODES}
            onChange={(defaultCaptureMode) => onChange({ defaultCaptureMode })}
            aria-label="Default capture mode"
          />
        }
      />

      <Setting
        label="Default output"
        description="The file type captures are saved as."
        control={
          <Select
            value={settings.defaultOutputType}
            options={OUTPUT_TYPES}
            onChange={(defaultOutputType) => onChange({ defaultOutputType })}
            aria-label="Default output type"
          />
        }
      />

      <Setting
        label="Image format for PDFs"
        description="Which encoder is used for the pictures placed inside a PDF."
        control={
          <Select
            value={settings.image.format}
            options={IMAGE_FORMATS}
            onChange={(format) => onChange({ image: { format } })}
            aria-label="Image format used inside PDFs"
          />
        }
      />

      <Setting
        label="Image quality"
        description={
          lossless
            ? 'PNG is always lossless. Quality applies to JPEG, WebP and PDF output.'
            : 'Higher keeps more detail and makes larger files. 100 is lossless.'
        }
        control={
          <>
            <input
              type="range"
              className="sd-range"
              min={LIMITS.quality.min}
              max={LIMITS.quality.max}
              step={1}
              value={settings.image.quality}
              aria-label="Image quality"
              onChange={(event) => onChange({ image: { quality: Number(event.target.value) } })}
            />
            <span className="sd-value">{settings.image.quality}</span>
          </>
        }
      />

      <Setting
        label="Resolution"
        description="Scales the captured pixels. Above 100% enlarges without adding real detail."
        control={
          <Select
            value={String(settings.image.scale)}
            options={SCALES}
            onChange={(scale) => onChange({ image: { scale: Number(scale) } })}
            aria-label="Capture resolution scale"
          />
        }
      />
    </Panel>
  );
}
