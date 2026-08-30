# Amy-Novel UI 设计规范

> 本规范是 UI 层的唯一标准。新增页面、改样式前先读这里；
> 所有尺寸必须使用 `styles.css` `:root` 中定义的设计令牌（Design Tokens），禁止新写裸像素值。

## 1. 设计定位

Amy-Novel 是**桌面生产力工具**（Electron），不是营销网站。设计原则按优先级：

1. **信息密度优先**：一屏放下更多有效内容，留白服务于分组而不是气派。
2. **中文排版**：标题不用负字距（letter-spacing 为拉丁字母优化）；全大写英文 kicker 每页至多一处。
3. **一致性**：同类元素（卡片、输入框、按钮、间距）在所有页面尺寸完全一致，由令牌保证。
4. **主题兼容**：只允许使用 `--bg / --surface / --muted / --border / --text / --sub / --accent / --accent2` 颜色变量，禁止硬编码颜色（状态绿 `#4ca56a`、错误红除外，见 §5）。

## 2. 设计令牌（定义于 styles.css `:root`）

### 字号阶梯

| 令牌 | 值 | 用途 |
|---|---|---|
| `--fs-hero` | 30px | 仅首页主标题 |
| `--fs-h1` | 26px | 内页标题（页面唯一） |
| `--fs-h2` | 18px | 卡片/分区标题 |
| `--fs-lead` | 15px | 页面副标题（.lead） |
| `--fs-body` | 14px | 正文默认 |
| `--fs-small` | 12px | 辅助说明、表格 |
| `--fs-kicker` | 11px | kicker/eyebrow 标签 |

正文内容区（正文预览、编辑器）可用衬线体 `Noto Serif SC`，字号 15px、行高 1.9 左右。

### 间距阶梯

| 令牌 | 值 | 用途 |
|---|---|---|
| `--pad-page` | 32px 36px | 页面容器内边距（下边距可加大容纳滚动） |
| `--pad-card` | 20px | 表单卡/面板内边距 |
| `--pad-card-sm` | 14px | 卡片内按钮、紧凑面板 |
| `--pad-control` | 9px 11px | 输入框/下拉框内边距 |
| `--gap-section` | 14px | 卡片之间、网格 gap |
| `--gap-field` | 6px | label 与控件的间距 |

字段纵向间距：表单内 label 的 `margin-bottom` 统一 14px（参考 `.form-card label`）。

### 圆角阶梯

| 令牌 | 值 | 用途 |
|---|---|---|
| `--radius-lg` | 14px | 卡片、面板外框 |
| `--radius-md` | 9px | 输入框、按钮 |
| `--radius-sm` | 7px | 小徽标、swatch |

全圆角 `border-radius:99px` 保留给状态胶囊（status-pill）。

### 布局常量（直接写值，不设令牌）

- 侧栏 232px；页面最大宽度 1280px（narrow 1040px，settings 1040px）
- 网格换行一律 `repeat(auto-fit, minmax(220px, 1fr))`，禁止写死等分列数导致末行漏空
- 卡片不设 min-height（内容撑开）；空状态容器上限 280px

## 3. 组件规则

- **卡片头 `card-head`**：每个 `form-card` 分区顶部统一用 `<header class="card-head">`（h2 + 一句 small 说明，右侧可放操作）。
- **按钮**：主按钮 `.primary`（accent 底白字）每屏至多一个；次操作 `.secondary`；危险操作 `.danger`。禁用按钮必须可解释——若依赖前置操作（如"先保存才能测试"），要么不禁用并在点击/提示区说明原因，要么旁边给出常驻提示文案，不允许"点了没反应"。
- **表单**：label 包住控件（`display:grid`），说明用 `<small>`（`--fs-small`、`--sub` 色）。
- **页内操作组 `export-actions`**：`auto-fit minmax(200px,1fr)` 网格的紧凑操作卡（图标 + 标题 + 一行说明），用于表单内的导出/备份等操作；首页 Landing 的大宣传卡 `.action-card` 仅限首页。
- **上传/拖放 `upload-zone`**：虚线边框 + muted 底 + 居中图标文案，hover 变 accent。
- **主题选择**：胶囊 chip（`theme-grid`：圆形色点 + 名称），选中 accent 描边；禁止大色块铺排。
- **统计块**：数字 `--fs-h1` 以内（19–20px），说明 `--fs-small`，禁止 25px+ 的巨型数字。
- **空状态**：`.empty-state` / `.empty-inline`，图标 + 一句话 + 可选操作链接，不铺满全屏。

## 4. 文件组织

- 全局令牌、基础组件、侧栏、主题：`styles.css`（`:root` 是令牌唯一定义处）。
- 页面特有样式：与页面同名的 `*.css`（如 `batches.css`、`bible.css`），只写页面私有布局，公共尺寸引用令牌。
- 主题切换只改变量值（`:root[data-theme=…]`），不写针对主题的布局规则。

## 5. 约定与检查清单（提交前自查）

- [ ] 没有新增裸 `font-size / padding / border-radius` 像素值（令牌覆盖不到的特例需在旁注释原因）
- [ ] 没有硬编码颜色（`#4ca56a` 成功绿、`#a13f34`/`#ffe4e1` 错误红为仅有的豁免）
- [ ] 中文标题没有负字距
- [ ] 新页面复用 `.page` / `.form-card` / `.form-row` / `.page-heading` 骨架
- [ ] 交互按钮失败/禁用路径有可见反馈
- [ ] 在 midnight 深色主题下检查过对比度
