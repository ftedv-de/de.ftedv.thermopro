'use strict';

const {
  getAddressSuffix,
  getManufacturerDataEntries,
} = require('../AdvertisementUtils');
const { MatchScore } = require('../MatchScore');

const DRIVER_ID = 'ThermoProTHDriver';

const BASE_MODELS = [
  'TP350',
  'TP351',
  'TP357',
  'TP358',
  'TP359',
  'TP393',
];

const MODEL_SUFFIXES = ['', 'S', 'B'];
const KNOWN_MODELS = BASE_MODELS
  .flatMap(model => MODEL_SUFFIXES.map(suffix => `${model}${suffix}`))
  .sort((a, b) => b.length - a.length);

function getLocalName(adv) {
  return String(adv?.localName || '').trim();
}

function getModelFromLocalName(localName = '') {
  const name = String(localName).trim();
  const known = KNOWN_MODELS.find(model => name.startsWith(model));
  if (known) return known;

  const match = name.match(/^(TP[0-9A-Za-z]+)/);
  return match ? match[1] : null;
}

function getThermoProPayload(adv) {
  for (const entry of getManufacturerDataEntries(adv)) {
    const payload = entry.payload;
    if (!payload || payload.length < 5) continue;
    if (payload[0] !== 0xc2) continue;

    const temperature = payload.readInt16LE(1) / 10;
    const humidity = payload.readUInt8(3);
    const batteryLevelRaw = payload.readUInt8(4);

    if (temperature < -50 || temperature > 80) continue;
    if (humidity > 100) continue;
    if (batteryLevelRaw > 100) continue;

    return payload;
  }

  return null;
}

function match(adv) {
  const payload = getThermoProPayload(adv);
  const localName = getLocalName(adv);
  const model = getModelFromLocalName(localName);

  const score = new MatchScore('thermopro-c2')
    .addPayload(Boolean(payload), 'valid ThermoPro C2 payload')
    .addManufacturer(Boolean(payload && payload[0] === 0xc2), 'C2 manufacturer payload marker')
    .addPayloadLength(Boolean(payload && payload.length >= 5 && payload.length <= 8), 'expected C2 payload length')
    .addLocalName(Boolean(model && KNOWN_MODELS.includes(model)), `known ThermoPro model ${model || ''}`.trim());

  if (!payload) return { confidence: 0, reason: 'payload-mismatch', reasons: [] };
  return score.toResult();
}

function canHandle(adv) {
  return match(adv).confidence > 0;
}

function createDisplayName(adv, model) {
  const suffix = getAddressSuffix(adv);
  const baseName = getLocalName(adv) || model || 'ThermoPro';
  const compactBaseName = baseName.replace(/[^0-9A-F]/gi, '').toUpperCase();

  if (!suffix) return baseName;
  if (compactBaseName.endsWith(suffix.toUpperCase())) return baseName;
  return `${baseName} ${suffix}`;
}

function calculateBattery(batteryLevelRaw) {
  if (batteryLevelRaw === 2) return 100;
  if (batteryLevelRaw === 1) return 50;
  if (batteryLevelRaw === 0) return 0;
  if (batteryLevelRaw >= 0 && batteryLevelRaw <= 100) return batteryLevelRaw;
  return null;
}

function parse(adv) {
  if (!canHandle(adv)) return null;

  const payload = getThermoProPayload(adv);
  if (!payload) return null;

  const localName = getLocalName(adv);
  const model = getModelFromLocalName(localName) || 'ThermoPro';
  const temperature = payload.readInt16LE(1) / 10;
  const humidity = payload.readUInt8(3);
  const batteryLevelRaw = payload.readUInt8(4);
  const battery = calculateBattery(batteryLevelRaw);

  return {
    protocol: 'thermopro-c2',
    driverId: DRIVER_ID,
    deviceKey: String(adv.address || adv.uuid || ''),
    suffix: getAddressSuffix(adv),
    model,
    name: model,
    displayName: createDisplayName(adv, model),
    manufacturerData: payload.toString('hex'),
    localName,
    address: String(adv.address || ''),
    uuid: String(adv.uuid || ''),
    rssi: adv.rssi,
    measurement: true,
    temperature,
    humidity,
    battery,
    batteryLevelRaw,
    batteryLow: batteryLevelRaw === 0,
    raw: payload.toString('hex'),
  };
}

module.exports = {
  id: 'thermopro-c2',
  driverId: DRIVER_ID,
  BASE_MODELS,
  MODEL_SUFFIXES,
  KNOWN_MODELS,
  getModelFromLocalName,
  match,
  canHandle,
  parse,
};
