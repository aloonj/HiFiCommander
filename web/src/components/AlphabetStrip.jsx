import { cn } from '@/lib/utils';

const LETTERS = ['#', ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('')];

export function firstLetterOf(title) {
  const ch = (title ?? '').trim().charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
}

export function AlphabetStrip({ available, active, onSelect }) {
  return (
    <div className="flex flex-wrap gap-1 px-4 py-2 border-b">
      {LETTERS.map((letter) => {
        const enabled = available.has(letter);
        return (
          <button
            key={letter}
            disabled={!enabled}
            onClick={() => onSelect(active === letter ? null : letter)}
            className={cn(
              'size-6 rounded text-xs font-medium flex items-center justify-center',
              !enabled && 'text-muted-foreground/30 cursor-default',
              enabled && active !== letter && 'text-muted-foreground hover:bg-accent',
              active === letter && 'bg-primary text-primary-foreground'
            )}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
}
