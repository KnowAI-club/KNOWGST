const { app, BrowserWindow, dialog, Menu, shell } = require("electron");
const { fork } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { startGateway } = require("./gateway.cjs");
app.setName("KNOWGST");
// Explicit override is for isolated installer tests and portable test workspaces.
if (process.env.KNOWGST_DESKTOP_DATA)
  app.setPath("userData", path.resolve(process.env.KNOWGST_DESKTOP_DATA));
let service,
  gateway,
  window,
  quitting = false;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      if (process.env.KNOWGST_DESKTOP_TEST === "1") console.error(error);
      else
        dialog.showErrorBox(
          "KNOWGST could not start",
          `${error.message}\nYour business data has not been deleted.`,
        );
      app.quit();
    });
}
async function start() {
  const runtime = app.isPackaged
    ? path.join(process.resourcesPath, "runtime")
    : path.resolve(__dirname, "../../.local/desktop/runtime");
  const secret = randomBytes(32).toString("hex");
  const userData = app.getPath("userData");
  fs.mkdirSync(userData, { recursive: true, mode: 0o700 });
  const logs = path.join(userData, "desktop.log");
  if (fs.existsSync(logs) && fs.statSync(logs).size > 2 * 1024 * 1024)
    fs.renameSync(logs, logs + ".previous");
  const log = fs.openSync(logs, "a", 0o600);
  const env = {
    ...process.env,
    KNOWGST_PORT: "0",
    KNOWGST_RUNTIME: path.join(userData, "workspace"),
    KNOWGST_LOCAL_SECRET: secret,
  };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.ELECTRON_RUN_AS_NODE;
  service = fork(path.join(runtime, "server.js"), [], {
    execPath: path.join(
      runtime,
      process.platform === "win32" ? "node.exe" : "node",
    ),
    execArgv: [],
    env,
    stdio: ["ignore", log, log, "ipc"],
    windowsHide: true,
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          Error(
            "Local service startup timed out. See desktop.log in the application data folder.",
          ),
        ),
      30000,
    );
    service.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    service.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`Local service exited (${code}). See desktop.log.`));
    });
    service.on("message", (m) => {
      if (m.type === "ready") {
        clearTimeout(timer);
        resolve(m.port);
      }
    });
  });
  gateway = await startGateway({
    root: path.join(runtime, "public"),
    apiPort: port,
    secret,
  });
  window = new BrowserWindow({
    title: "KNOWGST",
    width: 1440,
    height: 960,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: "#fafbf8",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.setPermissionCheckHandler(() => false);
  const trustedContents = new Set([window.webContents.id]);
  session.webRequest.onBeforeSendHeaders(
    { urls: [gateway.origin + "/*"] },
    (details, callback) => {
      if (trustedContents.has(details.webContentsId))
        details.requestHeaders["x-knowgst-key"] = secret;
      callback({ requestHeaders: details.requestHeaders });
    },
  );
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== gateway.origin) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Report printing writes a same-origin about:blank document. PDF
    // fallbacks use locally created blob URLs; neither needs Node access.
    if (
      url === "about:blank" ||
      url === "" ||
      url.startsWith(`blob:${gateway.origin}/`)
    ) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          title: "KNOWGST document",
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
          },
        },
      };
    }
    try {
      const parsed = new URL(url);
      if (parsed.origin === gateway.origin) window.loadURL(url);
      else if (["https:", "mailto:"].includes(parsed.protocol))
        shell.openExternal(url);
    } catch {}
    return { action: "deny" };
  });
  window.webContents.on("did-create-window", (child) => {
    const id = child.webContents.id;
    trustedContents.add(id);
    child.on("closed", () => trustedContents.delete(id));
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    child.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    child.webContents.on("will-navigate", (event, url) => {
      if (url !== "about:blank" && new URL(url).origin !== gateway.origin)
        event.preventDefault();
    });
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  session.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({
      title: "Save KNOWGST document",
      defaultPath: path.join(
        app.getPath("downloads"),
        path.basename(item.getFilename()),
      ),
    });
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? [
            {
              label: "KNOWGST",
              submenu: [
                { role: "about" },
                { type: "separator" },
                { role: "quit" },
              ],
            },
          ]
        : []),
      {
        label: "File",
        submenu: [
          { label: "Open data folder", click: () => shell.openPath(userData) },
          { type: "separator" },
          { role: "close" },
          ...(process.platform === "darwin" ? [] : [{ role: "quit" }]),
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Help",
        submenu: [
          {
            label: "KNOWGST guide",
            click: () => window.loadURL(gateway.origin + "/docs/"),
          },
        ],
      },
    ]),
  );
  service.on("exit", () => {
    if (!quitting) {
      dialog.showErrorBox(
        "KNOWGST service stopped",
        "Close and reopen KNOWGST to recover the local service. Your saved records remain in the application data folder.",
      );
      app.quit();
    }
  });
  await window.loadURL(gateway.origin);
  window.show();
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  gateway?.server.close();
  if (service?.connected) {
    const timer = setTimeout(() => {
      service.kill();
      app.exit();
    }, 5000);
    timer.unref();
    service.once("exit", () => {
      clearTimeout(timer);
      app.exit();
    });
    service.send({ type: "shutdown" });
  } else {
    service?.kill();
    app.exit();
  }
});
