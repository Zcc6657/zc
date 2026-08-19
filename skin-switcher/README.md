# dsh-skin-switcher · 皮肤热切换器

给 DSH Web GUI 用的皮肤热切换小插件（本仓库的配套工具，非皮肤）：

- **Host 半侧**注册两个 web 路由：
  - `GET /dsh-skin/state` —— 返回已安装皮肤（从 profile 的 `link:` bundle 读 `skin.json`）与当前激活项
  - `POST /dsh-skin/switch` —— 写入 `{"target": "<skinId|none>"}`，重写**两个**用户 patch 层（profile + home），loader 的 patch watcher 热重放，无需重启
- **Client 半侧**是一个纯 DOM 的浮动"换肤"按钮（右上角），展开后可在 原皮 / 女仆工坊 / 虎鲸链路 之间点选，切完自动刷新页面。

## 安装

```sh
dsh plugin --profile web add <本仓库路径>/skin-switcher
# 重启 dsh web 一次，之后切换全部热生效
```

## 使用

- 点右上角"换肤"按钮 → 选择目标 → 页面自动刷新生效。
- 手动改文件等效操作（两个文件内容保持一致，home 层覆盖 profile 层）：
  - `~/.dsh/profiles/web/cordis.patch.yml`
  - `~/.dsh/cordis.patch.yml`

## 说明

- 切换机制与 `dsh-skin-install` 技能一致：修改 `disabled` 行，patch watcher 热应用，进程不重启。
- 本插件不包含任何皮肤素材，不注入服务/事件、不触达模型请求；仅修改用户 patch 配置文件。
- 默认面向 `web` profile；如需其他 profile，修改 `src/index.ts` 的 `PROFILE_NAME` 后重新构建。
