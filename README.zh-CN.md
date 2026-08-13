# ahub

[English](README.md) | [简体中文](README.zh-CN.md)

当前版本：**0.5.0**

在 Codex 或 Claude Code 中使用 DeepSeek 等模型，同时继承当前对话的相关上下文。

ahub 是一个支持中英文的本地控制中心和插件，用于配置模型、智能体角色、宿主上下文委派和自定义快捷预设。日常使用以自然语言为主，CLI 命令主要用于自动化。

## 核心特点

- **不离开当前对话**：Codex 从当前可见内容中选择相关上下文，通过 ahub 交给 DeepSeek，再把答案返回同一个任务。
- **密钥不污染环境**：模型密钥保存在 ahub 自己的私有凭据库中，不写入全局环境变量。
- **默认简单**：通过中英文终端菜单配置模型、智能体、宿主集成和快捷预设。
- **适合大量模型**：支持搜索、收藏、隐藏低频模型和设置一个“当前模型”。任何已注册的 OpenAI 兼容 provider 都能通过 `@ahub` 委派，不再局限于 DeepSeek。
- **上下文范围明确**：支持 `brief`、`related`、`full`、`fresh`；发送完整上下文前必须确认。超过 6 万字符的上下文会被截断，并明确告知模型它只看到部分内容。
- **委派鲁棒且透明**：回答在宿主支持时按 token 流式返回；每次调用都有超时，对限流和临时错误自动重试一次，并回传 token 用量与估算费用。常见密钥串（API key、AWS/Google/Slack/GitHub token、JWT、Bearer）会在上下文离开宿主前被抹除。
- **多轮委派线程**：被委派的模型可跨轮次续接（`threadId` / `continue`），只基于自己之前的回答；宿主可用 `recall` 取回它说过的话。委派记录保存在本地（已 gitignore、仅所有者可读；用 `delegationLog: false` 可关闭）。
- **同时支持 Codex 与 Claude Code**：可以只安装一个，也可以同时安装。
- **安全角色预设**：Architect 只分析，Coder 实现并测试，Reviewer 进行独立只读审查。

## 快速开始

需要 Node.js 20+，并已安装 Codex CLI 和/或 Claude Code。

```bash
npm install -g @haruw/ahub
ahub
```

首次运行按菜单完成：

1. 选择中文或 English。
2. 如果需要 DeepSeek，在「模型库 → Provider 连接」中连接。
3. 进入「安装集成」，将 ahub 安装到 Codex、Claude Code 或两者。
4. 新建 Codex 任务或 Claude Code 会话。

之后直接使用自然语言：

```text
@ahub 用 DeepSeek 继续分析我们刚才讨论的架构
@ahub 让 DeepSeek 独立审查这个结论，不参考前面的答案
```

## Codex APP 中使用

输入 `@` 可以选择以下入口：

- `@ahub`：通用对话、外部模型委派和状态。
- `@ahub-architect`：分析架构与方案，不修改文件。
- `@ahub-coder`：实现功能并运行测试。
- `@ahub-reviewer`：独立只读审查。
- `@ahub-config`：通过自然语言修改模型、终端和智能体默认值。

例如：

```text
@ahub-coder 用 Claude Code 自带模型修复登录问题
@ahub-reviewer 这次用便宜模型审查支付模块
@ahub-config 以后 coder 默认使用 Claude Code，并继承它自己的模型
```

安装或升级插件后请新建一个 Codex 任务。Codex 会在任务启动时加载插件技能和 MCP 工具，不需要重启整个 APP。

## 宿主上下文如何传递

ahub 不读取 Codex 内部会话文件，也不会宣称外部模型能看到宿主的隐藏状态。实际流程是：

1. Codex 根据当前请求选择必要的可见上下文。
2. ahub 再次过滤常见 API Key、Token、密码和私钥格式。
3. ahub 将任务与选定上下文发送给 DeepSeek。
4. DeepSeek 的结果返回当前 Codex 对话。

上下文模式：

- `/brief`：当前请求和必要信息，适合计算、改写和单点问题。
- `/related`：相关历史、文件和工具结果摘要，默认模式。
- `/full`：较完整的宿主可见上下文，发送前必须明确确认。
- `/fresh`：只发送当前请求，适合获得独立意见。

## 快捷预设

基础快捷词按三个维度自由组合：

- 模型：`/ds`、`/native`
- 上下文：`/brief`、`/related`、`/full`、`/fresh`
- 角色：`/analyze`、`/code`、`/review`

`/ds` 表示“当前模型”（粘性的活跃默认），不再写死为某个模型 ID。任何已连接的 provider 都能用——DeepSeek 是内置默认，你也可以注册更多。以后切换当前模型时，已有对话习惯和快捷预设不需要一起修改。

例如：

```text
@ahub /ds /fresh /review 独立审查这个方案
```

也可以运行 `ahub`，进入「快捷预设 → 新建」，把 DeepSeek + 相关上下文 + Reviewer 保存为 `/省钱审查`：

