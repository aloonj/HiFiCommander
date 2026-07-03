function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Wraps a track (as returned by contentDirectory.browse) in a minimal
// DIDL-Lite fragment so renderers can display metadata and pick the right
// mime type for the resource, per the AVTransport SetAVTransportURI contract.
export function buildItemMetadata(track) {
  const title = escapeXml(track.title ?? 'Unknown');
  const artist = escapeXml(track.artist ?? '');
  const album = escapeXml(track.album ?? '');
  const albumArtURI = track.albumArtURI ? `<upnp:albumArtURI>${escapeXml(track.albumArtURI)}</upnp:albumArtURI>` : '';
  const upnpClass = escapeXml(track.class ?? 'object.item.audioItem.musicTrack');
  const protocolInfo = escapeXml(track.res?.protocolInfo ?? 'http-get:*:audio/mpeg:*');
  const uri = escapeXml(track.res?.uri ?? '');
  const durationAttr = track.res?.duration ? ` duration="${escapeXml(track.res.duration)}"` : '';

  return (
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    `<item id="${escapeXml(track.id ?? '')}" parentID="${escapeXml(track.parentId ?? '-1')}" restricted="1">` +
    `<dc:title>${title}</dc:title>` +
    `<dc:creator>${artist}</dc:creator>` +
    `<upnp:album>${album}</upnp:album>` +
    albumArtURI +
    `<upnp:class>${upnpClass}</upnp:class>` +
    `<res protocolInfo="${protocolInfo}"${durationAttr}>${uri}</res>` +
    '</item>' +
    '</DIDL-Lite>'
  );
}
