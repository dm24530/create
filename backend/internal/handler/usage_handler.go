package handler

import (
	"context"
	"encoding/base64"
	"errors"
	"html"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/handler/dto"
	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/pkg/timezone"
	"github.com/Wei-Shaw/sub2api/internal/pkg/usagestats"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"

	"github.com/gin-gonic/gin"
)

type userUsageFilters struct {
	Filters   usagestats.UsageLogFilters
	StartTime time.Time
	EndTime   time.Time
}

type userModelStat struct {
	Model               string  `json:"model"`
	Requests            int64   `json:"requests"`
	InputTokens         int64   `json:"input_tokens"`
	OutputTokens        int64   `json:"output_tokens"`
	CacheCreationTokens int64   `json:"cache_creation_tokens"`
	CacheReadTokens     int64   `json:"cache_read_tokens"`
	TotalTokens         int64   `json:"total_tokens"`
	Cost                float64 `json:"cost"`
	ActualCost          float64 `json:"actual_cost"`
}

type userGroupStat struct {
	GroupID     int64   `json:"group_id"`
	GroupName   string  `json:"group_name"`
	Requests    int64   `json:"requests"`
	TotalTokens int64   `json:"total_tokens"`
	Cost        float64 `json:"cost"`
	ActualCost  float64 `json:"actual_cost"`
}

// UsageHandler handles usage-related requests
type UsageHandler struct {
	usageService   *service.UsageService
	apiKeyService  *service.APIKeyService
	opsService     *service.OpsService
	settingService *service.SettingService
	imageLinks     service.UsageLogImageLinkStore
	imageStorage   usageImageStorage
	imageTasks     *service.ImageTaskService
	localAssets    *service.LocalImageAssetStore
}

type usageImageStorage interface {
	ImageObjectExists(ctx context.Context, objectKey string) (bool, error)
	PresignImageObject(ctx context.Context, objectKey string) (string, error)
	FetchImageURL(ctx context.Context, rawURL string) ([]byte, string, error)
}

func (h *UsageHandler) SetImageTaskService(tasks *service.ImageTaskService) {
	if h == nil {
		return
	}
	h.imageTasks = tasks
}

func (h *UsageHandler) SetImageLinkDeps(
	imageLinks service.UsageLogImageLinkStore,
	imageStorage usageImageStorage,
) {
	if h == nil {
		return
	}
	h.imageLinks = imageLinks
	h.imageStorage = imageStorage
}

func (h *UsageHandler) SetLocalImageAssetStore(store *service.LocalImageAssetStore) {
	if h == nil {
		return
	}
	h.localAssets = store
}

func (h *UsageHandler) ImageLink(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}
	if h.imageLinks == nil {
		writeExpiredUsageImage(c)
		return
	}
	link, err := h.imageLinks.GetByToken(c.Request.Context(), strings.TrimSpace(c.Param("token")))
	if err != nil {
		if errors.Is(err, service.ErrUsageLogImageLinkNotFound) {
			writeExpiredUsageImage(c)
			return
		}
		response.ErrorFrom(c, err)
		return
	}
	role, _ := middleware2.GetUserRoleFromContext(c)
	if link.UserID != subject.UserID && role != service.RoleAdmin {
		writeExpiredUsageImage(c)
		return
	}
	if h.serveLocalUsageImage(c, link) {
		return
	}
	if h.imageStorage != nil && strings.TrimSpace(link.ObjectKey) != "" {
		url, urlErr := h.imageStorage.PresignImageObject(c.Request.Context(), link.ObjectKey)
		if urlErr != nil {
			response.ErrorFrom(c, urlErr)
			return
		}
		data, contentType, fetchErr := h.imageStorage.FetchImageURL(c.Request.Context(), url)
		if fetchErr != nil {
			response.ErrorFrom(c, fetchErr)
			return
		}
		if !strings.HasPrefix(contentType, "image/") {
			contentType = "image/png"
		}
		c.Header("Cache-Control", "private, max-age=300")
		c.Header("Content-Disposition", "inline")
		c.Data(http.StatusOK, contentType, data)
		return
	}
	imageURL := strings.TrimSpace(link.ImageURL)
	if strings.HasPrefix(imageURL, "http://") || strings.HasPrefix(imageURL, "https://") {
		c.Redirect(http.StatusFound, imageURL)
		return
	}
	if strings.HasPrefix(imageURL, "data:image/") {
		comma := strings.IndexByte(imageURL, ',')
		header := ""
		if comma > len("data:") {
			header = imageURL[len("data:"):comma]
		}
		if strings.HasSuffix(strings.ToLower(header), ";base64") {
			contentType := strings.TrimSpace(strings.SplitN(header, ";", 2)[0])
			data, err := base64.StdEncoding.DecodeString(imageURL[comma+1:])
			if err == nil && len(data) > 0 && strings.HasPrefix(strings.ToLower(contentType), "image/") {
				c.Header("Cache-Control", "private, max-age=300")
				c.Header("Content-Disposition", "inline")
				c.Data(http.StatusOK, contentType, data)
				return
			}
		}
	}
	writeExpiredUsageImage(c)
}

