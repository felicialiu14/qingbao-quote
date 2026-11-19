# 管理后台部署

此升级保留 GitHub Pages 报价网址，使用独立 Supabase 项目保存访问统计。当前配置已连接本站后台；复制或部署到其他站点时，应先把 `enabled` 改为 `false`，完成该站点自己的后台配置与线上验证后再启用。

## 数据库

1. 选择所有者确认的组织，创建专用项目；等待状态为 `ACTIVE_HEALTHY`。
2. 检查项目现有表，按顺序应用 `supabase/migrations/` 下的两份迁移。
3. 通过 Supabase Auth 正式管理接口或管理页面开通所有者指定的邮箱账号。不要直接向 `auth.users` 插入数据，也不要在源代码、聊天或公开仓库中保存密码。
4. 取得该账号经过确认的 Auth 用户 UUID，然后以管理权限写入唯一的管理员映射：

   ```sql
   insert into public.quote_analytics_owner(user_id)
   values ('经过核对的管理员 Auth UUID');
   ```

   `quote_analytics_owner` 只允许一行。浏览器账号不能新增或修改映射。不要按“第一个登录者”自动授权，也不要让客户端自行选择管理员身份。

5. 核实 `qingbao-analytics-retention` 定时任务已创建。应用内事件记录保留 30 天，限流记录保留不超过 2 天。即使清理延迟，读取策略也拒绝超过 30 天的记录。

## 采集函数

部署 `supabase/functions/quote-collect/`，入口 `index.ts`，包括 `handler.mjs`。

函数使用 Supabase 自动提供的 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEYS` 和 `SUPABASE_SECRET_KEYS`，优先使用名为 `default` 的现代 API key；旧环境兼容 `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`。

现代 API key 不属于 JWT，因此 `verify_jwt=false`，由函数检查项目 publishable key。此 key 公开，只识别项目；它不授予管理员权限。采集接口仅提供写入，不能读取任何访问记录。

函数同时验证来源、请求大小、事件类型、随机 UUID 和代理提供的 IP。客户端提交 IP、报价值或其他额外字段会被拒绝。服务器只读取 `CF-Connecting-IP`，不信任客户端 JSON、`X-Forwarded-For` 或 `X-Real-IP`。缺少合法的边缘 IP 时返回 503，不能用假 IP 代替。**上线必须在托管环境验证真实请求与伪造转发头的行为。**

数据库原子限流：每 IP 每分钟最多 60 个事件，全站每天最多 20,000 个事件。重复事件 UUID 只记一次。此统计不是身份认证或安全审计系统，恶意程序仍可能伪造使用事件。

## 前端配置

从项目读取 API URL 与启用的 `default` publishable key，填入 `analytics-config.js`。只允许公开 key，严禁填写 secret key、service-role key、数据库密码或管理员登录密码。

管理员页面使用 Supabase Auth 邮箱与密码登录；读取通过用户 JWT 和数据库 RLS 双重校验。登录会话保存在当前标签页的会话存储中，前端 8 小时后退出。登录接口采用 Supabase 的速率限制，页面没有开放注册入口。

首次密码设置使用 `admin/setup.html#token_hash=...`。由可信管理接口针对已核对的所有者生成 Supabase recovery token，私下交给所有者。此凭据只能使用一次，不要保存到仓库、截图或公开文档。设置页会移除地址栏中的 token，验证账号的管理员权限，再保存新密码并退出设置会话。密码至少 12 位、最多 72 个 UTF-8 字节。临时账号开通接口完成后必须关闭；后续重新生成链接也必须通过可信管理操作，不能开放自助领取入口。

完成验证后把 `enabled` 设为 `true`，再将完整静态页面和脚本发布至 GitHub Pages。正式报价网址与 `siteOrigin` / `sitePath` 必须匹配。离线 HTML 不采集；未配置的在线镜像保持入口锁定。

在线报价页要求用户先同意统计。报价区域在 HTML 中默认隐藏且不可交互，只有采集接口返回 204 后才加载计算脚本并开放。拒绝、撤回、跨标签页撤回、DNT / GPC、连接失败或配置错误均不会开放报价页。已同意的选择最长记忆 180 天，每次打开网页仍须确认采集连接。统计权限入口可随时撤回，保留本地草稿。

本次入口更新须在同一次 GitHub 提交中覆盖根目录的 `index.html`、`analytics.js`、`analytics.css`、`privacy.html` 四个文件，以免新旧脚本混用。无须修改已配置的 `analytics-config.js` 或后台账号。

这是公开静态网站的前端入口限制，不是服务端身份认证；访问者仍可下载或修改公开源码。管理员数据的保密继续由 Supabase Auth 和数据库 RLS 保证。

## 发布前验证

- 未登录的 key 无法直接读取事件、管理员映射或统计报告。
- 另一个已登录账号不能查询记录、调用报表或自行变成管理员。
- 管理员能登录、查询、筛选与导出；退出后清空页面中的记录。
- 采集调用只收到空响应；不会返回 IP 明细、服务密钥或数据库错误内容。
- 检查有效访问能写入真实边缘 IP；伪造转发头不能覆盖它。
- 新开报价页在同意前不加载计算脚本、不发送统计；同意且采集返回 204 后才进入。
- 拒绝、撤回或跨标签页撤回时锁定报价页并停止采集；DNT / GPC 下保持锁定。
- 采集失败、限流、脚本加载失败或配置错误时保持锁定；恢复后允许重试。
- 生成有效报价后才记录 `quote_generated`，不上传报价内容。
- 以明确标记的临时测试事件验证后，只清理这些测试 UUID。
- 检查 Supabase 安全建议和定时任务。确认真实环境与本地测试一致后再打开前端采集。

相关依据：[数据库权限](https://supabase.com/docs/guides/database/postgres/row-level-security)、[API key 与函数认证](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)、[Cloudflare IP 头](https://developers.cloudflare.com/fundamentals/reference/http-headers/)。
