'use strict';

const {
  getAddressSuffix,
  getManufacturerDataEntries,
  hasServiceUuid,
} = require('../AdvertisementUtils');
const { MatchScore } = require('../MatchScore');

const DRIVER_ID = 'GoveeTHDriver';
const SERVICE_UUID = '0000ec88-0000-1000-8000-00805f9b34fb';
const GOVEE_COMPANY_ID = 0xec88;
const SUPPORTED_MODELS = new Set(['H5074', 'H5075']);

function getLocalName(adv) {
  return String(adv?.localName || '').trim();
}

function getModel(localName = '') {
  const match = String(localName).toUpperCase().match(/^GV(H5074|H5075)(?:_|$)/);
  return match ? match[1] : null;
}

function findGoveePayload(adv) {
  for (const entry of getManufacturerDataEntries(adv)) {
    const data = entry.payload;
    if (!data || data.length < 7) continue;

    for (let offset = 0; offset <= data.length - 7; offset += 1) {
      if (data[offset] !== 0x88 || data[offset + 1] !== 0xec) continue;
      return data.subarray(offset, offset + 7);
    }
  }

  return null;
}

function decodePayload(payload) {
  if (!payload || payload.length < 7) return null;
  if (payload.readUInt16LE(0) !== GOVEE_COMPANY_ID) return null;

  let temperatureHumidity = payload.readUIntBE(3, 3);
  const negative = Boolean(temperatureHumidity & 0x800000);
  temperatureHumidity &= 0x7fffff;

  const humidityTenths = temperatureHumidity % 1000;
  const humidity = humidityTenths / 10;
  let temperature = (temperatureHumidity - humidityTenths) / 10000;
  if (negative) temperature *= -1;

  const battery = payload.readUInt8(6);
  if (temperature < -50 || temperature > 80) return null;
  if (humidity < 0 || humidity > 100) return null;
  if (battery > 100) return null;

  return {
    temperature,
    humidity,
    battery,
    batteryLow: battery <= 20,
  };
}

function match(adv) {
  const localName = getLocalName(adv);
  const model = getModel(localName);
  const payload = findGoveePayload(adv);
  const decoded = decodePayload(payload);
  const hasEc88Service = hasServiceUuid(adv, [SERVICE_UUID]);

  const score = new MatchScore('govee-ec88')
    .addServiceUuid(hasEc88Service, 'service UUID EC88')
    .addPayload(Boolean(decoded), 'valid Govee EC88 sensor payload')
    .addManufacturer(Boolean(payload), 'embedded company ID EC88')
    .addPayloadLength(payload?.length === 7, 'expected 7-byte EC88 payload')
    .addLocalName(Boolean(model && SUPPORTED_MODELS.has(model)), `supported model name ${model || ''}`.trim());

  // A name alone must never claim a device. Require the technical payload.
  if (!decoded) return { confidence: 0, reason: 'invalid-or-missing-govee-payload', reasons: [] };
  return score.toResult();
}

function canHandle(adv) {
  return match(adv).confidence > 0;
}

function parse(adv) {
  const matchResult = match(adv);
  if (matchResult.confidence <= 0) return null;

  const payload = findGoveePayload(adv);
  const measurement = decodePayload(payload);
  if (!measurement) return null;

  const localName = getLocalName(adv);
  const model = getModel(localName) || 'Govee';
  const suffix = getAddressSuffix(adv);

  return {
    protocol: 'govee-ec88',
    driverId: DRIVER_ID,
    deviceKey: String(adv.address || adv.uuid || ''),
    suffix,
    model,
    name: `Govee ${model}`,
    displayName: `Govee ${model} ${suffix}`.trim(),
    serviceUuid: 'EC88',
    localName,
    address: String(adv.address || ''),
    uuid: String(adv.uuid || ''),
    rssi: adv.rssi,
    raw: payload.toString('hex'),
    measurement: true,
    ...measurement,
  };
}

module.exports = {
  id: 'govee-ec88',
  driverId: DRIVER_ID,
  SERVICE_UUID,
  GOVEE_COMPANY_ID,
  SUPPORTED_MODELS,
  getModel,
  findGoveePayload,
  decodePayload,
  match,
  canHandle,
  parse,
};
