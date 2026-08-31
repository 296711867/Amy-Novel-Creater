import { safeStorage } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class SecretVault {
  constructor(private readonly path: string) {}
  private async read(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as Record<
        string,
        string
      >;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("密钥存储读取失败，文件可能已损坏", { cause: error });
    }
  }
  async set(id: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("系统安全存储当前不可用");
    const secrets = await this.read();
    secrets[id] = safeStorage.encryptString(value).toString("base64");
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(secrets), "utf8");
  }
  async get(id: string): Promise<string> {
    const encoded = (await this.read())[id];
    if (!encoded) return "";
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  }
  async delete(id: string): Promise<void> {
    const secrets = await this.read();
    delete secrets[id];
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(secrets), "utf8");
  }
}
