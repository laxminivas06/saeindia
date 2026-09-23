export type TransportType = 
  | 'ANDROID_USB' 
  | 'IOS_ACCESSORY' 
  | 'WEBSERIAL' 
  | 'WEBUSB' 
  | 'UDP' 
  | 'TCP' 
  | 'SIMULATOR';

export interface TransportStateEvent {
  phase: string;
  message: string;
  device?: {
    deviceName?: string;
    productName?: string;
    manufacturerName?: string;
    vendorId?: number;
    productId?: number;
    interfaceCount?: number;
    selectedInterface?: number;
    endpointIn?: number;
    endpointOut?: number;
    hasPermission?: boolean;
    baudRate?: number;
    interfaces?: Array<{
      id: number;
      interfaceClass: number;
      interfaceSubclass: number;
      endpointCount: number;
    }>;
  };
  error?: string;
}

export interface MavlinkTransport {
  readonly id: string;
  readonly name: string;
  readonly type: TransportType;
  
  connect(options?: { baudRate?: number; host?: string; port?: number }): Promise<boolean>;
  disconnect(): Promise<void>;
  send(data: Uint8Array): Promise<boolean>;
  
  subscribeData(listener: (chunk: Uint8Array) => void): () => void;
  subscribeState(listener: (event: TransportStateEvent) => void): () => void;
  
  getDiagnostics(): Promise<Record<string, any>>;
  isAvailable(): boolean;
}
