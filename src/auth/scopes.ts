import { BASE_OAUTH_SCOPES } from '@/manifest.config';

/**
 * SnapDock's two access levels.
 *
 * The distinction is not cosmetic. `drive.file` is per-file access: SnapDock can only
 * see and write files and folders it created itself, which is why the default folder
 * browser shows SnapDock's own folders and offers to create new ones. Saving into a
 * folder the extension did not create is impossible under that scope, because Drive
 * rejects it, so browsing the user's whole Drive genuinely requires the broader `drive`
 * scope. Rather than requesting that up front, SnapDock ships with the narrow scope
 * and lets the user opt in from Settings if they want to pick an existing folder.
 */

export type AccessLevel = 'app-folders' | 'full-drive';

export const SCOPES: Record<AccessLevel, string[]> = {
  'app-folders': [...BASE_OAUTH_SCOPES],
  'full-drive': ['https://www.googleapis.com/auth/drive'],
};

export const ACCESS_LEVEL_COPY: Record<AccessLevel, { title: string; description: string }> = {
  'app-folders': {
    title: 'Folders SnapDock creates',
    description:
      'SnapDock can only see and use folders it creates for you. The rest of your Drive stays private to it.',
  },
  'full-drive': {
    title: 'All folders in my Drive',
    description:
      'Lets you save into folders that already exist. SnapDock will be able to see your Drive files.',
  },
};

export function scopesFor(level: AccessLevel): string[] {
  return SCOPES[level];
}

/** True when the granted scope set includes browse-anywhere access. */
export function hasFullAccess(grantedScopes: readonly string[] | undefined): boolean {
  return (grantedScopes ?? []).includes(SCOPES['full-drive'][0]!);
}
