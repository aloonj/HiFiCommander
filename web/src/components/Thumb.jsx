import { useState } from 'react';
import { Music } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Thumb({ src, className }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={cn('flex items-center justify-center bg-muted text-muted-foreground', className)}>
        <Music className="size-1/3" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('object-cover', className)}
    />
  );
}
