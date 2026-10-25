import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DeviceTag } from '@/components/DeviceTag';
import { PinnedDevicesEditor } from '@/components/PinnedDevices';
import { api } from '@/lib/api';
import { SOURCE_LABELS } from '@/lib/deviceTags';
import { cn } from '@/lib/utils';

const POLL_MS = 2000;

function useIsWide() {
  const query = '(min-width: 640px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setWide(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return wide;
}

function DeviceRow({ device, selected, onSelect, onForget }) {
  const online = device.online !== false;
  // How it was found only matters when troubleshooting, so it's a tooltip.
  const howFound = SOURCE_LABELS[device.source];
  return (
    <li className="group flex items-center gap-1">
      <button
        type="button"
        disabled={!onSelect}
        onClick={onSelect}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
          onSelect && 'hover:bg-muted',
          selected && 'bg-muted hover:bg-muted'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('truncate', !online && 'text-muted-foreground')}>{device.friendlyName}</span>
            <DeviceTag device={device} />
          </div>
          {(device.address || !online) && (
            <div className="truncate text-xs text-muted-foreground" title={howFound}>
              {[device.address, !online && 'offline'].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        {selected && <Check className="size-4 shrink-0" aria-label="Selected" />}
      </button>
      {onForget && (
        <Button
          size="icon-sm"
          variant="ghost"
          title="Forget this device"
          onClick={onForget}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <X className="size-4" />
        </Button>
      )}
    </li>
  );
}

function Section({ title, children }) {
  return (
    <section className="space-y-1">
      <h3 className="px-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

// Managing devices (seeing what was found and how, rescanning, forgetting,
// manual URLs) is occasional, so it lives in a sheet rather than taking
// space from the queue; quick switching is done from the browse path and the
// now playing bar.
export function DevicesSheet({ open, onOpenChange, devices, serverUdn, rendererUdn, onServerChange, onRendererChange }) {
  const wide = useIsWide();
  const [extra, setExtra] = useState({ pinned: [], missing: [] });
  const [showManual, setShowManual] = useState(false);
  const [searching, setSearching] = useState(false);

  const refresh = useCallback(() => {
    api
      .getDevices()
      .then((d) => setExtra({ pinned: d.pinned ?? [], missing: d.missing ?? [] }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [open, refresh]);

  // Background searches every 30s aren't shown; only a search you asked for
  // reports progress, for the few seconds replies take to arrive.
  async function rescan() {
    setSearching(true);
    await api.rescanDevices().catch(() => {});
    setTimeout(() => {
      setSearching(false);
      refresh();
    }, 4000);
  }

  async function forget(udn) {
    await api.forgetDevice(udn).catch(() => {});
    refresh();
  }

  const missing = (kind) =>
    extra.missing
      .filter((m) => m.kind === kind)
      .map((m) => (
        <DeviceRow
          key={m.udn}
          device={{ ...m, online: false, source: 'remembered' }}
          onForget={() => forget(m.udn)}
        />
      ));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={wide ? 'right' : 'bottom'}
        className={cn('gap-0', wide ? 'w-96 sm:max-w-96' : 'max-h-[85vh]')}
      >
        <SheetHeader className="flex-row items-center gap-3 pr-12">
          <SheetTitle>Devices</SheetTitle>
          <SheetDescription className="sr-only">Players and libraries found on your network</SheetDescription>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={rescan} disabled={searching}>
            {searching ? 'Searching…' : 'Search again'}
          </Button>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-2 pb-4">
          <Section title="Players">
            {devices.renderers.map((r) => (
              <DeviceRow
                key={r.udn}
                device={r}
                selected={r.udn === rendererUdn}
                onSelect={() => onRendererChange(r.udn)}
                onForget={r.online === false ? () => forget(r.udn) : null}
              />
            ))}
            {missing('renderer')}
          </Section>

          <Section title="Libraries">
            {devices.servers.map((s) => (
              <DeviceRow
                key={s.udn}
                device={s}
                selected={s.udn === serverUdn}
                onSelect={() => onServerChange(s.udn)}
                onForget={s.online === false ? () => forget(s.udn) : null}
              />
            ))}
            {missing('server')}
            {devices.servers.length === 0 && extra.missing.every((m) => m.kind !== 'server') && (
              <li className="px-2.5 py-2 text-xs text-muted-foreground">No libraries found yet.</li>
            )}
          </Section>

          <section className="px-2.5">
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={cn('size-3.5 transition-transform', showManual && 'rotate-90')} />
              Add by URL{extra.pinned.length > 0 && ` (${extra.pinned.length})`}
            </button>
            {showManual && (
              <div className="pt-2">
                <PinnedDevicesEditor pinned={extra.pinned} onChange={refresh} />
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
