'use strict';

const Homey = require('homey');

const {
  getSupportedModel,
  decodeThermoProTH,
} = require('../../lib/thermopro');

module.exports = class ThermoProTHDevice extends Homey.Device {

  async onInit() {
    this.log(`ThermoPro TH device initialized: ${this.getName()}`);

    this.peripheralUuid = this.getStoreValue('peripheralUuid');
    this.address = this.getStoreValue('address');
    this.localName = this.getStoreValue('localName');
    this.model = this.getStoreValue('model');
    this.dataId = this.getData()?.id;

    this.updateTimer = this.homey.setInterval(async () => {
      try {
        await this.scan();
      } catch (err) {
        this.homey.app.reportError('Device update failed', err, {
          device: this.getName(),
          model: this.model,
          address: this.address,
          peripheralUuid: this.peripheralUuid,
          localName: this.localName,
          dataId: this.dataId,
        });
      }
    }, 35000);

    try {
      await this.scan();
    } catch (err) {
      this.homey.app.reportError('Initial device update failed', err, {
        device: this.getName(),
        model: this.model,
        address: this.address,
        peripheralUuid: this.peripheralUuid,
        localName: this.localName,
        dataId: this.dataId,
      });
    }
  }

  async scan() {
    const advertisements = this.homey.app.getBleAdvertisements();
    const adv = this.findAdvertisement(advertisements);

    if (!adv) {
      this.homey.app.debug('Device not found in BLE cache', {
        device: this.getName(),
        model: this.model,
        address: this.address,
        peripheralUuid: this.peripheralUuid,
        localName: this.localName,
        dataId: this.dataId,
      });
      return;
    }

    await this.migrateStoreFromAdvertisement(adv);

    const decoded = decodeThermoProTH(adv);

    if (!decoded) {
      this.homey.app.debug('Could not decode ThermoPro payload', {
        device: this.getName(),
        model: this.model,
        address: this.address,
        peripheralUuid: this.peripheralUuid,
        localName: this.localName,
        dataId: this.dataId,
      });
      return;
    }

    this.homey.app.debug('Decoded ThermoPro payload', {
      device: this.getName(),
      timestamp: new Date().toISOString(),
      model: this.model,
      localName: this.localName,
      raw: decoded.raw,
      temperature: decoded.temperature,
      humidity: decoded.humidity,
      battery: decoded.battery,
      batteryLow: decoded.batteryLow,
      rssi: adv.rssi,
    });

    if (this.hasCapability('measure_temperature')) {
      await this.setCapabilityValue('measure_temperature', decoded.temperature);
    }

    if (this.hasCapability('measure_humidity')) {
      await this.setCapabilityValue('measure_humidity', decoded.humidity);
    }

    if (this.hasCapability('measure_battery') && decoded.battery !== null) {
      await this.setCapabilityValue('measure_battery', decoded.battery);
    }

    if (this.hasCapability('alarm_battery')) {
      await this.setCapabilityValue('alarm_battery', decoded.batteryLow);
    }

    if (
      this.hasCapability('measure_signal_strength') &&
      typeof adv.rssi === 'number'
    ) {
      await this.setCapabilityValue('measure_signal_strength', adv.rssi);
    }
  }

  findAdvertisement(advertisements) {
    return advertisements.find(adv => this.matchesAdvertisement(adv));
  }

  matchesAdvertisement(adv) {
    if (!adv) return false;

    if (this.peripheralUuid && adv.uuid === this.peripheralUuid) return true;
    if (this.address && adv.address === this.address) return true;
    if (this.localName && adv.localName === this.localName) return true;

    if (this.dataId) {
      if (adv.uuid === this.dataId) return true;
      if (adv.address === this.dataId) return true;
    }

    // Do not match by model only. Multiple sensors of the same model would then
    // all pick the same advertisement and show identical values.
    return false;
  }

  async migrateStoreFromAdvertisement(adv) {
    const updates = [];

    if (!this.peripheralUuid && adv.uuid) {
      this.peripheralUuid = String(adv.uuid);
      updates.push(this.setStoreValue('peripheralUuid', this.peripheralUuid));
    }

    if (!this.address && adv.address) {
      this.address = String(adv.address);
      updates.push(this.setStoreValue('address', this.address));
    }

    if (!this.localName && adv.localName) {
      this.localName = String(adv.localName);
      updates.push(this.setStoreValue('localName', this.localName));
    }

    if (!this.model && adv.localName) {
      const model = getSupportedModel(adv.localName);
      if (model) {
        this.model = model;
        updates.push(this.setStoreValue('model', this.model));
      }
    }

    if (updates.length > 0) {
      await Promise.all(updates);
      this.homey.app.debug('Migrated ThermoPro device store', {
        device: this.getName(),
        model: this.model,
        address: this.address,
        peripheralUuid: this.peripheralUuid,
        localName: this.localName,
        dataId: this.dataId,
      });
    }
  }

  async onDeleted() {
    if (this.updateTimer) {
      this.homey.clearInterval(this.updateTimer);
    }
  }
  
};