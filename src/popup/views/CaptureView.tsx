import type {
  CaptureMode,
  ConnectionStatus,
  DestinationMode,
  DestinationRef,
  OutputType,
  Preset,
} from '@/types';
import { Segmented, type SegmentedOption } from '@/ui/components';
import { IconBolt, IconFullPage, IconRegion, IconViewport } from '@/ui/icons';
import { DestinationCard } from '../components/DestinationCard';

/**
 * The idle screen: pick how to capture, what to produce, where it goes, and go.
 *
 * The whole point is that the common path is three visible choices and one button,
 * with the defaults already correct, so a returning user can capture and save in a
 * single click without reading anything. The primary action itself lives in the
 * popup's pinned footer, so it never scrolls out of reach on a small screen.
 */

const CAPTURE_MODES: readonly SegmentedOption<CaptureMode>[] = [
  { value: 'visible', label: 'Visible', icon: <IconViewport size={17} />, title: 'Capture what is on screen' },
  { value: 'region', label: 'Area', icon: <IconRegion size={17} />, title: 'Drag to select an area' },
  { value: 'fullpage', label: 'Full page', icon: <IconFullPage size={17} />, title: 'Scroll and stitch the whole page' },
];

const OUTPUT_TYPES: readonly SegmentedOption<OutputType>[] = [
  { value: 'png', label: 'PNG', title: 'Lossless image' },
  { value: 'jpeg', label: 'JPEG', title: 'Smaller file, lossy' },
  { value: 'webp', label: 'WebP', title: 'Modern format, smaller than PNG' },
  { value: 'pdf', label: 'PDF', title: 'Paged document' },
];

export function CaptureView({
  captureMode,
  outputType,
  mode,
  connection,
  destinations,
  presets,
  onCaptureModeChange,
  onOutputTypeChange,
  onModeChange,
  onApplyPreset,
  onChangeFolder,
  onRefresh,
}: {
  captureMode: CaptureMode;
  outputType: OutputType;
  mode: DestinationMode;
  connection: ConnectionStatus;
  destinations: DestinationRef[];
  presets: Preset[];
  onCaptureModeChange: (captureMode: CaptureMode) => void;
  onOutputTypeChange: (type: OutputType) => void;
  onModeChange: (mode: DestinationMode) => void;
  onApplyPreset: (preset: Preset) => void;
  onChangeFolder: () => void;
  onRefresh: () => void | Promise<void>;
}) {
  return (
    <>
      <section>
        <span className="sd-label" id="sd-capture-label">
          Capture
        </span>
        <Segmented
          label="Capture mode"
          options={CAPTURE_MODES}
          value={captureMode}
          onChange={onCaptureModeChange}
        />
      </section>

      <section>
        <span className="sd-label">Save as</span>
        <Segmented
          label="Output format"
          options={OUTPUT_TYPES}
          value={outputType}
          onChange={onOutputTypeChange}
          compact
        />
      </section>

      <section>
        <span className="sd-label">Destination</span>
        <DestinationCard
          mode={mode}
          connection={connection}
          destinations={destinations}
          onModeChange={onModeChange}
          onChangeFolder={onChangeFolder}
          onChanged={onRefresh}
        />
      </section>

      {presets.length > 0 ? (
        <section>
          <span className="sd-label">Presets</span>
          <div className="sd-presets">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="sd-preset"
                onClick={() => onApplyPreset(preset)}
                title={`${preset.captureMode} · ${preset.outputType.toUpperCase()}`}
              >
                <IconBolt size={11} />
                {preset.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

    </>
  );
}
