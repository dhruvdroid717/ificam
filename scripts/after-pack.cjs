const path = require('node:path');
const fs = require('node:fs');
const { rcedit } = require('rcedit');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exePath = path.join(context.appOutDir, 'iFicam.exe');
  const iconPath = path.resolve(context.packager.projectDir, 'build', 'icon.ico');
  if (!fs.existsSync(exePath) || !fs.existsSync(iconPath)) return;

  await rcedit(exePath, {
    icon: iconPath,
    'version-string': {
      CompanyName: 'Ungyani',
      FileDescription: 'iFicam',
      ProductName: 'iFicam',
      InternalName: 'iFicam',
      OriginalFilename: 'iFicam.exe',
      LegalCopyright: 'Copyright © 2026 Ungyani',
    },
    'file-version': '21.6.26.1',
    'product-version': '21.6.26.1',
  });
};

