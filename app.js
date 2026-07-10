'use strict';

const Homey = require('homey');
const ParserRegistry = require('./lib/ParserRegistry');
const ThermoBeaconParser = require('./lib/parsers/ThermoBeaconParser');
const ThermoProParser = require('./lib/parsers/ThermoProParser');
const MiFloraParser = require('./lib/parsers/MiFloraParser');
const { getDeviceKey } = require('./lib/AdvertisementUtils');

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

    // Keep the queue usable after a failed operation while still returning the
    // original rejection to the caller.
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
