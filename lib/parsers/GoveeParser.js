'use strict';

const {
  getAddressSuffix,
  getManufacturerDataEntries,
  hasServiceUuid,
} = require('../AdvertisementUtils');
const { MatchScore } = require('../MatchScore');

const DRIVER_ID = 'GoveeTHDriver';
const MANUFACTURER_ID = 'govee';
const SERVICE_UUID = '0000ec88-0000-1000-8000-00805f9b34fb';

const COMPANY_IDS = Object.freeze({
  EC88: 0xec88,
  ID_0001: 0x0001,
  ID_8801: 0x8801,
});

const MODEL_FORMATS = Object.freeze({
  H5051: 'ec88-4byte-le',
  H5052: 'ec88-4byte-le',
  H5071: 'ec88-4byte-le',
  H5072: 'ec88-3byte',
  H5074: 'ec88-4byte-le',
  H5075: 'ec88-3byte',
  H5100: '0001-3byte',
  H5101: '0001-3byte',
  H5102: '0001-3byte',
  H5103: '0001-3byte',
  H5104: '0001-3byte',
  H5105: '0001-3byte',
  H5108: '0001-3byte',
  H5110: '0001-3byte',
  H5174: '0001-3byte',
  H5177: '0001-3byte',
  H5179: 'auto-h5179',
});

function getLocalName(adv) {
  return String(adv?.localName || '').trim();
}

function getModel(localName = '') {
  const match = String(localName).toUpperCase().match(/(?:^|[^A-Z0-9])(H\d{4})(?:[^A-Z0-9]|$)/);
  return match ? match[1] : null;
}

function isPlausibleMeasurement(measurement) {
  if (!measurement) return false;
  if (!Number.isFinite(measurement.temperature) || measurement.temperature < -50 || measurement.temperature > 80) return false;
  if (!Number.isFinite(measurement.humidity) || measurement.humidity < 0 || measurement.humidity > 100) return false;
  if (measurement.battery !== null && measurement.battery !== undefined) {
    if (!Number.isInteger(measurement.battery) || measurement.battery < 0 || measurement.battery > 100) return false;
  }
  return true;
}

function decode3Byte(data, offset) {
  if (!data || offset < 0 || offset + 4 > data.length) return null;
  let combined = data.readUIntBE(offset, 3);
  const negative = Boolean(combined & 0x800000);
  combined &= 0x7fffff;
  const humidityTenths = combined % 1000;
  const humidity = humidityTenths / 10;
  let temperature = Math.floor(combined / 1000) / 10;
  if (negative) temperature *= -1;
  const battery = data.readUInt8(offset + 3) & 0x7f;
  const result = { temperature, humidity, battery, batteryLow: battery <= 20 };
  return isPlausibleMeasurement(result) ? result : null;
}

function decode4ByteLe(data, offset) {
  if (!data || offset < 0 || offset + 5 > data.length) return null;
  const temperature = data.readInt16LE(offset) / 100;
  const humidity = data.readUInt16LE(offset + 2) / 100;
  const battery = data.readUInt8(offset + 4) & 0x7f;
  const result = { temperature, humidity, battery, batteryLow: battery <= 20 };
  return isPlausibleMeasurement(result) ? result : null;
}

function findFrames(adv) {
  const frames = [];

  for (const entry of getManufacturerDataEntries(adv)) {
    const data = entry.payload;
    if (!data || data.length < 2) continue;

    const addFrame = (companyId, payload, source, offset = 0) => {
      if (!payload || payload.length === 0) return;
      frames.push({ companyId, payload, source, offset, raw: data });
    };

    if (!entry.direct && Number.isInteger(entry.manufacturerId)) {
      addFrame(entry.manufacturerId, data, 'manufacturer-map');
    }

    if (entry.direct) {
      const directCompanyId = data.readUInt16LE(0);
      if (Object.values(COMPANY_IDS).includes(directCompanyId)) {
        addFrame(directCompanyId, data.subarray(2), 'direct-prefix');
      }

      // H5075 and related sensors are often wrapped in an Apple iBeacon frame.
      for (let offset = 0; offset <= data.length - 4; offset += 1) {
        const companyId = data.readUInt16LE(offset);
        if (!Object.values(COMPANY_IDS).includes(companyId)) continue;
        addFrame(companyId, data.subarray(offset + 2), 'embedded-company-id', offset);
      }
    }
  }

  const unique = new Map();
  for (const frame of frames) {
    const key = `${frame.companyId}:${frame.payload.toString('hex')}`;
    if (!unique.has(key)) unique.set(key, frame);
  }
  return Array.from(unique.values());
}

