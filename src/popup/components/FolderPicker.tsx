import { useCallback, useEffect, useState } from 'react';
import type { ConnectionStatus, RemoteFolder } from '@/types';
import { send } from '@/utils/messaging';
import { toAppError, type SerializedError } from '@/utils/errors';
import { Banner, Button, IconButton } from '@/ui/components';
import {
  IconChevronRight,
  IconClose,
  IconFolder,
  IconFolderPlus,
  IconRefresh,
} from '@/ui/icons';

/**
 * Google Drive folder browser.
 *
 * The empty state carries real weight here. Under the default `drive.file` scope
 * Drive genuinely returns nothing until SnapDock has created a folder, and a bare
 * "No folders" would read as a bug. So the empty state explains the scope, offers
 * the two things that actually resolve it (create a folder, or grant full access)
 * and never blames the user's Drive for being empty.
 */

const ROOT: RemoteFolder = {
  id: 'root',
  name: 'My Drive',
  path: 'My Drive',
  parentId: null,
};

export function FolderPicker({
  connection,
  onSelect,
  onClose,
  onConnectionChange,
}: {
  connection: ConnectionStatus;
  onSelect: (folder: RemoteFolder) => void | Promise<void>;
  onClose: () => void;
  onConnectionChange: (status: ConnectionStatus) => void;
}) {
  const [trail, setTrail] = useState<RemoteFolder[]>([ROOT]);
  const [folders, setFolders] = useState<RemoteFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SerializedError | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const current = trail[trail.length - 1] ?? ROOT;

  const load = useCallback(async (folder: RemoteFolder) => {
    setLoading(true);
    setError(null);
    try {
      setFolders(await send('drive/folders', { parentId: folder.id }));
    } catch (cause) {
      setError(toAppError(cause).toJSON());
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(current);
  }, [current, load]);

  const enter = (folder: RemoteFolder): void => setTrail((previous) => [...previous, folder]);
  const jumpTo = (index: number): void => setTrail((previous) => previous.slice(0, index + 1));

  const createFolder = async (): Promise<void> => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const folder = await send('drive/createFolder', { name, parentId: current.id });
      setNewName('');
      setCreating(false);
      setFolders((previous) => [...previous, folder].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (cause) {
      setError(toAppError(cause).toJSON());
    } finally {
      setBusy(false);
    }
  };

  const grantFullAccess = async (): Promise<void> => {
    setBusy(true);
    try {
      const status = await send('drive/connect', { fullAccess: true });
      onConnectionChange(status);
      await load(current);
    } catch (cause) {
      setError(toAppError(cause).toJSON());
    } finally {
      setBusy(false);
    }
  };

  const choose = async (): Promise<void> => {
    setBusy(true);
    try {
      await onSelect(current);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sd-picker">
      <div className="sd-row" style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 13 }}>Choose a folder</strong>
        <div className="sd-row" style={{ gap: 2 }}>
          <IconButton label="Refresh" onClick={() => void load(current)}>
            <IconRefresh size={14} />
          </IconButton>
          <IconButton label="Close" onClick={onClose}>
            <IconClose size={15} />
          </IconButton>
        </div>
      </div>

      <nav className="sd-crumbs" aria-label="Folder path">
        {trail.map((folder, index) =>
          index === trail.length - 1 ? (
            <span key={folder.id} className="sd-crumbs__current" aria-current="page">
              {folder.name}
            </span>
          ) : (
            <span key={folder.id} style={{ display: 'contents' }}>
              <button type="button" onClick={() => jumpTo(index)}>
                {folder.name}
              </button>
              <IconChevronRight size={11} />
            </span>
          ),
        )}
      </nav>

      {error ? <Banner tone="error">{error.userMessage}</Banner> : null}

      <div className="sd-folder-list">
        {loading ? (
          <div className="sd-empty">
            <span className="sd-spinner" style={{ color: 'var(--sd-text-subtle)' }} />
            <span>Loading folders…</span>
          </div>
        ) : folders.length > 0 ? (
          folders.map((folder) => (
            <button key={folder.id} type="button" className="sd-folder" onClick={() => enter(folder)}>
              <IconFolder size={15} style={{ color: 'var(--sd-text-subtle)' }} />
              <span className="sd-folder__name sd-truncate">{folder.name}</span>
              <IconChevronRight size={13} style={{ color: 'var(--sd-text-subtle)' }} />
            </button>
          ))
        ) : (
          <div className="sd-empty">
            <IconFolder size={22} style={{ color: 'var(--sd-text-subtle)' }} />
            <span className="sd-empty__title">
              {connection.fullAccess ? 'No sub-folders here' : 'No SnapDock folders yet'}
            </span>
            <span style={{ fontSize: 11.5, lineHeight: 1.5 }}>
              {connection.fullAccess
                ? 'You can save straight into this folder, or create a new one.'
                : 'SnapDock can only see folders it creates. Make one here, or let SnapDock see all your Drive folders.'}
            </span>
          </div>
        )}
      </div>

      {creating ? (
        <div className="sd-row" style={{ gap: 6 }}>
          <input
            className="sd-input"
            value={newName}
            autoFocus
            placeholder="Folder name"
            maxLength={80}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void createFolder();
              if (event.key === 'Escape') setCreating(false);
            }}
          />
          <Button size="sm" variant="primary" loading={busy} onClick={() => void createFolder()}>
            Create
          </Button>
        </div>
      ) : (
        <div className="sd-row" style={{ gap: 6 }}>
          <Button
            size="sm"
            icon={<IconFolderPlus size={14} />}
            onClick={() => setCreating(true)}
            disabled={busy}
          >
            New folder
          </Button>
          {!connection.fullAccess ? (
            <Button size="sm" variant="ghost" onClick={() => void grantFullAccess()} disabled={busy}>
              Show all my folders
            </Button>
          ) : null}
        </div>
      )}

      <Button variant="primary" block loading={busy} onClick={() => void choose()}>
        Save here: {current.name}
      </Button>
    </div>
  );
}
