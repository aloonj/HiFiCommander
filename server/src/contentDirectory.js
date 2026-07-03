import { XMLParser } from 'fast-xml-parser';
import { invokeAction } from './soap.js';

const SERVICE_TYPE = 'urn:schemas-upnp-org:service:ContentDirectory:1';

const didlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: {
    enabled: true,
    maxTotalExpansions: Infinity,
    maxExpandedLength: Infinity,
    maxEntityCount: Infinity,
  },
});

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value) {
  if (value === undefined || value === null) return undefined;
  // Fields like upnp:artist can appear multiple times with different
  // role="" attributes (e.g. plain artist + AlbumArtist); take the first.
  if (Array.isArray(value)) return textOf(value[0]);
  if (typeof value === 'object') return value['#text'];
  return String(value);
}

function parseContainer(node) {
  return {
    type: 'container',
    id: node['@_id'],
    parentId: node['@_parentID'],
    title: textOf(node['dc:title']),
    childCount: node['@_childCount'] !== undefined ? Number(node['@_childCount']) : undefined,
    class: textOf(node['upnp:class']),
    artist: textOf(node['dc:creator'] ?? node['upnp:artist']),
    albumArtURI: textOf(node['upnp:albumArtURI']),
  };
}

function parseItem(node) {
  const upnpClass = textOf(node['upnp:class']) ?? '';
  const resources = asArray(node.res);
  const res = resources.find((r) => r['@_protocolInfo']?.includes(':audio/')) ?? resources[0];
  return {
    type: upnpClass.startsWith('object.item.audioItem') ? 'track' : 'item',
    id: node['@_id'],
    parentId: node['@_parentID'],
    title: textOf(node['dc:title']),
    artist: textOf(node['dc:creator'] ?? node['upnp:artist']),
    album: textOf(node['upnp:album']),
    albumArtURI: textOf(node['upnp:albumArtURI']),
    class: upnpClass,
    res: res
      ? {
          uri: textOf(res),
          protocolInfo: res['@_protocolInfo'],
          duration: res['@_duration'],
          size: res['@_size'] !== undefined ? Number(res['@_size']) : undefined,
        }
      : undefined,
  };
}

function parseDidl(didlXml) {
  const parsed = didlParser.parse(didlXml);
  const root = parsed['DIDL-Lite'];
  if (!root) return [];
  const containers = asArray(root.container).map(parseContainer);
  const items = asArray(root.item).map(parseItem);
  return [...containers, ...items];
}

export async function browse(server, { objectId = '0', browseFlag = 'BrowseDirectChildren', startingIndex = 0, requestedCount = 0 } = {}) {
  const service = server.services.find((s) => s.serviceType.startsWith(SERVICE_TYPE));
  if (!service) throw new Error(`${server.friendlyName} has no ContentDirectory service`);

  const response = await invokeAction(service.controlURL, SERVICE_TYPE, 'Browse', {
    ObjectID: objectId,
    BrowseFlag: browseFlag,
    Filter: '*',
    StartingIndex: startingIndex,
    RequestedCount: requestedCount,
    SortCriteria: '',
  });

  const resultXml = typeof response.Result === 'object' ? response.Result['#text'] : response.Result;
  return {
    items: parseDidl(resultXml ?? ''),
    numberReturned: Number(response.NumberReturned ?? 0),
    totalMatches: Number(response.TotalMatches ?? 0),
    updateId: response.UpdateID,
  };
}
