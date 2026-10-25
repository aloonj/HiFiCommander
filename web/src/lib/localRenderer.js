// Synthetic renderer representing playback through this browser tab's own
// <audio> element, alongside real UPnP devices discovered over SSDP.
export const LOCAL_RENDERER_UDN = 'local-browser';

export const LOCAL_RENDERER_DEVICE = {
  udn: LOCAL_RENDERER_UDN,
  friendlyName: 'This Browser',
  manufacturer: null,
  modelName: null,
  pinned: false,
};
