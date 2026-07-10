'use strict';

const {
  getAddressSuffix,
  getManufacturerDataEntries,
  getMatchingServiceUuid,
  getServiceUuids,
  hasServiceUuid,
  normalizeUuid,
} = require('../AdvertisementUtils');
const { MatchScore } = require('../MatchScore');

const DRIVER_ID = 'ThermoBeaconDriver';

const SERVICE_UUIDS = [
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
];

const DEVICE_TYPES = {
  0x10: { model: '16', name: 'Mini Hygrometer' },
  0x11: { model: '17', name: 'Smart hygrometer' },
  0x14: { model: '20', name: 'Smart hygrometer' },
  0x15: { model: '21', name: 'Smart hygrometer' },
  0x18: { model: '24', name: 'Smart hygrometer' },
  0x1b: { model: '27', name: 'Smart hygrometer' },
  0x30: { model: '48', name: 'Smart hygrometer' },
};

const MANUFACTURER_IDS = Object.keys(DEVICE_TYPES).map(id => Number(id));
const MEASUREMENT_LENGTHS = [20, 21];
const KNOWN_PACKET_LENGTHS = [20, 21, 22];

function isThermoBeaconName(adv) {
  return String(adv?.localName || '').toLowerCase() === 'thermobeacon';
}

function hasThermoBeaconService(adv) {
  return hasServiceUuid(adv, SERVICE_UUIDS);
}

function isDirectThermoBeaconPacket(buffer) {
  if (!KNOWN_PACKET_LENGTHS.includes(buffer.length)) return false;
  if (!DEVICE_TYPES[buffer[0]]) return false;

  if (MEASUREMENT_LENGTHS.includes(buffer.length)) {
    const voltageMv = buffer.readUInt16LE(10);
    const temperature = buffer.readInt16LE(12) / 16;
    const humidity = buffer.readUInt16LE(14) / 16;

    if (voltageMv < 1800 || voltageMv > 3600) return false;
    if (temperature < -40 || temperature > 100) return false;
    if (humidity < 0 || humidity > 100) return false;
  }

  return true;
}

function createDirectCandidate(manufacturerId, data) {
  if (!isDirectThermoBeaconPacket(data)) return null;
  return { manufacturerId, data };
}

function createPrependedCandidate(manufacturerId, payload) {
  const manufacturerIdBuffer = Buffer.alloc(2);
  manufacturerIdBuffer.writeUInt16LE(manufacturerId, 0);
  return createDirectCandidate(manufacturerId, Buffer.concat([manufacturerIdBuffer, payload]));
}

function getCandidateDataPackets(adv) {
  const candidates = [];

  for (const entry of getManufacturerDataEntries(adv)) {
    if (entry.direct) {
      const directCandidate = createDirectCandidate(entry.payload[0], entry.payload);
      if (directCandidate) candidates.push(directCandidate);

      if ([18, 19, 20].includes(entry.payload.length)) {
        for (const id of MANUFACTURER_IDS) {
          const prepended = createPrependedCandidate(id, entry.payload);
          if (prepended) candidates.push(prepended);
        }
      }
      continue;
    }

    const directCandidate = createDirectCandidate(entry.manufacturerId, entry.payload);
    if (directCandidate) candidates.push(directCandidate);

    if (MANUFACTURER_IDS.includes(entry.manufacturerId)) {
      const prepended = createPrependedCandidate(entry.manufacturerId, entry.payload);
      if (prepended) candidates.push(prepended);
    }
  }

  return candidates;
}

function getThermoBeaconServiceUuid(adv) {
  return getMatchingServiceUuid(adv, SERVICE_UUIDS);
}

function match(adv) {
  const hasService = hasThermoBeaconService(adv);
  const candidates = getCandidateDataPackets(adv);
  const candidate = candidates[0];

  const score = new MatchScore('thermobeacon')
    .addServiceUuid(hasService, `service UUID ${getThermoBeaconServiceUuid(adv) || 'FFF0/FFE0'}`)
    .addPayload(candidates.length > 0, 'valid ThermoBeacon payload')
    .addManufacturer(Boolean(candidate && DEVICE_TYPES[candidate.data[0]]), 'known ThermoBeacon device type')
    .addPayloadLength(Boolean(candidate && KNOWN_PACKET_LENGTHS.includes(candidate.data.length)), 'known ThermoBeacon packet length')
    .addLocalName(isThermoBeaconName(adv), 'local name ThermoBeacon');

  if (!hasService || candidates.length === 0) {
    return { confidence: 0, reason: !hasService ? 'service-mismatch' : 'payload-mismatch', reasons: [] };
  }

  return score.toResult();
}

function canHandle(adv) {
  return match(adv).confidence > 0;
}

function parse(adv) {
  if (!canHandle(adv)) return null;

  const candidate = getCandidateDataPackets(adv)
    .find(item => KNOWN_PACKET_LENGTHS.includes(item.data.length));
  if (!candidate) return null;

  const data = candidate.data;
  const deviceId = data[0];
  const deviceType = DEVICE_TYPES[deviceId];
  if (!deviceType) return null;

  const common = {
    protocol: 'thermobeacon',
    driverId: DRIVER_ID,
    deviceKey: String(adv.address || adv.uuid || ''),
    suffix: getAddressSuffix(adv),
    model: deviceType.model,
    name: deviceType.name,
    displayName: `${deviceType.name} ${getAddressSuffix(adv)}`.trim(),
    deviceId,
    deviceType: `0x${deviceId.toString(16).padStart(2, '0').toUpperCase()}`,
    serviceUuid: getThermoBeaconServiceUuid(adv),
    serviceUuids: getServiceUuids(adv).map(normalizeUuid),
    manufacturerId: candidate.manufacturerId,
    manufacturerData: data.toString('hex'),
    localName: String(adv.localName || ''),
    address: String(adv.address || ''),
    uuid: String(adv.uuid || ''),
    rssi: adv.rssi,
    raw: data.toString('hex'),
  };

  if (!MEASUREMENT_LENGTHS.includes(data.length)) {
    return { ...common, measurement: false };
  }

  const buttonPushed = Boolean(data[3] & 0x80);
  const voltageMv = data.readUInt16LE(10);
  const temperature = data.readInt16LE(12) / 16;
  const humidity = data.readUInt16LE(14) / 16;

  let battery;
  if (voltageMv >= 3000) battery = 100;
  else if (voltageMv >= 2600) battery = 60 + (voltageMv - 2600) * 0.1;
  else if (voltageMv >= 2500) battery = 40 + (voltageMv - 2500) * 0.2;
  else if (voltageMv >= 2450) battery = 20 + (voltageMv - 2450) * 0.4;
  else battery = 0;

  battery = Math.max(0, Math.min(100, Math.round(battery)));

  return {
    ...common,
    measurement: true,
    temperature: Math.round(temperature * 100) / 100,
    humidity: Math.round(humidity * 100) / 100,
    voltage: Math.round((voltageMv / 1000) * 1000) / 1000,
    battery,
    batteryLow: battery <= 20,
    buttonPushed,
  };
}

module.exports = {
  id: 'thermobeacon',
  driverId: DRIVER_ID,
  SERVICE_UUIDS,
  DEVICE_TYPES,
  MANUFACTURER_IDS,
  match,
  canHandle,
  parse,
  getCandidateDataPackets,
  getThermoBeaconServiceUuid,
};
