import { useEffect, useState } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { describeSignal } from '@/lib/signalPath';
import { cn } from '@/lib/utils';

const SIGNAL_POLL_MS = 3000;

let browserRate;
function getBrowserRate() {
  if (browserRate === undefined) {
    try {
      const ctx = new AudioContext();
      browserRate = ctx.sampleRate;
      ctx.close();
    } catch {
      browserRate = null;
    }
  }
  return browserRate;
}

// "bit-perfect", "lossless", "not bit-perfect"... after the track format,
// with the reason in a tooltip.
export function SignalNote({ rendererUdn, rendererName, track, isPlaying, className }) {
  const [signal, setSignal] = useState(null);
  const isDac = rendererUdn?.startsWith('hires:');

  useEffect(() => {
    setSignal(null);
    if (!isDac || !isPlaying) return;
    let cancelled = false;
    const check = () =>
      api
        .getSignal(rendererUdn)
        .then((r) => !cancelled && setSignal(r.signal))
        .catch(() => {});
    check();
    const timer = setInterval(check, SIGNAL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rendererUdn, isDac, isPlaying, track?.id]);

  const note = describeSignal({
    rendererUdn,
    rendererName,
    res: track?.res,
    signal,
    browserRate: rendererUdn && !isDac ? getBrowserRate() : null,
  });
  if (!note) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('shrink-0 cursor-default', className)}>
            ·{' '}
            <span className="underline decoration-dotted underline-offset-2">{note.label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{note.detail}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
