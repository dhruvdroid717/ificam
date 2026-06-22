import os from 'node:os';

export interface LanAdapter {
  name: string;
  address: string;
}

const VIRTUAL_ADAPTER_PATTERN = /nord|vpn|wireguard|wintun|tailscale|zerotier|virtual|vmware|hyper-v|loopback/i;

const isPrivateLanIp = (address: string): boolean =>
  address.startsWith('192.168.') ||
  address.startsWith('10.') ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(address);

export const getLanAdapters = (): LanAdapter[] => {
  const adapters = os.networkInterfaces();
  const results: LanAdapter[] = [];

  for (const [name, addresses] of Object.entries(adapters)) {
    if (VIRTUAL_ADAPTER_PATTERN.test(name)) continue;
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal && isPrivateLanIp(address.address)) {
        results.push({ name, address: address.address });
      }
    }
  }

  return results.sort((a, b) => scoreAdapter(b) - scoreAdapter(a));
};

export const getPrimaryLanAdapter = (): LanAdapter => {
  const adapters = getLanAdapters();

  if (!adapters[0]) {
    throw new Error('No active IPv4 LAN adapter was found. Connect this PC to WiFi or Ethernet and relaunch iFicam.');
  }

  return adapters[0];
};

export const pickAdapter = (preferredIp?: string): LanAdapter => {
  const adapters = getLanAdapters();

  if (!adapters[0]) {
    throw new Error('No active IPv4 LAN adapter was found. Connect this PC to WiFi or Ethernet and relaunch iFicam.');
  }

  if (preferredIp) {
    const match = adapters.find((adapter) => adapter.address === preferredIp);
    if (match) {
      return match;
    }
  }

  return adapters[0];
};

const scoreAdapter = (adapter: LanAdapter): number => {
  const name = adapter.name.toLowerCase();
  let score = 0;
  if (name.includes('wi-fi') || name.includes('wifi') || name.includes('wireless')) score += 4;
  if (name.includes('ethernet')) score += 3;
  if (adapter.address.startsWith('192.168.')) score += 2;
  if (adapter.address.startsWith('10.')) score += 1;
  return score;
};
