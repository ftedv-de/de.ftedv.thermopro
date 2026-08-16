'use strict';

const Homey = require('homey');

const SERVICE_UUID = 'c9e2746c-59f1-4e54-a0dd-e1e54555cf8b';
const TEMPERATURE_UUID = '7edda774-045e-4bbf-909b-45d1991a2876';
const BATTERY_UUID = '2adb4877-68d8-4884-bd3c-d83853bf27b8';
const PROBE_RSSI_UUID = '370aabe7-4837-4bee-aadc-cd1836dbce53';
const BASE_BATTERY_UUID = '22db81c4-d125-4e8f-99a4-3609e4c9a017';
const POLL_INTERVAL = 30000;
const SERVICE_RESOLVE_DELAY = 5000;
const RATE_WINDOW = 5 * 60 * 1000;
const SAMPLE_RETENTION = 6 * 60 * 1000;

module.exports = class MeaterDevice extends Homey.Device {

  async onInit() {
    this.temperatureSamples = [];
    this.registerCapabilityListener('meater_target_temperature', async value => {
      await this.setCapabilityValue('meater_target_temperature', value);
      await this.updateEstimatedTimeRemaining();
    });
    this.pollInterval = this.homey.setInterval(() => this.updateMeasurements(), POLL_INTERVAL);
    await this.updateMeasurements();
  }

  async onDeleted() {
    this.homey.clearInterval(this.pollInterval);
    await this.disconnect();
  }

  async onUninit() {
    this.homey.clearInterval(this.pollInterval);
    await this.disconnect();
  }

  async updateMeasurements() {
    try {
      await this.connect();
      const temperatures = await this.temperatureCharacteristic.read();
      const battery = await this.batteryCharacteristic.read();
      const probeRssi = this.probeRssiCharacteristic
        ? await this.probeRssiCharacteristic.read() : null;
      const baseBattery = this.baseBatteryCharacteristic
        ? await this.baseBatteryCharacteristic.read() : null;

      if (temperatures.length === 0) return;

      await this.setTemperatures(temperatures);
      await this.setCapabilityValue('measure_battery', battery.readUInt8(0));
      if (probeRssi && probeRssi.length > 0) {
        await this.setCapabilityValue('meater_probe_rssi', probeRssi.readInt8(0));
      }
      if (baseBattery && baseBattery.length > 0) {
        await this.setCapabilityValue('meater_base_battery_voltage', baseBattery.readUInt8(0) / 50);
      }
      await this.setCapabilityValue('alarm_generic', false);
      await this.setAvailable();
    } catch (error) {
      this.log(`Unable to read MEATER probe: ${error.message}`);
      await this.setCapabilityValue('alarm_generic', true);
      await this.disconnect();
    }
  }

  async connect() {
    if (this.peripheral && this.peripheral.isConnected && this.temperatureCharacteristic) return;
    await this.disconnect();

    try {
      const advertisement = await this.homey.ble.find(this.getData().uuid);
      this.peripheral = await advertisement.connect();
      await wait(SERVICE_RESOLVE_DELAY);
      const [service] = await this.peripheral.discoverServices([SERVICE_UUID]);
      if (!service) throw new Error('MEATER GATT service was not found');

      const characteristics = await service.discoverCharacteristics();
      this.temperatureCharacteristic = getCharacteristic(characteristics, TEMPERATURE_UUID);
      this.batteryCharacteristic = getCharacteristic(characteristics, BATTERY_UUID);
      this.probeRssiCharacteristic = getCharacteristic(characteristics, PROBE_RSSI_UUID);
      this.baseBatteryCharacteristic = getCharacteristic(characteristics, BASE_BATTERY_UUID);
      if (!this.temperatureCharacteristic || !this.batteryCharacteristic) {
        throw new Error('MEATER temperature or battery characteristic was not found');
      }
      await this.temperatureCharacteristic.subscribeToNotifications(data => {
        if (data.length > 0) {
          this.setTemperatures(data).catch(error => this.error('Unable to process MEATER notification', error));
        }
      });
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async disconnect() {
    if (this.peripheral && this.peripheral.isConnected) await this.peripheral.disconnect();
    this.peripheral = null;
    this.temperatureCharacteristic = null;
    this.batteryCharacteristic = null;
    this.probeRssiCharacteristic = null;
    this.baseBatteryCharacteristic = null;
  }

  async setTemperatures(data) {
    if (data.length < 12) throw new Error(`Unexpected MEATER temperature payload length: ${data.length}`);
    const cores = Array.from({ length: 5 }, (_, index) => data.readUInt16LE(index * 2) / 32);
    const core = Math.min(...cores);
    const ambient = data.readUInt16LE(10) / 32;
    this.currentCoreTemperature = round(core);
    await this.setCapabilityValue('measure_meater_core_temperature', this.currentCoreTemperature);
    await this.setCapabilityValue('measure_meater_ambient_temperature', round(ambient));
    this.temperatureRate = await this.updateTemperatureRate(this.currentCoreTemperature);
    await this.updateEstimatedTimeRemaining();
  }

  async updateTemperatureRate(core) {
    const now = Date.now();
    this.temperatureSamples.push({ timestamp: now, temperature: core });
    this.temperatureSamples = this.temperatureSamples.filter(sample => sample.timestamp >= now - SAMPLE_RETENTION);
    const reference = [...this.temperatureSamples].reverse().find(sample => sample.timestamp <= now - RATE_WINDOW);
    if (!reference) return null;
    const rate = round((core - reference.temperature) / ((now - reference.timestamp) / 60000));
    await this.setCapabilityValue('meater_temperature_rate', rate);
    return rate;
  }

  async updateEstimatedTimeRemaining() {
    const target = this.getCapabilityValue('meater_target_temperature');
    if (typeof target !== 'number' || this.currentCoreTemperature === undefined) return;
    if (this.currentCoreTemperature >= target) {
      await this.setCapabilityValue('measure_meater_estimated_time_remaining', 0);
    } else if (typeof this.temperatureRate !== 'number' || this.temperatureRate <= 0) {
      await this.setCapabilityValue('measure_meater_estimated_time_remaining', null);
    } else {
      await this.setCapabilityValue(
        'measure_meater_estimated_time_remaining',
        Math.ceil((target - this.currentCoreTemperature) / this.temperatureRate),
      );
    }
  }

};

function getCharacteristic(characteristics, uuid) {
  return characteristics.find(characteristic => normalizeUuid(characteristic.uuid) === normalizeUuid(uuid));
}

function normalizeUuid(uuid) {
  return uuid.replace(/-/g, '').toLowerCase();
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
