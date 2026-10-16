package repository

import (
	"sync/atomic"
	"time"
)

// uniqueNanoSeq 是 uniqueNano 的进程内单调计数器。
var uniqueNanoSeq atomic.Int64

// uniqueNano 返回进程内严格递增的纳秒值，用作测试夹具的唯一后缀（邮箱、request_id、
// 外部 ID 等）。不要退回到直接读挂钟纳秒：Windows 与部分虚拟化环境的时钟粒度较粗，
// 紧凑循环里两次读数会相同，进而在唯一约束上撞车（例如 users_email_unique_active、
// idx_usage_logs_request_id_api_key_unique）。
func uniqueNano() int64 {
	for {
		last := uniqueNanoSeq.Load()
		now := time.Now().UnixNano()
		if now <= last {
			now = last + 1
		}
		if uniqueNanoSeq.CompareAndSwap(last, now) {
			return now
		}
	}
}
