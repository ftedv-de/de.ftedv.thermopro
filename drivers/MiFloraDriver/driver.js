'use strict';

const Homey = require('homey');
const { summarizeAdvertisement } = require('../../lib/AdvertisementUtils');

const DRIVER_ID = 'MiFloraDriver';

function createDeviceSettings(adv, decoded) {
  return {
    ble_address: String(adv.address || decoded?.address || ''),
    ble_uuid: String(adv.uuid || ''),
    model_name: String(decoded?.model || 'HHCCJCY01'),
    service_uuid: String(decoded?.serviceUuid || 'FE95'),
    product_id: String(decoded?.productId || ''),
  };
}

module.exports = class MiFloraDriver extends Homey.Driver {

  async onInit() {
    this.log('MiFlora driver initialized');
  }

  async onPairListDevices() {
    const advertisements = await this.homey.app.getAdvertisementsForPairing();
    const parserRegistry = this.homey.app.getParserRegistry();

    this.log(`Found ${advertisements.length} BLE advertisements during MiFlora pairing`);

    const devices = parserRegistry.parseAll(advertisements, DRIVER_ID)
      .map(({ advertisement: adv, decoded }) => {
        const id = decoded.deviceKey || adv.address || adv.uuid;
        if (!id) return null;

        return {
          name: decoded.displayName || 'Flower Care',
          data: {
            id: String(id),
          },
          store: {
            parserId: decoded.parserId,
            model: decoded.model || 'HHCCJCY01',
            modelName: decoded.name || 'Flower Care',
            serviceUuid: decoded.serviceUuid || 'FE95',
            productId: decoded.productId || '',
            peripheralUuid: String(adv.uuid || ''),
            address: String(adv.address || decoded.address || ''),
            localName: String(adv.localName || ''),
          },
          settings: createDeviceSettings(adv, decoded),
        };
      })
      .filter(Boolean);

    if (devices.length === 0) {
      this.log('No MiFlora advertisements matched. BLE advertisement sample:');
      advertisements.slice(0, 20).forEach((adv, index) => {
        this.log(`BLE[${index}]`, summarizeAdvertisement(adv));
      });
    } else {
      this.log(`Matched ${devices.length} MiFlora device(s)`);
    }

    return devices;
  }

};
