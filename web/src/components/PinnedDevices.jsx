import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusDot } from '@/components/DeviceTag';
import { api } from '@/lib/api';

// Last-resort manual entries by UPnP description URL, for a device that
// never turns up through discovery. Lives in the collapsed "Add by URL"
// section of the devices sheet.
export function PinnedDevicesEditor({ pinned, onChange }) {
  const [editing, setEditing] = useState(null); // location being edited
  const [draft, setDraft] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChange();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event) {
    event.preventDefault();
    const location = newLocation.trim();
    if (!location) return;
    if (await run(() => api.addPinnedDevice(location))) setNewLocation('');
  }

  async function save(from) {
    const location = draft.trim();
    if (!location) return;
    if (await run(() => api.updatePinnedDevice(from, location))) setEditing(null);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Only needed if a device never shows up. Use its UPnP description URL, e.g.{' '}
        <span className="font-mono">http://192.168.0.10:8080/description.xml</span>
      </p>

      {pinned.length > 0 && (
        <ul className="space-y-1">
          {pinned.map((p) => (
            <li key={p.location} className="rounded-lg border px-2.5 py-2">
              {editing === p.location ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save(p.location);
                  }}
                >
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="font-mono text-xs"
                    disabled={busy}
                  />
                  <Button type="submit" size="icon" variant="ghost" title="Save" disabled={busy}>
                    <Check className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    title="Cancel"
                    onClick={() => setEditing(null)}
                    disabled={busy}
                  >
                    <X className="size-4" />
                  </Button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <span title={p.online ? 'Online' : `Offline${p.error ? ` (${p.error})` : ''}`}>
                    <StatusDot online={p.online} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      {p.friendlyName ?? <span className="text-muted-foreground">Not reachable</span>}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground" title={p.location}>
                      {p.location}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Edit URL"
                    onClick={() => {
                      setEditing(p.location);
                      setDraft(p.location);
                      setError(null);
                    }}
                    disabled={busy}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Remove"
                    onClick={() => run(() => api.removePinnedDevice(p.location))}
                    disabled={busy}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="flex items-center gap-1" onSubmit={add}>
        <Input
          value={newLocation}
          onChange={(e) => setNewLocation(e.target.value)}
          placeholder="http://…/description.xml"
          className="font-mono text-xs"
          disabled={busy}
        />
        <Button type="submit" size="sm" disabled={busy || !newLocation.trim()}>
          <Plus className="size-4" />
          Add
        </Button>
      </form>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
