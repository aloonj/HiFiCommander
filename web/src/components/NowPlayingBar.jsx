import { useEffect, useRef, useState } from 'react';
import { ChevronUp, Pause, Play, Repeat, Settings2, SkipBack, SkipForward, Square, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Thumb } from '@/components/Thumb';
import { api } from '@/lib/api';
import { formatSeconds, parseDuration, secondsToRelTime } from '@/lib/time';

function VolumeCapPopover({ maxVolume, onChange }) {
  const [draft, setDraft] = useState(maxVolume ?? 100);

  return (
    <Popover onOpenChange={(open) => open && setDraft(maxVolume ?? 100)}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" title="Max volume limit">
          <Settings2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3">
        <div className="flex items-center justify-between text-sm font-medium">
          <span>Max volume</span>
          <span className="text-muted-foreground tabular-nums">{maxVolume == null ? 'No limit' : draft}</span>
        </div>
        <Slider
          min={1}
          max={100}
          step={1}
          value={[draft]}
          onValueChange={([v]) => setDraft(v)}
          onValueCommit={([v]) => onChange(v)}
        />
        <p className="text-xs text-muted-foreground">Caps how loud the volume slider can go for this renderer.</p>
        {maxVolume != null && (
          <Button size="sm" variant="secondary" className="w-full" onClick={() => onChange(null)}>
            Remove limit
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TransportControls({ rendererUdn, track, isPlaying, repeat, size = 'default' }) {
  const iconSize = size === 'large' ? 'size-5' : '';
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        disabled={!track}
        className={repeat ? 'text-primary' : undefined}
        title={repeat ? 'Repeat: on' : 'Repeat: off'}
        onClick={() => api.setRepeat(rendererUdn, !repeat)}
      >
        <Repeat className={iconSize} />
      </Button>
      <Button size="icon" variant="ghost" disabled={!track} onClick={() => api.previous(rendererUdn)}>
        <SkipBack className={`fill-current ${iconSize}`} />
      </Button>
      <Button
        size={size === 'large' ? 'lg' : 'icon'}
        className={size === 'large' ? 'size-14 rounded-full' : undefined}
        disabled={!track}
        onClick={() => (isPlaying ? api.pause(rendererUdn) : api.resume(rendererUdn))}
      >
        {isPlaying ? (
          <Pause className={`fill-current ${size === 'large' ? 'size-6' : ''}`} />
        ) : (
          <Play className={`fill-current ${size === 'large' ? 'size-6' : ''}`} />
        )}
      </Button>
      <Button size="icon" variant="ghost" disabled={!track} onClick={() => api.next(rendererUdn)}>
        <SkipForward className={`fill-current ${iconSize}`} />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        disabled={!track}
        title="Stop and clear queue"
        onClick={() => api.stop(rendererUdn)}
      >
        <Square className={`fill-current ${size === 'large' ? 'size-4' : 'size-3.5'}`} />
      </Button>
    </>
  );
}

function AdjacentTrack({ track, label, onClick }) {
  if (!track) return <div className="hidden lg:block w-40" />;
  return (
    <button
      className="hidden lg:flex w-40 flex-col items-center gap-2 text-center opacity-50 hover:opacity-100 transition-opacity"
      title={label}
      onClick={onClick}
    >
      <Thumb src={track.albumArtURI} className="size-24 rounded-lg shadow-lg" />
      <div className="min-w-0 w-full">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{track.title}</div>
        <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
      </div>
    </button>
  );
}

export function NowPlayingBar({ rendererUdn, queueState }) {
  const track = queueState?.tracks?.[queueState.currentIndex];
  const prevTrack = queueState?.tracks?.[queueState.currentIndex - 1];
  const nextTrack = queueState?.tracks?.[queueState.currentIndex + 1];
  const transportState = queueState?.transportState;
  const isPlaying = transportState === 'PLAYING';
  const [expanded, setExpanded] = useState(false);

  const [displaySeconds, setDisplaySeconds] = useState(0);
  const [seekDraft, setSeekDraft] = useState(null);
  const positionRef = useRef({ relSeconds: 0, receivedAt: Date.now() });

  // The renderer keeps reporting the last track's position/duration for a
  // moment even after we've stopped and cleared our queue; ignore it once
  // there's no current track in our own model.
  const position = track ? queueState?.position : null;
  const duration = position ? parseDuration(position.duration) : 0;

  useEffect(() => {
    if (!track) setExpanded(false);
  }, [track]);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  useEffect(() => {
    if (!position) return;
    positionRef.current = { relSeconds: parseDuration(position.relTime), receivedAt: Date.now() };
  }, [position]);

  useEffect(() => {
    const tick = () => {
      if (!isPlaying) {
        setDisplaySeconds(positionRef.current.relSeconds);
        return;
      }
      const elapsed = (Date.now() - positionRef.current.receivedAt) / 1000;
      setDisplaySeconds(Math.min(duration, positionRef.current.relSeconds + elapsed));
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [isPlaying, duration]);

  const [volume, setVolumeState] = useState(null);
  const [muted, setMuted] = useState(false);
  const [maxVolume, setMaxVolume] = useState(null);

  useEffect(() => {
    if (!rendererUdn) return;
    api.getVolumeLimit(rendererUdn).then((r) => setMaxVolume(r.maxVolume)).catch(() => {});
  }, [rendererUdn]);

  useEffect(() => {
    if (!rendererUdn) return;
    let cancelled = false;
    const refresh = () =>
      api
        .getVolume(rendererUdn)
        .then((v) => {
          if (cancelled) return;
          setMuted(v.muted);
          // Catch out-of-band volume changes (physical remote, another app)
          // that land above the cap and bring the renderer back in line.
          if (maxVolume != null && v.volume > maxVolume) {
            setVolumeState(maxVolume);
            api.setVolume(rendererUdn, maxVolume).catch(() => {});
          } else {
            setVolumeState(v.volume);
          }
        })
        .catch(() => {});
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [rendererUdn, maxVolume]);

  function changeVolumeCap(next) {
    setMaxVolume(next);
    api.setVolumeLimit(rendererUdn, next).catch(() => {});
    if (next != null && volume > next) {
      setVolumeState(next);
      api.setVolume(rendererUdn, next).catch(() => {});
    }
  }

  if (!rendererUdn) {
    return <div className="border-t px-4 py-4 text-center text-sm text-muted-foreground">No renderer connected</div>;
  }

  const shownSeconds = seekDraft ?? displaySeconds;

  const seekBar = (
    <div className="flex-1 flex items-center gap-3 min-w-0">
      <span className="text-xs text-muted-foreground tabular-nums w-10 text-right shrink-0">
        {formatSeconds(shownSeconds)}
      </span>
      <Slider
        className="flex-1"
        min={0}
        max={duration || 1}
        step={1}
        disabled={!track}
        value={[shownSeconds]}
        onValueChange={([v]) => setSeekDraft(v)}
        onValueCommit={([v]) => {
          api.seek(rendererUdn, secondsToRelTime(v));
          positionRef.current = { relSeconds: v, receivedAt: Date.now() };
          setSeekDraft(null);
        }}
      />
      <span className="text-xs text-muted-foreground tabular-nums w-10 shrink-0">{formatSeconds(duration)}</span>
    </div>
  );

  const volumeControl = (
    <div className="flex items-center gap-1 w-44 shrink-0">
      <Button
        size="icon"
        variant="ghost"
        onClick={() => {
          const next = !muted;
          setMuted(next);
          api.setMute(rendererUdn, next);
        }}
      >
        {muted ? <VolumeX /> : <Volume2 />}
      </Button>
      <Slider
        min={0}
        max={maxVolume ?? 100}
        step={1}
        value={[volume ?? 0]}
        onValueChange={([v]) => setVolumeState(v)}
        onValueCommit={([v]) => api.setVolume(rendererUdn, v)}
      />
      <VolumeCapPopover maxVolume={maxVolume} onChange={changeVolumeCap} />
    </div>
  );

  return (
    <>
      {expanded && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-6 p-8">
          <Button size="icon" variant="ghost" className="absolute top-4 right-4" onClick={() => setExpanded(false)}>
            <X />
          </Button>

          <div className="flex items-center justify-center gap-6 w-full">
            <AdjacentTrack track={prevTrack} label="Previous" onClick={() => api.previous(rendererUdn)} />
            <Thumb src={track?.albumArtURI} className="w-full max-w-[min(60vw,420px)] aspect-square rounded-xl shadow-2xl" />
            <AdjacentTrack track={nextTrack} label="Next" onClick={() => api.next(rendererUdn)} />
          </div>

          <div className="text-center">
            <div className="text-2xl font-semibold">{track?.title}</div>
            <div className="text-muted-foreground">{track?.artist}</div>
            {track?.album && <div className="text-sm text-muted-foreground mt-1">{track.album}</div>}
          </div>

          <div className="w-full max-w-md">{seekBar}</div>

          <div className="flex items-center gap-4">
            <TransportControls
              rendererUdn={rendererUdn}
              track={track}
              isPlaying={isPlaying}
              repeat={queueState?.repeat}
              size="large"
            />
          </div>

          <div className="w-full max-w-[220px]">{volumeControl}</div>
        </div>
      )}

      <div className="border-t relative">
        <div
          className="md:hidden absolute top-0 left-0 h-0.5 bg-primary"
          style={{ width: `${duration ? Math.min(100, (shownSeconds / duration) * 100) : 0}%` }}
        />

        <div className="px-4 py-3 flex items-center gap-3 sm:gap-4">
          <button
            className="w-auto sm:w-56 min-w-0 shrink sm:shrink-0 flex items-center gap-3 text-left disabled:cursor-default"
            disabled={!track}
            onClick={() => track && setExpanded(true)}
          >
            <Thumb src={track?.albumArtURI} className="size-10 rounded shrink-0" />
            {track ? (
              <div className="min-w-0">
                <div className="truncate font-medium text-sm">{track.title}</div>
                <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Nothing playing</div>
            )}
            {track && <ChevronUp className="size-3.5 text-muted-foreground shrink-0 ml-auto hidden sm:block" />}
          </button>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <TransportControls rendererUdn={rendererUdn} track={track} isPlaying={isPlaying} repeat={queueState?.repeat} />
          </div>

          <div className="hidden md:flex flex-1 items-center gap-3 min-w-0">{seekBar}</div>

          <div className="hidden lg:flex">{volumeControl}</div>

          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" className="lg:hidden shrink-0">
                {muted ? <VolumeX /> : <Volume2 />}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              {volumeControl}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </>
  );
}
