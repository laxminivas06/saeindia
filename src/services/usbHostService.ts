import { registerPlugin, Capacitor } from '@capacitor/core';
import { ConnectionPhase, UsbDeviceDiagnostics } from '../types/mavlink';

export interface NativeUsbDevice {
  deviceName: string;
  vendorId: number;
  productId: number;
  deviceClass: number;
  deviceSubclass: number;
  interfaceCount: number;
  productName: string;
  manufacturerName: string;
  serialNumber: string;
}

export interface NativeUsbSerialPlugin {
  getConnectedDevices(): Promise<{ devices: NativeUsbDevice[]; count: number }>;
  autoConnect(options: { baudRate: number }): Promise<{ success: boolean; status?: string; device?: NativeUsbDevice; error?: string }>;
  requestPermission(options?: { deviceName?: string }): Promise<{ success: boolean; granted?: boolean }>;
  openPort(options: { baudRate: number; deviceName?: string }): Promise<{ success: boolean }>;
  sendData(options: { data: string }): Promise<{ bytesSent: number }>;
  disconnect(): Promise<{ success: boolean }>;
  getDiagnostics(): Promise<any>;
  addListener(eventName: 'usbData', listenerFunc: (data: { data: string; length: number }) => void): Promise<any>;
  addListener(eventName: 'usbStateChange', listenerFunc: (state: { status: string; message: string; device?: NativeUsbDevice }) => void): Promise<any>;
  addListener(eventName: 'usbAttached', listenerFunc: (info: { device: NativeUsbDevice }) => void): Promise<any>;
  addListener(eventName: 'usbDetached', listenerFunc: (info: { device?: NativeUsbDevice }) => void): Promise<any>;
}

const UsbSerial = registerPlugin<NativeUsbSerialPlugin>('UsbSerial');

type DataListener = (chunk: Uint8Array) => void;
type StateListener = (phase: ConnectionPhase, message: string, diagnostics: Partial<UsbDeviceDiagnostics>) => void;

class UsbHostService {
  private isNative: boolean = Capacitor.isNativePlatform();
  private dataListeners: Set<DataListener> = new Set();
  private stateListeners: Set<StateListener> = new Set();
  
  private currentPhase: ConnectionPhase = 'DISCONNECTED';
  private currentBaudRate: number = 115200;
  private currentDevice: NativeUsbDevice | null = null;
  private isConnected: boolean = false;
  
  // WebSerial/WebUSB fallbacks for desktop development
  private webSerialPort: any = null;
  private webSerialReader: any = null;
  private webSerialWriter: any = null;
  private isReadingWebSerial: boolean = false;

  private webUsbDevice: any = null;
  private isReadingWebUsb: boolean = false;
  private webUsbInEp: number = 1;
  private webUsbOutEp: number = 2;

  constructor() {
    this.init();
  }

