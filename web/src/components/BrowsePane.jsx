import { useEffect, useMemo, useState } from 'react';
import { Folder, Music, Play, Plus, ListMusic, Search, X, LayoutGrid, List as ListIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { AlphabetStrip, firstLetterOf } from '@/components/AlphabetStrip';
import { Thumb } from '@/components/Thumb';
import { api } from '@/lib/api';
import { formatSeconds, parseDuration } from '@/lib/time';
import { cn } from '@/lib/utils';

// Below this, a folder is easy enough to scan without a filter UI.
const LONG_LIST_THRESHOLD = 20;
const VIEW_STORAGE_KEY = 'nodedlna-view';

export function BrowsePane({ serverUdn, path, onNavigate, onPlayTracks, onAddTracks }) {
  const folder = path[path.length - 1];
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [activeLetter, setActiveLetter] = useState(null);
  const [view, setView] = useState(() => localStorage.getItem(VIEW_STORAGE_KEY) ?? 'list');

  function changeView(next) {
    setView(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  useEffect(() => {
    if (!serverUdn) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    setQuery('');
    setActiveLetter(null);
    api
      .browse(serverUdn, folder.id)
      .then((result) => !cancelled && setItems(result.items))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [serverUdn, folder.id]);

  const availableLetters = useMemo(() => new Set((items ?? []).map((item) => firstLetterOf(item.title))), [items]);

  const displayedItems = useMemo(() => {
    if (!items) return items;
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (activeLetter && firstLetterOf(item.title) !== activeLetter) return false;
      if (q && !item.title?.toLowerCase().includes(q) && !item.artist?.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, query, activeLetter]);

  const tracks = displayedItems?.filter((item) => item.type === 'track') ?? [];
  const showFilters = (items?.length ?? 0) > LONG_LIST_THRESHOLD;

  if (!serverUdn) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground">No media server connected</div>;
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b">
        <Breadcrumb>
          <BreadcrumbList>
            {path.map((crumb, i) => (
              <div key={crumb.id} className="flex items-center gap-1.5">
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {i === path.length - 1 ? (
                    <BreadcrumbPage>{crumb.title}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <button onClick={() => onNavigate(path.slice(0, i + 1))}>{crumb.title}</button>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </div>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex gap-2 shrink-0">
          <div className="flex border rounded-md overflow-hidden">
            <Button
              size="icon"
              variant={view === 'list' ? 'secondary' : 'ghost'}
              className="rounded-none size-8"
              onClick={() => changeView('list')}
              title="List view"
            >
              <ListIcon className="size-4" />
            </Button>
            <Button
              size="icon"
              variant={view === 'grid' ? 'secondary' : 'ghost'}
              className="rounded-none size-8"
              onClick={() => changeView('grid')}
              title="Grid view"
            >
              <LayoutGrid className="size-4" />
            </Button>
          </div>

          {tracks.length > 0 && (
            <>
              <Button size="sm" variant="secondary" onClick={() => onAddTracks(tracks)}>
                <Plus /> Queue all
              </Button>
              <Button size="sm" onClick={() => onPlayTracks(tracks, 0)}>
                <Play /> Play all
              </Button>
            </>
          )}
        </div>
      </div>

      {showFilters && (
        <>
          <div className="px-4 py-2 border-b relative">
            <Search className="absolute left-7 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter this list…"
              className="pl-8 h-8"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <AlphabetStrip available={availableLetters} active={activeLetter} onSelect={setActiveLetter} />
        </>
      )}

      <div className="flex-1 overflow-y-auto">
        {error && <div className="p-4 text-destructive text-sm">{error}</div>}

        {!items && !error && (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}

        {items?.length === 0 && <div className="p-4 text-muted-foreground text-sm">Empty folder</div>}
        {items && items.length > 0 && displayedItems.length === 0 && (
          <div className="p-4 text-muted-foreground text-sm">No matches</div>
        )}

        {view === 'grid' ? (
          <div className="grid gap-4 p-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {displayedItems?.map((item) =>
              item.type === 'container' ? (
                <button
                  key={item.id}
                  onClick={() => onNavigate([...path, { id: item.id, title: item.title }])}
                  className="text-left group"
                >
                  <Thumb src={item.albumArtURI} className="w-full aspect-square rounded-md" />
                  <div className="mt-1.5 text-sm truncate group-hover:underline">{item.title}</div>
                  {item.artist && <div className="text-xs text-muted-foreground truncate">{item.artist}</div>}
                </button>
              ) : (
                <div
                  key={item.id}
                  onClick={() => onPlayTracks(tracks, tracks.indexOf(item))}
                  className="text-left cursor-pointer group"
                >
                  <Thumb src={item.albumArtURI} className="w-full aspect-square rounded-md" />
                  <div className="mt-1.5 text-sm truncate group-hover:underline">{item.title}</div>
                  {item.artist && <div className="text-xs text-muted-foreground truncate">{item.artist}</div>}
                </div>
              )
            )}
          </div>
        ) : (
          displayedItems?.map((item) =>
            item.type === 'container' ? (
              <button
                key={item.id}
                onClick={() => onNavigate([...path, { id: item.id, title: item.title }])}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent text-left"
              >
                <Folder className="size-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{item.title}</span>
                {item.childCount !== undefined && (
                  <span className="text-xs text-muted-foreground">{item.childCount}</span>
                )}
              </button>
            ) : (
              <div
                key={item.id}
                className={cn('group flex items-center gap-3 px-4 py-2.5 hover:bg-accent cursor-pointer')}
                onClick={() => onPlayTracks(tracks, tracks.indexOf(item))}
              >
                <Music className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{item.title}</div>
                  {item.artist && <div className="text-xs text-muted-foreground truncate">{item.artist}</div>}
                </div>
                {item.res?.duration && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatSeconds(parseDuration(item.res.duration))}
                  </span>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 opacity-0 group-hover:opacity-100 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddTracks([item]);
                  }}
                  title="Add to queue"
                >
                  <ListMusic className="size-3.5" />
                </Button>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}