type reportImageDisplayRequest struct {
	TaskID     string `json:"task_id" binding:"required"`
	DurationMs int    `json:"duration_ms"`
}

// ReportImageDisplay records when the browser actually rendered a generated
// image. Admin usage history uses this to distinguish request time from the
// time the user could finally see the image.
func (h *UsageHandler) ReportImageDisplay(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}
	if h.imageTasks == nil || h.imageLinks == nil {
		response.Error(c, http.StatusServiceUnavailable, "Image display tracking is unavailable")
		return
	}
	var request reportImageDisplayRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		response.BadRequest(c, "Invalid image display request")
		return
	}
	record, err := h.imageTasks.GetRecord(c.Request.Context(), strings.TrimSpace(request.TaskID))
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	if record == nil || record.UserID != subject.UserID {
		response.NotFound(c, "Image task not found")
		return
	}
	requestID := ""
	if record.Execution != nil {
		requestID = strings.TrimSpace(record.Execution.UsageRequestID)
	}
	if requestID == "" {
		response.Success(c, gin.H{"tracked": false})
		return
	}
	displayedAt := time.Now().UTC()
	if err := h.imageLinks.MarkDisplayed(
		c.Request.Context(),
		record.UserID,
		record.APIKeyID,
		requestID,
		displayedAt,
	); err != nil {
		response.ErrorFrom(c, err)
		return
	}
	durationMs := max(request.DurationMs, 0)
	if durationMs == 0 && record.CompletedAt != nil && record.StartedAt > 0 {
		durationMs = int(max(*record.CompletedAt-record.StartedAt, 0) * 1000)
	}
	if durationMs == 0 && record.CompletedAt != nil && record.CreatedAt > 0 {
		durationMs = int(max(*record.CompletedAt-record.CreatedAt, 0) * 1000)
	}
	if err := h.imageLinks.MarkGenerationDuration(
		c.Request.Context(),
		record.UserID,
		record.APIKeyID,
		requestID,
		durationMs,
	); err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, gin.H{
		"tracked":                true,
		"displayed_at":           displayedAt,
		"generation_duration_ms": durationMs,
	})
}