  private async init() {
    if (this.isNative) {
      try {
        await UsbSerial.addListener('usbData', (event) => {
          if (event && event.data) {
            const binaryString = atob(event.data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            this.notifyData(bytes);
          }
        });

        await UsbSerial.addListener('usbStateChange', (event) => {
          const mappedPhase = this.mapNativeStatusToPhase(event.status);
          if (event.device) this.currentDevice = event.device;
          this.notifyState(mappedPhase, event.message, {
            deviceName: event.device?.deviceName,
            productName: event.device?.productName,
            manufacturerName: event.device?.manufacturerName,
            vendorId: event.device?.vendorId,
            productId: event.device?.productId,
            interfaceCount: event.device?.interfaceCount,
            baudRate: this.currentBaudRate,
            driverType: 'NATIVE_ANDROID_USB'
          });
        });

        await UsbSerial.addListener('usbAttached', async (event) => {
          if (event.device) {
            this.currentDevice = event.device;
            this.notifyState('USB_DEVICE_DETECTED', `Pixhawk USB OTG connected: ${event.device.productName || 'Flight Controller'}`, {
              deviceName: event.device.deviceName,
              productName: event.device.productName,
              vendorId: event.device.vendorId,
              productId: event.device.productId,
              driverType: 'NATIVE_ANDROID_USB'
            });
            // Automatically auto-connect without user having to select anything
            await this.autoConnect(this.currentBaudRate);
          }
        });

        await UsbSerial.addListener('usbDetached', () => {
          this.currentDevice = null;
          this.isConnected = false;
          this.notifyState('DISCONNECTED', 'Flight Controller Disconnected (OTG cable removed)', {
            driverType: 'NATIVE_ANDROID_USB'
          });
        });

        // Automatically check if a device is already plugged in on app startup
        setTimeout(() => {
          this.autoConnect(this.currentBaudRate);
        }, 1000);
      } catch (err) {
        console.warn('Native UsbSerial listeners initialization notice:', err);
      }
    } else {
      // Browser environment: Auto-check if serial port was previously granted
      if (typeof navigator !== 'undefined' && 'serial' in navigator) {
        (navigator as any).serial.addEventListener('connect', (e: any) => {
          this.notifyState('USB_DEVICE_DETECTED', 'USB Serial Device Connected', { driverType: 'WEBSERIAL' });
          this.autoConnect(this.currentBaudRate);
        });
        (navigator as any).serial.addEventListener('disconnect', () => {
          this.disconnect();
          this.notifyState('DISCONNECTED', 'USB Serial Device Disconnected', { driverType: 'WEBSERIAL' });
        });
      }
    }
  }

  private mapNativeStatusToPhase(status: string): ConnectionPhase {
    switch (status) {
      case 'USB_DEVICE_DETECTED': return 'USB_DEVICE_DETECTED';
      case 'USB_PERMISSION_REQUESTED': return 'USB_PERMISSION_REQUESTED';
      case 'USB_PERMISSION_GRANTED': return 'USB_PERMISSION_GRANTED';
      case 'USB_INTERFACE_DETECTED': return 'USB_INTERFACE_DETECTED';
      case 'SERIAL_INTERFACE_OPENED': return 'SERIAL_INTERFACE_OPENED';
      case 'DISCONNECTED': return 'DISCONNECTED';
      case 'ERROR': return 'ERROR';
      default: return 'DISCONNECTED';
    }
  }

  public subscribeData(fn: DataListener) {
    this.dataListeners.add(fn);
    return () => this.dataListeners.delete(fn);
  }

  public subscribeState(fn: StateListener) {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private notifyData(chunk: Uint8Array) {
    this.dataListeners.forEach((fn) => fn(chunk));
  }

  private notifyState(phase: ConnectionPhase, message: string, diag?: Partial<UsbDeviceDiagnostics>) {
    this.currentPhase = phase;
    this.stateListeners.forEach((fn) => fn(phase, message, diag || {}));
  }

  public async autoConnect(baudRate: number = 115200): Promise<boolean> {
    this.currentBaudRate = baudRate;

    // 1. NATIVE ANDROID ENVIRONMENT (Capacitor Host)
    if (this.isNative) {
      try {
        this.notifyState('USB_DEVICE_DETECTED', 'Scanning USB Host for Pixhawk Flight Controller...', {
          baudRate,
          driverType: 'NATIVE_ANDROID_USB'
        });

        const res = await UsbSerial.autoConnect({ baudRate });
        if (res && res.success) {
          if (res.device) this.currentDevice = res.device;
          return true;
        } else {
          const errMsg = res?.error || 'USB device not detected. Check OTG cable & phone OTG settings.';
          this.notifyState('DISCONNECTED', errMsg, {
            baudRate,
            driverType: 'NATIVE_ANDROID_USB',
            lastError: errMsg
          });
          return false;
        }
      } catch (err: any) {
        const errMsg = err?.message || 'USB Host auto-connect error';
        this.notifyState('ERROR', errMsg, {
          baudRate,
          driverType: 'NATIVE_ANDROID_USB',
          lastError: errMsg
        });
        return false;
      }
    }

    // 2. DESKTOP / WEB BROWSER FALLBACK (WebSerial)
    if (typeof navigator !== 'undefined' && 'serial' in navigator) {
      try {
        const ports = await (navigator as any).serial.getPorts();
        let port = ports.length > 0 ? ports[0] : null;

        if (!port) {
          this.notifyState('USB_DEVICE_DETECTED', 'Requesting WebSerial port access...', { driverType: 'WEBSERIAL' });
          port = await (navigator as any).serial.requestPort();
        }

        await port.open({ baudRate });
        this.webSerialPort = port;
        this.webSerialWriter = port.writable.getWriter();

        this.notifyState('SERIAL_INTERFACE_OPENED', `Serial port opened @ ${baudRate} baud`, {
          baudRate,
          driverType: 'WEBSERIAL'
        });

        this.startWebSerialReader(port);
        return true;
      } catch (err: any) {
        if (err.name === 'NotFoundError') {
          this.notifyState('DISCONNECTED', 'Serial connection cancelled by user', { driverType: 'WEBSERIAL' });
          return false;
        }
        console.warn('WebSerial error, trying WebUSB fallback:', err);
      }
    }

    // 3. WEBUSB FALLBACK
    if (typeof navigator !== 'undefined' && 'usb' in navigator) {
      try {
        let device: any = null;
        const devices = await (navigator as any).usb.getDevices();
        if (devices.length > 0) {
          device = devices[0];
        } else {
          device = await (navigator as any).usb.requestDevice({
            filters: [
              { vendorId: 0x26ac },
              { vendorId: 0x1209 },
              { vendorId: 0x0483 },
              { vendorId: 0x10c4 },
              { vendorId: 0x0403 },
              { vendorId: 0x1a86 },
              { vendorId: 0x2e3c },
              { vendorId: 0x067b },
              { vendorId: 0x303a }
            ]
          });
        }

        if (device) {
          await device.open();
          if (device.configuration === null) {
            await device.selectConfiguration(1);
          }
          const iface = device.configuration.interfaces[0];
          await device.claimInterface(iface.interfaceNumber);

          for (const ep of iface.alternate.endpoints) {
            if (ep.direction === 'in') this.webUsbInEp = ep.endpointNumber;
            if (ep.direction === 'out') this.webUsbOutEp = ep.endpointNumber;
          }

          this.webUsbDevice = device;
          this.notifyState('SERIAL_INTERFACE_OPENED', `WebUSB interface claimed for ${device.productName || 'Pixhawk'}`, {
            productName: device.productName,
            vendorId: device.vendorId,
            productId: device.productId,
            baudRate,
            driverType: 'WEBUSB'
          });

          this.startWebUsbReader(device);
          return true;
        }
      } catch (e: any) {
        this.notifyState('ERROR', e.message || 'WebUSB connection failed', { driverType: 'WEBUSB' });
        return false;
      }
    }

    this.notifyState('DISCONNECTED', 'USB device not detected. Enable OTG in phone settings and ensure cable is connected.', {
      driverType: this.isNative ? 'NATIVE_ANDROID_USB' : 'WEBSERIAL'
    });
    return false;
  }

  private async startWebSerialReader(port: any) {
    this.isReadingWebSerial = true;
    while (port.readable && this.isReadingWebSerial) {
      try {
        this.webSerialReader = port.readable.getReader();
        while (this.isReadingWebSerial) {
          const { value, done } = await this.webSerialReader.read();
          if (done) break;
          if (value && value.length > 0) {
            this.notifyData(value);
          }
        }
      } catch (e) {
        break;
      } finally {
        if (this.webSerialReader) {
          try { this.webSerialReader.releaseLock(); } catch (e) {}
          this.webSerialReader = null;
        }
      }
    }
  }

  private async startWebUsbReader(device: any) {
    this.isReadingWebUsb = true;
    while (this.isReadingWebUsb && this.webUsbDevice) {
      try {
        const result = await device.transferIn(this.webUsbInEp, 64);
        if (result.data && result.data.byteLength > 0) {
          const chunk = new Uint8Array(result.data.buffer);
          this.notifyData(chunk);
        }
      } catch (e) {
        if (!this.isReadingWebUsb) break;
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  }

  public async sendBytes(bytes: Uint8Array): Promise<boolean> {
    if (this.isNative) {
      try {
        let binaryString = '';
        for (let i = 0; i < bytes.length; i++) {
          binaryString += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binaryString);
        await UsbSerial.sendData({ data: base64 });
        return true;
      } catch (err) {
        console.warn('Native USB send error:', err);
        return false;
      }
    }

    if (this.webSerialWriter) {
      try {
        await this.webSerialWriter.write(bytes);
        return true;
      } catch (e) {
        console.warn('WebSerial send error:', e);
        return false;
      }
    }

    if (this.webUsbDevice) {
      try {
        await this.webUsbDevice.transferOut(this.webUsbOutEp, bytes);
        return true;
      } catch (e) {
        console.warn('WebUSB send error:', e);
        return false;
      }
    }

    return false;
  }

  public async disconnect(): Promise<void> {
    if (this.isNative) {
      try {
        await UsbSerial.disconnect();
      } catch (ignored) {}
    }

    this.isReadingWebSerial = false;
    if (this.webSerialReader) {
      try {
        await this.webSerialReader.cancel();
        this.webSerialReader.releaseLock();
      } catch (e) {}
      this.webSerialReader = null;
    }
    if (this.webSerialWriter) {
      try {
        this.webSerialWriter.releaseLock();
      } catch (e) {}
      this.webSerialWriter = null;
    }
    if (this.webSerialPort) {
      try {
        await this.webSerialPort.close();
      } catch (e) {}
      this.webSerialPort = null;
    }

    this.isReadingWebUsb = false;
    if (this.webUsbDevice) {
      try {
        await this.webUsbDevice.close();
      } catch (e) {}
      this.webUsbDevice = null;
    }

    this.isConnected = false;
    this.notifyState('DISCONNECTED', 'Flight Controller Disconnected', {
      driverType: this.isNative ? 'NATIVE_ANDROID_USB' : 'WEBSERIAL'
    });
  }

  public async getDiagnostics(): Promise<Partial<UsbDeviceDiagnostics>> {
    if (this.isNative) {
      try {
        const diag = await UsbSerial.getDiagnostics();
        return {
          deviceName: diag?.device?.deviceName,
          productName: diag?.device?.productName || (diag?.device?.vendorId === 0x26AC ? 'Pixhawk 2.4.8 FC' : 'USB Serial'),
          manufacturerName: diag?.device?.manufacturerName,
          vendorId: diag?.device?.vendorId,
          productId: diag?.device?.productId,
          interfaceCount: diag?.device?.interfaceCount,
          endpointIn: diag?.endpointInNumber,
          endpointOut: diag?.endpointOutNumber,
          hasPermission: diag?.hasPermission,
          baudRate: diag?.baudRate || this.currentBaudRate,
          driverType: 'NATIVE_ANDROID_USB',
          lastError: diag?.lastError
        };
      } catch (e) {
        console.warn('Diagnostics error:', e);
      }
    }

    return {
      productName: this.webUsbDevice?.productName || (this.webSerialPort ? 'Pixhawk WebSerial Port' : 'No USB Device'),
      baudRate: this.currentBaudRate,
      driverType: this.webSerialPort ? 'WEBSERIAL' : this.webUsbDevice ? 'WEBUSB' : 'SIMULATOR'
    };
  }

  public getCurrentPhase(): ConnectionPhase {
    return this.currentPhase;
  }

  public isNativePlatform(): boolean {
    return this.isNative;
  }
}

export const usbHostService = new UsbHostService();
