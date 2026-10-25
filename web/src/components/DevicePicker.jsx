import { useState } from 'react';
import { Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DeviceTag } from '@/components/DeviceTag';
import { cn } from '@/lib/utils';

// Quick switcher for a player or library, opened from wherever that choice is
// shown (now playing bar, browse path). Full management lives in the
// devices sheet, linked at the bottom.
export function DevicePicker({ devices, selectedUdn, onSelect, onManage, emptyText, align = 'start', side, children }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} side={side} className="w-72 gap-0.5 p-1.5">
        {devices.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground">{emptyText}</div>}
        {devices.map((d) => {
          const offline = d.online === false;
          return (
            <button
              key={d.udn}
              type="button"
              onClick={() => {
                onSelect(d.udn);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className={cn('min-w-0 truncate', offline && 'text-muted-foreground')}>{d.friendlyName}</span>
              <DeviceTag device={d} />
              {offline && <span className="text-xs text-muted-foreground">offline</span>}
              <Check className={cn('ml-auto size-4 shrink-0', d.udn !== selectedUdn && 'invisible')} />
            </button>
          );
        })}
        <div className="my-1 h-px bg-border" />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onManage();
          }}
          className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Manage devices…
        </button>
      </PopoverContent>
    </Popover>
  );
}
