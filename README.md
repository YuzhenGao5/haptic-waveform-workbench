# Haptic Waveform Workbench

[**打开本机工作台 · Open the local workbench**](http://127.0.0.1:61045/#designer) · [下载项目 ZIP · Download the project ZIP](https://github.com/YuzhenGao5/haptic-waveform-workbench/archive/refs/heads/main.zip)

在连接马甲的电脑上启动 `Start-A-Drag-Observer.cmd`，然后点击上方入口。首次使用请先下载并解压整个项目，或用 GitHub Desktop 克隆。

Start `Start-A-Drag-Observer.cmd` on the computer you use with the vest, then click the link above. For first-time setup, download and extract the project or clone it with GitHub Desktop.

[中文](#中文) · [English](#english)

## 中文

一个在浏览器里编排、试听和回放 bHaptics 马甲振动的本地工作台。每条波形有独立的起振时间、时长、强度曲线和马甲正背面振点。编排区右上方的 **ZH / EN** 可切换界面语言。

### 启动

1. 在 Windows 安装 **Node.js 22 或更新版本**，并让 `node` 可在终端使用。项目使用 Node.js 自带模块，无需运行 `npm install`。
2. 打开 bHaptics Player，在 Player 内连接马甲。编辑和导出波形时可以先不连接设备。 [bHaptics Player 下载与安装](https://support.bhaptics.com/en/support/solutions/articles/150000209816-install-and-set-up-bhaptics-player-for-windows-pc)
3. 双击 `Start-A-Drag-Observer.cmd`，浏览器会打开本地工作台。也可在仓库目录运行下面的命令，再点击页面顶部的入口。

```powershell
node A-Drag-Observer.mjs
```

### 编排和试听

1. 点 **新增波** 添加片段，或载入正向、反向拖尾预设。所有波形共用一张图，横轴为播放时间，纵轴为 0–100 的强度指令。
2. 点波形或颜色按钮选中它。横拖曲线调整起振时间，上下拖峰值握柄调整整条波的强度。展开 **精确编辑选中的波** 可输入时长、时间和关键帧。
3. 在右侧正背面点阵为当前波点选振点。拖预览游标检查同一时刻的输出。多个片段在同一个振点重叠时，输出取其中的最高强度。
4. 点 **播放当前设计**，下方点阵会显示发送给 Player 的实时强度指令。点 **停止** 结束本轮。

### 导入和导出

- **导入 .mjs** 可打开工作台此前导出的波形，包括起振时间、曲线和振点。浏览器读取文件中的静态 `waveform` 数据，导入后由你手动播放或继续编辑。
- **导出 .mjs 源码** 可下载包含设计和播放逻辑的单文件。在下载目录执行以下命令即可播放。终端中按 `Ctrl+C` 停止。

```powershell
node .\haptic-waveform.mjs --play
```

点阵使用 Player 的 `VestFront` 和 `VestBack` 兼容坐标，每面编号 `0–19`。体表位置及左右方向以实物校准为准。实时数值表示软件发送的指令。

## English

A local browser workbench for arranging, previewing, and replaying vibration on a bHaptics vest. Each wave specifies a start time, duration, intensity curve, and front or back motor targets. Use **ZH / EN** in the editor header to switch the interface language.

### Getting started

1. Install **Node.js 22 or later** on Windows and make `node` available in your terminal. The project uses Node.js built-in modules and requires no `npm install`.
2. Open bHaptics Player and connect the vest. A vest is optional while editing and exporting. [Download and set up bHaptics Player](https://support.bhaptics.com/en/support/solutions/articles/150000209816-install-and-set-up-bhaptics-player-for-windows-pc)
3. Double-click `Start-A-Drag-Observer.cmd` to open the local workbench, or run the command below in the repository folder and use the link at the top of this README.

```powershell
node A-Drag-Observer.mjs
```

### Arrange and preview

1. Add a wave or load a forward or reverse trail preset. Every curve shares a time axis and a 0–100 command-intensity axis.
2. Select a curve directly or through its color button. Drag the curve horizontally to change its start or drag its peak handle vertically to scale its intensity. Expand the detailed editor for exact start times, durations, and keyframes.
3. Assign front and back motors using the vest grid. Scrub the timeline to inspect overlap. If several waves drive the same motor at once, the strongest command wins.
4. Play the current design and follow the live commands in the grids below. Use **Stop** to end the preview.

### Import and export

- Import an `.mjs` file previously exported by the workbench. The browser reads its static `waveform` data and restores the schedule, curves, and motor assignments for editing or manual playback.
- Export your design as a single runnable `.mjs` file. From the download folder, run the command below to play it. Press `Ctrl+C` in the terminal to stop.

```powershell
node .\haptic-waveform.mjs --play
```

The grids use Player's `VestFront` and `VestBack` compatibility coordinates, indexed `0–19` per face. Check the mapping to physical positions on your own vest. The live display reports software commands sent to Player.

### Source layout

| File | Role |
| --- | --- |
| `A-Drag-Observer.html` | Bilingual editor, motor assignment, and live observer |
| `A-Drag-Arrangement.mjs` | Shared waveform chart and drag interactions |
| `A-Drag-Waveform.mjs` | Validation, static file import, and waveform sampling |
| `A-Drag-Observer.mjs` | Loopback HTTP server, preview control, and standalone export |
| `A-Drag-Player.mjs` | Local bHaptics Player connection and frame playback |
| `A-Drag-Preview.mjs` | Original torso presets and terminal preview |
