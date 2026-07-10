'use strict';

// Backwards-compatible wrapper. New code should use lib/parsers/ThermoBeaconParser.js.

const ThermoBeaconParser = require('./parsers/ThermoBeaconParser');
const {
  normalizeUuid,
  shortUuid,
  toBuffer,
  getServiceUuids,
} = require('./AdvertisementUtils');

function getThermoBeaconServiceUuid(adv) {
  return ThermoBeaconParser.getThermoBeaconServiceUuid(adv);
}

function getCandidateDataPackets(adv) {
  return ThermoBeaconParser.getCandidateDataPackets(adv);
}

function isSupportedAdvertisement(adv) {
  return ThermoBeaconParser.canHandle(adv);
}

function decodeThermoBeacon(adv) {
  return ThermoBeaconParser.parse(adv);
}

module.exports = {
  SERVICE_UUIDS: ThermoBeaconParser.SERVICE_UUIDS,
  DEVICE_TYPES: ThermoBeaconParser.DEVICE_TYPES,
  MANUFACTURER_IDS: ThermoBeaconParser.MANUFACTURER_IDS,
  normalizeUuid,
  shortUuid,
  toBuffer,
  getServiceUuids,
  getThermoBeaconServiceUuid,
  getCandidateDataPackets,
  isSupportedAdvertisement,
  decodeThermoBeacon,
};
