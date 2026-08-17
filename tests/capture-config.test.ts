import { describe, expect, it } from 'vitest';
import type { DestinationRef, Settings } from '@/types';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { resolveCaptureRequest, resolveImageConfig } from '@/capture/requestConfig';
import { isRestrictedUrl } from '@/capture/tabCapture';

const destination: DestinationRef = {
  providerId: 'google-drive',
  folderId: 'default-folder',
  folderName: 'Screenshots',
  folderPath: 'My Drive / Screenshots',
};

const destinations = [destination];

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultCaptureMode: 'visible',
  defaultOutputType: 'png',
  image: { format: 'png', quality: 95, scale: 1 },
  filename: { template: 'Screenshot_{date}' },
};

describe('resolveImageConfig', () => {
  it('makes the image format follow the output type for image output', () => {
    expect(resolveImageConfig({ format: 'png', quality: 90, scale: 1 }, 'webp').format).toBe('webp');
    expect(resolveImageConfig({ format: 'webp', quality: 90, scale: 1 }, 'jpeg').format).toBe('jpeg');
  });

  it('leaves the image format alone for PDF, where it selects the embedded encoder', () => {
    expect(resolveImageConfig({ format: 'jpeg', quality: 90, scale: 1 }, 'pdf').format).toBe('jpeg');
  });

  it('preserves quality and scale in both cases', () => {
    const base = { format: 'png' as const, quality: 72, scale: 2 };
    expect(resolveImageConfig(base, 'jpeg')).toMatchObject({ quality: 72, scale: 2 });
    expect(resolveImageConfig(base, 'pdf')).toMatchObject({ quality: 72, scale: 2 });
  });

  it('does not mutate the config it was given', () => {
    const base = { format: 'png' as const, quality: 90, scale: 1 };
    resolveImageConfig(base, 'webp');
    expect(base.format).toBe('png');
  });
});

describe('resolveCaptureRequest', () => {
  it('fills everything from defaults when nothing is supplied, as a keyboard shortcut does', () => {
    const request = resolveCaptureRequest({}, settings, destinations);

    expect(request.captureMode).toBe('visible');
    expect(request.outputType).toBe('png');
    expect(request.filenameTemplate).toBe('Screenshot_{date}');
    expect(request.destinations).toEqual(destinations);
    expect(request.pdf).toEqual(settings.pdf);
  });

  it('lets explicit choices win over defaults', () => {
    const request = resolveCaptureRequest(
      { captureMode: 'fullpage', outputType: 'pdf' },
      settings,
      destinations,
    );
    expect(request.captureMode).toBe('fullpage');
    expect(request.outputType).toBe('pdf');
  });

  it('keeps the image format consistent with the requested output', () => {
    expect(resolveCaptureRequest({ outputType: 'webp' }, settings, destinations).image.format).toBe(
      'webp',
    );
    // PDF keeps the configured encoder rather than being overwritten with "pdf".
    expect(resolveCaptureRequest({ outputType: 'pdf' }, settings, destinations).image.format).toBe(
      'png',
    );
  });

  it('prefers preset destinations over the global default', () => {
    const pinned: DestinationRef = {
      providerId: 'google-drive',
      folderId: 'bug-reports',
      folderName: 'Bug Reports',
      folderPath: 'My Drive / Bug Reports',
    };
    expect(
      resolveCaptureRequest({ destinations: [pinned] }, settings, destinations).destinations,
    ).toEqual([pinned]);
  });

  it('falls back to the global default when a preset pins nothing', () => {
    expect(resolveCaptureRequest({}, settings, destinations).destinations).toEqual(destinations);
  });

  it('reports an empty destination list rather than inventing one', () => {
    expect(resolveCaptureRequest({}, settings, []).destinations).toEqual([]);
  });

  it('carries multiple destinations through unchanged, as "Both" requires', () => {
    const local: DestinationRef = {
      providerId: 'local',
      folderId: 'SnapDock',
      folderName: 'SnapDock',
      folderPath: 'Downloads/SnapDock',
    };
    const request = resolveCaptureRequest({}, settings, [local, destination]);
    expect(request.destinations).toHaveLength(2);
    // Order matters: local first, so a Drive failure cannot lose the capture.
    expect(request.destinations[0]?.providerId).toBe('local');
    expect(request.destinations[1]?.providerId).toBe('google-drive');
  });

  it('omits optional fields entirely when not supplied', () => {
    const request = resolveCaptureRequest({}, settings, destinations);
    expect('tabId' in request).toBe(false);
    expect('region' in request).toBe(false);
    expect('skipPreview' in request).toBe(false);
  });

  it('carries through tab, region and preview-skip when supplied', () => {
    const region = { x: 10, y: 20, width: 300, height: 200 };
    const request = resolveCaptureRequest(
      { tabId: 7, region, skipPreview: true, captureMode: 'region' },
      settings,
      destinations,
    );
    expect(request.tabId).toBe(7);
    expect(request.region).toEqual(region);
    expect(request.skipPreview).toBe(true);
  });

  it('keeps skipPreview: false, which is meaningfully different from omitted', () => {
    expect(resolveCaptureRequest({ skipPreview: false }, settings, destinations).skipPreview).toBe(
      false,
    );
  });
});

describe('isRestrictedUrl', () => {
  it('flags pages Chrome will not let any extension capture', () => {
    expect(isRestrictedUrl('chrome://settings')).toBe(true);
    expect(isRestrictedUrl('chrome-extension://abc/page.html')).toBe(true);
    expect(isRestrictedUrl('devtools://devtools/bundled/x.html')).toBe(true);
    expect(isRestrictedUrl('view-source:https://example.com')).toBe(true);
    expect(isRestrictedUrl('about:blank')).toBe(true);
    expect(isRestrictedUrl('file:///home/user/page.html')).toBe(true);
    expect(isRestrictedUrl('https://chromewebstore.google.com/detail/x')).toBe(true);
    expect(isRestrictedUrl('https://chrome.google.com/webstore/detail/x')).toBe(true);
  });

  it('treats a missing URL as restricted, since it cannot be checked', () => {
    expect(isRestrictedUrl(undefined)).toBe(true);
    expect(isRestrictedUrl('')).toBe(true);
  });

  it('allows ordinary web pages', () => {
    expect(isRestrictedUrl('https://example.com/docs')).toBe(false);
    expect(isRestrictedUrl('http://localhost:3000')).toBe(false);
    // A Google page that is not the Web Store is fine.
    expect(isRestrictedUrl('https://chrome.google.com/')).toBe(false);
  });
});
