# Create 部署：零基础从头到尾

照着从上到下敲就行。每一步都写了"成功应该看到什么"，对不上就停下看第 9 节排查。

> 本文假设服务器是 Ubuntu/Debian 的 Linux 服务器，你有 root 或 sudo 权限。
> 名词说明：**服务器**=你那台机器；**本地**=你自己这台 Windows 电脑。

---

## 0. 需要准备的东西

| 东西 | 说明 | 没有行不行 |
|---|---|---|
| Linux 服务器 | 1 核 2G 起，建议 2 核 4G 以上 | 不行 |
| Docker + Compose | 第 2 步装 | 不行 |
| 域名 | 例如 `create.superai.sbs` | 可以先不配，用 `IP:9898` 访问，之后再补 |
| GitHub PAT | 服务器直接从 GHCR 拉镜像时需要 | 用"本地打包"方式就不需要 |

---

## 1. 登录服务器

在本地 Windows 的终端里：

```powershell
ssh root@你的服务器IP
```

成功：提示符变成 `root@主机名:~#` 之类的样子。

> 后面所有以 `#` 开头的命令都在**服务器**上执行；标了"本地"的才在你 Windows 上执行。

---

## 2. 装 Docker（已经装了就跳过）

先在服务器上检查：

```bash
docker --version
docker compose version
```

- 两条都输出版本号 → 跳到第 3 步。
- 提示 command not found → 执行下面这条官方安装脚本：

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

装完再查一次 `docker --version` 和 `docker compose version` 确认。

成功：`Docker version 2x.x.x` 和 `Docker Compose version v2.x.x`。

---

## 3. 建目录、确认端口没被占

```bash
mkdir -p /opt/create
cd /opt/create

# 9898 必须没被占用：这条命令没有输出才算通过
ss -lntp | grep 9898
```

成功：`grep` 没有任何输出。如果有输出，说明 9898 已被别的程序占用，把后面所有
`9898` 换成别的端口（例如 9899）。

> 如果这台服务器上已经跑了别的项目（比如 API 站），完全没问题：create 有自己独立的
> 数据库、缓存、网络和数据目录，只要求端口不冲突。

---

## 4. 生成密钥并写配置文件

```bash
cd /opt/create

cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -base64 24)
JWT_SECRET=$(openssl rand -hex 32)
TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)
ADMIN_EMAIL=你的邮箱@example.com
ADMIN_PASSWORD=你要用的后台密码
SERVER_PORT=9898
TZ=Asia/Shanghai
EOF

chmod 600 .env
cat .env
```

成功：`cat .env` 能看到 5 行内容，`JWT_SECRET` / `TOTP_ENCRYPTION_KEY` 都是 64 位十六进制。

要点：

- `ADMIN_EMAIL` / `ADMIN_PASSWORD` 就是你的后台账号，**记好**，只在第一次启动时创建。
- `JWT_SECRET` 和 `TOTP_ENCRYPTION_KEY` 一旦上线就不要再改；改了所有人会掉线、
  已绑定的两步验证会失效。
- 准备用域名 + 反向代理的话，再加一行 `BIND_HOST=127.0.0.1`（这样 9898 只允许本机访问，
  外面走反代进来）。只用 IP 直接访问就不要加。

---

## 5. 把编排文件放进来

两种方式二选一。

### 5A. 服务器能访问 GitHub

```bash
cd /opt/create
git clone --depth 1 https://github.com/diminglucky/create.git src
cp src/deploy/docker-compose.create.yml .
ls -l docker-compose.create.yml
```

> 私有仓库需要登录，或者用方式 5B。

### 5B. 本地传上去

本地 Windows 上，把仓库里的 `deploy/docker-compose.create.yml` 传上去：

```powershell
scp C:\项目\code\sub2api\deploy\docker-compose.create.yml root@你的服务器IP:/opt/create/
```

成功：服务器上 `ls -l /opt/create/docker-compose.create.yml` 能看到文件。

---

## 6. 把镜像弄到服务器上

### 6A. 服务器直接拉（推荐，最省事）

镜像放在 GitHub 的私有仓库里，先登录一次。PAT 这样建：
GitHub → 右上头像 → Settings → Developer settings → Personal access tokens →
Tokens (classic) → Generate new token (classic) → 只勾 **read:packages** → 生成后复制。

```bash
echo "把PAT粘到这里" | docker login ghcr.io -u diminglucky --password-stdin
docker pull ghcr.io/diminglucky/create:main
```

成功：最后一行是 `Status: Downloaded newer image for ghcr.io/diminglucky/create:main`。

> 如果卡在下载或报网络错误，说明服务器连不上 GHCR，改用 6B。

### 6B. 本地打包后上传（服务器连不上 GHCR 时用）

本地 Windows 上（需要本地装了 Docker Desktop 并已启动），在仓库根目录执行：

```powershell
docker build -f Dockerfile -t create:local .
docker save -o create-image.tar create:local
```

成功：当前目录出现 `create-image.tar`（约几百 MB）。

传到服务器并加载：

```powershell
scp create-image.tar root@你的服务器IP:/opt/create/
```

```bash
cd /opt/create
docker load -i create-image.tar
docker images | grep create
```

成功：`docker images` 里能看到 `create:local`。

> 用这种方式启动时，命令里要带 `IMAGE=create:local`（见下一步），否则 compose 会去
> 拉远端镜像。

---

## 7. 启动

```bash
cd /opt/create
```

6A 拉镜像的情况：

```bash
docker compose -f docker-compose.create.yml up -d
```

6B 本地打包的情况：

