'use strict';

module.exports = {
  async scanBle({ homey }) {
    return homey.app.logBleScan();
  },
};
