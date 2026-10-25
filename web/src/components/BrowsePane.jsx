import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Folder, FolderUp, Music, Play, Plus, ListMusic, Search, X, LayoutGrid, List as ListIcon } from 'lucide-react';
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
import { DevicePicker } from '@/components/DevicePicker';
import { Thumb } from '@/components/Thumb';
import { api } from '@/lib/api';
import { formatSeconds, parseDuration } from '@/lib/time';
import { formatLabel } from '@/lib/audioFormat';
import { cn } from '@/lib/utils';

// Below this, a folder is easy enough to scan without a filter UI.
const LONG_LIST_THRESHOLD = 20;
const VIEW_STORAGE_KEY = 'nodedlna-view';

function LibraryPicker({ servers, serverUdn, onServerChange, onManageDevices, children }) {
  return (
    <DevicePicker
      devices={servers}
      selectedUdn={serverUdn}
      onSelect={onServerChange}
      onManage={onManageDevices}
      emptyText="No libraries found yet"
    >
      {children}
    </DevicePicker>
  );
}

export function BrowsePane({ serverUdn, servers, onServerChange, onManageDevices, path, onNavigate, onPlayTracks, onAddTracks }) {
  const server = servers.find((s) => s.udn === serverUdn);
  // The local library's contents change under the same folder ids when
  // folders are added or a scan finishes, so those also trigger a reload.
  const contentVersion = server?.local ? `${server.folders?.join('|')}:${server.trackCount}` : '';
  const pickerProps = { servers, serverUdn, onServerChange, onManageDevices };
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
  }, [serverUdn, folder.id, contentVersion]);

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
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        No library connected
        <LibraryPicker {...pickerProps}>
          <Button size="sm" variant="outline">
            Choose library <ChevronDown />
          </Button>
        </LibraryPicker>
      </div>
    );
  }

  const needsFolders = server?.local && !server.folders?.length;

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Sized by the pane, not the window, since the queue takes part of it. */}
      <div className="@container border-b">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          {/* Picking the current library again goes back to its top level. */}
          <LibraryPicker {...pickerProps}>
            <Button size="sm" variant="outline" className="min-w-0 gap-1" title="Switch library">
              <span className="truncate">{server?.friendlyName ?? 'Library'}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </Button>
          </LibraryPicker>

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
                <Button size="sm" variant="secondary" title="Queue all" onClick={() => onAddTracks(tracks)}>
                  <Plus /> <span className="hidden @md:inline">Queue all</span>
                </Button>
                <Button size="sm" title="Play all" onClick={() => onPlayTracks(tracks, 0)}>
                  <Play /> <span className="hidden @md:inline">Play all</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* The folder path gets its own row so long names never collide with
            the buttons above. */}
        {path.length > 1 && (
          <div className="flex min-w-0 items-center gap-1 px-4 pb-2.5">
            <Button
              size="icon-sm"
              variant="ghost"
              className="-ml-1.5 shrink-0"
              title={`Up to ${path.length === 2 ? server?.friendlyName ?? 'library' : path[path.length - 2].title}`}
              onClick={() => onNavigate(path.slice(0, -1))}
            >
              <FolderUp className="size-4" />
            </Button>
            <Breadcrumb className="min-w-0 flex-1">
              <BreadcrumbList className="flex-nowrap overflow-hidden">
                {path.slice(1).map((crumb, i) => {
                  const depth = i + 1;
                  return (
                    <div key={crumb.id} className="flex min-w-0 items-center gap-1.5">
                      {depth > 1 && <BreadcrumbSeparator />}
                      <BreadcrumbItem className="min-w-0">
                        {depth === path.length - 1 ? (
                          <BreadcrumbPage className="truncate">{crumb.title}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink asChild>
                            <button className="truncate" onClick={() => onNavigate(path.slice(0, depth + 1))}>
                              {crumb.title}
                            </button>
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </div>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        )}
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
        {needsFolders && (
          <div className="flex flex-col items-start gap-3 p-4 text-sm text-muted-foreground">
            No music folders added yet.
            <Button size="sm" variant="outline" onClick={onManageDevices}>
              Add a folder
            </Button>
          </div>
        )}
        {error && <div className="p-4 text-destructive text-sm">{error}</div>}

        {!items && !error && (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}

        {items?.length === 0 && !needsFolders && <div className="p-4 text-muted-foreground text-sm">Empty folder</div>}
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
                {formatLabel(item.res) && (
                  <span className="hidden sm:inline text-xs text-muted-foreground shrink-0 tabular-nums">
                    {formatLabel(item.res)}
                  </span>
                )}
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
