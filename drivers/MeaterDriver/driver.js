'use strict';

const Homey = require('homey');

const MEATER_SERVICE_UUID = 'c9e2746c-59f1-4e54-a0dd-e1e54555cf8b';

module.exports = class MeaterDriver extends Homey.Driver {

  async onInit() {
    this.log('MEATER driver initialized');
  }

  async onPairListDevices() {
    const advertisements = await this.homey.ble.discover();
    const bases = advertisements.filter(advertisement => (
      advertisement.connectable && advertisement.serviceUuids.some(
        uuid => normalizeUuid(uuid) === normalizeUuid(MEATER_SERVICE_UUID),
      )
    ));

    this.log(`Found ${advertisements.length} BLE devices, ${bases.length} MEATER bases`);
    return bases.map(advertisement => ({
      name: advertisement.localName || `MEATER ${advertisement.address || advertisement.uuid}`,
      data: { uuid: advertisement.uuid },
      store: { address: advertisement.address },
    }));
  }

};

function normalizeUuid(uuid) {
  return uuid.replace(/-/g, '').toLowerCase();
}
