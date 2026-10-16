# Create 部署说明

`create` 是独立项目（仓库：`diminglucky/create`），有自己的镜像 `ghcr.io/diminglucky/create`
和独立的数据库。**不要和 API 站（sub2api / superai）共用同一个数据库**：两者的迁移集不同，
虽然迁移按文件名记账、互不冲突，但混在一起会让回滚和备份变得很麻烦。

服务组成：`create`（应用）+ `postgres` + `redis`，编排见 `docker-compose.create.yml`。

---

## 一、准备 `.env`

在 `deploy/` 目录下建一个 `.env`（不要提交）：

```bash
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -base64 24)
JWT_SECRET=$(openssl rand -hex 32)
TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=换成你要用的强密码
SERVER_PORT=9898
TZ=Asia/Shanghai
EOF
```

要点：

- `JWT_SECRET` / `TOTP_ENCRYPTION_KEY` 必须固定：留空的话每次重启都会换密钥，前者让所有人掉线，
  后者让已经绑定过的双因素登录失效。
- `SERVER_PORT` 默认 `9898`（宿主机和容器用同一个端口），不会和 API 站常用的 8080 撞。
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` 只在第一次启动建管理员时用到。

## 二、上线

### 方式 A：服务器直接拉镜像（推荐）

CI 在推 `main` 时构建 `ghcr.io/diminglucky/create:main`。仓库是私有的，镜像也是私有的，
先在服务器上登录一次（PAT 勾 `read:packages` 即可）：

```bash
echo "<PAT>" | docker login ghcr.io -u diminglucky --password-stdin
docker compose -f docker-compose.create.yml pull
docker compose -f docker-compose.create.yml up -d
```

### 方式 B：本地打包后上传（服务器不能直连 GHCR 时用这条）

在本地仓库根目录：

```powershell
# 1. 构建镜像（根 Dockerfile 会把前端 build 进二进制，无需先跑 pnpm）
docker build -f Dockerfile -t create:local .

