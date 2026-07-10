'use strict';

const BaseClimateDevice = require('../../lib/BaseClimateDevice');

const DRIVER_ID = 'GoveeTHDriver';

module.exports = class GoveeTHDevice extends BaseClimateDevice {

  getDriverId() {
    return DRIVER_ID;
  }

  getLogPrefix() {
    return 'Govee';
  }

  async onInit() {
    await super.onInit();
    await this.ensureModelCapabilities();
  }

  async ensureCapability(capabilityId, options = null) {
    try {
      if (!this.hasCapability(capabilityId)) {
        await this.addCapability(capabilityId);
      }

      if (options) {
        await this.setCapabilityOptions(capabilityId, options);
      }

      return true;
    } catch (err) {
      this.homey.app.reportError('Could not configure Govee capability', err, {
        ...this.getLogContext(),
        capabilityId,
      });
      return false;
    }
  }

  async ensureModelCapabilities() {
    const model = String(this.model || this.getStoreValue('model') || '').toUpperCase();

    if (model === 'H5106') {
      await this.ensureCapability('measure_pm25');
    }

    if (model === 'H5112') {
      await this.ensureCapability('measure_temperature.probe1', {
        title: {
          en: 'Probe 1',
          de: 'Fühler 1',
        },
      });
      await this.ensureCapability('measure_temperature.probe2', {
        title: {
          en: 'Probe 2',
          de: 'Fühler 2',
        },
      });
    }
  }

  async applyAdditionalCapabilities(_adv, decoded) {
    if (this.hasCapability('measure_pm25') && typeof decoded.pm25 === 'number') {
      await this.setCapabilityValue('measure_pm25', decoded.pm25);
    }

    if (
      this.hasCapability('measure_temperature.probe1')
      && typeof decoded.probe1Temperature === 'number'
    ) {
      await this.setCapabilityValue('measure_temperature.probe1', decoded.probe1Temperature);
    }

    if (
      this.hasCapability('measure_temperature.probe2')
      && typeof decoded.probe2Temperature === 'number'
    ) {
      await this.setCapabilityValue('measure_temperature.probe2', decoded.probe2Temperature);
    }
  }
};