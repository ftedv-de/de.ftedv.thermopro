'use strict';

const BaseClimateDevice = require('../../lib/BaseClimateDevice');

const DRIVER_ID = 'MiFloraDriver';

module.exports = class MiFloraDevice extends BaseClimateDevice {

  getDriverId() {
    return DRIVER_ID;
  }

  getLogPrefix() {
    return 'MiFlora';
  }

  getDeviceInfoSettings(adv, decoded) {
    return {
      ...super.getDeviceInfoSettings(adv, decoded),
      product_id: String(decoded?.productId || this.getStoreValue('productId') || ''),
    };
  }

  async applyAdditionalCapabilities(_adv, decoded) {
    if (
      this.hasCapability('measure_luminance') &&
      typeof decoded.luminance === 'number'
    ) {
      await this.setCapabilityValue('measure_luminance', decoded.luminance);
    }

    if (
      this.hasCapability('measure_moisture') &&
      typeof decoded.moisture === 'number'
    ) {
      await this.setCapabilityValue('measure_moisture', decoded.moisture);
    }

    if (
      this.hasCapability('measure_conductivity') &&
      typeof decoded.conductivity === 'number'
    ) {
      await this.setCapabilityValue('measure_conductivity', decoded.conductivity);
    }
  }

};