// OpenImageLink is a capability URL for browser image viewers. The opaque,
// expiring link token is the authorization; this avoids buffering the entire
// object in the frontend and redirects directly to object storage.
func (h *UsageHandler) OpenImageLink(c *gin.Context) {
	if h.imageLinks == nil {
		writeExpiredUsageImage(c)
		return
	}
	link, err := h.imageLinks.GetByToken(c.Request.Context(), strings.TrimSpace(c.Param("token")))
	if err != nil {
		if errors.Is(err, service.ErrUsageLogImageLinkNotFound) {
			writeExpiredUsageImage(c)
			return
		}
		response.ErrorFrom(c, err)
		return
	}
	imageURL := strings.TrimSpace(link.ImageURL)
	if h.serveLocalUsageImage(c, link) {
		return
	}
	if c.Query("full") != "1" && strings.HasPrefix(imageURL, "data:image/") {
		writeInlineUsageDataURL(c, imageURL)
		return
	}
	if h.imageStorage != nil && strings.TrimSpace(link.ObjectKey) != "" {
		url, urlErr := h.imageStorage.PresignImageObject(c.Request.Context(), link.ObjectKey)
		if urlErr != nil {
			response.ErrorFrom(c, urlErr)
			return
		}
		c.Header("Cache-Control", "private, max-age=300")
		c.Redirect(http.StatusFound, url)
		return
	}
	if strings.HasPrefix(imageURL, "http://") || strings.HasPrefix(imageURL, "https://") {
		c.Header("Cache-Control", "private, max-age=300")
		c.Redirect(http.StatusFound, imageURL)
		return
	}
	if strings.HasPrefix(imageURL, "data:image/") {
		writeInlineUsageDataURL(c, imageURL)
		return
	}
	writeExpiredUsageImage(c)
}

func (h *UsageHandler) serveLocalUsageImage(c *gin.Context, link *service.UsageLogImageLink) bool {
	if h == nil || h.localAssets == nil || link == nil {
		return false
	}
	if h.localAssets.IsAssetURL(link.ImageURL) {
		if data, contentType, handled, err := h.localAssets.ReadURL(c.Request.Context(), link.ImageURL); handled && err == nil && len(data) > 0 {
			writeUsageImageBytes(c, contentType, data)
			return true
		}
	}
	if objectKey := strings.TrimSpace(link.ObjectKey); objectKey != "" {
		if meta, err := h.localAssets.FindByObjectKey(objectKey); err == nil {
			if _, data, readErr := h.localAssets.Read(meta.ID); readErr == nil && len(data) > 0 {
				writeUsageImageBytes(c, meta.ContentType, data)
				return true
			}
		}
	}
	return false
}

func usageImageLinkIsGIF(imageURL, objectKey string) bool {
	if strings.EqualFold(path.Ext(strings.TrimSpace(objectKey)), ".gif") {
		return true
	}
	imageURL = strings.TrimSpace(imageURL)
	if strings.HasPrefix(strings.ToLower(imageURL), "data:image/gif") {
		return true
	}
	if idx := strings.IndexAny(imageURL, "?#"); idx >= 0 {
		imageURL = imageURL[:idx]
	}
	return strings.EqualFold(path.Ext(imageURL), ".gif")
}

func writeUsageImageBytes(c *gin.Context, contentType string, data []byte) {
	if !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		contentType = http.DetectContentType(data)
	}
	c.Header("Cache-Control", "private, max-age=300")
	c.Header("Content-Disposition", "inline")
	c.Data(http.StatusOK, contentType, data)
}

func writeInlineUsageDataURL(c *gin.Context, imageURL string) {
	comma := strings.IndexByte(imageURL, ',')
	header := ""
	if comma > len("data:") {
		header = imageURL[len("data:"):comma]
	}
	if !strings.HasSuffix(strings.ToLower(header), ";base64") {
		writeExpiredUsageImage(c)
		return
	}
	contentType := strings.TrimSpace(strings.SplitN(header, ";", 2)[0])
	data, err := base64.StdEncoding.DecodeString(imageURL[comma+1:])
	if err != nil || len(data) == 0 || !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		writeExpiredUsageImage(c)
		return
	}
	c.Header("Cache-Control", "private, max-age=300")
	c.Header("Content-Disposition", "inline")
	c.Data(http.StatusOK, contentType, data)
}

func writeExpiredUsageImage(c *gin.Context) {
	c.Data(http.StatusGone, "text/html; charset=utf-8", []byte(
		"<html><body style=\"font-family:sans-serif;padding:24px\">"+
			html.EscapeString("图片已过期或已被删除。")+
			"</body></html>",
	))
}

// NewUsageHandler creates a new UsageHandler
func NewUsageHandler(
	usageService *service.UsageService,
	apiKeyService *service.APIKeyService,
	opsService *service.OpsService,
	settingService *service.SettingService,
) *UsageHandler {
	return &UsageHandler{
		usageService:   usageService,
		apiKeyService:  apiKeyService,
		opsService:     opsService,
		settingService: settingService,
	}
}

