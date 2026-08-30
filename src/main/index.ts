import { app, BrowserWindow } from "electron";
import { electronApp, is } from "@electron-toolkit/utils";
import { join } from "node:path";
import { registerNovelIpc } from "./ipc/novel-ipc";
import { ipcMain } from "electron";
import { NovelDatabase } from "./db/database";
import { SecretVault } from "./security/secret-vault";

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#fff8f2",
    title: "Amy Novel",
    icon: join(__dirname, "../../build/icons/icon.ico"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
    },
  });
  window.on("ready-to-show", () => window.show());
  if (is.dev && process.env.ELECTRON_RENDERER_URL)
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.amy.novel");
  const database = await NovelDatabase.open(
    join(app.getPath("userData"), "amy-novel.db"),
  );
  registerNovelIpc(
    ipcMain,
    database,
    new SecretVault(join(app.getPath("userData"), "secrets.bin")),
  );
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
