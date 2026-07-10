'use strict';

function normalizeUuid(value = '') {
  const text = String(value).toLowerCase().replace(/[^0-9a-f]/g, '');

  if (/^[0-9a-f]{4}$/.test(text)) {
    return `0000${text}-0000-1000-8000-00805f9b34fb`;
  }

  if (/^[0-9a-f]{32}$/.test(text)) {
    return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
  }

  return String(value).toLowerCase();
}

function shortUuid(uuid) {
  const normalized = normalizeUuid(uuid);
  const match = normalized.match(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i);
  return match ? match[1].toUpperCase() : normalized;
}

function getServiceUuids(adv) {
  return (adv?.serviceUuids || adv?.serviceUUIDs || adv?.services || [])
    .map(normalizeUuid);
}

function hasServiceUuid(adv, acceptedServiceUuids) {
  const normalizedAccepted = acceptedServiceUuids.map(normalizeUuid);
  return getServiceUuids(adv).some(uuid => normalizedAccepted.includes(uuid));
}

function getMatchingServiceUuid(adv, acceptedServiceUuids) {
  const normalizedAccepted = acceptedServiceUuids.map(normalizeUuid);
  const match = getServiceUuids(adv).find(uuid => normalizedAccepted.includes(uuid));
  return match ? shortUuid(match) : '';
}

function toBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value);
  if (typeof value === 'string') {
    if (/^[0-9a-f]+$/i.test(value) && value.length % 2 === 0) {
      return Buffer.from(value, 'hex');
    }

    return Buffer.from(value, 'base64');
  }
  if (value.data) return Buffer.from(value.data);
  return null;
}

function readManufacturerId(rawId) {
  if (typeof rawId === 'number') return rawId;

  const idText = String(rawId).trim().toLowerCase();
  if (idText.startsWith('0x')) return Number.parseInt(idText.slice(2), 16);
  return Number.parseInt(idText, 10);
}

function getManufacturerDataEntries(adv) {
  const manufacturerData = adv?.manufacturerData;
  if (!manufacturerData) return [];

  const directBuffer = toBuffer(manufacturerData);
  if (directBuffer) {
    return [{ manufacturerId: null, payload: directBuffer, direct: true }];
  }

  let entries = [];
  if (manufacturerData instanceof Map) {
    entries = Array.from(manufacturerData.entries());
  } else if (typeof manufacturerData === 'object') {
    entries = Object.entries(manufacturerData);
  }

  return entries
    .map(([rawId, rawPayload]) => {
      const payload = toBuffer(rawPayload);
      if (!payload) return null;

      return {
        manufacturerId: readManufacturerId(rawId),
        payload,
        direct: false,
      };
    })
    .filter(Boolean);
}

function getServiceDataEntries(adv) {
  const serviceData = adv?.serviceData;
  if (!serviceData) return [];

  if (Array.isArray(serviceData)) {
    return serviceData
      .map(entry => {
        if (!entry) return null;

        if (entry.uuid !== undefined && entry.data !== undefined) {
          const payload = toBuffer(entry.data);
          if (!payload) return null;
          return { uuid: normalizeUuid(entry.uuid), payload };
        }

        return null;
      })
      .filter(Boolean);
  }

  if (serviceData instanceof Map) {
    return Array.from(serviceData.entries())
      .map(([uuid, data]) => {
        const payload = toBuffer(data);
        return payload ? { uuid: normalizeUuid(uuid), payload } : null;
      })
      .filter(Boolean);
  }

  if (typeof serviceData === 'object') {
    return Object.entries(serviceData)
      .map(([uuid, data]) => {
        const payload = toBuffer(data);
        return payload ? { uuid: normalizeUuid(uuid), payload } : null;
      })
      .filter(Boolean);
  }

  return [];
}

function getServiceData(adv, uuid) {
  const normalizedUuid = normalizeUuid(uuid);
  return getServiceDataEntries(adv)
    .find(entry => entry.uuid === normalizedUuid)?.payload || null;
}

function getDeviceKey(adv) {
  return String(adv?.address || adv?.uuid || '');
}

function getAddressSuffix(adv) {
  const source = String(adv?.address || adv?.uuid || '').toUpperCase();
  const compact = source.replace(/[^0-9A-F]/g, '');

  return compact.length >= 4 ? compact.slice(-4) : compact;
}

function describeValue(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return `buffer:${value.length}:${value.toString('hex')}`;
  if (value instanceof Uint8Array) return `uint8:${value.length}:${Buffer.from(value).toString('hex')}`;
  if (Array.isArray(value)) return `array:${value.length}:${Buffer.from(value).toString('hex')}`;
  if (typeof value === 'string') return `string:${value.length}:${value}`;
  if (value.data) return describeValue(value.data);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, describeValue(item)])
    );
  }
  return typeof value;
}

function getManufacturerDiagnostic(adv) {
  const entries = getManufacturerDataEntries(adv);
  if (entries.length === 0) return [];

  return entries.map(entry => {
    let manufacturerId = entry.manufacturerId;
    let payload = entry.payload;

    if (manufacturerId === null && entry.direct && payload.length >= 2) {
      manufacturerId = payload.readUInt16LE(0);
    }

    return {
      manufacturerId: Number.isInteger(manufacturerId)
        ? `0x${manufacturerId.toString(16).padStart(4, '0').toUpperCase()}`
        : null,
      payloadLength: payload.length,
      direct: entry.direct,
    };
  });
}

function summarizeAdvertisement(adv) {
  const serviceUuids = adv.serviceUuids || adv.serviceUUIDs || adv.services || [];
  const manufacturerBuffer = toBuffer(adv.manufacturerData);

  return {
    uuid: adv.uuid,
    address: adv.address,
    addressType: adv.addressType,
    connectable: adv.connectable,
    localName: adv.localName,
    rssi: adv.rssi,
    serviceUuids,
    serviceUuidsShort: serviceUuids.map(shortUuid),
    manufacturerData: describeValue(adv.manufacturerData),
    manufacturerDataLength: manufacturerBuffer?.length || 0,
    manufacturerEntries: getManufacturerDiagnostic(adv),
    serviceData: describeValue(adv.serviceData),
    serviceDataEntries: getServiceDataEntries(adv).map(entry => ({
      uuid: entry.uuid,
      uuidShort: shortUuid(entry.uuid),
      payloadLength: entry.payload.length,
    })),
  };
}

module.exports = {
  normalizeUuid,
  shortUuid,
  getServiceUuids,
  hasServiceUuid,
  getMatchingServiceUuid,
  toBuffer,
  readManufacturerId,
  getManufacturerDataEntries,
  getServiceDataEntries,
  getServiceData,
  getDeviceKey,
  getAddressSuffix,
  describeValue,
  getManufacturerDiagnostic,
  summarizeAdvertisement,
};
