'use strict';

const BaseClimateDevice = require('../../lib/BaseClimateDevice');

const DRIVER_ID = 'MiFloraDriver';

const DATA_SERVICE_UUID = '0000120400001000800000805f9b34fb';
const REALTIME_CHARACTERISTIC_UUID = '00001a0000001000800000805f9b34fb';
const DATA_CHARACTERISTIC_UUID = '00001a0100001000800000805f9b34fb';
const FIRMWARE_CHARACTERISTIC_UUID = '00001a0200001000800000805f9b34fb';
const DAILY_GATT_READ_INTERVAL = 24 * 60 * 60 * 1000;

function normalizeUuid(uuid = '') {
  return String(uuid).toLowerCase().replace(/[^0-9a-f]/g, '');
}

module.exports = class MiFloraDevice extends BaseClimateDevice {

  async onInit() {
    await super.onInit();
    this.configureDailyGattRead();
  }

  async onUninit() {
    this.clearDailyGattRead();
  }

  async onDeleted() {
    this.clearDailyGattRead();
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('daily_gatt_battery_read')) {
      this.configureDailyGattRead(newSettings.daily_gatt_battery_read === true);
    }
  }

  getDriverId() {
    return DRIVER_ID;
  }

  getLogPrefix() {
    return 'MiFlora';
  }

  supportsInitialGattRead() {
    return true;
  }

  configureDailyGattRead(enabled = this.getSetting('daily_gatt_battery_read') === true) {
    this.clearDailyGattRead();
    if (!enabled) return;

    this.dailyGattReadInterval = this.homey.setInterval(() => {
      this.homey.app.runBleOperation(() => this.readInitialValuesViaGatt())
        .catch(err => this.homey.app.debug('Daily MiFlora GATT read failed', {
          device: this.getName(),
          error: err?.message,
        }));
    }, DAILY_GATT_READ_INTERVAL);
  }

  clearDailyGattRead() {
    if (!this.dailyGattReadInterval) return;
    this.homey.clearInterval(this.dailyGattReadInterval);
    this.dailyGattReadInterval = null;
  }

  async performInitialGattRead() {
    const succeeded = await this.readInitialValuesViaGatt();
    if (!succeeded) return false;

    try {
      await this.setStoreValue('initialGattReadSucceeded', true);
    } catch (err) {
      this.homey.app.debug('Could not store successful MiFlora GATT state', {
        device: this.getName(),
        error: err?.message,
      });
    }

    return true;
  }

  sleep(milliseconds) {
    return new Promise(resolve => this.homey.setTimeout(resolve, milliseconds));
  }

  getDeviceInfoSettings(adv, decoded) {
    return {
      ...super.getDeviceInfoSettings(adv, decoded),
      product_id: String(decoded?.productId || this.getStoreValue('productId') || ''),
    };
  }

  async applyAdditionalCapabilities(_adv, decoded) {
    if (this.hasCapability('measure_luminance') && typeof decoded.luminance === 'number') {
      await this.setCapabilityValue('measure_luminance', decoded.luminance);
    }

    if (this.hasCapability('measure_moisture') && typeof decoded.moisture === 'number') {
      await this.setCapabilityValue('measure_moisture', decoded.moisture);
    }

    if (this.hasCapability('measure_conductivity') && typeof decoded.conductivity === 'number') {
      await this.setCapabilityValue('measure_conductivity', decoded.conductivity);
    }
  }

  async findAdvertisementForGatt() {
    const identifiers = [
      this.getStoreValue('peripheralUuid'),
      this.getStoreValue('address'),
      this.getData()?.id,
    ]
      .map(value => String(value || ''))
      .filter((value, index, values) => value && values.indexOf(value) === index);

    if (identifiers.length === 0) {
      this.homey.app.debug('No BLE identifier is available for the MiFlora GATT interview', {
        device: this.getName(),
      });
      return null;
    }

    for (const identifier of identifiers) {
      try {
        const advertisement = await this.homey.ble.find(identifier, 10000);
        if (advertisement) return advertisement;
      } catch (err) {
        this.homey.app.debug('MiFlora advertisement lookup failed', {
          device: this.getName(),
          identifier,
          error: err?.message,
        });
      }
    }

    return null;
  }

  async readInitialValuesViaGatt() {
    const advertisement = await this.findAdvertisementForGatt();
    if (!advertisement) return false;

    let peripheral;

    try {
      peripheral = await advertisement.connect();
      const services = await peripheral.discoverServices();
      const dataService = services.find(service => normalizeUuid(service.uuid) === DATA_SERVICE_UUID);

      if (!dataService) {
        this.homey.app.debug('MiFlora GATT service 0x1204 was not found', {
          device: this.getName(),
          address: advertisement.address,
          uuid: advertisement.uuid,
        });
        return false;
      }

      const characteristics = await dataService.discoverCharacteristics();
      const realtime = characteristics.find(characteristic => (
        normalizeUuid(characteristic.uuid) === REALTIME_CHARACTERISTIC_UUID
      ));
      const sensorDataCharacteristic = characteristics.find(characteristic => (
        normalizeUuid(characteristic.uuid) === DATA_CHARACTERISTIC_UUID
      ));
      const firmwareCharacteristic = characteristics.find(characteristic => (
        normalizeUuid(characteristic.uuid) === FIRMWARE_CHARACTERISTIC_UUID
      ));

      if (!realtime || !sensorDataCharacteristic) {
        this.homey.app.debug('Required MiFlora GATT characteristics were not found', {
          device: this.getName(),
          realtimeFound: Boolean(realtime),
          sensorDataFound: Boolean(sensorDataCharacteristic),
          firmwareFound: Boolean(firmwareCharacteristic),
        });
        return false;
      }

      await realtime.write(Buffer.from([0xa0, 0x1f]));
      await this.sleep(200);

      const sensorData = await sensorDataCharacteristic.read();
      const sensorDataApplied = await this.applyInitialSensorData(sensorData);
      if (!sensorDataApplied) return false;

      if (firmwareCharacteristic) {
        try {
          const firmwareData = await firmwareCharacteristic.read();
          await this.applyInitialFirmwareData(firmwareData);
        } catch (err) {
          this.homey.app.debug('Optional MiFlora firmware read failed', {
            device: this.getName(),
            error: err?.message,
          });
        }
      }

      this.homey.app.debug('Initial MiFlora GATT read completed', {
        device: this.getName(),
        address: advertisement.address,
        uuid: advertisement.uuid,
      });

      return true;
    } catch (err) {
      this.homey.app.debug('Initial MiFlora GATT communication failed', {
        device: this.getName(),
        address: advertisement.address,
        uuid: advertisement.uuid,
        error: err?.message,
      });
      return false;
    } finally {
      if (peripheral?.isConnected) {
        try {
          await peripheral.disconnect();
        } catch (disconnectError) {
          this.homey.app.debug('Could not disconnect MiFlora after initial GATT read', {
            device: this.getName(),
            error: disconnectError?.message,
          });
        }
      }
    }
  }

  async applyInitialSensorData(sensorData) {
    if (!Buffer.isBuffer(sensorData) || sensorData.length < 10) {
      this.homey.app.debug('Unexpected MiFlora sensor data length', {
        device: this.getName(),
        length: sensorData?.length || 0,
      });
      return false;
    }

    const values = {
      temperature: sensorData.readInt16LE(0) / 10,
      luminance: sensorData.readUInt32LE(3),
      moisture: sensorData.readUInt8(7),
      conductivity: sensorData.readUInt16LE(8),
    };

    try {
      if (this.hasCapability('measure_temperature')) {
        await this.setCapabilityValue('measure_temperature', values.temperature);
      }
      if (this.hasCapability('measure_luminance')) {
        await this.setCapabilityValue('measure_luminance', values.luminance);
      }
      if (this.hasCapability('measure_moisture')) {
        await this.setCapabilityValue('measure_moisture', values.moisture);
      }
      if (this.hasCapability('measure_conductivity')) {
        await this.setCapabilityValue('measure_conductivity', values.conductivity);
      }
    } catch (err) {
      this.homey.app.debug('Could not apply initial MiFlora sensor values', {
        device: this.getName(),
        error: err?.message,
      });
      return false;
    }

    this.homey.app.debug('Initial MiFlora sensor values', {
      device: this.getName(),
      ...values,
      raw: sensorData.toString('hex'),
    });

    return true;
  }

  async applyInitialFirmwareData(firmwareData) {
    if (!Buffer.isBuffer(firmwareData) || firmwareData.length < 1) {
      this.homey.app.debug('Unexpected MiFlora firmware data', {
        device: this.getName(),
        length: firmwareData?.length || 0,
      });
      return false;
    }

    const battery = firmwareData.readUInt8(0);
    const firmwareVersion = firmwareData.length > 2
      ? firmwareData.toString('ascii', 2).replace(/\0+$/g, '')
      : '';

    try {
      if (this.hasCapability('measure_battery')) {
        await this.setCapabilityValue('measure_battery', battery);
      }
      if (this.hasCapability('alarm_battery')) {
        await this.setCapabilityValue('alarm_battery', battery <= 20);
      }

      if (firmwareVersion) await this.setStoreValue('firmwareVersion', firmwareVersion);
    } catch (err) {
      this.homey.app.debug('Could not apply initial MiFlora firmware values', {
        device: this.getName(),
        error: err?.message,
      });
      return false;
    }

    this.homey.app.debug('Initial MiFlora firmware values', {
      device: this.getName(),
      battery,
      firmwareVersion,
      raw: firmwareData.toString('hex'),
    });

    return true;
  }

};
