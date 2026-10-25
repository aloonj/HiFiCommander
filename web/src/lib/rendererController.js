import { api } from '@/lib/api';

// The common playback-control shape every renderer driver implements,
// regardless of how it actually moves audio: a backend-owned UPnP/DLNA
// device controlled over SOAP, a future Chromecast controlled the same way
// via the backend, or the browser's own <audio> element (see useLocalPlayer).
//
//   playNow(tracks, startIndex), addToQueue(tracks)
//   next(), previous(), jump(index)
//   stop(), pause(), resume(), seek(relTime)
//   setRepeat(repeat)
//   getVolume(), setVolume(volume), setMute(muted)
//   getVolumeLimit(), setVolumeLimit(maxVolume)
//
// This is the REST-backed implementation used for any renderer the backend
// controls directly (currently DLNA).
export function createRemoteController(rendererUdn) {
  return {
    playNow: (tracks, startIndex) => api.playNow(rendererUdn, tracks, startIndex),
    addToQueue: (tracks) => api.addToQueue(rendererUdn, tracks),
    next: () => api.next(rendererUdn),
    previous: () => api.previous(rendererUdn),
    jump: (index) => api.jump(rendererUdn, index),
    stop: () => api.stop(rendererUdn),
    pause: () => api.pause(rendererUdn),
    resume: () => api.resume(rendererUdn),
    seek: (relTime) => api.seek(rendererUdn, relTime),
    setRepeat: (repeat) => api.setRepeat(rendererUdn, repeat),
    getVolume: () => api.getVolume(rendererUdn),
    setVolume: (volume) => api.setVolume(rendererUdn, volume),
    setMute: (muted) => api.setMute(rendererUdn, muted),
    getVolumeLimit: () => api.getVolumeLimit(rendererUdn),
    setVolumeLimit: (maxVolume) => api.setVolumeLimit(rendererUdn, maxVolume),
  };
}
