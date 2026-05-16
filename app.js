'use strict';

const Homey = require('homey');

module.exports = class ThermoProBle extends Homey.App {

  async onInit() {
    this.log('ThermoPro BLE app initialized');

    this.bleAdvertisements = [];

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

  async scanBle() {
    this.debug('Central BLE scan started');

    const advertisements = await this.homey.ble.discover();
    const map = new Map();

    for (const adv of advertisements) {
      const key = adv.address || adv.uuid || adv.localName;
      if (!key) continue;
      map.set(key, adv);
    }

    this.bleAdvertisements = Array.from(map.values());

    this.lastScanInfo = {
      timestamp: new Date().toISOString(),
      total: advertisements.length,
      unique: this.bleAdvertisements.length,
    };

    this.debug('Central BLE scan completed', this.lastScanInfo);
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
