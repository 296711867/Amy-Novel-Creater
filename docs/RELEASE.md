# Amy Novel 发布说明

## Windows 安装包

```bash
pnpm install
pnpm icons
pnpm build:win
```

安装包生成到 `release/`。当前发布目标为 Windows x64 NSIS，允许选择安装目录，并创建桌面和开始菜单快捷方式。

## 发布前检查

1. 运行 `pnpm typecheck` 与 `pnpm test`。
2. 运行 `pnpm build:web`，确认 Web 版本可构建。
3. 安装生成的 NSIS 包，验证新建作品、模型配置、批量生成和项目备份恢复。
4. 卸载默认保留用户数据；用户可先在“导出备份”中保存项目数据包。

## 当前边界

- 尚未配置代码签名，Windows 首次安装可能显示 SmartScreen 提示。
- 尚未接入自动更新；新版本通过重新下载安装包升级。
- API Key 存在当前 Windows 用户的 Electron safeStorage 文件中，不进入项目备份。