# 2. 导出成 tar
docker save -o create-image.tar create:local
```

上传并在服务器加载：

```bash
scp create-image.tar deploy/docker-compose.create.yml deploy/.env user@server:/opt/create/
# 服务器上
cd /opt/create
docker load -i create-image.tar
IMAGE=create:local docker compose -f docker-compose.create.yml up -d
```

> `IMAGE` 不写的话默认拉 `ghcr.io/diminglucky/create:main`；用本地 tar 时必须显式指定，
> 否则 compose 会去仓库拉同名镜像。

### 方式 C：只用二进制（不装 Docker 的服务器）

```powershell
cd frontend; pnpm run build            # 产物落到 backend/internal/web/dist
cd ../backend
$env:CGO_ENABLED=0; $env:GOOS="linux"; $env:GOARCH="amd64"
go build -tags embed -trimpath -ldflags="-s -w -X main.Version=0.2.15" -o ../create-linux-amd64 ./cmd/server
```

上传后在服务器上跑（需要自备 PostgreSQL / Redis，并写好 `config.yaml`）：

```bash
./create-linux-amd64            # 或包成 systemd 服务
```

注意：`-tags embed` 不能省，否则二进制里没有前端界面。

## 三、验证

```bash
docker compose -f docker-compose.create.yml ps
curl -sS localhost:9898/health
curl -sS -o /dev/null -w '%{http_code}\n' localhost:9898/home
```

首次启动会自动跑完所有迁移（`AUTO_SETUP=true`），日志里能看到 `Server started on 0.0.0.0:9898`。
用 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录 `/login` 进入后台。

## 四、升级与回滚

```bash
# 拉新镜像并只重建应用
docker compose -f docker-compose.create.yml pull create
docker compose -f docker-compose.create.yml up -d create
```

回滚就换 `IMAGE` 指向旧 tag（`sha-<commit>` 形式一直保留）。迁移只前进不回退，
回滚代码前先把 `./postgres_data` 备份一份。

## 五、上线后还要在服务器上配好的东西

这些不在编排里，需要进后台设置：

- 作品库依赖对象存储（图片/视频落盘用），在「设置 → 备份」里配 S3/R2。
- 生成能力依赖上游账号或 API Key，在「渠道/账号」里接。
- 反向代理 / HTTPS：容器只监听 9898，外部域名、证书、`X-Forwarded-Proto` 交给
  Caddy 或 Nginx；`/sitemap.xml`、`/robots.txt` 会按请求域名自动生成，不用改配置。

---

## 六、和已有的 API 站同机部署

服务器上已经跑着 API 站（sub2api / superai）时，按下面这几条隔离，两套互不干扰。

**1. 独立目录、独立 .env**

```bash
mkdir -p /opt/create && cd /opt/create
# docker-compose.create.yml、.env 放这里；API 站仍在它自己的目录
```

两边的 `.env` 里都有 `SERVER_PORT`、`POSTGRES_PASSWORD` 这类同名变量，**不要共用或互相
`source`**，否则会串。

**2. 端口独立**

默认用 9898，和 API 站常用的 8080 不冲突：

```
SERVER_PORT=9898
BIND_HOST=127.0.0.1     # 只让反代访问，不对公网直接开端口
```

**3. 数据库与缓存完全独立**

本编排自带一套 PostgreSQL 与 Redis，容器名（`create` / `create-postgres` / `create-redis`）、
网络（`create-network`）、数据目录（`./create-data` / `./create-postgres-data` /
`./create-redis-data`）都与 API 站
分离，两者不共享任何实例。**不要**图省事把 `DATABASE_*` 指到 API 站那台库上：两个项目的
迁移集不同，混在一起升级和回滚会互相牵连，备份也没法单独恢复。

两层防呆：

- 编排顶部写死了 `name: create`，无论从哪个目录执行，容器、网络、卷的归属都是同一套，
  不会因为换目录而变成另一套资源。
- 三个数据目录都带 `create-` 前缀，和 API 站的 `./data` / `./postgres_data` /
  `./redis_data` 不重名。即便这份编排被误放进 API 站的部署目录执行，也只会新建
  `create-*` 目录，不会挂到 API 站的数据目录上。

两个数据库都不向宿主机暴露端口（只有应用容器通过内部网络连 `postgres:5432` /
`redis:6379`），因此同机两套之间也不存在端口冲突。

**4. 反向代理加一个站点**

给 create 准备一个域名（例如 `create.superai.sbs` 或独立域名），反代到
`127.0.0.1:9898`，并透传 `X-Forwarded-Proto`（HTTPS 时填 `https`）。页面的 canonical、
`sitemap.xml`、`robots.txt` 都会按请求域名自动生成，不需要改代码或配置。Cloudflare
那边记得加对应的 DNS 记录，并确认回源端口和缓存规则不会拦到 `/api/`。

**5. 资源与备份**

- 编排里的 Postgres 默认压到 `max_connections=200 / shared_buffers=256MB`，比 API 站那套
  收敛很多；VPS 内存紧张就把 `POSTGRES_SHARED_BUFFERS` 再调到 128MB。
- 备份要分开做：create 的库在 `/opt/create/postgres_data`，API 站在它自己的目录里，
  别指望一次备份覆盖两边。

**6. 内容不会自动继承**

create 是全新的空库：API 站的渠道、账号、分组、用户都不会出现在这边。上线后需要在
create 后台重新接入上游账号或 API Key，作品库还要单独配对象存储（R2/S3）。

**7. 镜像仓库是私有的**

`ghcr.io/diminglucky/create` 是私有包，服务器拉之前要登录一次：

```bash
echo "<PAT, 勾 read:packages>" | docker login ghcr.io -u diminglucky --password-stdin
```

如果服务器不方便登录，就用方式 B（本地 `docker save` → `scp` → `docker load`）。
