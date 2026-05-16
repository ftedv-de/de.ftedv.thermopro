'use strict';

const Homey = require('homey');

const {
  getSupportedModel,
  isSupportedAdvertisement,
} = require('../../lib/thermopro');

module.exports = class ThermoProTHDriver extends Homey.Driver {

  async onInit() {
    this.log('ThermoPro TH Driver initialized');
  }

  async onPairListDevices() {
    const advertisements = await this.homey.ble.discover();

    this.homey.app.debug(
      `Found ${advertisements.length} BLE advertisements during pairing`
    );

    return advertisements
      .filter(isSupportedAdvertisement)
      .map(adv => {
        const id = adv.address || adv.uuid;
        if (!id) return null;

        const model = getSupportedModel(adv.localName);

        return {
          name: adv.localName || `ThermoPro ${id}`,
          data: {
            id: String(id),
          },
          store: {
            model,
            peripheralUuid: String(adv.uuid || ''),
            address: String(adv.address || ''),
          },
          settings: {},
        };
      })
      .filter(Boolean);
  }
  
};