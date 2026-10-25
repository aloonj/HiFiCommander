import { Badge } from '@/components/ui/badge';
import { deviceTag } from '@/lib/deviceTags';
import { cn } from '@/lib/utils';

export function DeviceTag({ device, className }) {
  const tag = deviceTag(device);
  return (
    <Badge
      variant="outline"
      title={tag.title}
      className={cn('h-4 px-1.5 text-[10px] font-medium text-muted-foreground', className)}
    >
      {tag.label}
    </Badge>
  );
}