func (h *UsageHandler) parseUserUsageFilters(c *gin.Context, requireRange bool) (*userUsageFilters, bool) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return nil, false
	}

	var apiKeyID int64
	if apiKeyIDStr := strings.TrimSpace(c.Query("api_key_id")); apiKeyIDStr != "" {
		id, err := strconv.ParseInt(apiKeyIDStr, 10, 64)
		if err != nil {
			response.BadRequest(c, "Invalid api_key_id")
			return nil, false
		}
		if h.apiKeyService == nil {
			response.InternalError(c, "API key service not available")
			return nil, false
		}
		apiKey, err := h.apiKeyService.GetByID(c.Request.Context(), id)
		if err != nil {
			response.ErrorFrom(c, err)
			return nil, false
		}
		if apiKey.UserID != subject.UserID {
			response.Forbidden(c, "Not authorized to access this API key's usage records")
			return nil, false
		}
		apiKeyID = id
	}

	var groupID int64
	if groupIDStr := strings.TrimSpace(c.Query("group_id")); groupIDStr != "" {
		id, err := strconv.ParseInt(groupIDStr, 10, 64)
		if err != nil {
			response.BadRequest(c, "Invalid group_id")
			return nil, false
		}
		groupID = id
	}

	var requestType *int16
	var stream *bool
	if requestTypeStr := strings.TrimSpace(c.Query("request_type")); requestTypeStr != "" {
		parsed, err := service.ParseUsageRequestType(requestTypeStr)
		if err != nil {
			response.BadRequest(c, err.Error())
			return nil, false
		}
		value := int16(parsed)
		requestType = &value
	} else if streamStr := strings.TrimSpace(c.Query("stream")); streamStr != "" {
		val, err := strconv.ParseBool(streamStr)
		if err != nil {
			response.BadRequest(c, "Invalid stream value, use true or false")
			return nil, false
		}
		stream = &val
	}

	var nativeCompactionV2 *bool
	if raw := strings.TrimSpace(c.Query("native_compaction_v2")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			response.BadRequest(c, "Invalid native_compaction_v2 value, use true or false")
			return nil, false
		}
		nativeCompactionV2 = &value
	}

	var billingType *int8
	if billingTypeStr := strings.TrimSpace(c.Query("billing_type")); billingTypeStr != "" {
		val, err := strconv.ParseInt(billingTypeStr, 10, 8)
		if err != nil {
			response.BadRequest(c, "Invalid billing_type")
			return nil, false
		}
		bt := int8(val)
		billingType = &bt
	}

	billingMode := strings.TrimSpace(c.Query("billing_mode"))
	if billingMode != "" && !service.BillingMode(billingMode).IsValidUsageFilter() {
		response.BadRequest(c, "Invalid billing_mode")
		return nil, false
	}

	userTZ := c.Query("timezone")
	now := timezone.NowInUserLocation(userTZ)
	var startTime, endTime time.Time
	var startPtr, endPtr *time.Time
	startDateStr := strings.TrimSpace(c.Query("start_date"))
	endDateStr := strings.TrimSpace(c.Query("end_date"))

	if startDateStr != "" {
		t, err := timezone.ParseInUserLocation("2006-01-02", startDateStr, userTZ)
		if err != nil {
			response.BadRequest(c, "Invalid start_date format, use YYYY-MM-DD")
			return nil, false
		}
		startTime = t
		startPtr = &startTime
	}
	if endDateStr != "" {
		t, err := timezone.ParseInUserLocation("2006-01-02", endDateStr, userTZ)
		if err != nil {
			response.BadRequest(c, "Invalid end_date format, use YYYY-MM-DD")
			return nil, false
		}
		endTime = t.AddDate(0, 0, 1)
		endPtr = &endTime
	}

	if requireRange {
		if startPtr == nil {
			switch c.DefaultQuery("period", "") {
			case "today":
				startTime = timezone.StartOfDayInUserLocation(now, userTZ)
			case "week":
				startTime = now.AddDate(0, 0, -7)
			case "month":
				startTime = now.AddDate(0, -1, 0)
			default:
				startTime = timezone.StartOfDayInUserLocation(now.AddDate(0, 0, -7), userTZ)
			}
			startPtr = &startTime
		}
		if endPtr == nil {
			if strings.TrimSpace(c.Query("period")) != "" {
				endTime = now
			} else {
				endTime = timezone.StartOfDayInUserLocation(now.AddDate(0, 0, 1), userTZ)
			}
			endPtr = &endTime
		}
	}

	return &userUsageFilters{
		Filters: usagestats.UsageLogFilters{
			UserID:             subject.UserID,
			APIKeyID:           apiKeyID,
			GroupID:            groupID,
			Model:              strings.TrimSpace(c.Query("model")),
			ModelFilterSource:  usagestats.ModelSourceRequested,
			RequestType:        requestType,
			Stream:             stream,
			NativeCompactionV2: nativeCompactionV2,
			BillingType:        billingType,
			BillingMode:        billingMode,
			StartTime:          startPtr,
			EndTime:            endPtr,
			IncludeErrors:      true,
		},
		StartTime: derefTime(startPtr),
		EndTime:   derefTime(endPtr),
	}, true
}

