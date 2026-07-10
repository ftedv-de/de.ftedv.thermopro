'use strict';

const BaseClimateDevice = require('../../lib/BaseClimateDevice');

const DRIVER_ID = 'ThermoBeaconDriver';

module.exports = class ThermoBeaconDevice extends BaseClimateDevice {

  getDriverId() {
    return DRIVER_ID;
  }

  getLogPrefix() {
    return 'ThermoBeacon';
  }

  getDeviceInfoSettings(adv, decoded) {
    return {
      ...super.getDeviceInfoSettings(adv, decoded),
      device_type: String(decoded?.deviceType || this.deviceType || ''),
    };
  }

  async applyAdditionalCapabilities(_adv, decoded) {
    if (
      this.hasCapability('alarm_generic') &&
      typeof decoded.buttonPushed === 'boolean'
    ) {
      await this.setCapabilityValue('alarm_generic', decoded.buttonPushed);
    }
  }

};
