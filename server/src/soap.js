import { XMLParser } from 'fast-xml-parser';

// Large ContentDirectory Browse results embed hundreds of escaped DIDL-Lite
// entities in a single response; the default 1000-expansion DoS guard is too
// low for legitimate local-network payloads.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: {
    enabled: true,
    maxTotalExpansions: Infinity,
    maxExpandedLength: Infinity,
    maxEntityCount: Infinity,
  },
});

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildEnvelope(serviceType, actionName, args) {
  const argsXml = Object.entries(args)
    .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    '<s:Body>' +
    `<u:${actionName} xmlns:u="${serviceType}">${argsXml}</u:${actionName}>` +
    '</s:Body>' +
    '</s:Envelope>'
  );
}

export class SoapFault extends Error {
  constructor(faultString, detail) {
    super(faultString);
    this.name = 'SoapFault';
    this.detail = detail;
  }
}

export async function invokeAction(controlURL, serviceType, actionName, args = {}) {
  const body = buildEnvelope(serviceType, actionName, args);
  const res = await fetch(controlURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"${serviceType}#${actionName}"`,
    },
    body,
  });

  const text = await res.text();
  const parsed = parser.parse(text);
  const envelope = parsed['s:Envelope'] ?? parsed.Envelope;
  const soapBody = envelope?.['s:Body'] ?? envelope?.Body;

  const fault = soapBody?.['s:Fault'] ?? soapBody?.Fault;
  if (fault) {
    const detail = fault.detail?.UPnPError ?? fault.detail;
    throw new SoapFault(fault.faultstring ?? 'SOAP fault', detail);
  }

  if (!res.ok) {
    throw new Error(`SOAP request failed: ${res.status} ${res.statusText}`);
  }

  const responseKey = `u:${actionName}Response`;
  const result = soapBody?.[responseKey] ?? soapBody?.[`${actionName}Response`];
  if (!result) throw new Error(`Unexpected SOAP response shape for ${actionName}`);

  // Strip xmlns attribute the parser attaches to the response element.
  const { '@_xmlns:u': _ns, ...values } = result;
  return values;
}
