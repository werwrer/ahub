# ahub

[English](README.md) | [简体中文](README.zh-CN.md)

当前版本：**0.6.1**

在 Codex 或 Claude Code 里使用 DeepSeek 及其它模型，不丢失当前对话的上下文。

ahub 是一个双语本地控制中心和插件，负责模型路由、智能体角色、宿主上下文委派和可复用快捷预设。自然语言是主要交互方式；终端命令用于自动化。

## 核心特点

- **不离开当前对话** — Codex 选取它已经可见的相关上下文，通过 ahub 发给 DeepSeek，并把答案送回同一个任务。
- **凭据私有** — provider 密钥存放在 ahub 仅所有者可读的凭据库中，永不写入全局环境变量。
- **默认简单** — 用中英文终端菜单配置模型、智能体、集成和快捷预设。
- **适合大量模型** — 搜索模型、收藏常用项、隐藏噪音项、设置一个「当前模型」。任何已注册的 OpenAI 兼容 provider 都能通过 `@ahub` 委派，不再局限于 DeepSeek。
- **上下文范围明确** — 可选 `brief`、`related`、`full`、`fresh`；共享完整上下文前必须确认。超过 6 万字符的上下文会被截断，并明确告知模型它只看到了部分内容。
- **委派鲁棒且透明** — 宿主支持时回答按 token 流式返回；每次调用都有超时，对限流和临时错误自动重试一次，并回传 token 用量与估算费用。常见密钥串（API key、AWS/Google/Slack/GitHub token、JWT、Bearer）会在上下文离开宿主前被抹除。
- **多轮委派线程** — 被委派的模型可以跨轮次续接（`threadId` / `continue`），只基于自己之前的回答；宿主可用 `recall` 取回它说过的话。委派记录保存在本地（已 gitignore、仅所有者可读；用 `delegationLog: false` 可关闭）。
- **同时支持 Codex 与 Claude Code** — 可以只安装一个，也可以同时安装。
- **安全角色预设** — Architect 只分析，Coder 实现并测试，Reviewer 进行独立只读审查。

## 快速开始

需要 Node.js 20+，以及 Claude Code 和/或 Codex CLI。

面向使用者：

```bash
npm install -g @haruw/ahub
ahub
```

在引导菜单里：

1. 选择 中文 或 English。
2. 如果要使用 DeepSeek，在「模型库 → Provider 连接」中连接。
3. 选择「安装集成」，把 ahub 安装到 Codex、Claude Code 或两者。
4. 新建一个 Codex 任务或 Claude Code 会话。

然后用自然语言：

```text
@ahub Use DeepSeek to continue analyzing the architecture we just discussed
@ahub Ask DeepSeek for an independent review without using the previous answer
```

首次运行会先询问 中文 或 English，然后进入三步设置向导：选择编程终端、选择模型、安装集成。语言按项目保存，随时可在控制中心的「Language / 语言」里修改。全程只用 ↑/↓ 和回车，无需记忆任何命令。

ahub 只有确认模型真的能运行时才会称其「就绪」。选择 DeepSeek 会进入一个引导流程：安全接收密钥、验证连接、存入 ahub 私有凭据库、再分配模型。密钥跨 ahub 项目可用，但永远不会写入你的 shell 环境。

在 Codex APP 里，ahub 插件通过内置的 MCP 工具直接委派：Codex 选取它已可见的相关上下文，ahub 抹除常见密钥模式，DeepSeek 作答，结果送回同一任务。ahub 从不抓取 Codex 内部的 transcript 文件。

推荐使用自然语言：

```text
@ahub 用 DeepSeek 继续分析我们刚才讨论的方案
@ahub 请让 DeepSeek 独立审查这个结论，不参考前面的答案
```

可选的快捷方式在三个独立维度上组合：

- 模型：`/ds`、`/native`
- 上下文：`/brief`、`/related`、`/full`、`/fresh`
- 工作模式：`/analyze`、`/code`、`/review`

`/ds` 指向你的「当前模型」（粘性的活跃默认），切换它无需重新学习命令或修改每条提示。任何已连接的 provider 都能用——DeepSeek 是内置默认，你也可以注册更多。

例如 `@ahub /ds /fresh /review 审查这个结论` 会请 DeepSeek 做一次不带历史的独立审查。完整上下文委派始终需要确认。想把「DeepSeek + 相关上下文 + Reviewer」存成 `/省钱审查`，打开 `ahub` 菜单里的「快捷预设 / Shortcut presets」即可——不需要记任何命令语法。

从源码仓库开发：

```bash
npm install
npm link
ahub init
ahub doctor
```

在源码目录里 `npm link` 会把 `ahub` 命令全局安装。之后可用 `npm unlink -g ahub` 移除链接。

## 终端菜单

```bash
ahub
```

