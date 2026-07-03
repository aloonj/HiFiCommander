import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ThemePicker } from '@/components/ThemePicker';

export function DeviceHeader({ devices, serverUdn, rendererUdn, onServerChange, onRendererChange }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
      <h1 className="font-semibold text-sm shrink-0">HiFiCommander</h1>

      <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-4 ml-auto">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">Library</span>
          <Select value={serverUdn} onValueChange={onServerChange}>
            <SelectTrigger size="sm" className="w-28 sm:w-44">
              <SelectValue placeholder="No server" />
            </SelectTrigger>
            <SelectContent>
              {devices.servers.map((s) => (
                <SelectItem key={s.udn} value={s.udn}>
                  {s.friendlyName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">Playing on</span>
          <Select value={rendererUdn} onValueChange={onRendererChange}>
            <SelectTrigger size="sm" className="w-28 sm:w-44">
              <SelectValue placeholder="No renderer" />
            </SelectTrigger>
            <SelectContent>
              {devices.renderers.map((r) => (
                <SelectItem key={r.udn} value={r.udn}>
                  {r.friendlyName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ThemePicker />
      </div>
    </div>
  );
}
