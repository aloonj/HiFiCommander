import { invokeAction } from './soap.js';
import { buildItemMetadata } from './didl.js';

const SERVICE_TYPE = 'urn:schemas-upnp-org:service:AVTransport:1';

function getControlURL(renderer) {
  const service = renderer.services.find((s) => s.serviceType.startsWith(SERVICE_TYPE));
  if (!service) throw new Error(`${renderer.friendlyName} has no AVTransport service`);
  return service.controlURL;
}

function action(renderer, name, args = {}) {
  return invokeAction(getControlURL(renderer), SERVICE_TYPE, name, { InstanceID: 0, ...args });
}

export async function setTrack(renderer, track) {
  await action(renderer, 'SetAVTransportURI', {
    CurrentURI: track.res.uri,
    CurrentURIMetaData: buildItemMetadata(track),
  });
}

export async function play(renderer) {
  await action(renderer, 'Play', { Speed: '1' });
}

export async function pause(renderer) {
  await action(renderer, 'Pause');
}

export async function stop(renderer) {
  await action(renderer, 'Stop');
}

export async function seek(renderer, relTime) {
  await action(renderer, 'Seek', { Unit: 'REL_TIME', Target: relTime });
}

export async function playTrack(renderer, track) {
  await setTrack(renderer, track);
  await play(renderer);
}

export async function getTransportInfo(renderer) {
  const res = await action(renderer, 'GetTransportInfo');
  return {
    state: res.CurrentTransportState,
    status: res.CurrentTransportStatus,
    speed: res.CurrentSpeed,
  };
}

export async function getPositionInfo(renderer) {
  const res = await action(renderer, 'GetPositionInfo');
  return {
    track: res.Track,
    duration: res.TrackDuration,
    relTime: res.RelTime,
    uri: res.TrackURI,
  };
}
