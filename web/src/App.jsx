import { useEffect, useState } from 'react';
import { DeviceHeader } from '@/components/DeviceHeader';
import { BrowsePane } from '@/components/BrowsePane';
import { QueuePanel } from '@/components/QueuePanel';
import { NowPlayingBar } from '@/components/NowPlayingBar';
import { useDlnaSocket } from '@/lib/useDlnaSocket';
import { api } from '@/lib/api';

const ROOT = { id: '0', title: 'Home' };

export default function App() {
  const { devices, queueStates } = useDlnaSocket();
  const [serverUdn, setServerUdn] = useState(null);
  const [rendererUdn, setRendererUdn] = useState(null);
  const [path, setPath] = useState([ROOT]);

  // Push folder navigation onto browser history so the mouse/keyboard back
  // button walks up a folder instead of leaving the app.
  function navigate(nextPath, nextServerUdn = serverUdn) {
    history.pushState({ serverUdn: nextServerUdn, path: nextPath }, '');
    setPath(nextPath);
    if (nextServerUdn !== serverUdn) setServerUdn(nextServerUdn);
  }

  useEffect(() => {
    function onPopState(event) {
      if (event.state) {
        setServerUdn(event.state.serverUdn);
        setPath(event.state.path);
      } else {
        setPath([ROOT]);
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!serverUdn && devices.servers.length > 0) {
      const first = devices.servers[0].udn;
      history.replaceState({ serverUdn: first, path: [ROOT] }, '');
      setServerUdn(first);
    }
  }, [devices.servers, serverUdn]);

  useEffect(() => {
    if (!rendererUdn && devices.renderers.length > 0) setRendererUdn(devices.renderers[0].udn);
  }, [devices.renderers, rendererUdn]);

  const queueState = rendererUdn ? queueStates[rendererUdn] : null;

  function changeServer(udn) {
    navigate([ROOT], udn);
  }

  function playTracks(tracks, index) {
    if (!rendererUdn || tracks.length === 0) return;
    api.playNow(rendererUdn, tracks, index);
  }

  function addTracks(tracks) {
    if (!rendererUdn) return;
    api.addToQueue(rendererUdn, tracks);
  }

  return (
    <div className="h-screen flex flex-col">
      <DeviceHeader
        devices={devices}
        serverUdn={serverUdn}
        rendererUdn={rendererUdn}
        onServerChange={changeServer}
        onRendererChange={setRendererUdn}
      />

      <div className="flex-1 flex min-h-0">
        <BrowsePane
          serverUdn={serverUdn}
          path={path}
          onNavigate={navigate}
          onPlayTracks={playTracks}
          onAddTracks={addTracks}
        />
        <QueuePanel queueState={queueState} onJump={(index) => rendererUdn && api.jump(rendererUdn, index)} />
      </div>

      <NowPlayingBar rendererUdn={rendererUdn} queueState={queueState} />
    </div>
  );
}
