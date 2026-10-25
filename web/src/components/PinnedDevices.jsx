import { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Pin, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const POLL_MS = 5000;

// Devices that don't answer SSDP discovery (e.g. the Marantz) are added by
// their UPnP description URL. Status is polled only while the popover is open.
export function PinnedDevices() {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState([]);
  const [editing, setEditing] = useState(null); // location being edited
  const [draft, setDraft] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    api
      .getDevices()
      .then((d) => setPinned(d.pinned ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [open, refresh]);

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
      refresh();
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
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setEditing(null);
        setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" title="Pinned devices">
          <Pin className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] space-y-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Pinned devices</div>
          <p className="text-xs text-muted-foreground">
            For devices that don't show up on their own. Add them by their UPnP description URL, e.g.{' '}
            <span className="font-mono">http://192.168.0.148:8080/description.xml</span>
          </p>
        </div>

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
                    <span
                      className={cn('size-2 shrink-0 rounded-full', p.online ? 'bg-green-500' : 'bg-muted-foreground/40')}
                      title={p.online ? 'Online' : `Offline${p.error ? ` (${p.error})` : ''}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">
                        {p.friendlyName ?? <span className="text-muted-foreground">Not reachable</span>}
                        {p.friendlyName && !p.online && (
                          <span className="text-muted-foreground"> · offline</span>
                        )}
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
      </PopoverContent>
    </Popover>
  );
}
