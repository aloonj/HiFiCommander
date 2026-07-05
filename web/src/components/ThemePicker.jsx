import { useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { THEMES } from '@/lib/themes';
import { getSavedTheme, selectTheme } from '@/lib/applyTheme';
import { cn } from '@/lib/utils';

const OPTIONS = [{ key: 'system', label: 'System', swatch: null }, ...Object.entries(THEMES).map(([key, t]) => ({ key, ...t }))];

export function ThemePicker() {
  const [active, setActive] = useState(getSavedTheme());
  const activeLabel = OPTIONS.find((o) => o.key === active)?.label ?? 'Theme';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" title={`Theme: ${activeLabel}`}>
          <Palette className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2">
        <div className="text-xs text-muted-foreground px-0.5">{activeLabel}</div>
        <TooltipProvider delayDuration={200}>
          <div className="grid grid-cols-5 gap-2">
            {OPTIONS.map((opt) => (
              <Tooltip key={opt.key}>
                <TooltipTrigger asChild>
                  <button
                    aria-label={opt.label}
                    onClick={() => {
                      selectTheme(opt.key);
                      setActive(opt.key);
                    }}
                    className={cn(
                      'relative size-9 rounded-full border-2 transition-transform hover:scale-110',
                      active === opt.key ? 'border-foreground' : 'border-transparent'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute inset-0.5 rounded-full',
                        !opt.swatch && 'bg-gradient-to-br from-neutral-300 to-neutral-600'
                      )}
                      style={opt.swatch ? { backgroundColor: opt.swatch } : undefined}
                    />
                    {active === opt.key && (
                      <Check className="absolute inset-0 m-auto size-4 text-white mix-blend-difference" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{opt.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
