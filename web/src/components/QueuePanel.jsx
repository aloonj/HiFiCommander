import { ListMusic, Music } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatSeconds, parseDuration } from '@/lib/time';

export function QueuePanel({ queueState, onJump }) {
  const tracks = queueState?.tracks ?? [];
  const currentIndex = queueState?.currentIndex ?? -1;

  return (
    <div className="w-72 shrink-0 border-l flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b text-sm font-medium">
        <ListMusic className="size-4" />
        Queue
        {tracks.length > 0 && <span className="text-muted-foreground font-normal">({tracks.length})</span>}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tracks.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">Nothing queued</div>
        )}
        {tracks.map((track, i) => (
          <button
            key={`${track.id}-${i}`}
            onClick={() => onJump(i)}
            className={cn(
              'w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-accent',
              i === currentIndex && 'bg-accent'
            )}
          >
            <Music className={cn('size-3.5 shrink-0', i === currentIndex ? 'text-foreground' : 'text-muted-foreground')} />
            <div className="flex-1 min-w-0">
              <div className={cn('truncate text-sm', i === currentIndex && 'font-medium')}>{track.title}</div>
              {track.artist && <div className="text-xs text-muted-foreground truncate">{track.artist}</div>}
            </div>
            {track.res?.duration && (
              <span className="text-xs text-muted-foreground shrink-0">
                {formatSeconds(parseDuration(track.res.duration))}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
