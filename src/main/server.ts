import express from 'express';
import https from 'node:https';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { getOrCreateCertificate } from './cert';
import { getLanAdapters, pickAdapter, type LanAdapter } from './network';
import { attachSignaling } from './signaling';

export interface IFiCamServerInfo {
  url: string;
  certUrl: string;
  port: number;
  lanIp: string;
  adapterName: string;
  certPath: string;
  pin: string;
  qrDataUrl: string;
  adapters: LanAdapter[];
}

export interface IFiCamServer {
  info: IFiCamServerInfo;
  close: () => Promise<void>;
}

const PORT = 8443;

const generatePin = (): string => String(Math.floor(1000 + Math.random() * 9000));

const createBrandedQrDataUrl = async (value: string): Promise<string> => {
  const qrSvg = await QRCode.toString(value, {
    type: 'svg',
    margin: 1,
    width: 360,
    errorCorrectionLevel: 'H',
    color: { dark: '#0B0D10', light: '#FFFFFF' },
  });
  const badge = `
    <g>
      <rect x="126" y="139" width="108" height="82" rx="18" fill="#ffffff"/>
      <rect x="132" y="145" width="96" height="70" rx="15" fill="#0B0D10"/>
      <text x="180" y="178" text-anchor="middle" font-family="Segoe UI, Nirmala UI, Arial, sans-serif" font-size="17" font-weight="800" fill="#ffffff">UN</text>
      <text x="180" y="199" text-anchor="middle" font-family="Nirmala UI, Mangal, Segoe UI, Arial, sans-serif" font-size="15" font-weight="700" fill="#ffffff">ज्ञानी</text>
    </g>`;
  const brandedSvg = qrSvg.replace('</svg>', `${badge}</svg>`);
  return `data:image/svg+xml;base64,${Buffer.from(brandedSvg, 'utf8').toString('base64')}`;
};

export const createIFiCamServer = async (userDataPath: string, preferredIp?: string): Promise<IFiCamServer> => {
  const adapter = pickAdapter(preferredIp);
  const cert = await getOrCreateCertificate(userDataPath, adapter.address);
  const pin = generatePin();
  const app = express();
  const phoneRoot = resolvePhoneRoot();

  app.get('/health', (_req, res) => {
    res.json({ ok: true, name: 'iFicam', secure: true, lanIp: adapter.address });
  });

  app.get('/ificam-cert.crt', (_req, res) => {
    res.type('application/x-x509-ca-cert');
    res.attachment('ificam-cert.crt');
    res.send(cert.cert);
  });

  app.use(express.static(phoneRoot));
  app.get('*', (_req, res) => {
    res.sendFile(join(phoneRoot, 'index.html'));
  });

  const httpsServer = https.createServer({ key: cert.key, cert: cert.cert }, app);
  const wss = attachSignaling(httpsServer, pin);

  await new Promise<void>((resolve, reject) => {
    httpsServer.once('error', reject);
    httpsServer.listen(PORT, '0.0.0.0', () => {
      httpsServer.off('error', reject);
      resolve();
    });
  });

  const url = `https://${adapter.address}:${PORT}`;
  // Embed the PIN in the QR URL fragment so scanning pre-fills it; manual typists
  // still see the PIN in plain text on screen.
  const qrDataUrl = await createBrandedQrDataUrl(`${url}/#pin=${pin}`);

  const info: IFiCamServerInfo = {
    url,
    certUrl: `${url}/ificam-cert.crt`,
    port: PORT,
    lanIp: adapter.address,
    adapterName: adapter.name,
    certPath: cert.certPath,
    pin,
    qrDataUrl,
    adapters: getLanAdapters(),
  };

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close(() => {
        httpsServer.close(() => resolve());
      });
    });

  return { info, close };
};

const resolvePhoneRoot = (): string => {
  const devRoot = join(process.cwd(), 'src', 'phone');
  if (existsSync(join(devRoot, 'index.html'))) {
    return devRoot;
  }

  const packagedRoot = join(process.resourcesPath, 'phone');
  if (existsSync(join(packagedRoot, 'index.html'))) {
    return packagedRoot;
  }

  return join(__dirname, '../phone');
};