```text
@ahub /省钱审查 检查当前方案
```

当前请求中的明确自然语言指令优先级高于快捷预设。

## 终端菜单

```bash
ahub
```

```text
? ahub 控制中心
❯ ▶  运行智能体       启动 architect、coder 或 reviewer
  ⚙  智能体设置       选择默认终端和模型
  ◇  模型库           搜索、收藏和管理所有模型
  ⌁  快捷预设         组合模型、上下文和智能体角色
  ＋ 安装集成         添加到 Claude Code 或 Codex
  ●  状态与诊断       检查配置和安装状态
  文  语言            切换中文或 English
  ×  退出
```

如需脚本化安装：

```bash
ahub install claude
ahub install codex
ahub install all
```

## DeepSeek 密钥

从菜单选择「模型库 → Provider 连接 → DeepSeek → 连接」，或者运行：

```bash
ahub auth set deepseek
```

DeepSeek 是内置 provider。要使用任何其他 OpenAI 兼容端点，先注册它，再加一个指向它的模型别名，最后连接密钥——这样每个有 provider 的模型都能通过 `@ahub` 委派，不再局限于 DeepSeek：

```bash
ahub provider add acme https://api.acme.example.com --label "Acme"
ahub model set fast acme-fast --provider acme
ahub auth set acme
ahub model default fast   # 把 fast 设为 @ahub /ds 的当前模型
```

输入会被隐藏。密钥保存在 `~/.ahub/credentials.json`，文件权限为 `600`，仅注入 ahub 发起的模型请求或子进程，不会修改 Shell 环境。

```bash
ahub auth status
ahub auth remove deepseek
```

旧版项目级 `.ahub/secrets.json` 仍兼容，并具有更高优先级。

## 智能体与模型配置

普通用户建议直接运行 `ahub` 使用菜单。用于脚本和 CI 的命令包括：

### 大量模型的管理方式

ahub 把容易混在一起的四件事拆开：

1. **Provider**：已注册的 OpenAI 兼容端点（DeepSeek 内置；用 `ahub provider add` 添加更多）。只有当模型的 provider 已注册**且**已连接时，它才能在 `@ahub` 里被委派。
2. **Provider 连接**：按 provider 管理密钥和连通状态。
3. **模型库**：管理简称、显示名称、模型 ID、标签、收藏和显示状态。
4. **当前模型与使用默认值**：决定 `@ahub /ds` 和裸 `@ahub` 委派到哪个粘性“当前模型”，以及每个智能体使用哪个模型。

进入 `ahub → 模型库` 可以浏览、添加、搜索、收藏、隐藏模型或设置当前模型。隐藏不会删除配置，只是不再出现在日常选择器中。已被智能体使用的模型和收藏模型会排在前面；选择器会内联显示 provider 和标签，模型超过 8 个后自动支持输入搜索。

```bash
ahub agent list
ahub model list

ahub agent set coder cli claude
ahub agent set coder model inherit

ahub model set myfast my-fast-model
ahub agent set coder model myfast
```

脚本化管理模型库：

```bash
ahub model favorite myfast
ahub model default myfast
ahub model hide old-model
ahub model show old-model
ahub model remove old-model
```

模型选择优先级：当前请求明确指定的模型 → 智能体默认模型 → Claude Code 或 Codex 自己配置的原生模型。

## 高级自动化

ahub 可以保存本地会话、任务和智能体运行结果，并按范围把前序结果交给后续智能体：

```bash
ahub session create auth
ahub task add auth "修复 refresh-token 竞争问题"

ahub run claude auth "分析 refresh-token 实现"
ahub run codex auth "实现上一步分析" --context summary
ahub run claude auth "审查 Codex 的修改" --context session
```

自动化上下文模式：

- `task`：当前任务和未完成任务，不包含之前运行结果。
- `summary`：最多 3 个成功结果，默认值。
- `session`：最多 12 个成功结果。
- `full`：当前本地会话中的全部成功结果。

失败结果不会被后续智能体继承。

## 本地开发

```bash
git clone https://github.com/werwrer/ahub.git
cd ahub
npm install
npm test
npm link
ahub doctor
```

取消全局链接：

```bash
npm unlink -g @haruw/ahub
```

## 存储与安全

- 项目状态保存在 `.ahub/state.json`，采用原子写入。
- `.ahub/`、`.agenthub/`、环境文件和打包产物默认不会提交到 Git。
- ahub 不绕过 Codex 或 Claude Code 自己的权限与沙箱。
- 请只在你信任的工作区中运行具有写权限的 Coder。

## 当前范围

当前已包含：Codex/Claude Code 插件安装、DeepSeek 宿主上下文委派、三类智能体、模型与快捷预设配置、本地会话和任务、上下文继承、诊断、离线演示和自动化测试。

暂未包含：实时双向 Agent 邮箱、并行冲突自动合并、语义检索、长期记忆和 Web 控制台。

## 许可证

[MIT](LICENSE)
