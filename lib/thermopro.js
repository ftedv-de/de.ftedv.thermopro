'use strict';

const SUPPORTED_MODELS = [
  'TP350',
  'TP357',
  'TP358',
  'TP359',
  'TP393',
];

function getSupportedModel(localName = '') {
  return SUPPORTED_MODELS.find(model => localName.startsWith(model));
}

function isSupportedAdvertisement(adv) {
  return Boolean(getSupportedModel(adv.localName));
}

function toBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'base64');
  if (value.data) return Buffer.from(value.data);
  return null;
}

function decodeThermoProTH(adv) {
  const buf = toBuffer(adv.manufacturerData);

  if (!buf || buf.length < 6) return null;
  if (buf[0] !== 0xc2) return null;

  const temperature = buf.readInt16LE(1) / 10;
  const humidity = buf.readUInt8(3);

  const batteryLevelRaw = buf.readUInt8(4);

  let battery = null;
  if (batteryLevelRaw === 2) battery = 100;
  else if (batteryLevelRaw === 1) battery = 50;
  else if (batteryLevelRaw === 0) battery = 0;

  return {
    temperature,
    humidity,
    battery,
    batteryLevelRaw,
    batteryLow: batteryLevelRaw === 0,
    raw: buf.toString('hex'),
  };
}

module.exports = {
  SUPPORTED_MODELS,
  getSupportedModel,
  isSupportedAdvertisement,
  decodeThermoProTH,
  toBuffer,
};