func derefTime(value *time.Time) time.Time {
	if value == nil {
		return time.Time{}
	}
	return *value
}

// List handles listing usage records with pagination
// GET /api/v1/usage
func (h *UsageHandler) List(c *gin.Context) {
	page, pageSize := response.ParsePagination(c)
	parsed, ok := h.parseUserUsageFilters(c, false)
	if !ok {
		return
	}

	params := pagination.PaginationParams{
		Page:      page,
		PageSize:  pageSize,
		SortBy:    c.DefaultQuery("sort_by", "created_at"),
		SortOrder: c.DefaultQuery("sort_order", "desc"),
	}

	records, result, err := h.usageService.ListWithFilters(c.Request.Context(), params, parsed.Filters)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	out := make([]dto.UsageLog, 0, len(records))
	for i := range records {
		out = append(out, *dto.UsageLogFromService(&records[i]).Localized(c.GetHeader("Accept-Language")))
	}
	response.Paginated(c, out, result.Total, page, pageSize)
}

// ListErrors handles listing the current user's failed requests (redacted).
// GET /api/v1/usage/errors
func (h *UsageHandler) ListErrors(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}

	// Visibility switch (fail-closed). Defense-in-depth: frontend also hides the tab.
	if h.settingService == nil || !h.settingService.IsUserErrorViewAllowed(c.Request.Context()) {
		response.Forbidden(c, "Error requests view is disabled")
		return
	}
	if h.opsService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Ops service not available")
		return
	}

	page, pageSize := response.ParsePagination(c)
	if pageSize > 100 {
		pageSize = 100
	}

	filter := &service.OpsErrorLogFilter{Page: page, PageSize: pageSize}

	// Date range (half-open [start, end)), reuse usage-list semantics.
	userTZ := c.Query("timezone")
	if startDateStr := c.Query("start_date"); startDateStr != "" {
		t, err := timezone.ParseInUserLocation("2006-01-02", startDateStr, userTZ)
		if err != nil {
			response.BadRequest(c, "Invalid start_date format, use YYYY-MM-DD")
			return
		}
		filter.StartTime = &t
	}
	if endDateStr := c.Query("end_date"); endDateStr != "" {
		t, err := timezone.ParseInUserLocation("2006-01-02", endDateStr, userTZ)
		if err != nil {
			response.BadRequest(c, "Invalid end_date format, use YYYY-MM-DD")
			return
		}
		t = t.AddDate(0, 0, 1)
		filter.EndTime = &t
	}

	filter.Model = strings.TrimSpace(c.Query("model"))

	if k := strings.TrimSpace(c.Query("api_key_id")); k != "" {
		n, err := strconv.ParseInt(k, 10, 64)
		if err != nil || n < 0 {
			response.BadRequest(c, "Invalid api_key_id")
			return
		}
		if n > 0 {
			filter.APIKeyID = &n
		}
	}

	if sc := strings.TrimSpace(c.Query("status_code")); sc != "" {
		n, err := strconv.Atoi(sc)
		if err != nil || n < 0 {
			response.BadRequest(c, "Invalid status_code")
			return
		}
		filter.StatusCodes = []int{n}
	}

	if cat := strings.TrimSpace(c.Query("category")); cat != "" {
		phases, types := service.CategoryToFilter(cat)
		filter.ErrorPhasesAny = phases
		filter.ErrorTypesAny = types
	}

	// 排序对齐用量明细:列白名单与方向归一在 repo 层,非法值回退 created_at DESC。
	filter.SetSort(c.Query("sort_by"), c.Query("sort_order"))

	result, err := h.opsService.ListUserErrorRequests(c.Request.Context(), subject.UserID, filter)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Paginated(c, result.Items, int64(result.Total), result.Page, result.PageSize)
}

