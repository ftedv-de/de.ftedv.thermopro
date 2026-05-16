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
    this.model = this.getStoreValue('model');

    this.lastDecode = null;

    this.updateTimer = this.homey.setInterval(async () => {
      try {
        await this.scan();
      } catch (err) {
        this.homey.app.reportError('Device update failed', err, {
          device: this.getName(),
          model: this.model,
          address: this.address,
          peripheralUuid: this.peripheralUuid,
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
      });
    }
  }

  async scan() {
    const advertisements = this.homey.app.getBleAdvertisements();

    const adv = advertisements.find(a =>
      a.uuid === this.peripheralUuid ||
      a.address === this.address ||
      getSupportedModel(a.localName) === this.model
    );

    if (!adv) {
      this.homey.app.debug('Device not found in BLE cache', {
        device: this.getName(),
        model: this.model,
        address: this.address,
        peripheralUuid: this.peripheralUuid,
      });
      return;
    }

    const decoded = decodeThermoProTH(adv);

    if (!decoded) {
      this.homey.app.debug('Could not decode ThermoPro payload', {
        device: this.getName(),
        model: this.model,
        address: this.address,
        peripheralUuid: this.peripheralUuid,
      });
      return;
    }

    this.homey.app.debug('Decoded ThermoPro payload', {
      device: this.getName(),
      timestamp: new Date().toISOString(),
      model: this.model,
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

  async onDeleted() {
    if (this.updateTimer) {
      this.homey.clearInterval(this.updateTimer);
    }
  }
  
};