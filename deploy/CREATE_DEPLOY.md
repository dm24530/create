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
SERVER_PORT=8080
TZ=Asia/Shanghai
EOF
```

要点：

- `JWT_SECRET` / `TOTP_ENCRYPTION_KEY` 必须固定：留空的话每次重启都会换密钥，前者让所有人掉线，
  后者让已经绑定过的双因素登录失效。
- `SERVER_PORT` 是宿主机端口。如果和 API 站同机部署，改成 8081 之类没被占用的端口。
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
curl -sS localhost:8080/health
curl -sS -o /dev/null -w '%{http_code}\n' localhost:8080/home
```

首次启动会自动跑完所有迁移（`AUTO_SETUP=true`），日志里能看到 `Server started on 0.0.0.0:8080`。
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
- 反向代理 / HTTPS：容器只监听 8080，外部域名、证书、`X-Forwarded-Proto` 交给
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

**2. 端口错开**

API 站一般占宿主机 8080，给 create 换一个：

```
SERVER_PORT=8081
BIND_HOST=127.0.0.1     # 只让反代访问，不对公网直接开端口
```

**3. 数据库相互独立（最重要）**

- 默认做法：用本编排自带的 Postgres 容器。容器名（`create` / `create-postgres` /
  `create-redis`）、网络（`create-network`）、数据目录（`./postgres_data`）都与 API 站分离。
- 想省内存、复用 API 站那台 Postgres 也可以，但必须：

  ```bash
  # 在 API 站的 PG 里建独立库与用户
  CREATE USER create_app WITH PASSWORD '<强密码>';   -- 别用 API 站的应用账号
  CREATE DATABASE create OWNER create_app;
  ```

  然后删掉本编排里的 `postgres` 服务，把 `DATABASE_HOST/PORT/USER/PASSWORD/DBNAME`
  指向那台实例。**绝不能把 dbname 指成 API 站那个库**：两个项目的迁移集不同，
  混在一起会让升级和回滚互相牵连，备份也无法单独恢复。
- 同理 Redis 也可以复用 API 站那台，但建议 `REDIS_DB` 用不同的序号（如 `1`）。

**4. 反向代理加一个站点**

给 create 准备一个域名（例如 `create.superai.sbs` 或独立域名），反代到
`127.0.0.1:8081`，并透传 `X-Forwarded-Proto`（HTTPS 时填 `https`）。页面的 canonical、
`sitemap.xml`、`robots.txt` 都会按请求域名自动生成，不需要改代码或配置。Cloudflare
那边记得加对应的 DNS 记录，并确认回源端口和缓存规则不会拦到 `/api/`。

**5. 资源与备份**

- 编排里的 Postgres 默认压到 `max_connections=200 / shared_buffers=256MB`，比 API 站那套
  收敛很多；VPS 内存紧张就把 `POSTGRES_SHARED_BUFFERS` 再调到 128MB，或者干脆复用
  API 站的 PG 实例（见第 3 条）。
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
