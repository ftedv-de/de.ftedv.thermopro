'use strict';

const {
  getAddressSuffix,
  getServiceData,
  hasServiceUuid,
} = require('../AdvertisementUtils');
const { MatchScore } = require('../MatchScore');

const DRIVER_ID = 'MiFloraDriver';
const SERVICE_UUID = '0000fe95-0000-1000-8000-00805f9b34fb';
const FLOWER_CARE_PRODUCT_IDS = new Set([0x0098]);

const DATA_TYPES = {
  TEMPERATURE: 0x1004,
  ILLUMINANCE: 0x1007,
  MOISTURE: 0x1008,
  CONDUCTIVITY: 0x1009,
  BATTERY: 0x100a,
  TEMPERATURE_HUMIDITY: 0x100d,
};

function decodeMac(buffer) {
  if (!buffer || buffer.length !== 6) return '';
  return Array.from(buffer)
    .reverse()
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase();
}

function parseFrame(adv) {
  if (!hasServiceUuid(adv, [SERVICE_UUID])) return null;

  const data = getServiceData(adv, SERVICE_UUID);
  if (!data || data.length < 12) return null;

  const frameControl = data.readUInt16LE(0);
  const productId = data.readUInt16LE(2);
  const frameCounter = data.readUInt8(4);

  if (!FLOWER_CARE_PRODUCT_IDS.has(productId)) return null;

  const hasMac = Boolean(frameControl & 0x0010);
  const hasCapability = Boolean(frameControl & 0x0020);
  const hasData = Boolean(frameControl & 0x0040);
  const encrypted = Boolean(frameControl & 0x0800);

  if (!hasMac || !hasData || encrypted) return null;

  let offset = 5;
  if (offset + 6 > data.length) return null;

  const mac = decodeMac(data.subarray(offset, offset + 6));
  offset += 6;

  if (hasCapability) {
    if (offset >= data.length) return null;
    offset += 1;
  }

  if (offset + 3 > data.length) {
    return {
      frameControl,
      productId,
      frameCounter,
      mac,
      dataType: null,
      payload: null,
      raw: data.toString('hex'),
    };
  }

  const dataType = data.readUInt16LE(offset);
  const dataLength = data.readUInt8(offset + 2);
  offset += 3;

  if (offset + dataLength > data.length) return null;

  return {
    frameControl,
    productId,
    frameCounter,
    mac,
    dataType,
    payload: data.subarray(offset, offset + dataLength),
    raw: data.toString('hex'),
  };
}

function decodeMeasurement(frame) {
  const payload = frame?.payload;
  if (!payload || frame.dataType === null) return {};

  switch (frame.dataType) {
    case DATA_TYPES.TEMPERATURE:
      if (payload.length !== 2) return {};
      return { temperature: payload.readInt16LE(0) / 10 };
    case DATA_TYPES.ILLUMINANCE:
      if (payload.length !== 3) return {};
      return { luminance: payload.readUIntLE(0, 3) };
    case DATA_TYPES.MOISTURE:
      if (payload.length !== 1) return {};
      return { moisture: payload.readUInt8(0) };
    case DATA_TYPES.CONDUCTIVITY:
      if (payload.length !== 2) return {};
      return { conductivity: payload.readUInt16LE(0) };
    case DATA_TYPES.BATTERY:
      if (payload.length !== 1) return {};
      return { battery: payload.readUInt8(0), batteryLow: payload.readUInt8(0) <= 20 };
    case DATA_TYPES.TEMPERATURE_HUMIDITY:
      if (payload.length !== 4) return {};
      return {
        temperature: payload.readInt16LE(0) / 10,
        humidity: payload.readUInt16LE(2) / 10,
      };
    default:
      return {};
  }
}

function match(adv) {
  const hasService = hasServiceUuid(adv, [SERVICE_UUID]);
  const serviceData = getServiceData(adv, SERVICE_UUID);
  const frame = parseFrame(adv);
  const localName = String(adv?.localName || '').toLowerCase();

  const score = new MatchScore('mibeacon-flower-care')
    .addServiceUuid(hasService, 'service UUID FE95')
    .addServiceData(Boolean(serviceData), 'MiBeacon service data present')
    .addPayload(Boolean(frame), 'valid Flower Care MiBeacon frame')
    .addPayloadLength(Boolean(serviceData && serviceData.length >= 12), 'valid MiBeacon frame length')
    .addLocalName(localName === 'flower care', 'local name Flower care');

  if (!frame) return { confidence: 0, reason: 'not-flower-care-mibeacon', reasons: [] };
  return score.toResult();
}

function canHandle(adv) {
  return match(adv).confidence > 0;
}

function parse(adv) {
  const frame = parseFrame(adv);
  if (!frame) return null;

  const measurement = decodeMeasurement(frame);
  const suffix = getAddressSuffix(adv);
  const name = 'Flower Care';

  return {
    protocol: 'mibeacon-flower-care',
    driverId: DRIVER_ID,
    deviceKey: String(adv.address || adv.uuid || frame.mac || ''),
    suffix,
    model: 'HHCCJCY01',
    name,
    displayName: `${name} ${suffix}`.trim(),
    serviceUuid: 'FE95',
    productId: `0x${frame.productId.toString(16).padStart(4, '0').toUpperCase()}`,
    frameCounter: frame.frameCounter,
    dataType: frame.dataType === null
      ? ''
      : `0x${frame.dataType.toString(16).padStart(4, '0').toUpperCase()}`,
    localName: String(adv.localName || ''),
    address: String(adv.address || frame.mac || ''),
    uuid: String(adv.uuid || ''),
    rssi: adv.rssi,
    raw: frame.raw,
    measurement: Object.keys(measurement).length > 0,
    ...measurement,
  };
}

module.exports = {
  id: 'mibeacon-flower-care',
  driverId: DRIVER_ID,
  SERVICE_UUID,
  FLOWER_CARE_PRODUCT_IDS,
  DATA_TYPES,
  parseFrame,
  decodeMeasurement,
  match,
  canHandle,
  parse,
};