// GetErrorDetail handles fetching one of the current user's failed-request details (redacted).
// GET /api/v1/usage/errors/:id
func (h *UsageHandler) GetErrorDetail(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}
	if h.settingService == nil || !h.settingService.IsUserErrorViewAllowed(c.Request.Context()) {
		response.Forbidden(c, "Error requests view is disabled")
		return
	}
	if h.opsService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Ops service not available")
		return
	}
	id, err := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || id <= 0 {
		response.BadRequest(c, "Invalid id")
		return
	}
	detail, err := h.opsService.GetUserErrorRequestDetail(c.Request.Context(), subject.UserID, id)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, detail)
}

// GetByID handles getting a single usage record
// GET /api/v1/usage/:id
func (h *UsageHandler) GetByID(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}

	usageID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		response.BadRequest(c, "Invalid usage ID")
		return
	}

	record, err := h.usageService.GetByID(c.Request.Context(), usageID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	// 验证所有权
	if record.UserID != subject.UserID {
		response.Forbidden(c, "Not authorized to access this record")
		return
	}

	response.Success(c, dto.UsageLogFromService(record).Localized(c.GetHeader("Accept-Language")))
}

// Stats handles getting usage statistics
// GET /api/v1/usage/stats
func (h *UsageHandler) Stats(c *gin.Context) {
	parsed, ok := h.parseUserUsageFilters(c, true)
	if !ok {
		return
	}

	stats, err := h.usageService.GetStatsWithFilters(c.Request.Context(), parsed.Filters)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	stats.TotalAccountCost = nil
	stats.UpstreamEndpoints = nil
	stats.EndpointPaths = nil

	response.Success(c, stats)
}

const (
	defaultAPIKeyDailyUsageDays = 30
	maxAPIKeyDailyUsageDays     = 90
)

func parseAPIKeyDailyUsageDays(raw string) (int, bool) {
	if strings.TrimSpace(raw) == "" {
		return defaultAPIKeyDailyUsageDays, true
	}
	days, err := strconv.Atoi(raw)
	if err != nil || days <= 0 || days > maxAPIKeyDailyUsageDays {
		return 0, false
	}
	return days, true
}

func apiKeyDailyUsageRange(days int, userTZ string) (time.Time, time.Time) {
	now := timezone.NowInUserLocation(userTZ)
	startTime := timezone.StartOfDayInUserLocation(now.AddDate(0, 0, -(days-1)), userTZ)
	endTime := timezone.StartOfDayInUserLocation(now.AddDate(0, 0, 1), userTZ)
	return startTime, endTime
}

// DashboardStats handles getting user dashboard statistics
// GET /api/v1/usage/dashboard/stats
func (h *UsageHandler) DashboardStats(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}

	stats, err := h.usageService.GetUserDashboardStats(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	response.Success(c, stats)
}

