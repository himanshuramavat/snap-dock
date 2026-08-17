import { useRef } from 'react';
import type { OutputType, Settings } from '@/types';
import { findUnknownTokens, previewFilename, TEMPLATE_TOKENS } from '@/filename/template';
import { Banner } from '@/ui/components';
import type { DeepPartial } from '@/settings/SettingsStore';
import { Panel, Setting } from '../components/Panel';

/**
 * Filename template editor.
 *
 * The live preview is the feature: a template language is only usable if you can see
 * what it produces, and it removes any need to explain the syntax in prose.
 */
export function FilenameSection({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: DeepPartial<Settings>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const template = settings.filename.template;
  const unknown = findUnknownTokens(template);

  /** Inserts a token at the caret rather than appending, which is what users expect. */
  const insertToken = (key: string): void => {
    const input = inputRef.current;
    const token = `{${key}}`;
    if (!input) {
      onChange({ filename: { template: template + token } });
      return;
    }
    const start = input.selectionStart ?? template.length;
    const end = input.selectionEnd ?? template.length;
    const next = template.slice(0, start) + token + template.slice(end);
    onChange({ filename: { template: next } });
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const outputType: OutputType = settings.defaultOutputType;

  return (
    <Panel title="File names" description="How captures are named when they land in Drive.">
      <Setting
        label="Template"
        description="Click a placeholder below to insert it. The file extension is added automatically."
        layout="stacked"
        htmlFor="sd-filename-template"
        control={
          <div style={{ width: '100%' }}>
            <input
              id="sd-filename-template"
              ref={inputRef}
              className="sd-input"
              value={template}
              spellCheck={false}
              maxLength={200}
              onChange={(event) => onChange({ filename: { template: event.target.value } })}
            />

            <div className="sd-tokens">
              {TEMPLATE_TOKENS.map((token) => (
                <button
                  key={token.key}
                  type="button"
                  className="sd-token"
                  title={`${token.description}. Example: ${token.example}`}
                  onClick={() => insertToken(token.key)}
                >
                  {`{${token.key}}`}
                </button>
              ))}
            </div>

            <div className="sd-preview-name" aria-live="polite">
              {previewFilename(template, outputType)}
            </div>

            {unknown.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <Banner tone="warning">
                  {unknown.length === 1
                    ? `“{${unknown[0]}}” isn’t a placeholder SnapDock knows, so it will appear as-is in the file name.`
                    : `These aren’t placeholders SnapDock knows and will appear as-is: ${unknown
                        .map((key) => `{${key}}`)
                        .join(', ')}`}
                </Banner>
              </div>
            ) : null}
          </div>
        }
      />
    </Panel>
  );
}
