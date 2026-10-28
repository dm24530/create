package service

import (
	"context"
	"errors"
	"net/http"
	"strings"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"go.uber.org/zap"
)

// ErrStudioWorksQuotaExceeded 是存储层的通用"配额已满"信号：
// store 不知道作品类型，由各工作台把它翻译成自己的错误码（图片/视频各一个）。
var ErrStudioWorksQuotaExceeded = infraerrors.New(
	http.StatusTooManyRequests,
	"STUDIO_WORKS_QUOTA_EXCEEDED",
	"studio works quota reached",
)

// ErrStudioWorksTempLimitExceeded 是临时内容的堆积上限：临时作品不占配额，
// 但如果完全不设上限，脚本刷生成就能把桶撑爆。超了让用户先保存或等过期。
var ErrStudioWorksTempLimitExceeded = infraerrors.New(
	http.StatusTooManyRequests,
	"STUDIO_WORKS_TEMP_LIMIT_EXCEEDED",
	"too many temporary works",
)

// ErrStudioWorkExpired 表示取消保存时，作品按临时内容保留期计算已经过期。
// 调用方必须提示用户确认后，再走正式的删除流程清理记录和对象存储。
var ErrStudioWorkExpired = infraerrors.New(
	http.StatusConflict,
	"STUDIO_WORK_EXPIRED",
	"studio work has expired",
)

// StudioWorksTempLimit 是每个用户同时保留的临时作品上限（图片 + 视频合计）。
const StudioWorksTempLimit = 500

// studioWorkStore 是图片/视频两个 store 接口的公共子集：删除作品只用得上这两步。
type studioWorkStore interface {
	ObjectKey(ctx context.Context, userID int64, id string) (string, error)
	Delete(ctx context.Context, userID int64, id string) error
}

// studioObjectDeleter 是对象存储删除能力的公共子集。
type studioObjectDeleter interface {
	DeleteObject(ctx context.Context, key string) error
}

// StudioWorksQuota 描述用户的配额使用情况，供前端展示「已用 N / 上限」。
type StudioWorksQuota struct {
	Used             int64 `json:"used"`
	Limit            int64 `json:"limit"`
	RetentionSeconds int64 `json:"retention_seconds"`
}

// studioQuotaReader 是读配额上限的最小接口，由对象存储设置服务实现。
type studioQuotaReader interface {
	StudioWorksQuota() int
}

// resolveStudioQuota 读后台配置的配额上限；读不到或配成非正数时回落内置默认值。
func resolveStudioQuota(reader studioQuotaReader) int64 {
	if reader != nil {
		if limit := reader.StudioWorksQuota(); limit > 0 {
			return int64(limit)
		}
	}
	return int64(StudioWorksQuotaPerUser)
}

// studioWorksListLimitMax 是列表一次最多返回多少条：配额可以配到 10000，
// 但一次吐一万条对内存和前端都不友好，这里封顶。
const studioWorksListLimitMax = 1000

// studioWorksListLimit 让列表条数跟着配额走。
//
// 这一步是必须的：配额放宽到 500、列表却还写死 100 的话，用户只能看到最近 100 条，
// 更早的作品既看不到也删不掉——配额满了就彻底卡死。
func studioWorksListLimit(reader studioQuotaReader) int {
	limit := resolveStudioQuota(reader)
	if limit < 100 {
		return 100
	}
	if limit > studioWorksListLimitMax {
		return studioWorksListLimitMax
	}
	return int(limit)
}

// deleteStudioWorkByKey 负责「删除作品」的固定顺序：先删对象存储里的文件，
// 成功后再删记录。反过来会留下删不掉也查不到的孤儿文件。
//
// 唯一例外是"存储根本没配好"（被停用或凭证不全）：这时对象删不掉，
// 但绝不能因此把用户卡住——记录照删，只是日志里留下孤儿对象的线索。
// 存储配好但调用失败（网络/鉴权）仍然报错并保留记录，这样用户重试即可。
func deleteStudioWorkByKey(
	ctx context.Context,
	store studioWorkStore,
	storage studioObjectDeleter,
	userID int64,
	id string,
) error {
	key, err := store.ObjectKey(ctx, userID, id)
	if err != nil {
		return err
	}
	if trimmed := strings.TrimSpace(key); trimmed != "" && storage != nil {
		if err := storage.DeleteObject(ctx, trimmed); err != nil {
			if !isStorageNotConfigured(err) {
				return err
			}
			logger.L().Warn("studio_work.object_delete_skipped",
				zap.String("object_key", trimmed),
				zap.Error(err))
		}
	}
	return store.Delete(ctx, userID, id)
}

// isStorageNotConfigured 区分"存储没配好"和"存储调用失败"：
// 前者删不了对象（也不该拦着用户删记录），后者可以重试。
func isStorageNotConfigured(err error) bool {
	return errors.Is(err, ErrImageStorageDisabled) || errors.Is(err, ErrImageStorageIncomplete)
}
