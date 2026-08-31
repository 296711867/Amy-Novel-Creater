// @vitest-environment jsdom
/**
 * Web 适配的契约入口：webPlatform（IndexedDB 存储）接入同一组共享契约
 * 用例，与 Electron 数据适配（tests/contract/electron-port.test.ts）
 * 断言完全一致的 DTO 与错误语义。
 */
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { webPlatform } from "../../src/renderer/src/platform/web-platform";
import {
  registerPlatformPortContract,
} from "../contract/platform-port.contract";

describe("Web（webPlatform + IndexedDB）", () => {
  registerPlatformPortContract("Web", () => webPlatform);
});