```text
当前项目
  智能体           终端     模型
  architect       claude   inherit
  coder           codex    ds4f
  reviewer        claude   inherit

  Provider        状态
  DeepSeek        ● 已连接

  当前模型  DeepSeek V4 Flash (ds4f) · $0.14/M

? 控制中心
❯ ＋ 添加模型 / Provider  一步向导：供应商 → 模型 → key → 收尾
  ▶  运行智能体          启动 architect、coder 或 reviewer
  ⚙  智能体设置          选择默认终端和模型
  ◇  模型库              搜索、收藏和管理所有模型
  ⌁  快捷预设            组合模型、上下文和智能体角色
  ＋ 安装集成            添加到 Claude Code 或 Codex
  ●  状态与诊断          检查配置和安装状态
  文  语言 / Language    切换中文或 English
  ×  退出
```

设置向导处理初始流程：

1. 配置 `architect`、`coder` 和 `reviewer`。
2. 选择模型和项目凭据。
3. 把配置好的 ahub 插件安装到 Claude Code、Codex 或两者。
4. 在「状态与诊断」里核对一切。
5. 每次操作后自动返回控制中心。

三个角色有安全默认值：`architect` 负责分析，`coder` 负责编辑和测试，`reviewer` 负责独立审查。

需要脚本化而不是菜单时，可直接安装 CLI 集成：

```bash
ahub install claude
ahub install codex
ahub install all
```

Claude Code 在新会话或执行 `/reload-plugins` 后加载 ahub；Codex 在新任务中加载。

新建一个 Codex 任务并提问：

```text
@ahub ask the architect to analyze this project
```

在 Codex 或 GPT 应用里输入 `@` 会显示五个带命名空间的快捷入口：

- `@ahub-architect` — 分析与设计，不修改文件。
- `@ahub-coder` — 实现改动并运行测试。
- `@ahub-reviewer` — 进行独立只读审查。
- `@ahub-config` — 在对话中配置智能体、终端和模型。
- `@ahub` — 通用协调与状态。

自然语言是主要交互方式：

```text
@ahub-coder 用 Claude Code 自带的模型修复登录问题
@ahub-reviewer 这次用便宜模型审查支付模块
@ahub-config 以后 coder 默认使用 Claude Code，并继承它自己的模型配置
@ahub-config 添加一个叫 fast 的模型，模型 ID 是 my-fast-model
```

「这次」只影响一次请求。「以后」或「默认」会持久修改智能体配置。ahub 会用自然语言确认持久化改动。

宿主上下文委派使用上面这套小而可组合的词汇。下面这些更早的终端自动化别名仍然兼容，但不再是推荐的宿主内交互方式：

```text
@ahub-coder /cc Fix all lint errors
@ahub-coder /ds4f /cx Fix all lint errors
@ahub-architect /ds4f /cc Analyze this architecture
@ahub-reviewer /best Review the payment changes
```

命令可组合，代表彼此独立的维度：

- `/ds4f`、`/cheap`、`/flash`、`/省钱` 选择 `deepseek-v4-flash`。
- `/cc` 选择 Claude Code 终端。
- `/cx` 选择 Codex 终端。
- 不带 `/cc` 或 `/cx` 时，所选智能体沿用它的默认终端。
- 不带模型命令时，ahub 不传模型覆盖，Claude Code 或 Codex 使用该终端里已配置的模型。

也就是说 `@ahub-coder /cc Fix the tests` 使用 Claude Code 及其自带模型；只有 `@ahub-coder /ds4f /cc Fix the tests` 才会显式把模型覆盖为 DeepSeek V4 Flash。

从终端菜单选择「模型库 → Provider 连接 → DeepSeek → 连接」。ahub 会先验证密钥再保存，然后询问是否把 DeepSeek 分配给某个智能体。等价的脚本命令是：

```bash
ahub auth set deepseek
```

DeepSeek 是内置 provider。常见 provider 用 `ahub provider add <name>` 注册时会**自动带上默认 Base URL**——之后只需要填 API key（`ahub provider catalog` 可查看目录；菜单里也有同样的选择器）。其它 OpenAI 兼容端点则手动传入 Base URL：

```bash
ahub provider add openai     # 已知 provider —— 默认 Base URL 自动填好
ahub auth set openai         # 只需 key

ahub provider add acme https://api.acme.example.com --label "Acme"   # 自定义端点
ahub model set fast acme-fast --provider acme
ahub auth set acme
ahub model default fast   # 把 fast 设为 @ahub /ds 的当前模型
```

输入会被隐藏。密钥保存在 `~/.ahub/credentials.json`（权限 600），仅注入所选子进程，不会修改 shell 环境。用 `ahub auth status` 查看、用 `ahub auth remove deepseek` 删除。旧的项目级 `.ahub/secrets.json` 密钥仍然受支持并优先。

旧式终端自动化仍可定义底层命令，无需手改 JSON：

```bash
ahub command set /省点 profile:cheap
ahub command set /克劳德 cli:claude
ahub command set /考德克斯 cli:codex
```

然后使用 `@ahub-coder /省点 /考德克斯 Fix the tests`。

Codex APP 的宿主上下文委派建议改用终端菜单创建一个可读的预设：

