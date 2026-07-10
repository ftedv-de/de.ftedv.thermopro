'use strict';

module.exports = {
  async scanBle({ homey }) {
    return homey.app.logBleScan('all');
  },

  async scanMatchedBle({ homey }) {
    return homey.app.logBleScan('matched');
  },

  async scanUnknownBle({ homey }) {
    return homey.app.logBleScan('unknown');
  },
};
