import { useState } from 'react';
import { Speaker } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DevicesSheet } from '@/components/DevicesSheet';
import { DeviceTag, StatusDot } from '@/components/DeviceTag';
import { ThemePicker } from '@/components/ThemePicker';

const MANAGE = '__manage__';

function DeviceSelect({ value, onChange, items, placeholder, onManage }) {
  return (
    <Select value={value} onValueChange={(v) => (v === MANAGE ? onManage() : onChange(v))}>
      <SelectTrigger size="sm" className="w-32 sm:w-52">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((d) => (
          <SelectItem key={d.udn} value={d.udn}>
            <StatusDot online={d.online !== false} />
            <span className="truncate">{d.friendlyName}</span>
            <DeviceTag device={d} />
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={MANAGE} className="text-muted-foreground">
          Manage devices…
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

export function DeviceHeader({ devices, serverUdn, rendererUdn, onServerChange, onRendererChange }) {
  const [managing, setManaging] = useState(false);
  const anyOffline = [...devices.servers, ...devices.renderers].some((d) => d.online === false);

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
      <h1 className="font-semibold text-sm shrink-0">HiFiCommander</h1>

      <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-4 ml-auto">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">Library</span>
          <DeviceSelect
            value={serverUdn}
            onChange={onServerChange}
            items={devices.servers}
            placeholder="No server"
            onManage={() => setManaging(true)}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">Playing on</span>
          <DeviceSelect
            value={rendererUdn}
            onChange={onRendererChange}
            items={devices.renderers}
            placeholder="No renderer"
            onManage={() => setManaging(true)}
          />
        </div>

        <div className="flex items-center">
          <Button
            size="icon"
            variant="ghost"
            title={anyOffline ? 'Devices (one is offline)' : 'Devices'}
            onClick={() => setManaging(true)}
            className="relative"
          >
            <Speaker className="size-4" />
            {anyOffline && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-amber-500" />}
          </Button>
          <ThemePicker />
        </div>
      </div>

      <DevicesSheet
        open={managing}
        onOpenChange={setManaging}
        devices={devices}
        serverUdn={serverUdn}
        rendererUdn={rendererUdn}
        onServerChange={onServerChange}
        onRendererChange={onRendererChange}
      />
    </div>
  );
}
