import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import selfsigned from 'selfsigned';

export interface CertificateBundle {
  key: string;
  cert: string;
  lanIp: string;
  certPath: string;
}

interface CachedCertificate {
  key: string;
  cert: string;
  lanIp: string;
}

export const getOrCreateCertificate = async (userDataPath: string, lanIp: string): Promise<CertificateBundle> => {
  const certPath = join(userDataPath, 'certs', 'ificam-cert.crt');
  const cachePath = join(userDataPath, 'certs', 'ificam-cert.json');

  try {
    const cached = JSON.parse(await readFile(cachePath, 'utf8')) as CachedCertificate;
    if (cached.lanIp === lanIp && cached.key && cached.cert) {
      return { ...cached, certPath };
    }
  } catch {
    // Missing or unreadable cache is fine; generate below.
  }

  const attrs = [{ name: 'commonName', value: lanIp }];
  const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'basicConstraints',
        cA: true,
      },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        keyEncipherment: true,
      },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 7, ip: lanIp },
          { type: 2, value: 'ificam.local' },
        ],
      },
    ],
  });

  const bundle: CachedCertificate = {
    key: pems.private,
    cert: pems.cert,
    lanIp,
  };

  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(bundle, null, 2), 'utf8');
  await writeFile(certPath, bundle.cert, 'utf8');

  return { ...bundle, certPath };
};
