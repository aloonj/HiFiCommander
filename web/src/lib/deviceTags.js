import { LOCAL_RENDERER_UDN } from '@/lib/localRenderer';

// What kind of device this is, shown as a small chip next to its name.
export function deviceTag(device) {
  if (device.udn === LOCAL_RENDERER_UDN) {
    return { label: 'Local', title: "Plays through this computer's normal audio output" };
  }
  return { label: 'DLNA', title: 'Network device (UPnP/DLNA)' };
}

// How the server came to know about a device.
export const SOURCE_LABELS = {
  ssdp: 'Answered a search',
  announce: 'Announced itself',
  traffic: 'Seen on the network',
  mdns: 'Found via mDNS',
  remembered: 'Remembered',
  manual: 'Added by URL',
};
