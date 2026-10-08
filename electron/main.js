import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
} from 'electron';

import path from 'path';
import {
  fileURLToPath,
} from 'url';

import fs from 'fs';
import os from 'os';

import {
  activateLicense,
  validateLocalLicense,
} from './license/licenseManager.js';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const isDev =
  !app.isPackaged;

const PORT = 8001;

let mainWindow = null;
let stopServer = null;


/*
|--------------------------------------------------------------------------
| USER DATA
|--------------------------------------------------------------------------
*/

function getUserDataPaths() {
  const root =
    path.join(
      app.getPath('userData'),
      'POS'
    );

  return {
    root,

    dbDir:
      path.join(
        root,
        'server',
        'databases'
      ),

    dbFile:
      path.join(
        root,
        'server',
        'databases',
        'pos.sqlite'
      ),

    uploads:
      path.join(
        root,
        'uploads'
      ),

    localConfig:
      path.join(
        root,
        'local-config.json'
      ),
  };
}


function ensureDirs(paths) {
  fs.mkdirSync(
    paths.dbDir,
    {
      recursive: true,
    }
  );

  fs.mkdirSync(
    paths.uploads,
    {
      recursive: true,
    }
  );
}


/*
|--------------------------------------------------------------------------
| LOCAL CONFIG
|--------------------------------------------------------------------------
*/

function readLocalConfig(paths) {
  const defaults = {
    mode:
      'Standalone Point of Sale',

    serverIp: '',

    till: 1,

    apiPort: PORT,
  };

  try {
    if (
      fs.existsSync(
        paths.localConfig
      )
    ) {
      return {
        ...defaults,

        ...JSON.parse(
          fs.readFileSync(
            paths.localConfig,
            'utf8'
          )
        ),
      };
    }
  } catch {
    // Ignore invalid config
  }

  return defaults;
}


function writeLocalConfig(
  paths,
  config
) {
  ensureDirs(paths);

  fs.writeFileSync(
    paths.localConfig,

    JSON.stringify(
      config,
      null,
      2
    )
  );
}


/*
|--------------------------------------------------------------------------
| NETWORK
|--------------------------------------------------------------------------
*/

function getLanIp() {
  const nets =
    os.networkInterfaces();

  for (
    const name of Object.keys(nets)
  ) {
    for (
      const net of
        nets[name] || []
    ) {
      if (
        net.family ===
          'IPv4' &&
        !net.internal
      ) {
        return net.address;
      }
    }
  }

  return '127.0.0.1';
}


/*
|--------------------------------------------------------------------------
| API SERVER
|--------------------------------------------------------------------------
*/

function shouldStartServer(
  mode
) {
  return (
    mode ===
      'Standalone Point of Sale' ||
    mode ===
      'Network Point of Sale Server'
  );
}


async function startApiServer(
  paths,
  mode
) {
  if (
    !shouldStartServer(mode)
  ) {
    return null;
  }

  const {
    createServer,
  } = await import(
    '../server/index.js'
  );

  const host =
    mode ===
      'Network Point of Sale Server'
      ? '0.0.0.0'
      : '127.0.0.1';

  const expressApp =
    await createServer({
      dbPath:
        paths.dbFile,

      uploadsPath:
        paths.uploads,

      jwtSecret:
        app.getPath(
          'userData'
        ) +
        '-store-pos-jwt',
    });

  const httpServer =
    await new Promise(
      (resolve, reject) => {
        const server =
          expressApp.listen(
            PORT,
            host,
            () => {
             

              resolve(server);
            }
          );

        server.on(
          'error',
          reject
        );
      }
    );

  return () =>
    new Promise(
      (resolve) => {
        httpServer.close(
          () => resolve()
        );
      }
    );
}


/*
|--------------------------------------------------------------------------
| WINDOW
|--------------------------------------------------------------------------
*/

function createWindow() {
  const {
    width,
    height,
  } =
    screen
      .getPrimaryDisplay()
      .workAreaSize;

  const iconPath =
    fs.existsSync(
      path.join(
        __dirname,
        '..',
        'build',
        'icon.ico'
      )
    )
      ? path.join(
          __dirname,
          '..',
          'build',
          'icon.ico'
        )
      : path.join(
          __dirname,
          '..',
          'public',
          'favicon.ico'
        );

  mainWindow =
    new BrowserWindow({
      width,
      height,

      minWidth: 1100,
      minHeight: 700,

      show: false,

      icon: iconPath,

      webPreferences: {
        preload:
          path.join(
            __dirname,
            'preload.cjs'
          ),

        contextIsolation:
          true,

        nodeIntegration:
          false,

        sandbox: false,
      },
    });

  mainWindow.maximize();

  mainWindow.show();

  if (isDev) {
    mainWindow.loadURL(
      'http://127.0.0.1:5173'
    );
  } else {
    mainWindow.loadFile(
      path.join(
        __dirname,
        '..',
        'dist',
        'index.html'
      )
    );
  }

  mainWindow.on(
    'closed',
    () => {
      mainWindow = null;
      startUpdateChecks();
}
  );
}


/*
|--------------------------------------------------------------------------
| LICENSE IPC
|--------------------------------------------------------------------------
*/

