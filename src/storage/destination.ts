import type { DestinationMode, DestinationRef, ProviderId, Settings } from '@/types';
import { sanitizeSubfolder } from './local/LocalProvider';

/**
 * Turns settings into the concrete destinations a capture will be written to.
 *
 * Destinations are resolved as a *list* rather than a single value because "Both" is a
 * first-class choice. Every entry point (popup, preset, keyboard shortcut) goes through
 * here, so the precedence rules exist in exactly one place and are testable without a
 * browser.
 *
 * The two providers source their destination differently, and that asymmetry is
 * deliberate rather than an inconsistency:
 *
 *  - **Local** has nothing to look up. Chrome can only write inside Downloads, so the
 *    destination is fully described by a sub-folder name that lives in settings, and it
 *    is therefore *always* available.
 *  - **Google Drive** requires a folder id obtained by browsing, so it is persisted
 *    separately and may legitimately not exist yet.
 */

export const LOCAL_ROOT_LABEL = 'Downloads';

export const DESTINATION_MODES: readonly DestinationMode[] = ['local', 'google-drive', 'both'];

export const MODE_LABELS: Record<DestinationMode, string> = {
  local: 'This device',
  'google-drive': 'Google Drive',
  both: 'Both',
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  local: 'This device',
  'google-drive': 'Google Drive',
};

/** Builds the local destination implied by the user's sub-folder setting. */
export function localDestination(subfolder: string): DestinationRef {
  const clean = sanitizeSubfolder(subfolder);
  return {
    providerId: 'local',
    folderId: clean,
    folderName: clean || LOCAL_ROOT_LABEL,
    folderPath: clean ? `${LOCAL_ROOT_LABEL}/${clean}` : LOCAL_ROOT_LABEL,
  };
}

/** True when the mode asks for this provider. */
export function modeIncludes(mode: DestinationMode, providerId: ProviderId): boolean {
  if (mode === 'both') return true;
  return mode === providerId;
}

/**
 * Resolves every destination a capture should be written to, in save order.
 *
 * Local is deliberately first: it is instant and cannot fail for reasons outside the
 * user's control, so if the Drive upload then fails the capture is already safe on
 * disk rather than lost.
 *
 * Returns an empty array only when nothing is usable, which in practice means Drive
 * was chosen alone and has no folder. That empty array is what disables the capture
 * button, and it is the single source of that decision.
 */
export function resolveDestinations(
  settings: Settings,
  driveDestination: DestinationRef | null,
  mode: DestinationMode = settings.destinationMode,
): DestinationRef[] {
  const destinations: DestinationRef[] = [];

  if (modeIncludes(mode, 'local')) {
    destinations.push(localDestination(settings.local.subfolder));
  }
  if (modeIncludes(mode, 'google-drive') && driveDestination) {
    destinations.push(driveDestination);
  }

  return destinations;
}

/**
 * Explains a mode the user has chosen but which cannot be fully honoured, or null when
 * everything is fine.
 *
 * This is surfaced *before* capturing rather than after, so "Both" never silently
 * degrades into "device only" without the user being told.
 */
export function describeShortfall(
  mode: DestinationMode,
  driveReady: boolean,
): { message: string; blocking: boolean } | null {
  if (modeIncludes(mode, 'google-drive') && !driveReady) {
    return mode === 'both'
      ? {
          message:
            'Google Drive is not set up yet, so captures will be saved to this device only.',
          blocking: false,
        }
      : {
          message: 'Connect Google Drive and choose a folder before saving.',
          blocking: true,
        };
  }
  return null;
}

/**
 * Formats the local save location for display.
 *
 * Uses the real absolute root once one has been learned from a completed save, and the
 * generic "Downloads" label before that. The separator is taken from the root itself,
 * so a Windows user sees backslashes and everyone else sees forward slashes without
 * this module needing to know which platform it is on.
 */
export function formatLocalPath(root: string | null, subfolder: string): string {
  const clean = sanitizeSubfolder(subfolder);
  if (!root) return clean ? `${LOCAL_ROOT_LABEL}/${clean}` : LOCAL_ROOT_LABEL;

  const separator = root.includes('\\') ? '\\' : '/';
  const trimmed = root.replace(/[\\/]+$/, '');
  if (!clean) return trimmed;
  return `${trimmed}${separator}${clean.split('/').join(separator)}`;
}

/** True when saving to this provider needs no account or setup. */
export function isAlwaysReady(providerId: ProviderId): boolean {
  return providerId === 'local';
}
