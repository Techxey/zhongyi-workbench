# 第三方项目、数据与许可标注

本项目在开发过程参考、使用了以下第三方项目与公开数据。**如果你要再分发本项目（尤其是数据部分），请连同本文件一起保留。**

> 说明：本项目仓库**不包含**任何古籍原文文件与第三方数据集文件；古籍/方剂数据仅在本地导入数据库（`prisma/dev.db`，被 `.gitignore` 排除）。仓库中只保留导入脚本与自行整理的示例 CSV。

## 一、被引用的 GitHub 项目（重点标注）

### 1. xiaopangxia/TCM-Ancient-Books

- 地址：<https://github.com/xiaopangxia/TCM-Ancient-Books>
- 作者：xiaopangxia
- 简介：中医药古籍文本，近 700 部（本项目导入实测 **701 部**）
- **许可状态**：仓库**未声明开源许可**（GitHub API `license: null`）。
- 本项目如何使用：
  - 只使用其中属于**公有领域（Public Domain）的古代文献正文**（作者逝世远超版权保护期，如《伤寒论》《金匮要略》《医宗金鉴》等）；
  - 通过 `scripts/import-classics.mjs` 导入本地 `kb_items` / `kb_item_bodies` 表，并用 `scripts/build-classic-fts.mjs` 建 FTS5 全文索引；
  - **仓库不包含、也不再分发这些 txt 原文**；仓库只提供导入脚本（使用者需自行获取古籍文本）。
  - 未复制该仓库的整理说明、校注、标点等可能构成演绎作品的内容。
- 由于上游仓库未声明许可，若你是该仓库作者并认为此处使用方式不妥，请开 Issue 或联系维护者，我们会在核实后移除导入脚本中的相关默认路径/说明或调整文档。
- 建议后续使用者：自行确认文本来源的许可与准确性；本项目的古籍数据仅供检索参考，不能作为校勘定本。

### 2. lin-haust/TCM-prescription-datasets

- 地址：<https://github.com/lin-haust/TCM-prescription-datasets>
- 作者：lin-haust
- 简介：中医方剂数据集（方剂类别、组成、剂量、出处等）
- **许可状态**：仓库**未声明开源许可**（GitHub API `license: null`）。
- 本项目如何使用：仅在设计 `data/seed/formulas.csv` 的字段组织与校验思路上做参考（方名、别名、出处、组成、功效、主治、用法、禁忌、方解、备注），**未复制其数据行**。CSV 内容为按公版古籍通行内容自行整理与改写。
- 如需引用其数据，请先向原作者取得授权。

### 3. 其它参考（非 GitHub 项目）

- **维基文库（中文）** <https://zh.wikisource.org/>：公版古籍页面用于检索核对。页面本身以 CC BY-SA 授权，但其收录的古籍原文属公有领域；本项目未复制页面上的校注与标点说明。
- **中国哲学书电子化计划 ctext** <https://ctext.org/>：公版古籍检索核对，未复制页面内容。
- **《中药学》**（中国中医药出版社，规划教材）与 **《中国药典》2020 年版一部**：仅参考「药名、性味、归经、剂量区间」等通用事实/标准术语口径，行文为自行改写，未整段复制受版权保护的表述。
- 未使用任何付费数据库（药智数据、米内网、医脉通、中医智库、中华医典商业版等），未抓取任何网站整体内容。

## 二、npm 依赖

主要运行期依赖及其许可（以各包 `package.json` 与 `LICENSE` 为准）：

| 依赖 | 许可 | 项目地址 |
| --- | --- | --- |
| next | MIT | <https://github.com/vercel/next.js> |
| react / react-dom | MIT | <https://github.com/facebook/react> |
| @prisma/client / prisma | Apache-2.0 | <https://github.com/prisma/prisma> |
| tailwindcss / @tailwindcss/postcss | MIT | <https://github.com/tailwindlabs/tailwindcss> |
| jose | MIT | <https://github.com/panva/jose> |
| bcryptjs | MIT | <https://github.com/dcodeIO/bcrypt.js> |
| pinyin-pro | MIT | <https://github.com/zh-lx/pinyin-pro> |
| zod | MIT | <https://github.com/colinhacks/zod> |
| typescript | Apache-2.0 | <https://github.com/microsoft/TypeScript> |
| playwright-core（开发/测试） | Apache-2.0 | <https://github.com/microsoft/playwright> |

完整依赖清单见 `pnpm-lock.yaml`。`pnpm licenses list` 可生成完整许可列表。

## 三、字体

界面使用 `Noto Sans SC` / `Noto Serif SC` 作为首选字体（经 CSS `font-family` 调用，**不随本项目分发字体文件**）。字体本身采用 SIL Open Font License 1.1；如系统未安装会回退到系统字体。若要精确复现设计稿，请自行安装 Noto 字体（OFL 允许免费使用与分发）。

## 四、桌面打包与构建工具

- **.NET Framework `csc.exe`**：Windows 自带编译器，用于编译 `packaging/src/*.cs` 启动器/托盘/安装器；本项目**不随包分发 csc**，仅构建时调用。
- **Microsoft Edge**：桌面版优先用系统自带 Edge 的 `--app` 无边框窗口展示界面；**不随包分发 Edge**，缺失时回退到默认浏览器。
- **Playwright**（`playwright-core`）：仅用于开发期截图与端到端回归测试。
- **SQLite**：经 Prisma 使用，SQLite 属公有领域。

## 五、本项目自身许可

- **代码**：[MIT](../LICENSE) © 2026 左晋（Techxey）
- **`data/seed/` 示例数据与文档**：CC BY 4.0 —— 可自由使用/修改/再分发，请注明来源（本项目链接）与作者。
- 若你引入本项目的代码或数据，建议在 README/关于页注明：
  「本项目基于 中医诊所工作台（https://github.com/<your-account>/zhongyi-workbench），MIT / CC BY 4.0」。
