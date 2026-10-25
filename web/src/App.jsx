import { useEffect, useRef, useState } from 'react';
import { DeviceHeader } from '@/components/DeviceHeader';
import { BrowsePane } from '@/components/BrowsePane';
import { QueuePanel } from '@/components/QueuePanel';
import { NowPlayingBar } from '@/components/NowPlayingBar';
import { DevicesSheet } from '@/components/DevicesSheet';
import { useDlnaSocket } from '@/lib/useDlnaSocket';
import { useLocalPlayer } from '@/lib/useLocalPlayer';
import { createRemoteController } from '@/lib/rendererController';
import { LOCAL_RENDERER_UDN, LOCAL_RENDERER_DEVICE } from '@/lib/localRenderer';

const ROOT = { id: '0', title: 'Home' };

export default function App() {
  const { devices, queueStates } = useDlnaSocket();
  const [serverUdn, setServerUdn] = useState(null);
  const [rendererUdn, setRendererUdn] = useState(LOCAL_RENDERER_UDN);
  const [path, setPath] = useState([ROOT]);
  const [managing, setManaging] = useState(false);
  const localPlayer = useLocalPlayer();
  const isLocal = rendererUdn === LOCAL_RENDERER_UDN;
  const rendererDevices = [LOCAL_RENDERER_DEVICE, ...devices.renderers];

  function controllerFor(udn) {
    return udn === LOCAL_RENDERER_UDN ? localPlayer.controller : createRemoteController(udn);
  }

  const controller = rendererUdn ? controllerFor(rendererUdn) : null;

  // changeRenderer below needs the renderer that's *actually* selected at the
  // time a delayed resume-seek fires, not whatever was current when the
  // switch started - a ref sidesteps the stale closure a plain setTimeout
  // would otherwise capture.
  const rendererUdnRef = useRef(rendererUdn);
  rendererUdnRef.current = rendererUdn;

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

  const queueState = isLocal ? localPlayer.queueState : rendererUdn ? queueStates[rendererUdn] : null;

  function changeServer(udn) {
    navigate([ROOT], udn);
  }

  // Only one renderer is ever meant to be "live" at a time - leaving one
  // playing in the background when switching is surprising and, for the
  // local player, inaudible-but-still-running. Stop-and-clear whatever the
  // outgoing renderer was doing, then hand the same queue/track/repeat state
  // to the new one so playback carries over instead of just stopping.
  function changeRenderer(nextUdn) {
    if (nextUdn === rendererUdn) return;
    const outgoing = queueState;
    const hasTrack = outgoing?.tracks?.length > 0 && outgoing.currentIndex >= 0;

    if (controller && hasTrack) controller.stop();
    setRendererUdn(nextUdn);
    if (hasTrack) transferPlayback(nextUdn, outgoing);
  }

  function transferPlayback(nextUdn, outgoing) {
    const next = controllerFor(nextUdn);
    Promise.resolve(next.playNow(outgoing.tracks, outgoing.currentIndex)).catch(() => {});
    Promise.resolve(next.setRepeat(outgoing.repeat)).catch(() => {});

    // Best-effort resume position: give SetAVTransportURI/Play (or the local
    // <audio> element) a moment to settle before seeking, and only follow
    // through if the user hasn't already switched renderers again meanwhile.
    const resumeAt = outgoing.position?.relTime;
    if (!resumeAt) return;
    setTimeout(() => {
      if (rendererUdnRef.current !== nextUdn) return;
      Promise.resolve(next.seek(resumeAt)).catch(() => {});
    }, 1200);
  }

  function playTracks(tracks, index) {
    if (!controller || tracks.length === 0) return;
    controller.playNow(tracks, index);
  }

  function addTracks(tracks) {
    if (!controller) return;
    controller.addToQueue(tracks);
  }

  return (
    <div className="h-screen flex flex-col">
      <audio ref={localPlayer.audioRef} className="hidden" />

      <DeviceHeader onManageDevices={() => setManaging(true)} />

      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <BrowsePane
          serverUdn={serverUdn}
          servers={devices.servers}
          onServerChange={changeServer}
          onManageDevices={() => setManaging(true)}
          path={path}
          onNavigate={navigate}
          onPlayTracks={playTracks}
          onAddTracks={addTracks}
        />
        <QueuePanel queueState={queueState} onJump={(index) => controller?.jump(index)} />
      </div>

      <NowPlayingBar
        rendererUdn={rendererUdn}
        controller={controller}
        queueState={queueState}
        renderers={rendererDevices}
        onRendererChange={changeRenderer}
        onManageDevices={() => setManaging(true)}
      />

      <DevicesSheet
        open={managing}
        onOpenChange={setManaging}
        devices={{ servers: devices.servers, renderers: rendererDevices }}
        serverUdn={serverUdn}
        rendererUdn={rendererUdn}
        onServerChange={changeServer}
        onRendererChange={changeRenderer}
      />
    </div>
  );
}