ipcMain.handle(
  'license:get-status',
  () => {
    const result =
      validateLocalLicense();

   

    return result;
  }
);

ipcMain.handle(
  'license:activate',
  async (_event, licenseKey) => {
    try {
      const license =
        await activateLicense(
          licenseKey
        );

      

      return {
        success: true,
        ...license,
      };

    } catch (error) {
      console.error(
        'License activation failed:',
        error
      );

      return {
        success: false,
        message:
          error.message ||
          'License activation failed.',
      };
    }
  }
);


/*
|--------------------------------------------------------------------------
| EXISTING IPC
|--------------------------------------------------------------------------
*/

ipcMain.handle(
  'get-paths',
  () => {
    const paths =
      getUserDataPaths();

    return {
      uploads:
        paths.uploads,

      userData:
        paths.root,
    };
  }
);


ipcMain.handle(
  'get-local-config',
  () => {
    const paths =
      getUserDataPaths();

    return readLocalConfig(
      paths
    );
  }
);


ipcMain.handle(
  'set-local-config',
  (
    _event,
    config
  ) => {
    const paths =
      getUserDataPaths();

    const current =
      readLocalConfig(
        paths
      );

    const next = {
      ...current,
      ...config,
    };

    writeLocalConfig(
      paths,
      next
    );

    return next;
  }
);


ipcMain.handle(
  'get-lan-ip',
  () => {
    return getLanIp();
  }
);


ipcMain.handle(
  'get-api-info',
  () => {
    const paths =
      getUserDataPaths();

    const config =
      readLocalConfig(
        paths
      );

    const isTerminal =
      config.mode ===
      'Network Point of Sale Terminal';

    const host =
      isTerminal
        ? config.serverIp ||
          '127.0.0.1'
        : '127.0.0.1';

    return {
      baseUrl:
        `http://${host}:${config.apiPort || PORT}/api`,

      healthUrl:
        `http://${host}:${config.apiPort || PORT}/`,

      mode:
        config.mode,

      serverIp:
        config.serverIp,

      till:
        config.till,

      lanIp:
        getLanIp(),

      localServerRunning:
        shouldStartServer(
          config.mode
        ),
    };
  }
);


ipcMain.on(
  'app-quit',
  () => {
    app.quit();
  }
);


ipcMain.on(
  'app-reload',
  () => {
    if (mainWindow) {
      mainWindow.reload();
    }
  }
);

/*
|--------------------------------------------------------------------------
| AUTO UPDATE
|--------------------------------------------------------------------------
*/

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function safeCheck() {
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Update check failed:', err);
  });
}

// تُسجَّل مرة واحدة فقط (خارج createWindow) لتجنب خطأ التسجيل المكرر
autoUpdater.on('update-available', (info) =>
  sendToRenderer('update:available', info.version));
autoUpdater.on('download-progress', (p) =>
  sendToRenderer('update:progress', Math.round(p.percent)));
autoUpdater.on('update-downloaded', (info) =>
  sendToRenderer('update:downloaded', info.version));
autoUpdater.on('error', (err) => {
  console.error('Updater error:', err);
  sendToRenderer('update:error', err?.message || 'Update error');
});

ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('update:check', async () => {
  if (isDev) return;
  await autoUpdater.checkForUpdates();
});

function startUpdateChecks() {
  if (isDev) return;

  // انتظر تحميل الواجهة حتى تكون مستمعات React جاهزة
  mainWindow.webContents.once('did-finish-load', () => {
    safeCheck();
    setInterval(safeCheck, 4 * 60 * 60 * 1000);
  });
}
/*
|--------------------------------------------------------------------------
| START APPLICATION
|--------------------------------------------------------------------------
*/

app.whenReady()
  .then(async () => {

    /*
     * Create directories first.
     */
    const paths =
      getUserDataPaths();

    ensureDirs(paths);


    /*
     * Check license BEFORE
     * starting the POS server.
     *
     * IMPORTANT:
     * validateLocalLicense()
     * DOES NOT access internet.
     */
    const license =
      validateLocalLicense();


    /*
     * If not activated,
     * open the React app.
     *
     * React will display
     * the activation screen.
     */
    if (!license.valid) {
    

      createWindow();

      return;
    }


    /*
     * License is valid.
     * Continue normally.
     */
  


    const config =
      readLocalConfig(
        paths
      );

    writeLocalConfig(
      paths,
      config
    );


    /*
     * Start POS API.
     */
    try {
      stopServer =
        await startApiServer(
          paths,
          config.mode
        );

    } catch (err) {
      console.error(
        'Failed to start API server',
        err
      );
    }


    /*
     * Open application.
     */
    createWindow();


    app.on(
      'activate',
      () => {
        if (
          BrowserWindow
            .getAllWindows()
            .length === 0
        ) {
          createWindow();
        }
      }
    );
  });


/*
|--------------------------------------------------------------------------
| CLOSE
|--------------------------------------------------------------------------
*/

app.on(
  'window-all-closed',
  async () => {

    if (stopServer) {
      await stopServer();

      stopServer = null;
    }

    if (
      process.platform !==
      'darwin'
    ) {
      app.quit();
    }
  }
);


app.on(
  'before-quit',
  async () => {

    if (stopServer) {
      await stopServer();

      stopServer = null;
    }
  }
);