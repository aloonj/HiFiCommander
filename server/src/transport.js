import * as av from './avTransport.js';
import * as rc from './renderingControl.js';

// Renderers are either UPnP devices (driven over SOAP) or local outputs that
// carry their own driver, such as the mpv-backed hi-res output. Callers use
// these and don't need to know which.
const via = (upnp, method) => (renderer, ...args) =>
  renderer.driver ? renderer.driver[method](...args) : upnp(renderer, ...args);

export const playTrack = via(av.playTrack, 'playTrack');
export const play = via(av.play, 'play');
export const pause = via(av.pause, 'pause');
export const stop = via(av.stop, 'stop');
export const seek = via(av.seek, 'seek');
export const getTransportInfo = via(av.getTransportInfo, 'getTransportInfo');
export const getPositionInfo = via(av.getPositionInfo, 'getPositionInfo');
export const getVolume = via(rc.getVolume, 'getVolume');
export const setVolume = via(rc.setVolume, 'setVolume');
export const getMute = via(rc.getMute, 'getMute');
export const setMute = via(rc.setMute, 'setMute');