// DashboardTrend handles getting user usage trend data
// GET /api/v1/usage/dashboard/trend
func (h *UsageHandler) DashboardTrend(c *gin.Context) {
	parsed, ok := h.parseUserUsageFilters(c, true)
	if !ok {
		return
	}
	granularity := c.DefaultQuery("granularity", "day")

	trend, err := h.usageService.GetUsageTrendWithFilters(c.Request.Context(), parsed.StartTime, parsed.EndTime, granularity, parsed.Filters)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	response.Success(c, gin.H{
		"trend":       trend,
		"start_date":  parsed.StartTime.Format("2006-01-02"),
		"end_date":    parsed.EndTime.Add(-24 * time.Hour).Format("2006-01-02"),
		"granularity": granularity,
	})
}

// DashboardModels handles getting user model usage statistics
// GET /api/v1/usage/dashboard/models
func (h *UsageHandler) DashboardModels(c *gin.Context) {
	parsed, ok := h.parseUserUsageFilters(c, true)
	if !ok {
		return
	}

	modelSource := strings.TrimSpace(c.Query("model_source"))
	if modelSource != "" && modelSource != usagestats.ModelSourceRequested {
		response.BadRequest(c, "Invalid model_source, user usage only supports requested")
		return
	}

	stats, err := h.usageService.GetModelStatsWithFiltersBySource(c.Request.Context(), parsed.StartTime, parsed.EndTime, parsed.Filters, usagestats.ModelSourceRequested)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	response.Success(c, gin.H{
		"models":     userModelStatsFromUsageStats(stats),
		"start_date": parsed.StartTime.Format("2006-01-02"),
		"end_date":   parsed.EndTime.Add(-24 * time.Hour).Format("2006-01-02"),
	})
}

// DashboardSnapshotV2 returns usage-page chart data scoped to the current user.
// GET /api/v1/usage/dashboard/snapshot-v2
func (h *UsageHandler) DashboardSnapshotV2(c *gin.Context) {
	parsed, ok := h.parseUserUsageFilters(c, true)
	if !ok {
		return
	}

	granularity := strings.TrimSpace(c.DefaultQuery("granularity", "day"))
	if granularity != "hour" {
		granularity = "day"
	}
	includeTrend, ok := parseBoolQueryWithDefault(c, "include_trend", true)
	if !ok {
		return
	}
	includeModels, ok := parseBoolQueryWithDefault(c, "include_model_stats", true)
	if !ok {
		return
	}
	includeGroups, ok := parseBoolQueryWithDefault(c, "include_group_stats", false)
	if !ok {
		return
	}

	resp := gin.H{
		"generated_at": time.Now().UTC().Format(time.RFC3339),
		"start_date":   parsed.StartTime.Format("2006-01-02"),
		"end_date":     parsed.EndTime.Add(-24 * time.Hour).Format("2006-01-02"),
		"granularity":  granularity,
	}

	if includeTrend {
		trend, err := h.usageService.GetUsageTrendWithFilters(c.Request.Context(), parsed.StartTime, parsed.EndTime, granularity, parsed.Filters)
		if err != nil {
			response.ErrorFrom(c, err)
			return
		}
		resp["trend"] = trend
	}
	if includeModels {
		models, err := h.usageService.GetModelStatsWithFiltersBySource(c.Request.Context(), parsed.StartTime, parsed.EndTime, parsed.Filters, usagestats.ModelSourceRequested)
		if err != nil {
			response.ErrorFrom(c, err)
			return
		}
		resp["models"] = userModelStatsFromUsageStats(models)
	}
	if includeGroups {
		groups, err := h.usageService.GetGroupStatsWithFilters(c.Request.Context(), parsed.StartTime, parsed.EndTime, parsed.Filters)
		if err != nil {
			response.ErrorFrom(c, err)
			return
		}
		resp["groups"] = userGroupStatsFromUsageStats(groups)
	}

	response.Success(c, resp)
}

