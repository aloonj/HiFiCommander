import { useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { THEMES } from '@/lib/themes';
import { getSavedTheme, selectTheme } from '@/lib/applyTheme';
import { cn } from '@/lib/utils';

const OPTIONS = [{ key: 'system', label: 'System', swatch: null }, ...Object.entries(THEMES).map(([key, t]) => ({ key, ...t }))];

export function ThemePicker() {
  const [active, setActive] = useState(getSavedTheme());

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" title="Theme">
          <Palette className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1 max-h-96 overflow-y-auto">
        {OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => {
              selectTheme(opt.key);
              setActive(opt.key);
            }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent text-left"
          >
            <span
              className={cn('size-3 rounded-full shrink-0 border border-border', !opt.swatch && 'bg-gradient-to-br from-neutral-300 to-neutral-600')}
              style={opt.swatch ? { backgroundColor: opt.swatch } : undefined}
            />
            <span className="flex-1">{opt.label}</span>
            {active === opt.key && <Check className="size-3.5 shrink-0" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