```text
ahub → 快捷预设 → 创建
名称：/省钱审查
模型：DeepSeek V4 Flash
上下文：相关
角色：Reviewer
```

然后在 Codex 里输入 `@ahub /省钱审查 检查当前方案`。预设只是偏好，不是隐藏提示：当前请求里显式的自然语言指令优先级更高。

## 高级自动化

菜单是常规界面，以下命令用于脚本和 CI：

```bash
ahub session create auth
ahub task add auth "Fix refresh-token races"

ahub run claude auth "Analyze the refresh-token implementation"
ahub run codex auth "Implement the previous analysis" --context summary
ahub run claude auth "Review Codex's implementation" --context session

ahub session show auth
```

用完整 ID 或 `task list` 打印出的短前缀来标记任务完成：

```bash
ahub task done auth 12ab34cd
```

用 `mock` 验证完整协调链路而无需调用付费模型：

```bash
ahub demo
```

## 上下文模式

- `task`：当前任务和待办列表；不含此前智能体的结果。
- `summary`：最多 3 条此前成功结果。这是默认值。
- `session`：最多 12 条此前成功结果。
- `full`：全部成功结果。

每次运行都会记录上下文清单（manifest），说明它继承了哪些更早的运行。失败的输出永远不会被继承。

## 配置

直接打开设置：

```bash
ahub config
```

菜单会询问使用哪个智能体、终端和模型。DeepSeek 设置与项目凭据也在这里。

### 大量模型的管理方式

ahub 把容易混在一起的四件事拆开：

1. **Provider** — 已注册的 OpenAI 兼容端点（DeepSeek 内置；用 `ahub provider add` 添加更多）。只有 provider 已注册**且**已连接时，模型才能在 `@ahub` 里被委派。
2. **Provider 连接** — 按 provider 管理密钥和连通状态。
3. **模型库** — 别名、显示名称、模型 ID、标签、收藏和可见性。
4. **当前模型与使用默认值** — `@ahub /ds` 和裸 `@ahub` 委派到的粘性当前模型，以及每个智能体使用的模型。

打开 `ahub → 模型库` 可以浏览、添加、搜索、收藏、隐藏模型或设置当前模型。隐藏不会删除配置，只是不再出现在日常选择器中。已被智能体使用的模型和收藏模型会排在前面；选择器内联显示 provider 和标签，模型超过 8 个后自动支持输入搜索。

下面的命令是脚本接口，普通用户不需要。列出当前值：

```bash
ahub agent list
ahub model list
```

选择某个智能体使用的终端，同时保留该终端自己的模型配置：

```bash
ahub agent set coder cli claude
ahub agent set coder model inherit
```

创建可复用模型别名，并把它设为 coder 的持久覆盖：

```bash
ahub model set myfast my-fast-model
ahub agent set coder model myfast
```

用脚本管理模型库：

```bash
ahub model favorite myfast
ahub model default myfast
ahub model hide old-model
ahub model show old-model
ahub model remove old-model
```

随时把模型改回 Claude Code 或 Codex 的终端默认：

```bash
ahub agent set coder model inherit
```

选择优先级为：当前请求里的模型命令 → 智能体配置的模型 → 终端 CLI 自带的模型配置。运行 `ahub config` 查看完整生效配置。

高级用户也可以直接编辑 `.ahub/config.json`：

```json
{
  "models": {
    "myfast": { "model": "my-fast-model" }
  },
  "agents": {
    "architect": { "cli": "claude", "model": "inherit" },
    "coder": { "cli": "codex", "model": "myfast" },
    "reviewer": { "cli": "claude", "model": "inherit" }
  }
}
```

未指定的值保持安全默认。配置在每次运行时加载，改动立即生效。

## 存储与安全

项目状态保存在 `.ahub/state.json`，原子写入。旧的 `.agenthub` 状态会自动迁移。状态与旧 `.ahub/secrets.json` 凭据会被 Git 忽略，因为提示词、模型输出和凭据可能是私密的。用 `ahub auth set` 保存的 provider 密钥只存在于 ahub 仅所有者可读的凭据库中，永不写入状态、模型配置或 shell 环境。委派记录保存在 `.ahub/delegations.jsonl`（仅所有者可读、已 gitignore、自动压缩），可用配置 `delegationLog: false` 关闭，也可在对话中用 `forget` 工具清除。

此 MVP 让 Codex 运行在其 `workspace-write` 沙箱中、Claude 运行在 `acceptEdits` 下。请只在你信任的工作区里使用。ahub 不会绕过任何一方的沙箱。

## 当前范围

已包含：本地会话、只追加事件记录、任务、Claude/Codex 适配器、上下文继承、运行清单、失败持久化、诊断、离线演示和测试。

暂缓：实时双向信箱、并行冲突解决、语义检索、长期记忆、Web UI 和更多运行时。

## 本地开发

```bash
git clone https://github.com/werwrer/ahub.git
cd ahub
npm install
npm test
npm link
ahub doctor
```

用 `npm unlink -g @haruw/ahub` 移除全局开发链接。

## 许可证

[MIT](LICENSE)
