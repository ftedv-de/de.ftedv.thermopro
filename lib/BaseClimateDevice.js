'use strict';

const Homey = require('homey');

module.exports = class BaseClimateDevice extends Homey.Device {

  getDriverId() {
    throw new Error('BaseClimateDevice subclasses must implement getDriverId()');
  }

  getLogPrefix() {
    return 'Climate sensor';
  }

  supportsInitialGattRead() {
    return false;
  }

  isInitialGattReadEnabled() {
    return this.getSetting('initial_gatt_read') !== false;
  }

  getInitialGattReadDelayMs() {
    return 2500;
  }

  getInitialGattReadAttempts() {
    return 3;
  }

  getInitialGattReadRetryDelayMs() {
    return 2000;
  }

  async performInitialGattRead() {
    throw new Error('Device declares initial GATT support but does not implement performInitialGattRead()');
  }

  async onInit() {
    this.log(`${this.getLogPrefix()} initialized: ${this.getName()}`);

    this.parserId = this.getStoreValue('parserId');
    this.peripheralUuid = this.getStoreValue('peripheralUuid');
    this.address = this.getStoreValue('address');
    this.localName = this.getStoreValue('localName');
    this.model = this.getStoreValue('model');
    this.modelName = this.getStoreValue('modelName');
    this.deviceType = this.getStoreValue('deviceType');
    this.serviceUuid = this.getStoreValue('serviceUuid');
    this.dataId = this.getData()?.id;

    this.homey.app.registerClimateDevice(this.getDriverId(), this);
  }

  async onAdded() {
    if (!this.supportsInitialGattRead() || !this.isInitialGattReadEnabled()) return;

    await this.setStoreValue('initialGattReadAttempted', true);
    await new Promise(resolve => this.homey.setTimeout(resolve, this.getInitialGattReadDelayMs()));

    let lastError;
    const attempts = this.getInitialGattReadAttempts();

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.homey.app.runBleOperation(() => this.performInitialGattRead());
        return;
      } catch (err) {
        lastError = err;
        this.homey.app.debug('Initial GATT read attempt failed', {
          ...this.getLogContext(),
          attempt,
          attempts,
          error: err?.message,
        });

        if (attempt < attempts) {
          await new Promise(resolve => this.homey.setTimeout(resolve, this.getInitialGattReadRetryDelayMs()));
        }
      }
    }

    this.homey.app.reportError(`Initial ${this.getLogPrefix()} GATT read failed`, lastError, {
      ...this.getLogContext(),
      attempts,
    });
  }

  getLogContext() {
    return {
      device: this.getName(),
      parserId: this.parserId,
      model: this.model,
      modelName: this.modelName,
      deviceType: this.deviceType,
      serviceUuid: this.serviceUuid,
      address: this.address,
      peripheralUuid: this.peripheralUuid,
      localName: this.localName,
      dataId: this.dataId,
    };
  }

  async onClimateAdvertisement(adv, decoded) {
    if (!this.matchesDecodedAdvertisement(adv, decoded)) return;

    this.updateRuntimeDeviceInfo(adv, decoded);

    if (!decoded || decoded.measurement !== true) {
      this.homey.app.debug(`${this.getLogPrefix()} packet did not contain measurement data`, {
        ...this.getLogContext(),
        raw: decoded?.raw,
      });
      return;
    }

    await this.updateDeviceInfoSettings(adv, decoded);

    this.homey.app.debug(`Decoded ${this.getLogPrefix()} payload`, {
      ...this.getLogContext(),
      timestamp: new Date().toISOString(),
      raw: decoded.raw,
      temperature: decoded.temperature,
      humidity: decoded.humidity,
      voltage: decoded.voltage,
      battery: decoded.battery,
      batteryLow: decoded.batteryLow,
      buttonPushed: decoded.buttonPushed,
      rssi: adv.rssi,
    });

    await this.applyCommonCapabilities(adv, decoded);
    await this.applyAdditionalCapabilities(adv, decoded);
  }

  matchesDecodedAdvertisement(adv, decoded) {
    if (!adv || !decoded) return false;

    if (this.peripheralUuid && adv.uuid === this.peripheralUuid) return true;
    if (this.address && adv.address === this.address) return true;

    if (this.dataId) {
      if (decoded.deviceKey === this.dataId) return true;
      if (adv.uuid === this.dataId) return true;
      if (adv.address === this.dataId) return true;
    }

    return false;
  }

  updateRuntimeDeviceInfo(adv, decoded = null) {
    if (!this.peripheralUuid && adv.uuid) this.peripheralUuid = String(adv.uuid);
    if (!this.address && adv.address) this.address = String(adv.address);
    if (!this.localName && adv.localName) this.localName = String(adv.localName);

    if (decoded) {
      if (!this.parserId && decoded.parserId) this.parserId = decoded.parserId;
      if (!this.model && decoded.model) this.model = decoded.model;
      if (!this.modelName && decoded.name) this.modelName = decoded.name;
      if (!this.deviceType && decoded.deviceType) this.deviceType = decoded.deviceType;
      if (!this.serviceUuid && decoded.serviceUuid) this.serviceUuid = decoded.serviceUuid;
    }
  }

  getDeviceInfoSettings(adv, decoded) {
    return {
      ble_address: String(adv.address || this.address || ''),
      ble_uuid: String(adv.uuid || this.peripheralUuid || ''),
      model_name: String(decoded?.name || decoded?.model || this.modelName || this.model || ''),
      service_uuid: String(decoded?.serviceUuid || this.serviceUuid || ''),
    };
  }

  async updateDeviceInfoSettings(adv, decoded) {
    const nextSettings = this.getDeviceInfoSettings(adv, decoded);
    const currentSettings = this.getSettings();
    const changed = Object.entries(nextSettings)
      .some(([key, value]) => currentSettings[key] !== value);

    if (changed) await this.setSettings(nextSettings);
  }

  async applyCommonCapabilities(adv, decoded) {
    if (this.hasCapability('measure_temperature') && typeof decoded.temperature === 'number') {
      await this.setCapabilityValue('measure_temperature', decoded.temperature);
    }
    if (this.hasCapability('measure_humidity') && typeof decoded.humidity === 'number') {
      await this.setCapabilityValue('measure_humidity', decoded.humidity);
    }
    if (this.hasCapability('measure_voltage') && typeof decoded.voltage === 'number') {
      await this.setCapabilityValue('measure_voltage', decoded.voltage);
    }
    if (this.hasCapability('measure_battery') && decoded.battery !== null && decoded.battery !== undefined) {
      await this.setCapabilityValue('measure_battery', decoded.battery);
    }
    if (this.hasCapability('alarm_battery') && typeof decoded.batteryLow === 'boolean') {
      await this.setCapabilityValue('alarm_battery', decoded.batteryLow);
    }
    if (this.hasCapability('measure_signal_strength') && typeof adv.rssi === 'number') {
      await this.setCapabilityValue('measure_signal_strength', adv.rssi);
    }
  }

  async applyAdditionalCapabilities(_adv, _decoded) {
    // Optional for subclasses.
  }

  async onDeleted() {
    this.homey.app.unregisterClimateDevice(this.getDriverId(), this);
  }

};