func userModelStatsFromUsageStats(stats []usagestats.ModelStat) []userModelStat {
	out := make([]userModelStat, 0, len(stats))
	for _, stat := range stats {
		out = append(out, userModelStat{
			Model:               stat.Model,
			Requests:            stat.Requests,
			InputTokens:         stat.InputTokens,
			OutputTokens:        stat.OutputTokens,
			CacheCreationTokens: stat.CacheCreationTokens,
			CacheReadTokens:     stat.CacheReadTokens,
			TotalTokens:         stat.TotalTokens,
			Cost:                stat.Cost,
			ActualCost:          stat.ActualCost,
		})
	}
	return out
}

func userGroupStatsFromUsageStats(stats []usagestats.GroupStat) []userGroupStat {
	out := make([]userGroupStat, 0, len(stats))
	for _, stat := range stats {
		out = append(out, userGroupStat{
			GroupID:     stat.GroupID,
			GroupName:   stat.GroupName,
			Requests:    stat.Requests,
			TotalTokens: stat.TotalTokens,
			Cost:        stat.Cost,
			ActualCost:  stat.ActualCost,
		})
	}
	return out
}

func parseBoolQueryWithDefault(c *gin.Context, key string, fallback bool) (bool, bool) {
	raw := c.Query(key)
	if strings.TrimSpace(raw) == "" {
		return fallback, true
	}
	parsed, err := strconv.ParseBool(raw)
	if err != nil {
		response.BadRequest(c, "Invalid "+key+" value, use true or false")
		return false, false
	}
	return parsed, true
}

// BatchAPIKeysUsageRequest represents the request for batch API keys usage
type BatchAPIKeysUsageRequest struct {
	APIKeyIDs []int64 `json:"api_key_ids" binding:"required"`
}

// DashboardAPIKeysUsage handles getting usage stats for user's own API keys
// POST /api/v1/usage/dashboard/api-keys-usage
func (h *UsageHandler) DashboardAPIKeysUsage(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}

	var req BatchAPIKeysUsageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Invalid request: "+err.Error())
		return
	}

	if len(req.APIKeyIDs) == 0 {
		response.Success(c, gin.H{"stats": map[string]any{}})
		return
	}

	// Limit the number of API key IDs to prevent SQL parameter overflow
	if len(req.APIKeyIDs) > 100 {
		response.BadRequest(c, "Too many API key IDs (maximum 100 allowed)")
		return
	}

	validAPIKeyIDs, err := h.apiKeyService.VerifyOwnership(c.Request.Context(), subject.UserID, req.APIKeyIDs)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	if len(validAPIKeyIDs) == 0 {
		response.Success(c, gin.H{"stats": map[string]any{}})
		return
	}

	stats, err := h.usageService.GetBatchAPIKeyUsageStats(c.Request.Context(), validAPIKeyIDs, time.Time{}, time.Time{})
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	response.Success(c, gin.H{"stats": stats})
}

// GetMyAPIKeyDailyUsage handles getting daily usage details for the current user's API key.
// GET /api/v1/user/api-keys/:id/usage/daily?days=30
func (h *UsageHandler) GetMyAPIKeyDailyUsage(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}

	apiKeyID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		response.BadRequest(c, "Invalid API key ID")
		return
	}

	days, ok := parseAPIKeyDailyUsageDays(c.DefaultQuery("days", ""))
	if !ok {
		response.BadRequest(c, "Invalid days, allowed range is 1-90")
		return
	}

	if h.apiKeyService == nil {
		response.InternalError(c, "API key service is not configured")
		return
	}

	apiKey, err := h.apiKeyService.GetByID(c.Request.Context(), apiKeyID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	if apiKey.UserID != subject.UserID {
		response.Forbidden(c, "Not authorized to access this API key's usage")
		return
	}

	userTZ := c.Query("timezone")
	startTime, endTime := apiKeyDailyUsageRange(days, userTZ)
	items, err := h.usageService.GetAPIKeyDailyUsage(c.Request.Context(), subject.UserID, apiKeyID, startTime, endTime)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	response.Success(c, gin.H{
		"items":      items,
		"days":       days,
		"start_date": startTime.Format("2006-01-02"),
		"end_date":   endTime.AddDate(0, 0, -1).Format("2006-01-02"),
	})
}
