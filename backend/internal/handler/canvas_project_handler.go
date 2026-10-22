package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

type CanvasProjectHandler struct {
	projects *service.CanvasProjectService
}

type createCanvasProjectRequest struct {
	Title string          `json:"title"`
	Graph json.RawMessage `json:"graph"`
}

type updateCanvasProjectRequest struct {
	ExpectedVersion int             `json:"expected_version"`
	Title           string          `json:"title"`
	Graph           json.RawMessage `json:"graph"`
}

func NewCanvasProjectHandler(projects *service.CanvasProjectService) *CanvasProjectHandler {
	return &CanvasProjectHandler{projects: projects}
}

func (h *CanvasProjectHandler) List(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	items, err := h.projects.List(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, items)
}

func (h *CanvasProjectHandler) Create(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	var request createCanvasProjectRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		response.BadRequest(c, "Invalid canvas project request")
		return
	}
	project, err := h.projects.Create(c.Request.Context(), subject.UserID, request.Title, request.Graph)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, project)
}

func (h *CanvasProjectHandler) Get(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	project, err := h.projects.Get(c.Request.Context(), subject.UserID, c.Param("id"))
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, project)
}

func (h *CanvasProjectHandler) Update(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	var request updateCanvasProjectRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		response.BadRequest(c, "Invalid canvas project request")
		return
	}
	project, err := h.projects.Update(
		c.Request.Context(),
		subject.UserID,
		strings.TrimSpace(c.Param("id")),
		request.Title,
		request.Graph,
		request.ExpectedVersion,
	)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, project)
}

func (h *CanvasProjectHandler) Delete(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	if err := h.projects.Delete(c.Request.Context(), subject.UserID, c.Param("id")); err != nil {
		response.ErrorFrom(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
