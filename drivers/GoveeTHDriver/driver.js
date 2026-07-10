'use strict';

const Homey = require('homey');
const { summarizeAdvertisement } = require('../../lib/AdvertisementUtils');

const DRIVER_ID = 'GoveeTHDriver';

function createDeviceSettings(adv, decoded) {
  return {
    ble_address: String(adv.address || ''),
    ble_uuid: String(adv.uuid || ''),
    model_name: String(decoded?.model || ''),
    service_uuid: String(decoded?.serviceUuid || ''),
  };
}

module.exports = class GoveeTHDriver extends Homey.Driver {

  async onInit() {
    this.log('Govee TH driver initialized');
  }

  async onPairListDevices() {
    const advertisements = await this.homey.app.getAdvertisementsForPairing();
    const parserRegistry = this.homey.app.getParserRegistry();

    this.log(`Found ${advertisements.length} BLE advertisements during Govee pairing`);

    const devices = parserRegistry.parseAll(advertisements, DRIVER_ID)
      .map(({ advertisement: adv, decoded }) => {
        const id = decoded.deviceKey || adv.address || adv.uuid;
        if (!id) return null;

        return {
          name: decoded.displayName || decoded.name || adv.localName || 'Govee',
          data: { id: String(id) },
          store: {
            parserId: decoded.parserId,
            model: decoded.model || '',
            peripheralUuid: String(adv.uuid || ''),
            address: String(adv.address || ''),
            localName: String(adv.localName || ''),
            serviceUuid: String(decoded.serviceUuid || ''),
          },
          settings: createDeviceSettings(adv, decoded),
        };
      })
      .filter(Boolean);

    if (devices.length === 0) {
      this.log('No supported Govee advertisements matched. BLE advertisement sample:');
      advertisements.slice(0, 20).forEach((adv, index) => {
        this.log(`BLE[${index}]`, summarizeAdvertisement(adv));
      });
    } else {
      this.log(`Matched ${devices.length} Govee device(s)`);
    }

    return devices;
  }
};