```bash
IMAGE=create:local docker compose -f docker-compose.create.yml up -d
```

第一次启动会自动创建数据库、跑完所有迁移、建好管理员，大概要等 20~40 秒。

看状态：

```bash
docker compose -f docker-compose.create.yml ps
```

成功：三行都显示 `Up ... (healthy)`。刚启动时可能是 `(health: starting)`，等半分钟再看。

自检：

```bash
curl -sS localhost:9898/health
curl -sS -o /dev/null -w '%{http_code}\n' localhost:9898/home
```

成功：第一条返回 `{"status":"ok"}` 之类的 JSON，第二条输出 `200`。

---

## 8. 登录后台，把站点配起来

1. 浏览器打开 `http://你的服务器IP:9898/login`，用第 4 步的 `ADMIN_EMAIL` /
   `ADMIN_PASSWORD` 登录。
2. 进「设置 → 站点」核对站点名、副标题、logo（默认已经是 Create 的文案）。
3. **接上游**：在「渠道」「账号」里添加生成用的账号或 API Key（视频、生图各一条），
   加完用「测试」按钮验证。
4. **配对象存储**（作品库必需）：「设置 → 备份」填 S3/R2 的 endpoint、bucket、AK/SK，
   保存后打开图片存储开关。
5. **跑通一次真实生成**：视频工坊出一个短片、图片工坊出一张图，再去「用量」里确认
   有计费记录。这是唯一能证明整条链路真的通的检查。

---

## 9. 配域名和 HTTPS（建议做）

先在域名服务商那里加一条 A 记录，指向服务器 IP（例如 `create.example.com`）。

### 9.1 用 Caddy（最简单，证书自动申请）

```bash
# Ubuntu 官方源里没有 caddy，先加它的源
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

cat > /etc/caddy/Caddyfile <<'EOF'
create.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:9898
}
EOF
systemctl reload caddy
```

Caddy 会自动申请证书并带上 `X-Forwarded-Proto`。

> 用反代时记得 `.env` 里加 `BIND_HOST=127.0.0.1`，然后
> `docker compose -f docker-compose.create.yml up -d` 重建一次应用。

### 9.2 用 Nginx

```nginx
server {
    listen 80;
    server_name create.example.com;

    client_max_body_size 256m;      # 参考图/素材上传
    proxy_read_timeout 900s;        # 生成是长请求，默认 60s 会被掐断
    proxy_send_timeout 900s;

    location / {
        proxy_pass http://127.0.0.1:9898;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;        # 流式输出不要缓冲
    }
}
```

再用 `certbot --nginx` 签证书即可。

**Cloudflare 用户注意**：SSL/TLS 模式选 Full 或 Full (strict)；别让缓存规则命中 `/api/`。

成功：用域名打开能进登录页、证书有效、首页标题是 `Create ...`。

---

## 10. 日常运维

```bash
cd /opt/create

# 看状态 / 看日志
docker compose -f docker-compose.create.yml ps
docker compose -f docker-compose.create.yml logs -f create --tail 100

# 重启 / 停止
docker compose -f docker-compose.create.yml restart create
docker compose -f docker-compose.create.yml stop

# 升级到最新镜像
docker compose -f docker-compose.create.yml pull create
docker compose -f docker-compose.create.yml up -d create

# 备份（每天跑一次可以写成 crontab）
tar czf /backup/create-$(date +%F).tar.gz -C /opt/create create-postgres-data create-data
```

回滚：把 `IMAGE` 指向旧版本（CI 每次构建都会留 `sha-<commit>` 标签），
`IMAGE=ghcr.io/diminglucky/create:sha-xxxxxxx docker compose -f docker-compose.create.yml up -d create`。
数据库迁移只前进不回退，回滚代码前先备份。

---

## 11. 出问题怎么排查

按症状找：

| 症状 | 原因 / 处理 |
|---|---|
| `docker compose up` 报 `POSTGRES_PASSWORD is required` | `.env` 里少了必填项，`cat .env` 检查；注意 `.env` 必须和 compose 文件在同一个目录 |
| 报 `JWT_SECRET is required` | 同上，第 4 步的 `.env` 没写全 |
| 容器起不来、日志里 `address already in use` | 9898 被占用，换端口（`.env` 里改 `SERVER_PORT`，然后 `up -d` 重建） |
| `docker pull` 卡住 / `connection timed out` | 服务器连不上 GHCR，改用 6B 本地打包 |
| `docker login ghcr.io` 报 `denied` | PAT 没勾 `read:packages`，或者用户名不对 |
| 容器一直 `unhealthy` | `docker compose logs create --tail 100` 看最后几行；数据库还没起来时多等 30 秒 |
| 打开页面是空白 / 502 | 反代没连上：确认 `BIND_HOST` 和反代里的端口都是 9898；`curl -sS localhost:9898/health` 先在服务器本机测通 |
| 生成图片/视频失败 | 后台还没接上游账号；或对象存储没配（作品库保存会失败） |
| 上传大文件报 413 | 反代的 `client_max_body_size` 调大 |
| 生成到一半断掉 | 反代的 `proxy_read_timeout` 调大（默认 60 秒太短） |
| 忘了后台密码 | 改 `.env` 里的 `ADMIN_PASSWORD` 后重建容器不会自动改；用数据库里的管理员账号重置，或联系我处理 |

遇到搞不定的，把这三条的输出发我：

```bash
docker compose -f docker-compose.create.yml ps
docker compose -f docker-compose.create.yml logs create --tail 100
cat /opt/create/.env | sed 's/=.*/=***/'
```

（最后一条会把值打码，只留变量名，可以放心发。）
