import type { Orientation, PaperSizeId, Settings } from '@/types';
import { Select, Switch } from '@/ui/components';
import { LIMITS } from '@/settings/schema';
import { PAPER_SIZES } from '@/pdf/paper';
import type { DeepPartial } from '@/settings/SettingsStore';
import { Panel, Setting } from '../components/Panel';

const ORIENTATIONS: { value: Orientation; label: string }[] = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

const PAPER_OPTIONS: { value: PaperSizeId; label: string }[] = PAPER_SIZES.map((paper) => ({
  value: paper.id,
  label: paper.label,
}));

export function PdfSection({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: DeepPartial<Settings>) => void;
}) {
  const { pdf } = settings;
  const sizeIsFixed = pdf.paperSize !== 'fit';

  return (
    <Panel title="PDF" description="Defaults used whenever a capture is saved as a PDF.">
      <Setting
        label="Paper size"
        description={
          pdf.paperSize === 'fit'
            ? 'The page is sized to the capture, so nothing is cropped or letterboxed.'
            : undefined
        }
        control={
          <Select
            value={pdf.paperSize}
            options={PAPER_OPTIONS}
            onChange={(paperSize) => onChange({ pdf: { paperSize } })}
            aria-label="Paper size"
          />
        }
      />

      {pdf.paperSize === 'custom' ? (
        <Setting
          label="Custom size"
          description="Width and height in millimetres."
          control={
            <>
              <input
                type="number"
                className="sd-input"
                style={{ width: 90 }}
                min={LIMITS.customPaperMm.min}
                max={LIMITS.customPaperMm.max}
                value={pdf.customWidthMm ?? 210}
                aria-label="Custom paper width in millimetres"
                onChange={(event) => onChange({ pdf: { customWidthMm: Number(event.target.value) } })}
              />
              <span className="sd-hint">×</span>
              <input
                type="number"
                className="sd-input"
                style={{ width: 90 }}
                min={LIMITS.customPaperMm.min}
                max={LIMITS.customPaperMm.max}
                value={pdf.customHeightMm ?? 297}
                aria-label="Custom paper height in millimetres"
                onChange={(event) =>
                  onChange({ pdf: { customHeightMm: Number(event.target.value) } })
                }
              />
            </>
          }
        />
      ) : null}

      {sizeIsFixed ? (
        <Setting
          label="Orientation"
          control={
            <Select
              value={pdf.orientation}
              options={ORIENTATIONS}
              onChange={(orientation) => onChange({ pdf: { orientation } })}
              aria-label="Page orientation"
            />
          }
        />
      ) : null}

      <Setting
        label="Margin"
        description="Blank space around the capture, in millimetres."
        control={
          <>
            <input
              type="range"
              className="sd-range"
              min={LIMITS.marginMm.min}
              max={LIMITS.marginMm.max}
              step={1}
              value={pdf.marginMm}
              aria-label="Page margin in millimetres"
              onChange={(event) => onChange({ pdf: { marginMm: Number(event.target.value) } })}
            />
            <span className="sd-value">{pdf.marginMm} mm</span>
          </>
        }
      />

      <Setting
        label="Scale"
        description="Shrinks the capture within the printable area."
        control={
          <>
            <input
              type="range"
              className="sd-range"
              min={LIMITS.pdfScale.min * 100}
              max={LIMITS.pdfScale.max * 100}
              step={5}
              value={Math.round(pdf.scale * 100)}
              aria-label="Content scale"
              onChange={(event) => onChange({ pdf: { scale: Number(event.target.value) / 100 } })}
            />
            <span className="sd-value">{Math.round(pdf.scale * 100)}%</span>
          </>
        }
      />

      <Setting
        label="Split long captures across pages"
        description="When off, a tall capture is shrunk to fit on a single page instead."
        layout="switch"
        control={
          <Switch
            checked={pdf.multiPage}
            onChange={(multiPage) => onChange({ pdf: { multiPage } })}
            label="Split long captures across pages"
          />
        }
      />

      <Setting
        label="Fit to page"
        description="Scales a single-page capture down so its full height is visible."
        layout="switch"
        control={
          <Switch
            checked={pdf.fitToPage}
            onChange={(fitToPage) => onChange({ pdf: { fitToPage } })}
            label="Fit to page"
          />
        }
      />
    </Panel>
  );
}
