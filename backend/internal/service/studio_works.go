package service

import (
	"context"
	"strings"
)

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
	Used  int64 `json:"used"`
	Limit int64 `json:"limit"`
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

// deleteStudioWorkByKey 负责「删除作品」的固定顺序：先删对象存储里的文件，
// 成功后再删记录。反过来会留下删不掉也查不到的孤儿文件。
//
// 没配对象存储时 DeleteObject 会报错，这里直接把错误抛出去、记录保持不动，
// 管理员补好配置后用户重试即可。
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
			return err
		}
	}
	return store.Delete(ctx, userID, id)
}
