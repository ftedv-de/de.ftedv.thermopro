'use strict';

const BaseClimateDevice = require('../../lib/BaseClimateDevice');

const DRIVER_ID = 'MiFloraDriver';

const DATA_SERVICE_UUID = '0000120400001000800000805f9b34fb';
const REALTIME_CHARACTERISTIC_UUID = '00001a0000001000800000805f9b34fb';
const DATA_CHARACTERISTIC_UUID = '00001a0100001000800000805f9b34fb';
const FIRMWARE_CHARACTERISTIC_UUID = '00001a0200001000800000805f9b34fb';

const INITIAL_GATT_DELAY_MS = 2500;
const INITIAL_GATT_ATTEMPTS = 3;
const INITIAL_GATT_RETRY_DELAY_MS = 2000;

function normalizeUuid(uuid = '') {
  return String(uuid).toLowerCase().replace(/[^0-9a-f]/g, '');
}

module.exports = class MiFloraDevice extends BaseClimateDevice {

  getDriverId() {
    return DRIVER_ID;
  }

  getLogPrefix() {
    return 'MiFlora';
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

  async onAdded() {
    // Give Homey's pairing process and BLE stack a moment to settle before the
    // one-time active connection. All later updates remain advertisement-only.
    await this.sleep(INITIAL_GATT_DELAY_MS);

    try {
      await this.homey.app.runBleOperation(async () => {
        await this.readInitialValuesViaGattWithRetry();
      });

      await this.setStoreValue('initialGattReadSucceeded', true);
    } catch (err) {
      // Pairing must succeed even when the sensor is temporarily unreachable.
      // Advertisement updates will populate the values later.
      this.homey.app.reportError('Initial MiFlora GATT read failed', err, {
        device: this.getName(),
        dataId: this.getData()?.id,
        address: this.getStoreValue('address'),
        peripheralUuid: this.getStoreValue('peripheralUuid'),
        attempts: INITIAL_GATT_ATTEMPTS,
      });
    } finally {
      await this.setStoreValue('initialGattReadAttempted', true);
    }
  }

  async readInitialValuesViaGattWithRetry() {
    let lastError;

    for (let attempt = 1; attempt <= INITIAL_GATT_ATTEMPTS; attempt += 1) {
      try {
        this.homey.app.debug('Starting initial MiFlora GATT read', {
          device: this.getName(),
          attempt,
          attempts: INITIAL_GATT_ATTEMPTS,
        });

        await this.readInitialValuesViaGatt();
        return;
      } catch (err) {
        lastError = err;

        this.homey.app.debug('Initial MiFlora GATT attempt failed', {
          device: this.getName(),
          attempt,
          attempts: INITIAL_GATT_ATTEMPTS,
          error: err?.message,
        });

        if (attempt < INITIAL_GATT_ATTEMPTS) {
          await this.sleep(INITIAL_GATT_RETRY_DELAY_MS);
        }
      }
    }

    throw lastError || new Error('Initial MiFlora GATT read failed');
  }

  async findAdvertisementForGatt() {
    const identifiers = [
      this.getStoreValue('peripheralUuid'),
      this.getStoreValue('address'),
      this.getData()?.id,
    ]
      .map(value => String(value || ''))
      .filter((value, index, values) => value && values.indexOf(value) === index);

    let lastError;

    for (const identifier of identifiers) {
      try {
        return await this.homey.ble.find(identifier, 10000);
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error('No BLE identifier is available for the MiFlora device');
  }

  async readInitialValuesViaGatt() {
    // Resolve a fresh advertisement for every retry. Reusing an advertisement
    // object after a failed connection can leave Homey's peripheral stale.
    const advertisement = await this.findAdvertisementForGatt();
    let peripheral;

    try {
      peripheral = await advertisement.connect();
      const services = await peripheral.discoverServices();
      const dataService = services.find(service => (
        normalizeUuid(service.uuid) === DATA_SERVICE_UUID
      ));

      if (!dataService) {
        throw new Error('MiFlora GATT service 0x1204 was not found');
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

      if (!realtime) throw new Error('MiFlora realtime characteristic 0x1A00 was not found');
      if (!sensorDataCharacteristic) throw new Error('MiFlora data characteristic 0x1A01 was not found');

      await realtime.write(Buffer.from([0xa0, 0x1f]));
      await this.sleep(200);

      const sensorData = await sensorDataCharacteristic.read();
      await this.applyInitialSensorData(sensorData);

      if (firmwareCharacteristic) {
        const firmwareData = await firmwareCharacteristic.read();
        await this.applyInitialFirmwareData(firmwareData);
      }

      this.homey.app.debug('Initial MiFlora GATT read completed', {
        device: this.getName(),
        address: advertisement.address,
        uuid: advertisement.uuid,
      });
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
      throw new Error(`Unexpected MiFlora sensor data length: ${sensorData?.length || 0}`);
    }

    const values = {
      temperature: sensorData.readInt16LE(0) / 10,
      luminance: sensorData.readUInt32LE(3),
      moisture: sensorData.readUInt8(7),
      conductivity: sensorData.readUInt16LE(8),
    };

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

    this.homey.app.debug('Initial MiFlora sensor values', {
      device: this.getName(),
      ...values,
      raw: sensorData.toString('hex'),
    });
  }

  async applyInitialFirmwareData(firmwareData) {
    if (!Buffer.isBuffer(firmwareData) || firmwareData.length < 1) return;

    const battery = firmwareData.readUInt8(0);
    const firmwareVersion = firmwareData.length > 2
      ? firmwareData.toString('ascii', 2).replace(/\0+$/g, '')
      : '';

    if (this.hasCapability('measure_battery')) {
      await this.setCapabilityValue('measure_battery', battery);
    }
    if (this.hasCapability('alarm_battery')) {
      await this.setCapabilityValue('alarm_battery', battery <= 20);
    }

    if (firmwareVersion) {
      await this.setStoreValue('firmwareVersion', firmwareVersion);
    }

    this.homey.app.debug('Initial MiFlora firmware values', {
      device: this.getName(),
      battery,
      firmwareVersion,
      raw: firmwareData.toString('hex'),
    });
  }

};
