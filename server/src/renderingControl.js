import { invokeAction } from './soap.js';

const SERVICE_TYPE = 'urn:schemas-upnp-org:service:RenderingControl:1';

function getControlURL(renderer) {
  const service = renderer.services.find((s) => s.serviceType.startsWith(SERVICE_TYPE));
  if (!service) throw new Error(`${renderer.friendlyName} has no RenderingControl service`);
  return service.controlURL;
}

function action(renderer, name, args = {}) {
  return invokeAction(getControlURL(renderer), SERVICE_TYPE, name, { InstanceID: 0, Channel: 'Master', ...args });
}

export async function getVolume(renderer) {
  const res = await action(renderer, 'GetVolume');
  return Number(res.CurrentVolume);
}

export async function setVolume(renderer, volume) {
  await action(renderer, 'SetVolume', { DesiredVolume: Math.round(volume) });
}

export async function getMute(renderer) {
  const res = await action(renderer, 'GetMute');
  return res.CurrentMute === '1' || res.CurrentMute === 1 || res.CurrentMute === true;
}

export async function setMute(renderer, muted) {
  await action(renderer, 'SetMute', { DesiredMute: muted ? 1 : 0 });
}
