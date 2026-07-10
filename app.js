'use strict';

const Homey = require('homey');
const ParserRegistry = require('./lib/ParserRegistry');
const ThermoBeaconParser = require('./lib/parsers/ThermoBeaconParser');
const ThermoProParser = require('./lib/parsers/ThermoProParser');
const MiFloraParser = require('./lib/parsers/MiFloraParser');
const GoveeParser = require('./lib/parsers/GoveeParser');
const { getConfidenceRating } = require('./lib/MatchScore');
const {
  getDeviceKey,
  summarizeAdvertisement,
} = require('./lib/AdvertisementUtils');

module.exports = class ClimateSensorsApp extends Homey.App {

  async onInit() {
    this.log('Climate Sensors app initialized');

    this.bleAdvertisements = [];
    this.devicesByDriver = new Map();
    this.bleOperationQueue = Promise.resolve();
    this.parserRegistry = new ParserRegistry([
      ThermoBeaconParser,
      ThermoProParser,
      MiFloraParser,
      GoveeParser,
    ]);

    this.scanTimer = this.homey.setInterval(async () => {
      try {
        await this.scanBle();
      } catch (err) {
        this.error('BLE scan failed:', err);
      }
    }, 60000);

    await this.scanBle();
  }

  debug(...args) {
    if (this.homey.settings.get('debug') === true) {
      this.log('[debug]', ...args);
    }
  }

  reportError(message, err, context = {}) {
    this.error(message, {
      ...context,
      error: err?.message,
      stack: err?.stack,
    });
  }

  getParserRegistry() {
    return this.parserRegistry;
  }

  runBleOperation(operation) {
    const result = this.bleOperationQueue.then(operation, operation);
    this.bleOperationQueue = result.catch(() => undefined);
    return result;
  }

  registerClimateDevice(driverId, device) {
    if (!this.devicesByDriver.has(driverId)) {
      this.devicesByDriver.set(driverId, new Map());
    }

    const deviceId = String(device.getData()?.id || '');
    if (!deviceId) return;

    this.devicesByDriver.get(driverId).set(deviceId, device);
    this.debug('Registered climate sensor device', { driverId, deviceId, name: device.getName() });
  }

  unregisterClimateDevice(driverId, device) {
    const deviceId = String(device.getData()?.id || '');
    const devices = this.devicesByDriver.get(driverId);
    if (!deviceId || !devices) return;

    devices.delete(deviceId);
    this.debug('Unregistered climate sensor device', { driverId, deviceId, name: device.getName() });
  }

  async refreshBleAdvertisements({ dispatch = true } = {}) {
    return this.runBleOperation(async () => {
      this.debug('Central BLE advertisement refresh started', { dispatch });

      const advertisements = await this.homey.ble.discover();
      const map = new Map();

      for (const adv of advertisements) {
        const key = getDeviceKey(adv) || adv.localName;
        if (!key) continue;
        map.set(key, adv);
      }

      this.bleAdvertisements = Array.from(map.values());

      this.lastScanInfo = {
        timestamp: new Date().toISOString(),
        total: advertisements.length,
        unique: this.bleAdvertisements.length,
      };

      if (dispatch) {
        await this.dispatchAdvertisements(this.bleAdvertisements);
      }

      this.debug('Central BLE advertisement refresh completed', this.lastScanInfo);
      return this.bleAdvertisements;
    });
  }

  async scanBle() {
    return this.refreshBleAdvertisements({ dispatch: true });
  }

  async getAdvertisementsForPairing() {
    return this.refreshBleAdvertisements({ dispatch: false });
  }

  getDiagnosticGroup(entry) {
    if (entry.matchedDriver === 'ThermoBeaconDriver') return 'ThermoBeacon';
    if (entry.matchedDriver === 'ThermoProTHDriver') return 'ThermoPro';
    if (entry.matchedDriver === 'MiFloraDriver') return 'MiBeacon / MiFlora';
    if (entry.matchedDriver === 'GoveeTHDriver') return 'Govee';

    const name = String(entry.localName || '').toUpperCase();
    const shortServices = entry.serviceUuidsShort || [];
    if (name.startsWith('GOVEE_') || name.startsWith('GVH') || shortServices.includes('EC88')) return 'Govee';
    if (name.startsWith('TP')) return 'ThermoPro';
    if (name.includes('THERMOBEACON') || shortServices.includes('FFF0')) return 'ThermoBeacon';
    if (shortServices.includes('FE95')) return 'MiBeacon / MiFlora';
    return 'Unknown';
  }

  buildBleDiagnosticEntry(advertisement, index) {
    const decoded = this.parserRegistry.parse(advertisement);
    const parserCandidates = this.parserRegistry.getParserCandidates(advertisement, { includeZero: true });
    const bestCandidate = parserCandidates[0] || null;
    const confidence = decoded?.matchConfidence || bestCandidate?.confidence || 0;
    const entry = {
      index,
      ...summarizeAdvertisement(advertisement),
      matched: Boolean(decoded),
      matchedParser: decoded?.parserId || null,
      matchedDriver: decoded?.driverId || null,
      matchConfidence: confidence,
      matchRating: decoded?.matchRating || bestCandidate?.rating || getConfidenceRating(confidence),
      matchReason: decoded?.matchReason || bestCandidate?.reason || null,
      bestCandidate,
      parserCandidates,
    };

    entry.group = this.getDiagnosticGroup(entry);
    return entry;
  }

  buildDiagnosticGroups(entries) {
    const groups = {};

    for (const entry of entries) {
      if (!groups[entry.group]) {
        groups[entry.group] = {
          total: 0,
          matched: 0,
          unknown: 0,
        };
      }

      groups[entry.group].total += 1;
      if (entry.matched) groups[entry.group].matched += 1;
      else groups[entry.group].unknown += 1;
    }

    return groups;
  }

  async logBleScan(mode = 'all') {
    const advertisements = await this.refreshBleAdvertisements({ dispatch: false });
    const entries = advertisements.map((advertisement, index) => (
      this.buildBleDiagnosticEntry(advertisement, index)
    ));

    const filteredEntries = entries.filter(entry => {
      if (mode === 'matched') return entry.matched;
      if (mode === 'unknown') return !entry.matched;
      return true;
    });

    const groups = this.buildDiagnosticGroups(entries);

    this.log(
      `Manual BLE ${mode} scan found ${filteredEntries.length} matching advertisement(s) `
      + `out of ${advertisements.length} unique advertisement(s)`,
      { groups },
    );

    filteredEntries.forEach((entry, index) => {
      this.log(`BLE[${index}]`, entry);
    });

    return {
      mode,
      count: filteredEntries.length,
      total: advertisements.length,
      timestamp: new Date().toISOString(),
      groups,
      advertisements: filteredEntries,
    };
  }

  async dispatchAdvertisements(advertisements) {
    for (const adv of advertisements) {
      const decoded = this.parserRegistry.parse(adv);
      if (!decoded) continue;

      const device = this.findRegisteredDevice(decoded.driverId, decoded.deviceKey, adv);
      if (!device || typeof device.onClimateAdvertisement !== 'function') continue;

      try {
        await device.onClimateAdvertisement(adv, decoded);
      } catch (err) {
        this.reportError('Climate sensor advertisement dispatch failed', err, {
          driverId: decoded.driverId,
          deviceKey: decoded.deviceKey,
          parserId: decoded.parserId,
          device: device.getName(),
        });
      }
    }
  }

  findRegisteredDevice(driverId, deviceKey, adv) {
    const devices = this.devicesByDriver.get(driverId);
    if (!devices) return null;

    const keyCandidates = [
      String(deviceKey || ''),
      String(adv?.address || ''),
      String(adv?.uuid || ''),
    ].filter(Boolean);

    for (const key of keyCandidates) {
      const device = devices.get(key);
      if (device) return device;
    }

    return null;
  }

  getBleAdvertisements() {
    return this.bleAdvertisements || [];
  }

  async onUninit() {
    if (this.scanTimer) {
      this.homey.clearInterval(this.scanTimer);
    }
  }
};