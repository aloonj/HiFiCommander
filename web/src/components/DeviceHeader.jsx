import { Speaker } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemePicker } from '@/components/ThemePicker';

// Library and player are picked where they're shown (browse path, now
// playing bar), so the header only links to device management.
export function DeviceHeader({ onManageDevices }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
      <h1 className="font-semibold text-sm">HiFiCommander</h1>

      <div className="flex items-center ml-auto">
        <Button size="icon" variant="ghost" title="Devices" onClick={onManageDevices}>
          <Speaker className="size-4" />
        </Button>
        <ThemePicker />
      </div>
    </div>
  );
}
