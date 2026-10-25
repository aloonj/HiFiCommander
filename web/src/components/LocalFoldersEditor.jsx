import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

// The desktop app exposes a native folder picker; in a plain browser the
// path is typed instead.
const pickFolder = window.hifi?.pickFolder;

export function LocalFoldersEditor({ library }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const folders = library?.folders ?? [];

  async function save(next) {
    setBusy(true);
    setError(null);
    try {
      await api.setLocalFolders(next);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(folder) {
    const value = folder?.trim();
    if (!value || folders.includes(value)) return;
    if (await save([...folders, value])) setDraft('');
  }

  return (
    <div className="space-y-2">
      {folders.length > 0 && (
        <ul className="space-y-0.5">
          {folders.map((f) => (
            <li key={f} className="group flex items-center gap-1 rounded-md px-1 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f}>
                {f}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                title="Remove folder"
                disabled={busy}
                onClick={() => save(folders.filter((x) => x !== f))}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {pickFolder ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={async () => add(await pickFolder())}>
          <Plus className="size-4" /> Add folder
        </Button>
      ) : (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            add(draft);
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="/home/you/Music"
            className="font-mono text-xs"
            disabled={busy}
          />
          <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
            Add
          </Button>
        </form>
      )}

      <div className="text-xs text-muted-foreground">
        {library?.scanning ? (
          `Scanning… ${library.scanned} files`
        ) : folders.length > 0 ? (
          <>
            {library.trackCount} tracks ·{' '}
            <button type="button" className="hover:text-foreground hover:underline" onClick={() => api.rescanLocal()}>
              Rescan
            </button>
          </>
        ) : null}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
