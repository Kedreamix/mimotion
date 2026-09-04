# mimotion

![ 刷步数](https://github.com/TonyJiangWJ/mimotion/actions/workflows/run.yml/badge.svg)
[![GitHub forks](https://img.shields.io/github/forks/TonyJiangWJ/mimotion?style=flat-square)](https://github.com/TonyJiangWJ/mimotion/forks)
[![GitHub stars](https://img.shields.io/github/stars/TonyJiangWJ/mimotion?style=flat-square)](https://github.com/TonyJiangWJ/mimotion/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/TonyJiangWJ/mimotion?style=flat-square)](https://github.com/TonyJiangWJ/mimotion/issues)
[![GitHub Pages](https://img.shields.io/badge/Pages-状态看板-ff5a1f)](https://kedreamix.github.io/mimotion/)

## 小米运动自动刷步数（支持邮箱登录）

- 小米运动自动刷步数，小米运动APP现已改名 `Zepp Life`，为方便说明，后面还是称其为小米运动。但下载注册时请搜索 `Zepp Life`。
- 注册账号后建议先去以下网站测试自己的账号刷步数是否正常（注意这些网站只是网络上收集的，不保证安全和有效性）：
    - https://steps.hubp.de/ 提示密码错误时可以多试几次 或者切换网络
    - https://bs.yanwan.store/run4/ 验证码001或998
- 如无法刷步数同步到支付宝等，建议重新注册一个新的。

### 如果觉得好用，请给一个免费的[star](https://github.com/TonyJiangWJ/mimotion/)吧

## Github Actions 部署指南

### 一、Fork 此仓库，然后创建token

#### 创建小权限的限时token，推荐

- 前往[https://github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
  创建个人token，建议使用Fine-grained tokens，避免token泄露导致不必要的麻烦。
- 填写token的名称，用于自己区别干嘛用的。
- 选择token有效期，最大时长为1年。一年后需要重新续期或重建，唯一缺点
- `Repository access` 选择 `Only select repositories` 勾选自己fork后的仓库，下拉可搜索：输入 mimotion 进行检索
- 点击 `Repository permissions` 展开菜单，并勾选以下权限即可，其他的可以不勾选
    - `Actions` Access: `Read and write` 用于获取 Actions 权限，以及参数页触发「应用新定时」「刷新看板」
    - `Contents` Access: `Read and write` 用于更新定时任务和日志文件的权限
    - `Metadata` Access: `Read-only` 这个自带的必选
    - `Workflows` Access: `Read and write` 获取用于更新 `.github/workflow` 下文件的权限
    - `Variables` Access: `Read and write` 用于参数页保存最小/最大步数和执行整点

#### 你也可以创建更大权限的不限时token

- 建议使用上面的小权限token，这个token无法指定某一个仓库的权限，也就是token一旦泄露将有可能导致其他人直接自由访问和修改你的所有仓库代码
- 前往[https://github.com/settings/tokens/new](https://github.com/settings/tokens/new)创建
- 填写token名称，选择有效期
- `Select scopes` 勾选 `repo` 和 `workflow` 即可

#### 创建完毕后点击最底下的 `Generate token` 即可生成token，复制token并自己保存一下以备后续使用，关闭当前页面后将无法再看到它。

### 二、设置账号密码

#### 前往仓库设置创建变量

- Settings-->Secrets and variables-->Actions-->New repository secret
-
快捷跳转地址 [https://github.com/${你的github用户名}/mimotion/settings/secrets/actions](../../settings/secrets/actions)
- 点击右侧的 `New repository secret` 即可添加Secret

#### 添加名为 **PAT** 的Secret变量，值为第一步申请的token

- `PAT` 的作用是拿来更新随机执行时间以及加密token数据的，为了保证正常使用，一定要配置正确。

#### 添加名为 **AES_KEY** 的Secret变量，请自行创建一个长度为16个字符的字符串作为密钥

- 注意：密钥不要用中文，长度一定要是16个字符，否则可能出错。
- 如果你有多个账号，或者希望程序自动保存登录信息，就需要设置这个 `AES_KEY`。设置之后，程序会用这个密钥把各个账号的登录token信息加密保存起来。**请一定保管好你的密钥，不要泄露。**
- 同时，请确保你已经正确配置了 PAT 密钥，否则程序无法自动保存和提交信息到仓库。
- 第一次配置 `AES_KEY` 后，运行时可能会看到提示：“密钥不正确或者加密内容损坏 放弃token”，**这是正常现象**。因为原来加密文件用的是我的密钥，和你设置的不同，所以会提示不匹配。你直接忽略它，等程序运行完后，就会用你的新密钥生成一份新的加密文件，下次运行就正常了。
- 配置 `AES_KEY` 后，每个人的仓库里面到会保存一份 `encrypted_tokens.data`。每次更新代码时，这个文件会被覆盖。**为了避免丢失你保存的信息，请在更新代码前备份这个文件**，等代码更新完，再把它放回仓库并提交，最后重新运行workflow。

#### 添加名为 **CONFIG** 的Secret变量

- 需要注意Secret变量是密文，提交后无法查看，只能删除或用新值更新，建议本地保存一下自己的配置数据方便后期修改。或者参考步骤八导出配置数据。
- 账号、密码、推送 Token 必须放在 Secret `CONFIG` 里，**不要**写到公开的 GitHub Pages。步数、整点、间隔等可以改放到仓库 Variables，运行时会覆盖 CONFIG 里的同名键；详见下方「参数怎么改」。
- CONFIG的内容：

  ```json
  {
    "USER": "abcxxx@xx.com",
    "PWD": "password",
    "MIN_STEP": "18000",
    "MAX_STEP": "25000",
    "PUSH_PLUS_TOKEN": "",
    "PUSH_PLUS_HOUR": "",
    "PUSH_PLUS_MAX": "30",
    "PUSH_WECHAT_WEBHOOK_KEY": "",
    "TELEGRAM_BOT_TOKEN": "",
    "TELEGRAM_CHAT_ID": "",
    "SLEEP_GAP": "5",
    "USE_CONCURRENT": "False"
  }
  ```

  | 字段名                     | 格式                                                                                                             |
  |-------------------------|----------------------------------------------------------------------------------------------------------------|
  | USER                    | 小米运动登录账号，仅支持小米运动账号对应的手机号或邮箱，不支持小米账号                                                                            |
  | PWD                     | 小米运动登录密码，仅支持小米运动账号对应的密码                                                                                        |
  | MIN_STEP                | 最小步数                                                                                                           |
  | MAX_STEP                | 最大步数，最大步数和最小步数随机范围随着时间线性增加，北京时间22点达到最大值                                                                        |
  | PUSH_PLUS_TOKEN         | 推送加的个人token,申请地址[pushplus](https://www.pushplus.plus/push1.html)，工作流执行完成后推送每个账号的执行状态信息，如没有则不要填写                |
  | PUSH_PLUS_HOUR          | 限制只在某个整点进行pushplus的推送，值为整数，比如设置21，则只在北京时间21点XX分执行时才进行pushplus的消息推送。如不设置或值非数字则每次执行后都会进行推送                       |
  | PUSH_WECHAT_WEBHOOK_KEY | 企业微信推送通知的key，企业微信webhook机器人推送全地址为：https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key={机器人的key}，这里配置{机器人的key} |
  | PUSH_PLUS_MAX           | 设置pushplus最大推送账号详情数，默认为30，超过30个账号将只推送概要信息：多少个成功多少个失败。因为数量太多会导致内容过长无法推送。具体最大值请自行调试                              |
  | TELEGRAM_BOT_TOKEN      | 设置telegram机器人的token，同时需要配置TELEGRAM_CHAT_ID，否则不会执行推送                                                            |
  | TELEGRAM_CHAT_ID        | 设置telegram的chatId，需要同时配置TELEGRAM_BOT_TOKEN，否则无法执行推送。关于这两个值如何获取，请前往官网查看。                                        |
  | SLEEP_GAP               | 多账号执行间隔，单位秒，如果账号比较多可以设置的短一点，默认为5秒                                                                              |
  | USE_CONCURRENT          | 是否使用多线程，实验性功能，未测试是否有效。账号多的可以试试，将它设置为True即可，启用后 `SLEEP_GAP` 将不再生效                                               |

### 三、多账户设置(如用不上请忽略)

- 多账户请用 **#** 分割 然后保存到变量 **USER** 和 **PWD**
- 理论上账户数量不受限制，但是实际要看github actions的资源和华米接口是否有限制，pushplus消息内容应该也有最大长度限制，反正具体上限请自行测试

#### 例如

```json
{
  "USER": "13800138000#13800138001",
  "PWD": "abc123qwe#abcqwe2",
  "MIN_STEP": "18000",
  "MAX_STEP": "25000",
  "PUSH_PLUS_TOKEN": "",
  "PUSH_PLUS_HOUR": ""
}
```

#### 注意 **#** 分隔的账号和密码数量必须匹配，否则将跳过执行

### 四、自定义启动时间

#### 两种方式自定义启动时间

##### 1、添加名为 `CRON_HOURS` 的Variables变量 `Settings-->Secrets and variables-->Actions-->New repository variables` 注意不是Secret

-
快捷跳转地址 [https://github.com/${你的github用户名}/mimotion/settings/variables/actions](../../settings/variables/actions)
    - 填写自动执行的时间，单位为小时，此处需要设置UTC时间，例如设置 `0,2,4,6,8,14` 则会在北京时间 `8,10,12,14,16,22` 点触发执行
- 添加完成后可以在Actions中手动触发：`Random Cron` 来触发替换，或者等下一次定时执行时它将会自动替换。

##### 2、编辑 **.github/workflows/run.yml** 中的cron表达式

- cron表达式格式如下: `分 小时 日期 月份 年份`
- github actions中执行时间为UTC时间，即**北京时间-8**，如果需要每天`8，10，12，14，16，22`
  点执行，则设置cron为`0 0,2,4,6,8,14 * * *`

  ```yaml
  on:
    schedule:
      - cron: '0 0,2,4,6,8,14 * * *'
  ```

- **注意** 如果已添加 `CRON_HOURS` 变量，则修改此文件的cron表达式会失效，在下次执行 `Random Cron`
  后表达式中小时的部分会被覆盖为 `CRON_HOURS` 配置的值

- 注意以上两种方式二选一即可，推荐直接使用方式1，变量值填写的是逗号分隔的数字，别乱填别的报错别找我！
- github actions 0点为执行高峰，排队可能会延后一两小时才执行，建议直接从2开始

### 五、手动触发测试工作流

- 前往Actions,左侧选择 `刷步数`
  ，快捷链接：[https://github.com/${你的github用户名}/mimotion/actions/workflows/run.yml](../../actions/workflows/run.yml)
- 新fork的仓库默认未启用工作流，进入Actions后点击 `I understand my workflows, go ahead and enable them`
  启用，然后左侧选择 `刷步数` 之后，再点击 `enable workflow` 启用工作流。请确保开启工作流，否则不会定时执行。
- 点击右侧的`Run workflow`触发执行，触发后刷新即可查看执行记录。验证是否正确配置并执行刷步数。

### 六、感谢列表

本项目基于 `https://github.com/xunichanghuan/mimotion(已被ban)`
和 [https://github.com/huangshihai/mimotion](https://github.com/huangshihai/mimotion) 项目修改，特此感谢

新版本登录需要加密，感谢[https://github.com/hanximeng/Zepp_API/blob/main/index.php](https://github.com/hanximeng/Zepp_API/blob/main/index.php)
里面提供的aes加密密钥。大家可以去给作者点个star

### 七、同步最新代码

- 点击仓库界面上的 `Sync fork`，找不到的话直接Ctrl+F网页查找
- 然后点击 `Update branch` 或者 `Discard xxx commits`等待同步完成即可，如有其他提示请自行按提示操作。请不要提交 **pull request**
- 当配置了 `AES_KEY` 之后，因为每个人的仓库里面到会保存一份 `encrypted_tokens.data`，更新代码会被覆盖。为了避免数据丢失，请提前备份，在更新完成后将它重新提交到仓库中，然后再触发workflow。
- 同步更新后请自己再次仔细阅读README，配置项目修改等请自行对比，更新后因为配置不正确导致无法运行请不要找我

### 八、忘记配置后的处理

- 当长时间没有使用或者忘记了配置，可以通过手动触发工作流来发送配置信息到企业微信通知中，或者telegram机器人，请务必配置在私有的企业微信或telegram群组中，避免密码等敏感信息泄露给别人
- 步骤：
  - 首先配置Secrets：`INSPECT_WECHAT_HOOK_KEY` 配置企业微信机器人的key，具体请参考企业微信机器人文档。
  - telegram配置Secrets：`INSPECT_TELEGRAM_BOT_TOKEN`和`INSPECT_TELEGRAM_CHAT_ID` 配置机器人的token和聊天chatId，具体请参考TelegramBot文档。
  - 然后点击Actions，左侧选择 `提取配置信息` 手动运行它，运行成功后，将配置信息发送到企业微信或telegram中。企业微信或者telegram的推送自己按需选择，如果都不配置，请使用日志打印的方式。
- 如果没有企业微信或telegram，可以配置Secrets: `INSPECT_AES_KEY` 注意是16位的字符串，请勿使用弱密码，避免被人猜到。
  - 在Secrets中配置后，运行上述的Actions，然后在执行结果中查看日志打印的base64字符串。
  - 提取base64字符串后，可以使用在线AES加解密网站进行解密，加密方式为CBC，填充方式为PKCS7，密钥长度128bit，密钥和偏移量（iv）均为INSPECT_AES_KEY
  - 可用网站：https://www.toolhelper.cn/SymmetricEncryption/AES
- 以上两种方式都可以提取 CONFIG，PAT，AES_KEY 三个Secrets配置，请自行选择。

## 注意事项

1. 默认每天运行6+次，由run.yml中的cron控制，分钟为随机值，执行后自动更新分钟值，随机后可能当前整点二次执行，例如：8:
   05分执行后，分钟值随机为50，则会在8:50再次执行。

- 如果配置了 `CRON_HOURS` Variable变量，则脚本将自动判断，例如8:05分执行后，将从小时中剔除8，即8:00-8:59都不会再重复执行，避免随机的步数混乱。

2. 多账户的数量和密码请一定要对上 不然无法使用!!!

3. 启动时间得是UTC时间!

4. 如果支付宝没有更新步数，到小米运动->设置->账号->注销账号->清空数据，然后重新登录，重新绑定第三方。建议去开头提到的网站测试账号是否正常

5. 小米运动不会更新步数，只有关联的会同步！！！！！

6. 请各位在使用时Fork[当前仓库](https://github.com/TonyJiangWJ/mimotion/)，防止出现不必要的bug.

7. 请注意，账号不是 [小米账号]，而是 [小米运动/ZeppLife] 的账号。

8. 最大步数和最小步数随着时间增长，10点执行时范围为10/22 \* 18000 ~ 10/22 \* 25000：8181 ~
   11363，以此类推，在北京时间22点达到最大值，即22点执行时随机步数的范围为18000-25000之间。要修改这个范围可以修改CONFIG中的MIN_STEP和MAX_STEP。

9. cron的执行根据github actions的资源进行排队，并不是百分百按指定的时间进行运行，请知悉。

10. 新版本接口有限制，同ip登录过多账号可能会429，请自行测试。

### 状态看板（GitHub Pages）

仓库带了一个简单的状态页，用来看最近刷步是否成功、当前步数、下一次定时，以及最近的刷步记录。页面只读公开数据，不会展示密码或 Secret。

「下次定时」只表示 **当前 `run.yml` 里已经写死的那一次**（对应 `cron_change_time` 里的 `next cron`）。刷步成功后 Random Cron 会重随分钟，所以时间轴只标整点，不会把同一个随机分钟套到全天。

- 访问地址：`https://<你的GitHub用户名>.github.io/mimotion/`
- 参数页：`https://<你的GitHub用户名>.github.io/mimotion/settings.html`
- 本仓库示例：[https://kedreamix.github.io/mimotion/](https://kedreamix.github.io/mimotion/)
- 由 `.github/workflows/pages.yml` 自动发布。第一次如果打不开，到 `Settings → Pages` 把 Source 选成 `GitHub Actions` 即可。

### 参数怎么改（Pages / Variables / CONFIG）

公开站点不能存密码。参数分成两层：

| 放哪里 | 字段 | 以后怎么改 |
|--------|------|------------|
| Secret `CONFIG` | `USER` `PWD` 以及各类推送 Token | 参数页复制 JSON，粘贴到 Secrets；或按步骤八导出后再改 |
| 仓库 Variables | `MIN_STEP` `MAX_STEP` `CRON_HOURS` `SLEEP_GAP` `USE_CONCURRENT` `PUSH_PLUS_HOUR` `PUSH_PLUS_MAX` | 参数页写入，或 Actions 工作流「更新参数」 |

`main.py` 会把 Variables 覆盖到 CONFIG 的同名键上：Variables 为空则继续用 CONFIG。看板目标步数读快照里的 `MAX_STEP`。

参数页会明确区分两类能力：

- **游客一次性刷步**：打开 [迈步](https://kedreamix.github.io/mimotion/dongdong.html)，填写自己的 Zepp Life 账号、密码和步数，点一次即可。不走定时任务，也不动仓库账号。
- **站长刷步只要密码**：打开 [https://kedreamix.github.io/mimotion/](https://kedreamix.github.io/mimotion/)，输入站长密码立刻刷自己的号，不用 GitHub。
- **改仓库变量才要 PAT**：参数页写入 Variables、应用定时仍走 GitHub。
- **仓库 Secret**：定时任务读 GitHub `CONFIG`。马上刷可以把同一份贴到 Worker，**不要**把 `PAT` 放到 Worker。

看板默认是**只读模式**。访客可以看公开状态，也可以用自己的 Zepp Life 账号走游客刷步。你自己立刻刷步：在看板输入**站长密码**（存在 Cloudflare Worker Secret，不写进网页）。

#### 游客刷步与站长密码（Cloudflare Worker）

游客表单和站长密码都提交到独立 Worker，**不会触发**仓库 `run.yml`，也**不会读取** GitHub `CONFIG`。

- 看板地址始终是 `https://kedreamix.github.io/mimotion/`。Worker 只是刷步接口。
- 站长刷步走 `POST /owner-run`，只带看板密码。Worker 验密码后读 Secret `CONFIG` 里的 `USER` / `PWD`，走和迈步相同的华米接口。推送字段可以一起贴着，Worker **不会发** PushPlus。Worker **不用** `PAT`。
- 游客密码只在这一次 HTTPS 请求里使用，Worker 不落盘、不写 GitHub。
- 按 IP 限流（10 分钟 8 次）。
- 本地验证：`OWNER_PASSWORD=demo CONFIG='{"USER":"a@b.com","PWD":"x"}' node worker/dev-server.mjs`
- **不要**把 `OWNER_PASSWORD` 写成 GitHub Variables / `params.json`。公开仓库里谁都能看到。
- 上线：

```bash
npx wrangler deploy
npx wrangler secret put OWNER_PASSWORD
npx wrangler secret put CONFIG
```

`PAT` 只给参数页改 Variables、应用定时用，马上刷步不需要，也**不必**再复制到 Worker。仓库 Actions 里的 `PAT` 继续给定时任务用。

若 wrangler 打印的不是 `https://mimotion.kedreamix.workers.dev`，把 `docs/guest-config.js` 里的生产地址改成你的 `*.workers.dev`。
- 允许的来源按看板地址匹配：`https://kedreamix.github.io/mimotion/`（浏览器 Origin 不含路径，Worker 会按站点 origin 放行）。
- Cloudflare 控制台允许出站域名：`api-user.zepp.com`、`account.huami.com`、`api-mifit-cn.huami.com`。

没有部署 Worker 时，游客刷步和站长密码刷步会提示接口不可用。定时任务仍走 GitHub Actions。

参数页上的「执行整点」按**北京时间**勾选，保存时自动换成 UTC 再写入 `CRON_HOURS`。例如北京 `8,10,12,14,16,22` 对应 UTC `0,2,4,6,8,14`。

三种改 Variables 的方式：

1. 打开参数页，可选填 PAT（只存在本机）。Fine-grained token 需要 `Variables: Read and write`（保存设置）和 `Actions: Read and write`（应用定时 / 刷新看板）。马上刷步不需要 PAT。
2. 不想把 PAT 放浏览器：到 Actions 手动跑 `更新参数`，它使用仓库里的 `secrets.PAT`。立刻刷步请回看板输入站长密码。
3. 直接打开 [仓库 Variables](../../settings/variables/actions) 手工填写。`CRON_HOURS` 这里必须填 UTC。

看板和参数页还接了这些接口：

- **游客刷步**：看板公开入口，使用访客自己的账号。
- **站长马上刷步**：看板输入站长密码，Worker 读 `CONFIG` 直连华米，不走 GitHub，也不发推送。
- **保存变量**：参数页写入 Variables，仍需要 GitHub PAT。
- **应用新定时**：参数页「其它工作流」，触发 `Random Cron`。
- **刷新看板**：参数页「其它工作流」，重新发布 GitHub Pages 快照。

没有接「提取配置信息」：那会把密码推到聊天里，不适合放在公开页面上。

#### 以后加一个新参数

字段清单在 `docs/params.json`，参数页按这份 schema 生成表单，**新增字段是追加，不用改 HTML**。

1. 在 `docs/params.json` 的 `tunable`（公开、可进 Variables）或 `secretConfig`（只进 CONFIG）里加一项。
2. 用参数页或「更新参数」写入这个仓库变量。刷步会通过 `REPO_VARS` 注入全部 Variables，同名键自动覆盖 CONFIG。
3. 若希望 Actions「更新参数」界面也有单独输入框，给 `.github/workflows/update-params.yml` 加一个 input；也可以只走该工作流的 `params_json`。
4. 如果 `main.py` 还没有用到这个字段，再补读取逻辑。提交后刷新参数页即可看到新表单项。

不要把 `USER` / `PWD` / Token 放到 `tunable` 或 Pages 快照里。

### 查看执行记录

- 前往 [Actions](../../actions) 可以查看所有工作流的执行历史
    - `刷步数 #41: Scheduled` 代表是定时任务触发，`刷步数 #33: Manually run by xxx` 代表手动触发
- 点击其中一条记录，可以查看执行详情，这里以 `刷步数` 为例：
    - 详情界面 `Jobs` 可以查看到一个 `build` ，点击它查看执行步骤
    - 执行步骤中主要关注 `开始` ，点击 `开始` 展开详情
    - 展开后便可以查看到执行日志，如果执行成功，则会显示每个账号当前随机的步数是多少
    - 如果执行失败，则需要根据实际情况分析具体失败原因
- 对于随机Cron的工作流 `Random Cron`，它会在 `刷步数` 执行成功后触发，执行后会更新cron表达式创建随机的分钟值，然后提交到git仓库。这一步失败的主要原因有：
    - `PAT` Secret变量，也就是个人token设置的不正确
    - `CRON_HOURS` Variable变量设置的不正确，需要逗号分隔的小时字符串例如：`1,3,4,5,6,7` 。不要添加奇奇怪怪的东西
    - 其他请见执行日志
- 随机Cron运行完毕后可以查看 `cron_change_time` 文件的内容，记录了触发方式、当前触发时间、cron表达式信息、下一次定时触发时间等信息，示例如下：
  ```log
  trigger by: workflow_run
  current system time:
  UTC: 23-06-03 12:56:53
  北京时间: 23-06-03 20:56:53
  current cron:
  UTC时间: '48 1,4,7,10,12,14 * * *'
  北京时间: '48 9,12,15,18,20,22 * * *'
  next cron:
  UTC时间: '37 1,4,7,10,12,14 * * *'
  北京时间: '37 9,12,15,18,20,22 * * *'
  next exec time: UTC(14:37) 北京时间(22:37)
  ```
