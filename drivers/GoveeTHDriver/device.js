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
};
