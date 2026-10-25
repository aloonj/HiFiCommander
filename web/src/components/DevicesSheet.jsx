import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronRight, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DeviceTag, StatusDot } from '@/components/DeviceTag';
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

function timeAgo(timestamp, now) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
}

function DeviceRow({ device, selected, onSelect, onForget }) {
  const online = device.online !== false;
  const detail = [device.address, SOURCE_LABELS[device.source]].filter(Boolean).join(' · ');
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
        <StatusDot online={online} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('truncate', !online && 'text-muted-foreground')}>{device.friendlyName}</span>
            <DeviceTag device={device} />
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {!online && 'Offline · '}
            {detail || 'This computer'}
          </div>
        </div>
        {selected && <Check className="size-4 shrink-0 text-primary" aria-label="Selected" />}
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
// space from the queue; quick switching stays in the header selects.
export function DevicesSheet({ open, onOpenChange, devices, serverUdn, rendererUdn, onServerChange, onRendererChange }) {
  const wide = useIsWide();
  const [extra, setExtra] = useState({ pinned: [], missing: [], scan: null });
  const [showManual, setShowManual] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(() => {
    api
      .getDevices()
      .then((d) => setExtra({ pinned: d.pinned ?? [], missing: d.missing ?? [], scan: d.scan ?? null }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    const timer = setInterval(() => {
      refresh();
      setNow(Date.now());
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [open, refresh]);

  async function rescan() {
    await api.rescanDevices().catch(() => {});
    refresh();
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

  const scanning = extra.scan?.scanning;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={wide ? 'right' : 'bottom'}
        className={cn('gap-0', wide ? 'w-96 sm:max-w-96' : 'max-h-[85vh]')}
      >
        <SheetHeader className="pr-12">
          <SheetTitle>Devices</SheetTitle>
          <SheetDescription className="flex items-center gap-1.5 text-xs">
            {scanning ? (
              <>
                <Loader2 className="size-3 animate-spin" /> Searching…
              </>
            ) : extra.scan?.lastScanAt ? (
              `Last search ${timeAgo(extra.scan.lastScanAt, now)} · repeats every 30s`
            ) : (
              'Found automatically on your network'
            )}
          </SheetDescription>
          <Button size="sm" variant="outline" className="mt-2 w-fit" onClick={rescan} disabled={scanning}>
            <RefreshCw className={cn('size-3.5', scanning && 'animate-spin')} />
            Search now
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
