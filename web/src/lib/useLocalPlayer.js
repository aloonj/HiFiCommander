import { useEffect, useRef, useState } from 'react';
import { parseDuration, secondsToRelTime } from '@/lib/time';

function positionFrom(audio) {
  return {
    relTime: secondsToRelTime(audio.currentTime),
    duration: Number.isFinite(audio.duration) ? secondsToRelTime(audio.duration) : '0:00:00',
  };
}

function loadAndPlay(audio, track) {
  if (!audio || !track?.res?.uri) return;
  audio.src = track.res.uri;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

// Drives playback entirely inside this browser tab via an <audio> element,
// mirroring the same queue/transport shape the backend's QueueManager
// exposes for real UPnP renderers so the rest of the UI doesn't need to care
// which kind of renderer is selected.
export function useLocalPlayer() {
  const audioRef = useRef(null);
  const [tracks, setTracks] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [repeat, setRepeat] = useState(false);
  const [transportState, setTransportState] = useState('STOPPED');
  const [position, setPosition] = useState(null);
  const [volume, setVolumeState] = useState(100);
  const [muted, setMutedState] = useState(false);
  const [maxVolume, setMaxVolume] = useState(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    function onPlay() {
      setTransportState('PLAYING');
    }
    function onPause() {
      setTransportState((prev) => (prev === 'STOPPED' ? prev : 'PAUSED_PLAYBACK'));
    }
    function onTimeUpdate() {
      setPosition(positionFrom(audio));
    }
    // Re-registered whenever tracks/currentIndex/repeat change (below) so
    // this always closes over the current queue instead of going stale.
    function onEnded() {
      if (currentIndex + 1 < tracks.length) {
        setCurrentIndex(currentIndex + 1);
        loadAndPlay(audio, tracks[currentIndex + 1]);
      } else if (repeat && tracks.length > 0) {
        setCurrentIndex(0);
        loadAndPlay(audio, tracks[0]);
      } else {
        setTransportState('STOPPED');
      }
    }

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, [tracks, currentIndex, repeat]);

  const controller = {
    playNow(newTracks, startIndex = 0) {
      setTracks(newTracks);
      setCurrentIndex(startIndex);
      loadAndPlay(audioRef.current, newTracks[startIndex]);
    },
    addToQueue(newTracks) {
      setTracks((prev) => [...prev, ...newTracks]);
    },
    next() {
      if (currentIndex + 1 < tracks.length) {
        setCurrentIndex(currentIndex + 1);
        loadAndPlay(audioRef.current, tracks[currentIndex + 1]);
      } else if (repeat && tracks.length > 0) {
        setCurrentIndex(0);
        loadAndPlay(audioRef.current, tracks[0]);
      }
    },
    previous() {
      if (currentIndex <= 0) return;
      setCurrentIndex(currentIndex - 1);
      loadAndPlay(audioRef.current, tracks[currentIndex - 1]);
    },
    jump(index) {
      if (index < 0 || index >= tracks.length) return;
      setCurrentIndex(index);
      loadAndPlay(audioRef.current, tracks[index]);
    },
    stop() {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      setTracks([]);
      setCurrentIndex(-1);
      setTransportState('STOPPED');
      setPosition(null);
    },
    pause() {
      audioRef.current?.pause();
    },
    resume() {
      audioRef.current?.play().catch(() => {});
    },
    seek(relTime) {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = parseDuration(relTime);
      setPosition(positionFrom(audio));
    },
    setRepeat(next) {
      setRepeat(next);
    },
    getVolume: () => Promise.resolve({ volume, muted }),
    setVolume(next) {
      setVolumeState(next);
      if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(100, next)) / 100;
      return Promise.resolve({ ok: true, volume: next });
    },
    setMute(next) {
      setMutedState(next);
      if (audioRef.current) audioRef.current.muted = next;
      return Promise.resolve({ ok: true });
    },
    getVolumeLimit: () => Promise.resolve({ maxVolume }),
    setVolumeLimit(next) {
      setMaxVolume(next);
      if (next != null && volume > next) controller.setVolume(next);
      return Promise.resolve({ maxVolume: next });
    },
  };

  return {
    audioRef,
    controller,
    queueState: {
      tracks,
      currentIndex,
      active: currentIndex >= 0,
      transportState,
      repeat,
      position,
    },
  };
}