function decodeFrame(frame, model = null) {
  if (!frame) return null;
  const format = model ? MODEL_FORMATS[model] : null;
  const data = frame.payload;

  if (frame.companyId === COMPANY_IDS.EC88) {
    if (format === 'ec88-4byte-le') return decode4ByteLe(data, 1);
    if (format === 'ec88-3byte') return decode3Byte(data, 1);

    // Generic inference is intentionally payload-based. It allows unknown models
    // using an already known climate frame while still rejecting devices such as H6062.
    if ([5].includes(data.length)) return decode3Byte(data, 1);
    if ([6, 8].includes(data.length)) return decode4ByteLe(data, 1);
    return null;
  }

  if (frame.companyId === COMPANY_IDS.ID_0001) {
    if (data.length === 6 || data.length === 8) return decode3Byte(data, 2);
    return null;
  }

  if (frame.companyId === COMPANY_IDS.ID_8801) {
    if (data.length === 9) return decode4ByteLe(data, 4);
    return null;
  }

  return null;
}

function findDecodedFrame(adv) {
  const model = getModel(getLocalName(adv));
  for (const frame of findFrames(adv)) {
    const measurement = decodeFrame(frame, model);
    if (measurement) return { frame, measurement, model };
  }
  return null;
}

function match(adv) {
  const decodedFrame = findDecodedFrame(adv);
  const localName = getLocalName(adv);
  const model = getModel(localName);
  const hasEc88Service = hasServiceUuid(adv, [SERVICE_UUID]);
  const frame = decodedFrame?.frame;

  const score = new MatchScore('govee-climate')
    .addServiceUuid(hasEc88Service, 'service UUID EC88')
    .addPayload(Boolean(decodedFrame), 'valid Govee climate payload')
    .addManufacturer(Boolean(frame), `known Govee company ID ${frame ? `0x${frame.companyId.toString(16).padStart(4, '0').toUpperCase()}` : ''}`.trim())
    .addPayloadLength(Boolean(frame), `supported climate payload length ${frame?.payload.length || 0}`)
    .addLocalName(Boolean(model), `Govee model name ${model || ''}`.trim());

  if (!decodedFrame) {
    return { confidence: 0, reason: 'invalid-or-unsupported-govee-climate-payload', reasons: [] };
  }
  return score.toResult();
}

function canHandle(adv) {
  return match(adv).confidence > 0;
}

function parse(adv) {
  const decodedFrame = findDecodedFrame(adv);
  if (!decodedFrame) return null;

  const { frame, measurement } = decodedFrame;
  const localName = getLocalName(adv);
  const model = decodedFrame.model || getModel(localName) || 'Climate Sensor';
  const suffix = getAddressSuffix(adv);
  const companyIdHex = `0x${frame.companyId.toString(16).padStart(4, '0').toUpperCase()}`;
  const protocol = frame.companyId === COMPANY_IDS.EC88
    ? 'govee-climate-ec88'
    : frame.companyId === COMPANY_IDS.ID_0001
      ? 'govee-climate-0001'
      : 'govee-climate-8801';

  return {
    manufacturer: 'Govee',
    manufacturerId: MANUFACTURER_ID,
    protocol,
    protocolId: protocol,
    driverId: DRIVER_ID,
    deviceKey: String(adv.address || adv.uuid || ''),
    suffix,
    model,
    name: model === 'Climate Sensor' ? 'Govee Climate Sensor' : `Govee ${model}`,
    displayName: `${model === 'Climate Sensor' ? 'Govee Climate Sensor' : `Govee ${model}`} ${suffix}`.trim(),
    serviceUuid: hasServiceUuid(adv, [SERVICE_UUID]) ? 'EC88' : '',
    companyId: companyIdHex,
    localName,
    address: String(adv.address || ''),
    uuid: String(adv.uuid || ''),
    rssi: adv.rssi,
    raw: frame.raw.toString('hex'),
    payload: frame.payload.toString('hex'),
    measurement: true,
    ...measurement,
  };
}

module.exports = {
  id: 'govee-climate',
  manufacturerId: MANUFACTURER_ID,
  manufacturerName: 'Govee',
  protocolId: 'govee-climate',
  driverId: DRIVER_ID,
  SERVICE_UUID,
  COMPANY_IDS,
  MODEL_FORMATS,
  getModel,
  findFrames,
  decodeFrame,
  findDecodedFrame,
  match,
  canHandle,
  parse,
};