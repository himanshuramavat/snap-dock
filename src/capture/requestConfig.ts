import type { CaptureRequest, DestinationRef, ImageConfig, OutputType, Settings } from '@/types';

/**
 * Resolves a partial capture request against the user's saved defaults.
 *
 * This is the single place where "what did the user ask for" becomes "what will
 * actually happen", and every entry point funnels through it: the popup (which
 * supplies most fields), a preset (which supplies all of them), and a keyboard
 * shortcut (which supplies almost none). Keeping it pure means the precedence rules
 * are testable without a browser.
 */

/**
 * Reconciles the output type with the image encoder.
 *
 * For image output the two are the same thing: asking for WebP output and then
 * encoding PNG would be incoherent. For PDF output the image format keeps its own
 * meaning, because it selects the encoder used for pictures placed inside the
 * document.
 */
export function resolveImageConfig(base: ImageConfig, outputType: OutputType): ImageConfig {
  return outputType === 'pdf' ? { ...base } : { ...base, format: outputType };
}

export function resolveCaptureRequest(
  partial: Partial<CaptureRequest>,
  settings: Settings,
  defaultDestinations: DestinationRef[],
): CaptureRequest {
  const outputType = partial.outputType ?? settings.defaultOutputType;

  return {
    captureMode: partial.captureMode ?? settings.defaultCaptureMode,
    outputType,
    image: resolveImageConfig(partial.image ?? settings.image, outputType),
    pdf: partial.pdf ?? settings.pdf,
    filenameTemplate: partial.filenameTemplate ?? settings.filename.template,
    // Explicitly supplied destinations (from a preset that pins one) always win over
    // the global default, including when the default resolves to nothing.
    destinations: partial.destinations ?? defaultDestinations,
    ...(partial.tabId !== undefined ? { tabId: partial.tabId } : {}),
    ...(partial.region ? { region: partial.region } : {}),
    ...(partial.skipPreview !== undefined ? { skipPreview: partial.skipPreview } : {}),
  };
}
